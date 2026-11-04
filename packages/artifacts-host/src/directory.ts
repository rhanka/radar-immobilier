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
 * (account UUID) of an approved account only (status = 'approved').
 * Anything else — raw IdP sub, email, unknown marker — resolves to nothing,
 * so no sub ever yields an account at the input boundary either. UUID misses
 * merge into the single `person_not_shareable` (a directory throw would
 * escape as a 500 instead, hence the miss); a known sub misused as input is
 * refused provider-side with 403 access_denied, told apart from an unknown
 * target precisely because `describePrincipal` always answers (R1). The
 * set_access transaction guard agrees userRef-only as a second line. The
 * guide instructs userRef exclusively, and outputs only ever carry userRef
 * (R1).
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

function toPerson(row: AccountRow): DirectoryPerson {
  return {
    userRef: row.id,
    displayName: row.name ?? (row.email !== null ? row.email.split("@")[0] ?? row.id : row.id),
    email: row.email ?? "",
  };
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
      const folded = fold(query);
      const { rows } = await pool.query<AccountRow>(
        "SELECT id, sub, name, email FROM account_users WHERE status = 'approved'");
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
      // (account UUID) of an approved account. Anything else — raw IdP sub,
      // email, unknown marker — resolves to nothing: subs never cross the
      // model boundary in either direction (R1 covers outputs, this covers
      // inputs). A miss (not a throw: the provider merges a miss into
      // `person_not_shareable` but lets a directory exception escape as a
      // 500) keeps the single merged refusal code, and the host transaction
      // guard agrees.
      if (!UUID_RE.test(userRef)) return undefined;
      const { rows } = await pool.query<{ sub: string }>(
        "SELECT sub FROM account_users WHERE id = $1 AND status = 'approved'", [userRef]);
      return rows[0]?.sub;
    },
    async describePrincipal(_scope, principalId) {
      // Mode sentinels name no person; the provider renders the mode itself.
      if (typeof principalId === "string" && principalId.startsWith("sentropic:")) return undefined;
      const { rows } = await pool.query<AccountRow>(
        "SELECT id, sub, name, email FROM account_users WHERE sub = $1", [principalId]);
      if (rows[0] !== undefined) return toPerson(rows[0]);
      // The opaque form resolves too: an existing account always projects
      // to its userRef, whatever form the stored principal arrived in.
      if (typeof principalId === "string" && UUID_RE.test(principalId)) {
        const byId = await pool.query<AccountRow>(
          "SELECT id, sub, name, email FROM account_users WHERE id = $1", [principalId]);
        if (byId.rows[0] !== undefined) return toPerson(byId.rows[0]);
      }
      // R1: never undefined for an internal id — a missing account projects
      // to the explicit unknown marker, never the raw sub.
      return toUnknownPerson(String(principalId));
    },
  };
}
