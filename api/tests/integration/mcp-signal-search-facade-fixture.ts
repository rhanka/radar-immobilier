import { createApp } from "../../src/app.js";
import { MCP_SIGNAL_SEARCH_PATH } from "../../src/routes/mcp-signal-search.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import type { LegacyRetirementState } from "../../src/services/facets/legacy-retirement.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { searchFixture } from "./mcp-signal-search-fixture.js";

export async function facadeFixture(options: { enabled?: boolean; retirement?: LegacyRetirementState;
  store?: ObjectStore; authEnabled?: boolean; afterWorkspaceResolve?: () => Promise<void> | void } = {}) {
  const f = await searchFixture();
  const auth = { ...baseAuth, enabled: options.authEnabled ?? true };
  const app = createApp({ db: f.data.db, store: options.store ?? f.store, auth,
    discarded: EMPTY_DISCARDED_SIGNALS, checkDb: async () => ({ ok: true }),
    checkObjectStore: async () => ({ ok: true }),
    ...(options.enabled === undefined ? { mcpSignalSearch: { enabled: true,
      ...(options.afterWorkspaceResolve ? { afterWorkspaceResolve: options.afterWorkspaceResolve } : {}) } }
      : options.enabled ? { mcpSignalSearch: { enabled: true } } : {}),
    ...(options.retirement ? { legacyRetirement: options.retirement } : {}),
  });
  const request = async (url: string, sub = f.data.contributor.sub, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("authorization")) headers.set("cookie", await baseCookie(sub));
    return app.request(url, { ...init, headers });
  };
  const search = (query = "", sub = f.data.contributor.sub) => request(
    `${MCP_SIGNAL_SEARCH_PATH}?city=synthetic-city${query}`, sub);
  return { ...f, app, request, search };
}
export type FacadeFixture = Awaited<ReturnType<typeof facadeFixture>>;
