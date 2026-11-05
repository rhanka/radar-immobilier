import { createHash } from "node:crypto";
import type pg from "pg";
import type { DirectoryPerson, PrincipalDirectoryPort } from "@sentropic/artifacts";

/**
 * I2 on G2 — host-trusted principal directory over immo `account_users`.
 *
 * Model-boundary invariant (R1): `describePrincipal` NEVER emits a raw IdP
 * sub. Every existing row projects to its opaque `account_users.id`; every
 * missing principal (deleted or never-existing account) projects to an
 * explicit `unknown-<hash>` marker — opaque, stable per principal,
 * unresolvable by `resolvePrincipal`, and clearly not an account. The
 * provider fallback therefore can never leak a raw sub, including for
 * erased people. Mode sentinels (`sentropic:*`) name no person and stay
 * unprojected.
 *
 * Input path (N3): `resolvePrincipal` accepts the opaque directory userRef
 * (account UUID) of any existing account, regardless of status. Anything
 * else — raw IdP sub, email, unknown marker — resolves to nothing, so no
 * sub ever yields an account at the input boundary either. UUID misses
 * merge into the single `person_not_shareable` (a directory throw would
 * escape as a 500 instead, hence the miss); a known sub misused as input is
 * refused provider-side with 403 access_denied, told apart from an unknown
 * target precisely because `describePrincipal` always answers (R1). Status
 * is deliberately not a resolution criterion (R5): revoke is the cleanup
 * step for dormant principals, so a suspended account still resolves and
 * its grant row is really deleted. The approved-only rule lives on the
 * grant path — the provider approval gate plus the set_access transaction
 * guard (userRef-only as a second line) refuse grants to non-approved
 * accounts. The guide instructs userRef exclusively, and outputs only ever
 * carry userRef (R1).
 * The single-storage-scope host treats every account as in scope.
 * Display name falls back from the IdP name to the email local part, then to
 * the opaque reference; the package masks emails at the model boundary.
 */

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

interface AccountRow {
  id: string;
  sub: string;
  name: string | null;
  email: string | null;
}

/**
 * Least-privilege principal resolution runs on the restricted writer role
 * (`immo_mcp_artifact_writer`: column SELECT on `id, sub, status` only).
 * The opaque `userRef` / `unknown` projection needs no personal data, so it
 * reads `id, sub, status` only and synthesizes the display fields locally.
 */
interface MinimalAccountRow {
  id: string;
  sub: string;
  status: string;
}

function toPerson(row: AccountRow): DirectoryPerson {
  return {
    userRef: row.id,
    displayName: row.name ?? (row.email !== null ? row.email.split("@")[0] ?? row.id : row.id),
    email: row.email ?? "",
  };
}

function toOpaquePerson(row: MinimalAccountRow): DirectoryPerson {
  return { userRef: row.id, displayName: row.id, email: "" };
}

/** Postgres privilege denial (table or column), e.g. missing name/email grant. */
function isPrivilegeDenied(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "42501") return true;
  return typeof record.message === "string" && record.message.includes("permission denied");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertResolvableForm(userRef: string): void {
  if (typeof userRef !== "string" || userRef.length === 0 || userRef.length > 512) {
    throw { code: "unresolvable_share_target", reason: "malformed principal reference" };
  }
}

/**
 * Explicit unknown marker for a principal with no account row (R1): opaque
 * (one-way hash, stable per principal so listings stay readable),
 * unresolvable (never a UUID, never a sub), and visibly not an account.
 */
export function unknownUserRef(principalId: string): string {
  return `unknown-${createHash("sha256").update(principalId).digest("hex").slice(0, 12)}`;
}

function toUnknownPerson(principalId: string): DirectoryPerson {
  return { userRef: unknownUserRef(principalId), displayName: "Unknown reader", email: "" };
}

/** G2 principal directory over the injected pool (no DDL). */
export function createAccountDirectory(pool: pg.Pool): PrincipalDirectoryPort {
  return {
    async searchPeople(_scope, query, limit) {
      // People lookup is the ONLY path that needs name/email (sharing by
      // colleague). The writer role is deliberately NOT granted those
      // personal-data columns (owner decision pending), so a missing grant
      // fails here with a documented code instead of a raw pg error — and
      // never affects the resolution paths below, which stay available.
      // Proposal (NOT applied): GRANT SELECT (name, email) ON
      // public.account_users TO immo_mcp_artifact_writer;
      const folded = fold(query);
      let rows: AccountRow[];
      try {
        ({ rows } = await pool.query<AccountRow>(
          "SELECT id, sub, name, email FROM account_users WHERE status = 'approved'"));
      } catch (error) {
        if (isPrivilegeDenied(error)) {
          throw { code: "directory_lookup_unavailable",
            reason: "people lookup needs SELECT(name, email) on public.account_users, withheld from immo_mcp_artifact_writer" };
        }
        throw error;
      }
      return rows
        .filter((row) => fold(row.name ?? "").includes(folded) || fold(row.email ?? "").includes(folded))
        .sort((a, b) => (a.name ?? a.email ?? a.sub).localeCompare(b.name ?? b.email ?? b.sub))
        .slice(0, limit)
        .map(toPerson);
    },
    async resolvePrincipal(_scope, userRef) {
      assertResolvableForm(userRef);
      // Mode sentinels are provider-owned: they name no person.
      if (typeof userRef === "string" && userRef.startsWith("sentropic:")) return undefined;
      // N3: the canonical input form is the opaque directory userRef
      // (account UUID). Anything else — raw IdP sub, email, unknown
      // marker — resolves to nothing: subs never cross the model boundary
      // in either direction (R1 covers outputs, this covers inputs). A
      // miss (not a throw: the provider merges a miss into
      // `person_not_shareable` but lets a directory exception escape as a
      // 500) keeps the single merged refusal code, and the host transaction
      // guard agrees. Resolution is status-blind on purpose (R5): revoke is
      // the cleanup step for dormant principals, so a suspended account
      // still resolves to its sub and the grant row is really deleted. The
      // approved-only rule lives on the grant path, not here: the provider
      // approval gate (isApprovedPrincipal) plus the host transaction guard
      // (sharePrincipalApproved) refuse grants to non-approved accounts.
      if (!UUID_RE.test(userRef)) return undefined;
      const { rows } = await pool.query<{ sub: string }>(
        "SELECT sub FROM account_users WHERE id = $1", [userRef]);
      return rows[0]?.sub;
    },
    async describePrincipal(_scope, principalId) {
      // Mode sentinels name no person; the provider renders the mode itself.
      if (typeof principalId === "string" && principalId.startsWith("sentropic:")) return undefined;
      // Least privilege: id/sub/status only (granted to the writer role).
      const { rows } = await pool.query<MinimalAccountRow>(
        "SELECT id, sub, status FROM account_users WHERE sub = $1", [principalId]);
      if (rows[0] !== undefined) return toOpaquePerson(rows[0]);
      // The opaque form resolves too: an existing account always projects
      // to its userRef, whatever form the stored principal arrived in.
      if (typeof principalId === "string" && UUID_RE.test(principalId)) {
        const byId = await pool.query<MinimalAccountRow>(
          "SELECT id, sub, status FROM account_users WHERE id = $1", [principalId]);
        if (byId.rows[0] !== undefined) return toOpaquePerson(byId.rows[0]);
      }
      // R1: never undefined for an internal id — a missing account projects
      // to the explicit unknown marker, never the raw sub.
      return toUnknownPerson(String(principalId));
    },
  };
}
