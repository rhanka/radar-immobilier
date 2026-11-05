/**
 * Lot I2 — reader directory on `account_users` (converged-r2 §2.3).
 *
 * `userRef` is the internal account UUID (`account_users.id`), never the IdP
 * `sub`: the `sub` stored in `artifacts.owner_id` / `artifact_access` stays
 * the internal evaluation form, while every model-visible surface projects
 * it to `userRef`. Only `status='approved'` accounts are ever returned or
 * resolved — pending, suspended or unknown accounts behave as absent, so no
 * caller can probe account status through this module.
 *
 * G2 SEAM: this module is the immo binding for the generic
 * `PrincipalDirectoryPort` (search, `userRef` ↔ internal principal
 * resolution, model-output projection). The G2 MCP tools
 * (`artifacts_lookup_people`, `artifacts_list_access`) and the widened
 * `artifacts_set_access` semantics will call exactly these functions; until
 * G2 merges, sharing mutations stay owner-nominative and no tool reads
 * this module.
 */
import type pg from "pg";

export interface DirectoryPerson {
  /** Opaque model-facing reference: the internal `account_users.id`. */
  readonly userRef: string;
  readonly displayName: string;
  /** Masked local part, visible domain — enough to break homonym ties. */
  readonly emailHint: string;
}

export interface ResolvedDirectoryPerson extends DirectoryPerson {
  /** Internal evaluation principal. Never leaves the trusted host code. */
  readonly sub: string;
}

/** G2 SEAM: lookup bounds shared with the future `lookup_people` tool. */
export const DIRECTORY_QUERY_MIN_LENGTH = 2;
export const DIRECTORY_QUERY_MAX_LENGTH = 120;
export const DIRECTORY_RESULT_LIMIT_MAX = 10;
const DIRECTORY_CANDIDATE_CAP = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function foldAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Mask an email for model output: local part reduced to its first
 * character, domain kept visible (`farid.d@example.com` → `f***@example.com`).
 * Unknown or malformed emails yield an empty hint rather than a leak.
 */
export function maskEmail(email: string | null | undefined): string {
  if (typeof email !== "string") return "";
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return "";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(domain)) return "";
  return `${local.slice(0, 1)}***@${domain}`;
}

function toPerson(row: { id: string; name: string | null; email: string | null }): DirectoryPerson {
  const displayName = typeof row.name === "string" && row.name.trim() !== "" ? row.name : "Membre";
  return { userRef: row.id, displayName, emailHint: maskEmail(row.email) };
}

/**
 * Least-privilege principal resolution: the opaque `userRef` projection
 * needs no personal data, so it reads `id, sub, status` only (the columns
 * the restricted writer role may read). Only the people-lookup path below
 * reads `name`/`email`.
 */
function toOpaquePerson(row: { id: string; sub: string }): ResolvedDirectoryPerson {
  return { userRef: row.id, displayName: "Membre", emailHint: "", sub: row.sub };
}

/** Postgres privilege denial (table or column), e.g. missing name/email grant. */
function isPrivilegeDenied(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "42501") return true;
  return typeof record.message === "string" && record.message.includes("permission denied");
}

/** Resolve a model-facing `userRef` to its internal principal. Approved accounts only. */
export async function resolveUserRef(
  pool: Pick<pg.Pool, "query">,
  userRef: string,
): Promise<ResolvedDirectoryPerson | null> {
  if (!UUID_RE.test(userRef)) return null;
  const result = await pool.query(
    `SELECT id, sub, status FROM account_users WHERE id = $1 AND status = 'approved'`,
    [userRef],
  );
  const row = result.rows[0] as { id: string; sub: string } | undefined;
  if (!row || typeof row.sub !== "string") return null;
  return toOpaquePerson(row);
}

/** Resolve the internal `sub` to its model-facing `userRef`. Approved accounts only. */
export async function resolveSubToUserRef(
  pool: Pick<pg.Pool, "query">,
  sub: string,
): Promise<ResolvedDirectoryPerson | null> {
  if (typeof sub !== "string" || sub.length === 0 || sub.length > 256) return null;
  const result = await pool.query(
    `SELECT id, sub, status FROM account_users WHERE sub = $1 AND status = 'approved'`,
    [sub],
  );
  const row = result.rows[0] as { id: string; sub: string } | undefined;
  if (!row) return null;
  return toOpaquePerson(row);
}

/**
 * Search approved accounts by name or email, case- and accent-insensitive,
 * capped at 10 matches. The SQL prefilter is case-insensitive; accent
 * folding runs over the bounded candidate set so behaviour stays identical
 * with or without the `unaccent` extension (server-side unaccent is a G2
 * follow-up, not a behaviour change).
 *
 * People lookup is the ONLY path that needs name/email. A restricted role
 * without those columns fails here with the documented
 * `directory_lookup_unavailable` error (proposal, NOT applied:
 * `GRANT SELECT (name, email) ON public.account_users TO
 * immo_mcp_artifact_writer;`); resolution above stays available.
 */
export async function searchDirectory(
  pool: Pick<pg.Pool, "query">,
  query: string,
  limit = DIRECTORY_RESULT_LIMIT_MAX,
): Promise<DirectoryPerson[]> {
  if (typeof query !== "string") return [];
  const trimmed = query.trim();
  if (trimmed.length < DIRECTORY_QUERY_MIN_LENGTH || trimmed.length > DIRECTORY_QUERY_MAX_LENGTH) return [];
  const capped = Math.max(1, Math.min(Math.floor(limit) || DIRECTORY_RESULT_LIMIT_MAX, DIRECTORY_RESULT_LIMIT_MAX));
  const pattern = `%${trimmed.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
  let result;
  try {
    result = await pool.query(
      `SELECT id, name, email FROM account_users
     WHERE status = 'approved' AND (name ILIKE $1 ESCAPE '\\' OR email ILIKE $1 ESCAPE '\\')
     ORDER BY name ASC LIMIT ${DIRECTORY_CANDIDATE_CAP}`,
      [pattern],
    );
  } catch (error) {
    if (isPrivilegeDenied(error)) {
      throw { code: "directory_lookup_unavailable",
        reason: "people lookup needs SELECT(name, email) on public.account_users, withheld from immo_mcp_artifact_writer" };
    }
    throw error;
  }
  const folded = foldAccents(trimmed);
  const matches: DirectoryPerson[] = [];
  for (const row of result.rows as Array<{ id: string; name: string | null; email: string | null }>) {
    if (matches.length >= capped) break;
    const haystack = `${row.name ?? ""} ${row.email ?? ""}`;
    if (foldAccents(haystack).includes(folded)) matches.push(toPerson(row));
  }
  return matches;
}
