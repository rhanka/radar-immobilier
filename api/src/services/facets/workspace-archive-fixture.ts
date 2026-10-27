// Disposable synthetic databases for 6I workspace archive qualification.
import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { accountUsers, graphNodes } from "../../db/schema.js";
import { initializeWorkspaceStore } from "../workspaces/init-store.js";
import { attachPersonalHistory } from "./attachment.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import { database, safety } from "./scope-db-fixture.js";
import { targetFingerprint } from "./target.js";

export const describeDb: ReturnType<typeof describe.skipIf> = describe.skipIf(process.env.LOT_MIGRATION_DB_TEST !== "1");

export async function workspaceFixture() {
  const handle = await database();
  const { db } = handle;
  const moderator = { id: randomUUID(), sub: `synthetic-moderator-${randomUUID()}` };
  const contributor = { id: randomUUID(), sub: `synthetic-contributor-${randomUUID()}` };
  const outsider = { id: randomUUID(), sub: `synthetic-outsider-${randomUUID()}` };
  for (const person of [moderator, contributor, outsider]) {
    await db.insert(accountUsers).values({ ...person, status: "approved" });
  }
  const init = async (approvedAccountIds = [moderator.id, contributor.id]) => initializeWorkspaceStore(db, {
    workspaceSlug: `synthetic-${randomUUID()}`, workspaceLabel: "Synthetic 6I",
    approvedAccountIds,
    managerAccountIds: [moderator.id], moderatorAccountIds: [moderator.id],
    actorAccountId: moderator.id, reason: "synthetic initialization",
  });
  const first = await init();
  const second = await init([moderator.id, contributor.id, outsider.id]);
  await attachPersonalHistory(db, { actorAccountId: moderator.id,
    reason: "synthetic attachment", entries: [
      { accountId: moderator.id, workspaceId: first.workspaceId },
      { accountId: contributor.id, workspaceId: first.workspaceId },
      { accountId: outsider.id, workspaceId: second.workspaceId },
    ] });
  for (const workspaceId of [first.workspaceId, second.workspaceId]) {
    await runPersonalAttachmentActivation(db,
      { workspaceId, actorSub: moderator.sub, reason: "synthetic activation" }, safety);
  }
  return { ...handle, moderator, contributor, outsider,
    workspaceId: first.workspaceId, otherId: second.workspaceId };
}

export type WorkspaceFixture = Awaited<ReturnType<typeof workspaceFixture>>;

export async function workspaceSignal(f: WorkspaceFixture, label = "Synthetic 6I signal") {
  const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(),
    type: "Signal", citySlug: "synthetic-city", label }).returning();
  const target = { citySlug: node!.citySlug, type: "Signal" as const, id: node!.id };
  return { node: node!, target, fingerprint: targetFingerprint(node!) };
}
