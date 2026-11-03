// Lot I1 — JIT reconciliation for the immo-mcp front gate (raw-SQL mirror of
// `api/src/admission/jit.ts`, which immo-mcp cannot import without dragging
// drizzle into the MCP bundle).
//
// Same contract: join key is the verified email (never the sub), an already
// linked account is never relinked, local accounts are never hijacked. The
// caller supplies a WRITABLE store (the read-only account pool cannot link)
// and only invokes this when the account is missing or not approved.

export interface AdmissionJitInput {
  /** MCP subject (this environment's IdP). */
  sub: string;
  /** Claimed email (verified upstream token). */
  email: string;
  /** Upstream `email_verified` claim — must be true. */
  emailVerified: boolean;
  /** Issuer that verified the claims (upstream token iss). */
  issuer: string;
}

export interface AdmissionJitStore {
  query(sql: string, args: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export type AdmissionJitMode = "created" | "upgraded" | "reapproved" | "already";

export type AdmissionJitOutcome =
  | { linked: true; mode: AdmissionJitMode }
  | { linked: false; reason: AdmissionJitRejectReason };

export type AdmissionJitRejectReason =
  | "unverified_email"
  | "untrusted_issuer"
  | "missing_email"
  | "not_admitted"
  | "not_approved"
  | "already_linked_elsewhere"
  | "local_conflict"
  | "account_blocked";

export interface AdmissionJitOptions {
  trustedIssuers: string[];
  now?: () => number;
}

export function normalizeJitEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

interface StagedRow {
  status: string;
  role: string;
  name: string | null;
}

interface AccountRow {
  sub: string;
  email: string | null;
  status: string;
  approvedAt: string | Date | null;
  admissionSource: string;
}

function toAccountRow(raw: Record<string, unknown>): AccountRow {
  return {
    sub: String(raw["sub"]),
    email: typeof raw["email"] === "string" ? raw["email"] : null,
    status: String(raw["status"]),
    approvedAt: (raw["approved_at"] as string | Date | null) ?? null,
    admissionSource: String(raw["admission_source"]),
  };
}

/**
 * Totally-ordered winner is decided API-side at snapshot build time, so the
 * staging table already holds one row per email: this mirror only reads it.
 */
export async function reconcileAdmissionLink(
  store: AdmissionJitStore,
  input: AdmissionJitInput,
  opts: AdmissionJitOptions,
): Promise<AdmissionJitOutcome> {
  if (!input.emailVerified) return { linked: false, reason: "unverified_email" };
  if (!opts.trustedIssuers.includes(input.issuer)) return { linked: false, reason: "untrusted_issuer" };
  if (typeof input.email !== "string" || input.email.trim() === "") {
    return { linked: false, reason: "missing_email" };
  }
  const norm = normalizeJitEmail(input.email);
  const now = new Date(opts.now?.() ?? Date.now());

  const stagedRows = (
    await store.query("SELECT status, role, name FROM admission_sync_profiles WHERE email = $1 LIMIT 1", [norm])
  ).rows;
  const staged = stagedRows[0] as unknown as StagedRow | undefined;
  if (!staged) return { linked: false, reason: "not_admitted" };
  if (staged.status !== "approved") return { linked: false, reason: "not_approved" };
  const isAdmin = staged.role === "admin";

  const bySubRows = (
    await store.query(
      "SELECT sub, email, status, approved_at, admission_source FROM account_users WHERE sub = $1 LIMIT 1",
      [input.sub],
    )
  ).rows;

  if (bySubRows.length > 0) {
    const row = toAccountRow(bySubRows[0]!);
    if (row.admissionSource === "prod_sync") {
      if (row.email === null || normalizeJitEmail(row.email) !== norm) {
        return { linked: false, reason: "already_linked_elsewhere" };
      }
      if (row.status === "approved") return { linked: true, mode: "already" };
      const updated = (
        await store.query(
          "UPDATE account_users SET status = 'approved', is_admin = $1 WHERE sub = $2 AND admission_source = 'prod_sync' RETURNING id",
          [isAdmin, input.sub],
        )
      ).rows;
      return updated.length > 0
        ? { linked: true, mode: "reapproved" }
        : { linked: false, reason: "not_approved" };
    }
    if (row.status === "approved") return { linked: true, mode: "already" };
    if (row.status === "rejected" || row.status === "suspended") {
      return { linked: false, reason: "account_blocked" };
    }
    if (row.status !== "pending" || row.approvedAt !== null) {
      return { linked: false, reason: "local_conflict" };
    }
    if (row.email === null || normalizeJitEmail(row.email) !== norm) {
      return { linked: false, reason: "local_conflict" };
    }
    if (await hasProdSyncLink(store, norm, input.sub)) {
      return { linked: false, reason: "already_linked_elsewhere" };
    }
    if (await hasLocalSameEmail(store, norm, input.sub)) {
      return { linked: false, reason: "local_conflict" };
    }
    try {
      const updated = (
        await store.query(
          `UPDATE account_users SET email = $1, name = COALESCE($2, name), status = 'approved',
             is_admin = $3, approved_at = $4, approved_by = 'prod-sync', admission_source = 'prod_sync'
           WHERE sub = $5 AND status = 'pending' AND admission_source = 'local' RETURNING id`,
          [input.email.trim(), staged.name, isAdmin, now.toISOString(), input.sub],
        )
      ).rows;
      return updated.length > 0
        ? { linked: true, mode: "upgraded" }
        : { linked: false, reason: "local_conflict" };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return { linked: false, reason: "already_linked_elsewhere" };
    }
  }

  if (await hasProdSyncLink(store, norm)) {
    return { linked: false, reason: "already_linked_elsewhere" };
  }
  if (await hasLocalSameEmail(store, norm)) {
    return { linked: false, reason: "local_conflict" };
  }

  try {
    const inserted = (
      await store.query(
        `INSERT INTO account_users (sub, email, name, status, is_admin, approved_at, approved_by, admission_source)
         VALUES ($1, $2, $3, 'approved', $4, $5, 'prod-sync', 'prod_sync')
         ON CONFLICT (sub) DO NOTHING RETURNING id`,
        [input.sub, input.email.trim(), staged.name, isAdmin, now.toISOString()],
      )
    ).rows;
    if (inserted.length > 0) return { linked: true, mode: "created" };
    const winnerRows = (
      await store.query("SELECT sub, email, status, approved_at, admission_source FROM account_users WHERE sub = $1 LIMIT 1", [
        input.sub,
      ])
    ).rows;
    const winner = winnerRows[0] ? toAccountRow(winnerRows[0]!) : null;
    if (winner && winner.email !== null && normalizeJitEmail(winner.email) === norm) {
      return { linked: true, mode: "created" };
    }
    return { linked: false, reason: "already_linked_elsewhere" };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { linked: false, reason: "already_linked_elsewhere" };
  }
}

async function hasProdSyncLink(store: AdmissionJitStore, norm: string, excludeSub?: string): Promise<boolean> {
  const rows = (
    await store.query(
      `SELECT sub FROM account_users WHERE admission_source = 'prod_sync' AND lower(email) = $1
       ${excludeSub !== undefined ? "AND sub <> $2" : ""} LIMIT 1`,
      excludeSub !== undefined ? [norm, excludeSub] : [norm],
    )
  ).rows;
  return rows.length > 0;
}

async function hasLocalSameEmail(store: AdmissionJitStore, norm: string, excludeSub?: string): Promise<boolean> {
  const rows = (
    await store.query(
      `SELECT sub FROM account_users WHERE admission_source = 'local' AND lower(email) = $1
       ${excludeSub !== undefined ? "AND sub <> $2" : ""} LIMIT 1`,
      excludeSub !== undefined ? [norm, excludeSub] : [norm],
    )
  ).rows;
  return rows.length > 0;
}

/**
 * Pure extraction of the JIT identity from already-verified upstream token
 * claims (the MCP resource-server guard verified signature/issuer/audience
 * before dispatch). Returns `undefined` when the token carries nothing the
 * JIT can use — the gate then keeps its historical closed behaviour.
 */
export function admissionJitInputFromClaims(
  claims: Record<string, unknown> | null | undefined,
): { email: string; emailVerified: boolean; issuer: string } | undefined {
  if (!claims || typeof claims !== "object") return undefined;
  const email = claims["email"];
  const issuer = claims["iss"];
  if (typeof email !== "string" || email.trim() === "") return undefined;
  if (typeof issuer !== "string" || issuer === "") return undefined;
  return { email, emailVerified: claims["email_verified"] === true, issuer };
}
