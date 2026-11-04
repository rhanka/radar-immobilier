import type pg from "pg";
import { ARTIFACT_P0B } from "./p0b-profile.js";
import type { ArtifactDeleteConfirmation } from "./delete-confirmation.js";
import type { createPostgresArtifactStore } from "@sentropic/artifacts/adapters/postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import type { FinalizeTxClient } from "@sentropic/artifacts/server/commit-contract";

export const sharePrincipal = new AsyncLocalStorage<{ action?: unknown; principalId?: unknown }>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function sharePrincipalApproved(client: FinalizeTxClient, operation: string): Promise<boolean> {
  const target = sharePrincipal.getStore();
  if (operation !== "set_access" || target?.action !== "grant") return true;
  if (typeof target.principalId !== "string") return false;
  // G2 — the grant target is an opaque directory userRef (account_users.id).
  // Mode sentinels never name a person. A raw IdP sub never approves here:
  // the provider routes sub-form principals straight to this transaction
  // guard without consulting the directory, so this is the immo-side
  // enforcement point for the userRef-only input rule (N3, R1) — the false
  // merges into the single person_not_shareable like every other refusal.
  // Approval stays approved-only.
  if (target.principalId.startsWith("sentropic:")) return true;
  if (!UUID_RE.test(target.principalId)) return false;
  const result = await client.query<{ status: string }>(
    "SELECT status FROM account_users WHERE id=$1 FOR SHARE", [target.principalId]);
  return result.rows[0]?.status === "approved";
}

/** Fail startup closed until the shared migration and trusted confirmation port exist. */
export async function assertP0bStorage(pool: pg.Pool, confirmation?: ArtifactDeleteConfirmation) {
  if (!ARTIFACT_P0B) return;
  if (!confirmation) throw new Error("artifact_delete_confirmation_required");
  const columns = await pool.query(`SELECT terminal_deleted_at, updated_at FROM artifacts.artifacts LIMIT 0`);
  await pool.query("SELECT confirmation_ref FROM artifacts.delete_confirmations LIMIT 0");
  await pool.query("SELECT metadata FROM artifacts.artifacts LIMIT 0");
  await pool.query("SELECT author_principal_id, parent_release_id, reverted_from_release_id FROM artifacts.releases LIMIT 0");
  return columns;
}

/** P0b (0.2.5 or 0.3.0) accepts a synchronous account predicate: isolate it per async request. */
export function p0bPorts(store: ReturnType<typeof createPostgresArtifactStore>,
  confirmation: ArtifactDeleteConfirmation | undefined, isApprovedAccount: (sub: string) => boolean) {
  return ARTIFACT_P0B ? { sources: store, management: { confirmation: confirmation!.port }, isApprovedAccount } : {};
}
