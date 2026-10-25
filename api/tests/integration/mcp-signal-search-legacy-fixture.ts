import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { createApp } from "../../src/app.js";
import { accountUsers, facetActivationState } from "../../src/db/schema.js";
import { database } from "../../src/services/facets/scope-db-fixture.js";
import { createDiscardedSignalsReader } from "../../src/services/facets/discarded-reader.js";
import { workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { initializeWorkspaceStore } from "../../src/services/workspaces/init-store.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { MCP_SIGNAL_SEARCH_PATH } from "../../src/routes/mcp-signal-search.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";

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

export async function legacyFacadeFixture(epoch: "missing" | "legacy" = "missing") {
  const data = await legacyDataFixture();
  if (epoch === "legacy") await data.db.insert(facetActivationState).values({ workspaceId: data.workspaceId });
  const signal = await workspaceSignal(data);
  const head = vi.fn(async () => null);
  const store = { head } as unknown as ObjectStore;
  const discarded = createDiscardedSignalsReader(data.db);
  const forViewer = vi.spyOn(discarded, "forViewer");
  const app = createApp({ db: data.db, store, discarded, auth: baseAuth,
    checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
    mcpSignalSearch: { enabled: true } });
  const request = async (url: string, sub = data.contributor.sub) => app.request(url,
    { headers: { cookie: await baseCookie(sub) } });
  const search = (query = "", sub = data.contributor.sub) => request(
    `${MCP_SIGNAL_SEARCH_PATH}?city=synthetic-city${query}`, sub);
  return { data, signal, head, forViewer, app, request, search };
}
