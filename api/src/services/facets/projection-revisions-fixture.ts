// Disposable synthetic databases for 6L1 revision qualification.
//
// Annotated exports:
// - `describeDb`: suite gate, active only under LOT_MIGRATION_DB_TEST=1.
// - `revisionFixture`: one activated workspace with a moderator, a
//   contributor, an outsider parked in a second workspace, and both
//   workspace ids (`workspaceId` under test, `otherId` for isolation).
// - `revisionCitySignal`: a synthetic signal node in a fresh city slug,
//   with its target triple and 6B displayed fingerprint.
// - `WorkspaceFixture`: the fixture record type.
import { randomUUID } from "node:crypto";
import { accountUsers, facetEvents, graphNodes } from "../../db/schema.js";
import { targetFingerprint, type SignalTarget } from "./target.js";
import { database, safety } from "./scope-db-fixture.js";
import { initializeWorkspaceStore } from "../workspaces/init-store.js";
import { addMembership } from "../workspaces/mutations.js";
import { attachPersonalHistory } from "./attachment.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import {
  describeDb,
  workspaceFixture,
  type WorkspaceFixture,
} from "./workspace-archive-fixture.js";

export { describeDb };
export type { WorkspaceFixture };

export async function revisionFixture(): Promise<WorkspaceFixture> {
  return workspaceFixture();
}

/** Preserve pre-cutover history for a member admitted after activation. */
export async function unresolvedRevisionFixture(): Promise<{
  db: WorkspaceFixture["db"]; workspaceId: string;
  contributor: WorkspaceFixture["contributor"]; moderator: WorkspaceFixture["moderator"];
}> {
  const { db } = await database();
  const moderator = { id: randomUUID(), sub: `synthetic-manager-${randomUUID()}` };
  const contributor = { id: randomUUID(), sub: `synthetic-late-${randomUUID()}` };
  for (const person of [moderator, contributor]) {
    await db.insert(accountUsers).values({ ...person, status: "approved" });
  }
  const { workspaceId } = await initializeWorkspaceStore(db, {
    workspaceSlug: `synthetic-${randomUUID()}`, workspaceLabel: "Synthetic pending history",
    approvedAccountIds: [moderator.id], managerAccountIds: [moderator.id],
    moderatorAccountIds: [moderator.id], actorAccountId: moderator.id,
    reason: "synthetic initialization",
  });
  await db.insert(facetEvents).values({ ownerId: contributor.id, actorId: contributor.id,
    citySlug: "synthetic-city", nodeType: "Signal", nodeId: randomUUID(), facet: "selection",
    basket: "pertinent", state: "active", observedFingerprint: "a".repeat(64),
    commandKey: randomUUID(), commandDigest: "c".repeat(64) });
  const attach = (accountId: string) => attachPersonalHistory(db, {
    actorAccountId: moderator.id, reason: "synthetic attachment", entries: [{ accountId, workspaceId }],
  });
  await attach(moderator.id);
  await runPersonalAttachmentActivation(db, {
    workspaceId, actorSub: moderator.sub, reason: "synthetic activation",
  }, safety);
  await addMembership(db, { workspaceId, targetAccountId: contributor.id,
    actorSub: moderator.sub, reason: "synthetic late admission", expectedRevision: null });
  await attach(contributor.id);
  return { db, workspaceId, moderator, contributor };
}

export async function revisionCitySignal(f: WorkspaceFixture, label = "Synthetic 6L1 signal"): Promise<{
  node: typeof graphNodes.$inferSelect; target: SignalTarget; fingerprint: string;
}> {
  const citySlug = `synthetic-6l1-${randomUUID().slice(0, 8)}`;
  const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(),
    type: "Signal", citySlug, label }).returning();
  const target = { citySlug: node!.citySlug, type: "Signal" as const, id: node!.id };
  return { node: node!, target, fingerprint: targetFingerprint(node!) };
}
