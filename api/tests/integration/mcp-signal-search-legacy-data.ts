import { randomUUID } from "node:crypto";
import { accountUsers } from "../../src/db/schema.js";
import { database } from "../../src/services/facets/scope-db-fixture.js";
import { initializeWorkspaceStore } from "../../src/services/workspaces/init-store.js";

/** No attachment, activation or scoped data is created, even transiently. */
export async function legacyDataFixture() {
  const handle = await database();
  const moderator = { id: randomUUID(), sub: `synthetic-moderator-${randomUUID()}` };
  const contributor = { id: randomUUID(), sub: `synthetic-contributor-${randomUUID()}` };
  const outsider = { id: randomUUID(), sub: `synthetic-outsider-${randomUUID()}` };
  for (const person of [moderator, contributor, outsider]) {
    await handle.db.insert(accountUsers).values({ ...person, status: "approved" });
  }
  const init = (ids: string[]) => initializeWorkspaceStore(handle.db, {
    workspaceSlug: `synthetic-${randomUUID()}`, workspaceLabel: "Unactivated search",
    approvedAccountIds: ids, managerAccountIds: [moderator.id], moderatorAccountIds: [moderator.id],
    actorAccountId: moderator.id, reason: "synthetic preactivation initialization",
  });
  const first = await init([moderator.id, contributor.id]);
  const second = await init([moderator.id, outsider.id]);
  return { ...handle, moderator, contributor, outsider,
    workspaceId: first.workspaceId, otherId: second.workspaceId };
}
