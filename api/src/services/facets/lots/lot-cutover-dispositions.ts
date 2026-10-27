/**
 * 6K explicit D5 dispositions: one moderator decision per conflicted
 * target recorded against the exact manifest digest. Immutable: a
 * changed manifest or a revised decision needs new rows, never an
 * overwrite. `activate` always names its winning source row.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  lotCutoverEvents,
  lotD5Dispositions,
} from "../../../db/schema.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../../workspaces/store.js";
import { FacetError } from "../target.js";
import {
  SHA_PATTERN,
  type D5Decision,
} from "./lot-cutover-types.js";

/** Record explicit D5 dispositions. Moderator-only and immutable. */
export async function recordD5Dispositions(
  db: Database, input: {
    workspaceId: string; actorSub: string; manifestSha: string; decisions: D5Decision[];
  },
): Promise<{ recorded: number; targetKeys: string[] }> {
  if (!SHA_PATTERN.test(input.manifestSha)) throw new FacetError(400, "invalid_facet_command");
  if (input.decisions.length === 0) throw new FacetError(400, "invalid_facet_command");
  for (const decision of input.decisions) {
    if (decision.targetKey === "" || decision.targetKey.length > 512
      || (decision.decision !== "activate" && decision.decision !== "keep-pending")
      || decision.reason === "" || decision.reason.length > 1024) {
      throw new FacetError(400, "invalid_facet_command");
    }
    if (decision.decision === "activate"
      && (decision.sourceId === undefined || decision.sourceId === "")) {
      throw new FacetError(400, "invalid_facet_command");
    }
    if (decision.sourceId !== undefined && decision.sourceId.length > 512) {
      throw new FacetError(400, "invalid_facet_command");
    }
  }
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const recorderId = await approvedAccountId(tx, input.actorSub, true);
    const access = await resolveWorkspaceAccess(tx, input.workspaceId, input.actorSub);
    if (!access.moderateArchive) throw new FacetError(403, "workspace_capability_required");
    for (const decision of input.decisions) {
      const [existing] = await tx.select().from(lotD5Dispositions).where(and(
        eq(lotD5Dispositions.workspaceId, input.workspaceId),
        eq(lotD5Dispositions.manifestSha, input.manifestSha),
        eq(lotD5Dispositions.targetKey, decision.targetKey)));
      if (existing && (existing.decision !== decision.decision
        || existing.sourceId !== (decision.sourceId ?? null)
        || existing.reason !== decision.reason)) {
        throw new FacetError(409, "idempotency_key_conflict");
      }
      await tx.insert(lotD5Dispositions).values({
        workspaceId: input.workspaceId,
        manifestSha: input.manifestSha,
        targetKey: decision.targetKey,
        decision: decision.decision,
        sourceId: decision.sourceId ?? null,
        reason: decision.reason,
        recordedBy: recorderId,
      }).onConflictDoNothing();
    }
    await tx.insert(lotCutoverEvents).values({
      workspaceId: input.workspaceId, stage: "d5-dispositions",
      detail: {
        manifestSha: input.manifestSha,
        targetKeys: input.decisions.map((decision) => decision.targetKey).sort(),
      },
    });
    return {
      recorded: input.decisions.length,
      targetKeys: input.decisions.map((decision) => decision.targetKey).sort(),
    };
  });
}
