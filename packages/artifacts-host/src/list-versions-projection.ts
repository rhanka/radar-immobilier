import type { PrincipalDirectoryPort } from "@sentropic/artifacts";

/**
 * R1 — immo-side author projection for `list_versions`, kept as defence in
 * depth under provider 0.2.15 (the provider now projects through the same
 * directory, so this pass is idempotent for known accounts and re-marks an
 * already-projected unknown value with the stable immo `unknown-<hash>`
 * form; it additionally covers the `ownerId`/`principalId`/`actorId` keys a
 * version entry may carry, on both the provider-outcome and the projected
 * HTTP/MCP bodies).
 *
 * Every author field is resolved through the immo directory
 * `describePrincipal`: known account -> opaque `userRef`
 * (`account_users.id`), missing account -> explicit `unknown-<hash>`
 * marker, mode sentinel (`sentropic:*`) -> left untouched (it names a
 * mode, not a person). `null` stays `null`.
 *
 * Shapes covered (both provider-outcome bodies and projected HTTP/MCP
 * bodies): v2 `{ versions: [...] }` or `{ output: { versions: [...] } }`
 * with `authorPrincipalId`, v1 `{ releases: [...] }` or
 * `{ output: { releases: [...] } }` with `author`. Any other actor-id
 * field carried by a version entry (`ownerId`, `principalId`, `actorId`)
 * is projected the same way so no raw sub leaves through this tool.
 */
export type ListVersionsDirectory = Pick<PrincipalDirectoryPort, "describePrincipal">;

const AUTHOR_KEYS = ["authorPrincipalId", "author", "ownerId", "principalId", "actorId"] as const;

async function projectEntry(
  entry: Record<string, unknown>,
  scope: string,
  directory: ListVersionsDirectory,
): Promise<void> {
  for (const key of AUTHOR_KEYS) {
    const value = entry[key];
    if (typeof value !== "string" || value.length === 0) continue;
    const person = await directory.describePrincipal(scope, value);
    if (person) entry[key] = person.userRef;
  }
}

function versionLists(body: Record<string, unknown>): Record<string, unknown>[][] {
  const lists: Record<string, unknown>[][] = [];
  const output = body.output;
  const roots = [body, ...(output !== null && typeof output === "object" && !Array.isArray(output)
    ? [output as Record<string, unknown>] : [])];
  for (const root of roots) {
    for (const key of ["versions", "releases"] as const) {
      const list = root[key];
      if (Array.isArray(list) && list.every((entry) => typeof entry === "object" && entry !== null)) {
        lists.push(list as Record<string, unknown>[]);
      }
    }
  }
  return lists;
}

/** Project every author field of a `list_versions` response body in place. */
export async function projectListVersionsAuthors(
  body: unknown,
  scope: string,
  directory: ListVersionsDirectory,
): Promise<unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  for (const list of versionLists(record)) {
    for (const entry of list) await projectEntry(entry, scope, directory);
  }
  return body;
}
