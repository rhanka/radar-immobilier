/**
 * 6J distinct lot capabilities (D4).
 *
 * Selection, pipeline, and market have separate workspace rights; common
 * archive/restoration stays moderator-only. Grants are explicit per
 * (workspace, account, capability) with expected revisions and an
 * append-only audit; approval, invitation, or global administration never
 * implies a lot right. Documentary `author_id` values never appear here.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  accountUsers,
  lotCapabilityEvents,
  lotCapabilityGrants,
} from "../../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../../workspaces/store.js";
import { managingActorId, lockWorkspace } from "../../workspaces/mutations.js";
import {
  WorkspaceError,
  WorkspaceRevisionConflictError,
  type MembershipRecord,
} from "../../workspaces/types.js";

export type LotCapability = "lot_select" | "lot_pipeline" | "lot_market";

export function assertLotCapability(capability: string): asserts capability is LotCapability {
  if (capability !== "lot_select" && capability !== "lot_pipeline" && capability !== "lot_market") {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
}

export interface LotGrantMutation {
  workspaceId: string;
  targetAccountId: string;
  actorSub: string;
  capability: LotCapability;
  granted: boolean;
  reason: string;
  expectedRevision: number | null | undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setLotCapability(
  db: Database, mutation: LotGrantMutation,
): Promise<{ granted: boolean; revision: number; changed: boolean }> {
  assertLotCapability(mutation.capability);
  if (!UUID_PATTERN.test(mutation.workspaceId) || !UUID_PATTERN.test(mutation.targetAccountId)) {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
  if (typeof mutation.reason !== "string" || mutation.reason.length === 0 || mutation.reason.length > 512) {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
  if (mutation.expectedRevision === undefined
    || (mutation.expectedRevision !== null && !Number.isInteger(mutation.expectedRevision))) {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, mutation.workspaceId);
    const actorId = await managingActorId(tx, mutation.workspaceId, mutation.actorSub);
    const [target] = await tx.select({ id: accountUsers.id }).from(accountUsers).where(and(
      eq(accountUsers.id, mutation.targetAccountId), eq(accountUsers.status, "approved"),
    )).for("share");
    if (!target) throw new WorkspaceError(403, "account_not_approved");
    const [current] = await tx.select().from(lotCapabilityGrants).where(and(
      eq(lotCapabilityGrants.workspaceId, mutation.workspaceId),
      eq(lotCapabilityGrants.accountId, mutation.targetAccountId),
      eq(lotCapabilityGrants.capability, mutation.capability),
    ));
    if (!current && mutation.expectedRevision !== null) {
      throw new WorkspaceError(400, "invalid_workspace_command");
    }
    if (current && mutation.expectedRevision !== current.revision) {
      throw new WorkspaceRevisionConflictError({ ...fallbackRecord(mutation), revision: current.revision });
    }
    if (current && current.granted === mutation.granted) {
      return { granted: current.granted, revision: current.revision, changed: false };
    }
    const revision = (current?.revision ?? 0) + 1;
    await tx.insert(lotCapabilityGrants).values({
      workspaceId: mutation.workspaceId,
      accountId: mutation.targetAccountId,
      capability: mutation.capability,
      granted: mutation.granted,
      revision,
      actorId,
      reason: mutation.reason,
    }).onConflictDoUpdate({
      target: [
        lotCapabilityGrants.workspaceId,
        lotCapabilityGrants.accountId,
        lotCapabilityGrants.capability,
      ],
      set: { granted: mutation.granted, revision, actorId, reason: mutation.reason },
    });
    await tx.insert(lotCapabilityEvents).values({
      workspaceId: mutation.workspaceId,
      accountId: mutation.targetAccountId,
      capability: mutation.capability,
      kind: mutation.granted ? "capability_granted" : "capability_revoked",
      actorId,
      reason: mutation.reason,
    });
    return { granted: mutation.granted, revision, changed: true };
  });
}

function fallbackRecord(mutation: LotGrantMutation): MembershipRecord {
  return {
    workspaceId: mutation.workspaceId,
    accountId: mutation.targetAccountId,
    status: "active",
    revision: 0,
    moderateArchive: false,
    manageMembers: false,
  };
}

export interface LotRights {
  select: boolean;
  changePipeline: boolean;
  changeMarket: boolean;
  discardPersonally: boolean;
  moderateArchive: boolean;
}

export const LOT_RIGHTS_LABELS = ["select", "changePipeline", "changeMarket"] as const;

/** Distinct D4 rights for one viewer; every grant is explicit. */
export async function resolveLotRights(
  db: Pick<Database, "select">, workspaceId: string, sub: string,
): Promise<LotRights> {
  const accountId = await approvedAccountId(db, sub);
  const access = await resolveWorkspaceAccess(db, workspaceId, sub);
  const rows = await db.select().from(lotCapabilityGrants).where(and(
    eq(lotCapabilityGrants.workspaceId, workspaceId),
    eq(lotCapabilityGrants.accountId, accountId),
  ));
  const granted = new Set(rows.filter((row) => row.granted).map((row) => row.capability));
  for (const capability of granted) assertLotCapability(capability);
  return {
    select: granted.has("lot_select"),
    changePipeline: granted.has("lot_pipeline"),
    changeMarket: granted.has("lot_market"),
    discardPersonally: true,
    moderateArchive: access.moderateArchive,
  };
}
