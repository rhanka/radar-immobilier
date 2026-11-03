// Lot I1 — JIT reconciliation of the preprod `sub` by verified email.
//
// The two environments use distinct IdP domains, so the preprod `sub` can
// differ from the prod `sub`: NEVER assume they are equal. The join key is
// the verified email, and only `email_verified=true` from a trusted issuer
// is accepted. An account that is already linked can never be relinked.
//
// Placement (converged R2 §2.6, normative): (a) in the reader opening flow on
// the control origin, BEFORE getRights, at the initial 303 of a shared link;
// (b) at MCP/app login. Both call sites proceed to their normal flow
// regardless of the outcome — JIT never blocks, it only links.
//
// Concurrency: two tabs with the same email produce exactly one link. The
// link is a single-row INSERT guarded by the partial unique index on
// lower(email) for prod_sync rows (plus the global sub uniqueness); a unique
// violation re-reads instead of failing.

import { and, eq, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { accountUsers, admissionSyncProfiles } from "../db/schema.js";
import { normalizeAdmissionEmail } from "./snapshot.js";

export interface JitInput {
  /** Preprod session/bearer subject (this environment's IdP). */
  sub: string;
  /** Claimed email (IdP id_token / access token). */
  email?: string;
  /** IdP `email_verified` claim — must be true. */
  emailVerified: boolean;
  /** Issuer that verified the claims (id_token iss). */
  issuer: string;
}

export interface JitContext {
  trustedIssuers: string[];
  now?: () => number;
}

export type JitLinkMode = "created" | "upgraded" | "reapproved" | "already";

export type JitOutcome =
  | { linked: true; mode: JitLinkMode }
  | { linked: false; reason: JitRejectReason };

export type JitRejectReason =
  | "unverified_email"
  | "untrusted_issuer"
  | "missing_email"
  | "not_admitted"
  | "not_approved"
  | "already_linked_elsewhere"
  | "local_conflict"
  | "account_blocked";

type AccountRow = typeof accountUsers.$inferSelect;

function emailMatches(row: AccountRow, norm: string): boolean {
  return typeof row.email === "string" && normalizeAdmissionEmail(row.email) === norm;
}

/** Another `sub` already linked to this email via `prod_sync`: never relink. */
async function findProdSyncLink(db: Database, norm: string, excludeSub?: string): Promise<boolean> {
  const filters = [
    eq(accountUsers.admissionSource, "prod_sync"),
    sql`lower(${accountUsers.email}) = ${norm}`,
    ...(excludeSub !== undefined ? [ne(accountUsers.sub, excludeSub)] : []),
  ];
  const linked = await db
    .select({ sub: accountUsers.sub })
    .from(accountUsers)
    .where(and(...filters))
    .limit(1);
  return linked.length > 0;
}

/** Another `sub` holding this email as a `local` account: never hijack. */
async function findLocalSameEmail(db: Database, norm: string, excludeSub?: string): Promise<boolean> {
  const filters = [
    eq(accountUsers.admissionSource, "local"),
    sql`lower(${accountUsers.email}) = ${norm}`,
    ...(excludeSub !== undefined ? [ne(accountUsers.sub, excludeSub)] : []),
  ];
  const local = await db
    .select({ sub: accountUsers.sub })
    .from(accountUsers)
    .where(and(...filters))
    .limit(1);
  return local.length > 0;
}

export async function reconcilePreprodSub(
  db: Database,
  input: JitInput,
  ctx: JitContext,
): Promise<JitOutcome> {
  if (!input.emailVerified) return { linked: false, reason: "unverified_email" };
  if (!ctx.trustedIssuers.includes(input.issuer)) return { linked: false, reason: "untrusted_issuer" };
  if (typeof input.email !== "string" || input.email.trim() === "") {
    return { linked: false, reason: "missing_email" };
  }
  const norm = normalizeAdmissionEmail(input.email);
  const now = new Date(ctx.now?.() ?? Date.now());

  const staged = await db
    .select()
    .from(admissionSyncProfiles)
    .where(eq(admissionSyncProfiles.email, norm))
    .limit(1);
  if (staged.length === 0) return { linked: false, reason: "not_admitted" };
  const admission = staged[0]!;
  if (admission.status !== "approved") return { linked: false, reason: "not_approved" };

  const bySub = await db
    .select()
    .from(accountUsers)
    .where(eq(accountUsers.sub, input.sub))
    .limit(1);

  if (bySub.length > 0) {
    const row = bySub[0]!;
    if (row.admissionSource === "prod_sync") {
      if (!emailMatches(row, norm)) {
        // Already linked to another admission: never relink.
        return { linked: false, reason: "already_linked_elsewhere" };
      }
      if (row.status === "approved") return { linked: true, mode: "already" };
      // Revoked earlier, re-approved in prod: re-admit the SAME link.
      const updated = await db
        .update(accountUsers)
        .set({ status: "approved", isAdmin: admission.role === "admin" })
        .where(and(eq(accountUsers.sub, input.sub), eq(accountUsers.admissionSource, "prod_sync")))
        .returning({ id: accountUsers.id });
      return updated.length > 0
        ? { linked: true, mode: "reapproved" }
        : { linked: false, reason: "not_approved" };
    }
    // Local row for this sub: leave it to its own lifecycle, except the
    // narrow auto-row adoption below. Never relink, never overwrite.
    if (row.status === "approved") return { linked: true, mode: "already" };
    if (row.status === "rejected" || row.status === "suspended") {
      return { linked: false, reason: "account_blocked" };
    }
    // Pending local auto-row (first login before the sync ran, never
    // admin-touched): adopt it into the prod admission. Any other shape —
    // including a missing or divergent email — is left alone: a `null` email
    // row must never be stamped with the incoming address.
    if (row.status !== "pending" || row.approvedAt !== null) {
      return { linked: false, reason: "local_conflict" };
    }
    if (row.email === null || !emailMatches(row, norm)) {
      return { linked: false, reason: "local_conflict" };
    }
    // Same guards as the create path: never adopt past an existing link or
    // a local same-email account held by another sub.
    if (await findProdSyncLink(db, norm, input.sub)) {
      return { linked: false, reason: "already_linked_elsewhere" };
    }
    if (await findLocalSameEmail(db, norm, input.sub)) {
      return { linked: false, reason: "local_conflict" };
    }
    try {
      const updated = await db
        .update(accountUsers)
        .set({
          email: input.email.trim(),
          ...(admission.name !== null ? { name: admission.name } : {}),
          status: "approved",
          isAdmin: admission.role === "admin",
          approvedAt: now,
          approvedBy: "prod-sync",
          admissionSource: "prod_sync",
        })
        .where(
          and(
            eq(accountUsers.sub, input.sub),
            eq(accountUsers.status, "pending"),
            eq(accountUsers.admissionSource, "local"),
          ),
        )
        .returning({ id: accountUsers.id });
      return updated.length > 0
        ? { linked: true, mode: "upgraded" }
        : { linked: false, reason: "local_conflict" };
    } catch (error) {
      // Lost a race against a concurrent link: report the conflict, never 500.
      if (!isUniqueViolation(error)) throw error;
      return { linked: false, reason: "already_linked_elsewhere" };
    }
  }

  // No row for this sub: refuse to hijack an existing link or local account.
  if (await findProdSyncLink(db, norm)) {
    return { linked: false, reason: "already_linked_elsewhere" };
  }
  if (await findLocalSameEmail(db, norm)) {
    return { linked: false, reason: "local_conflict" };
  }

  // Single-row link: concurrent twins race on the unique indexes; the loser
  // re-reads the winner's row instead of failing.
  try {
    await db.insert(accountUsers).values({
      sub: input.sub,
      email: input.email.trim(),
      name: admission.name,
      status: "approved",
      isAdmin: admission.role === "admin",
      approvedAt: now,
      approvedBy: "prod-sync",
      admissionSource: "prod_sync",
    });
    return { linked: true, mode: "created" };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await db
      .select()
      .from(accountUsers)
      .where(eq(accountUsers.sub, input.sub))
      .limit(1);
    if (winner.length > 0 && emailMatches(winner[0]!, norm)) {
      return { linked: true, mode: "created" };
    }
    return { linked: false, reason: "already_linked_elsewhere" };
  }
}

/**
 * Drizzle wraps driver failures (DrizzleQueryError with a `cause` chain down
 * to the pg DatabaseError), so the `23505` code is unwrapped a few levels.
 * Only a genuine uniqueness conflict resolves to the re-read path; anything
 * else keeps failing loudly.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
