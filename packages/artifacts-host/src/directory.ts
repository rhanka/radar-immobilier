import type pg from "pg";
import type { DirectoryPerson, PrincipalDirectoryPort } from "@sentropic/artifacts";

/**
 * I2 on G2 — host-trusted principal directory over immo `account_users`.
 *
 * Search and resolution are approved-only (status = 'approved'); approval
 * itself is NOT part of resolution — the provider merges every
 * resolution/approval failure into the single `person_not_shareable`.
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
const SUB_RE = /^[^\s]{1,256}$/;

function assertResolvableForm(userRef: string): void {
  if (typeof userRef !== "string" || userRef.length === 0 || userRef.length > 512 ||
    UUID_RE.test(userRef) || SUB_RE.test(userRef)) return;
  throw { code: "unresolvable_share_target", reason: "malformed principal reference" };
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
      // Canonical form: the opaque account id. The legacy IdP sub still
      // resolves so pre-G2 callers keep working through the same approval.
      if (UUID_RE.test(userRef)) {
        const { rows } = await pool.query<{ sub: string }>(
          "SELECT sub FROM account_users WHERE id = $1", [userRef]);
        return rows[0]?.sub;
      }
      const { rows } = await pool.query<{ sub: string }>(
        "SELECT sub FROM account_users WHERE sub = $1", [userRef]);
      return rows[0]?.sub;
    },
    async describePrincipal(_scope, principalId) {
      const { rows } = await pool.query<AccountRow>(
        "SELECT id, sub, name, email FROM account_users WHERE sub = $1", [principalId]);
      if (rows[0] === undefined) return undefined;
      return toPerson(rows[0]);
    },
  };
}
