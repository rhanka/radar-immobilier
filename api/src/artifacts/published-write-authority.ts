import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { WriteTx } from "../services/facets/signal-write-scope.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";
import { WRITE_PROFILE_NAME } from "./write-profile.js";
import { POLICY_REVISION } from "@radar/artifacts-host";
import { evaluateAccess } from "@sentropic/artifacts/server/access";

/** Immutable publication opt-in; it requests host features, never publisher rights. */
export const PUBLISHED_WRITE_FILE = "radar-write.json";
export const PUBLISHED_WRITE_DECLARATION = JSON.stringify({ profileName: WRITE_PROFILE_NAME, permitsWrites: true });
export const PUBLISHED_WRITE_DIGEST = `sha256:${createHash("sha256")
  .update(PUBLISHED_WRITE_DECLARATION).digest("hex")}`;
export const PUBLISHED_WRITE_POLICY = "published-write-v1";

export interface PublishedWriteBinding {
  scope: string;
  artifactId: string;
  releaseId: string;
  readerSub: string;
  version: string;
}

export function manifestRequestsWrites(manifest: string): boolean {
  try {
    const parsed = JSON.parse(manifest) as { files?: Array<{ path: string; digest: string; size: number }> };
    return parsed.files?.filter((file) => file.path === PUBLISHED_WRITE_FILE).length === 1 &&
      parsed.files.some((file) => file.path === PUBLISHED_WRITE_FILE && file.digest === PUBLISHED_WRITE_DIGEST &&
        file.size === Buffer.byteLength(PUBLISHED_WRITE_DECLARATION));
  } catch { return false; }
}

/** Real L3 rows stay locked until the caller's BASE transaction commits.
 * UPDATE/DELETE authority withdrawals therefore cannot acknowledge ahead of an
 * admitted write. No pool callback, positive cache or external I/O is used here.
 */
export async function readPublishedWriteAuthority(tx: WriteTx,
  binding: Omit<PublishedWriteBinding, "version">): Promise<PublishedWriteBinding> {
  const deny = () => { throw new PwWriteError(403, "write_authority_unavailable"); };
  const policy = await tx.execute(sql`SELECT revision, xmin::text AS version
    FROM artifacts.host_policy WHERE storage_scope_id=${binding.scope} FOR SHARE`);
  if (policy.rows.length !== 1 || policy.rows[0]?.["revision"] !== POLICY_REVISION) return deny();
  const result = await tx.execute(sql`SELECT a.owner_id, a.is_public, a.lifecycle_state,
    a.xmin::text AS artifact_version, r.xmin::text AS release_version, r.state, r.manifest
    FROM artifacts.artifacts a JOIN artifacts.releases r ON r.artifact_id=a.id
    WHERE a.id=${binding.artifactId}::uuid AND r.id=${binding.releaseId}::uuid
      AND a.storage_scope_id=${binding.scope} FOR SHARE OF a,r`);
  const row = result.rows[0];
  if (!row || row["lifecycle_state"] !== "active" || !["ready", "retired"].includes(String(row["state"])) ||
    !manifestRequestsWrites(String(row["manifest"]))) return deny();
  const account = await tx.execute(sql`SELECT status, xmin::text AS version FROM account_users
    WHERE sub=${binding.readerSub} FOR SHARE`);
  if (account.rows[0]?.["status"] !== "approved") return deny();
  const acl = await tx.execute(sql`SELECT permission, xmin::text AS version FROM artifacts.artifact_access
    WHERE artifact_id=${binding.artifactId}::uuid AND principal_id=${binding.readerSub} FOR SHARE`);
  const allowed = evaluateAccess({ ownerId: String(row["owner_id"]), isPublic: row["is_public"] === true,
    withdrawn: false, grants: acl.rows.map((grant) => ({ principalId: binding.readerSub,
      grant: grant["permission"] as "read" })) }, binding.readerSub, "read", () => true);
  if (!allowed) return deny();
  return { ...binding, version: createHash("sha256")
    .update(JSON.stringify([row, policy.rows, account.rows, acl.rows, PUBLISHED_WRITE_POLICY])).digest("hex") };
}

/** Runtime records cannot opt out of the actual SQL check at a later receiver. */
export async function lockPublishedWriteAuthority(tx: WriteTx,
  references: Record<string, string | undefined>, exact = true): Promise<void> {
  const raw = references["reader_runtime"];
  if (raw === undefined) {
    if (references["policy"] === PUBLISHED_WRITE_POLICY) throw new PwWriteError(503, "write_authority_unavailable");
    return; // Synthetic PW port users have no L3 publication.
  }
  let binding: PublishedWriteBinding;
  try { binding = JSON.parse(raw) as PublishedWriteBinding; }
  catch { throw new PwWriteError(503, "write_authority_unavailable"); }
  if (!binding || ![binding.scope, binding.artifactId, binding.releaseId, binding.readerSub, binding.version]
    .every((value) => typeof value === "string" && value.length > 0)) {
    throw new PwWriteError(503, "write_authority_unavailable");
  }
  const current = await readPublishedWriteAuthority(tx, binding);
  if (exact && current.version !== binding.version) throw new PwWriteError(403, "write_authority_unavailable");
}
