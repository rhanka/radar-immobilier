import { vi } from "vitest";
import { createApp } from "../../src/app.js";
import { facetActivationState } from "../../src/db/schema.js";
import { createDiscardedSignalsReader } from "../../src/services/facets/discarded-reader.js";
import { workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { MCP_SIGNAL_SEARCH_PATH } from "../../src/routes/mcp-signal-search.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { legacyDataFixture } from "./mcp-signal-search-legacy-data.js";
import type { LegacyRetirementState } from "../../src/services/facets/legacy-retirement.js";

export async function legacyFacadeFixture(epoch: "missing" | "legacy" = "missing", retirement?: LegacyRetirementState) {
  const data = await legacyDataFixture();
  if (epoch === "legacy") await data.db.insert(facetActivationState).values({ workspaceId: data.workspaceId });
  const signal = await workspaceSignal(data);
  const head = vi.fn(async () => null);
  const store = { head } as unknown as ObjectStore;
  const discarded = createDiscardedSignalsReader(data.db);
  const forViewer = vi.spyOn(discarded, "forViewer");
  const app = createApp({ db: data.db, store, discarded, auth: baseAuth,
    checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
    ...(retirement ? { legacyRetirement: retirement } : {}),
    mcpSignalSearch: { enabled: true } });
  const request = async (url: string, sub = data.contributor.sub) => app.request(url,
    { headers: { cookie: await baseCookie(sub) } });
  const search = (query = "", sub = data.contributor.sub) => request(
    `${MCP_SIGNAL_SEARCH_PATH}?city=synthetic-city${query}`, sub);
  return { data, signal, head, forViewer, app, request, search };
}
