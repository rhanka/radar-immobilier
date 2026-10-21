/**
 * 6G Drizzle mutations: explicit membership and capability changes with
 * expected revisions, advisory locks, and append-only audit. Every grant
 * and revocation appends exactly one audit row; no-ops append none.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  accountUsers,
  workspaceMembershipEvents,
  workspaceMemberships,
} from "../../db/schema.js";
import { checkRevision } from "./policy.js";
import { approvedAccountId, toRecord } from "./store.js";
import {
  WorkspaceError,
  type MembershipRecord,
  type WorkspaceCapability,
} from "./types.js";

export type MutationTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type WorkspaceDb = Pick<Database, "transaction">;

export async function lockWorkspace(tx: MutationTx, workspaceId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
    ["workspace", workspaceId])}, 0))`);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MembershipMutation {
  workspaceId: string;
  targetAccountId: string;
  actorSub: string;
  reason: string;
  expectedRevision: number | null;
}

/** Shared with capabilities.ts; not a public entry point. */
export function assertMutation(mutation: MembershipMutation): void {
  if (!UUID_PATTERN.test(mutation.workspaceId) || !UUID_PATTERN.test(mutation.targetAccountId)) {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
  if (typeof mutation.reason !== "string" || mutation.reason.length === 0 || mutation.reason.length > 512) {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
}

/** Shared with capabilities.ts; not a public entry point. */
export async function managingActorId(tx: MutationTx, workspaceId: string, actorSub: string): Promise<string> {
  const actorId = await approvedAccountId(tx, actorSub, true);
  const [row] = await tx.select().from(workspaceMemberships).where(and(
    eq(workspaceMemberships.workspaceId, workspaceId),
    eq(workspaceMemberships.accountId, actorId),
  )).for("share");
  const membership = row ? toRecord(row) : null;
  if (membership?.status !== "active" || !membership.manageMembers) {
    throw new WorkspaceError(403, "workspace_capability_required");
  }
  return actorId;
}

/** Shared with capabilities.ts; not a public entry point. */
export async function approvedTargetId(tx: MutationTx, targetAccountId: string): Promise<string> {
  const [target] = await tx.select({ id: accountUsers.id }).from(accountUsers).where(and(
    eq(accountUsers.id, targetAccountId), eq(accountUsers.status, "approved"),
  )).for("share");
  if (!target) throw new WorkspaceError(403, "account_not_approved");
  return target.id;
}

/** Shared with capabilities.ts; not a public entry point. */
export async function audit(
  tx: MutationTx, workspaceId: string, accountId: string, kind: string,
  capability: WorkspaceCapability | null, actorId: string, reason: string,
): Promise<void> {
  await tx.insert(workspaceMembershipEvents).values({
    workspaceId, accountId, kind, capability, actorId, reason,
  });
}

export async function addMembership(
  db: WorkspaceDb, mutation: MembershipMutation,
): Promise<{ record: MembershipRecord; changed: boolean }> {
  assertMutation(mutation);
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, mutation.workspaceId);
    const actorId = await managingActorId(tx, mutation.workspaceId, mutation.actorSub);
    const targetId = await approvedTargetId(tx, mutation.targetAccountId);
    const [row] = await tx.select().from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, mutation.workspaceId),
      eq(workspaceMemberships.accountId, targetId),
    ));
    if (row) checkRevision(toRecord(row), mutation.expectedRevision);
    else if (mutation.expectedRevision !== null) throw new WorkspaceError(400, "invalid_workspace_command");
    if (row && row.status === "active") return { record: toRecord(row), changed: false };
    const revision = (row?.revision ?? 0) + 1;
    const values = {
      workspaceId: mutation.workspaceId, accountId: targetId, status: "active",
      revision, moderateArchive: false, manageMembers: false, revokedAt: null,
    };
    const [saved] = row
      ? await tx.update(workspaceMemberships).set(values)
        .where(and(eq(workspaceMemberships.workspaceId, mutation.workspaceId),
          eq(workspaceMemberships.accountId, targetId))).returning()
      : await tx.insert(workspaceMemberships).values(values).returning();
    await audit(tx, mutation.workspaceId, targetId, "member_added", null, actorId, mutation.reason);
    return { record: toRecord(saved!), changed: true };
  });
}

export async function revokeMembership(db: WorkspaceDb, mutation: MembershipMutation): Promise<MembershipRecord> {
  assertMutation(mutation);
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, mutation.workspaceId);
    const actorId = await managingActorId(tx, mutation.workspaceId, mutation.actorSub);
    const [row] = await tx.select().from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, mutation.workspaceId),
      eq(workspaceMemberships.accountId, mutation.targetAccountId),
    ));
    const current = row ? toRecord(row) : null;
    if (!current || current.status !== "active") {
      throw new WorkspaceError(404, "workspace_membership_not_found");
    }
    checkRevision(current, mutation.expectedRevision);
    const [saved] = await tx.update(workspaceMemberships).set({
      status: "revoked", revision: current.revision + 1, revokedAt: new Date(),
    }).where(and(eq(workspaceMemberships.workspaceId, mutation.workspaceId),
      eq(workspaceMemberships.accountId, mutation.targetAccountId))).returning();
    await audit(tx, mutation.workspaceId, mutation.targetAccountId,
      "member_revoked", null, actorId, mutation.reason);
    return toRecord(saved!);
  });
}

