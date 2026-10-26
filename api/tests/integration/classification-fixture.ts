import { vi } from "vitest";
import { createApp, type AppDeps } from "../../src/app.js";
import { workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import type { ObjectStore } from "../../src/storage/object-store.js";

export async function classificationFixture(extra: Partial<AppDeps> = {}) {
  const data = await workspaceFixture();
  const signal = await workspaceSignal(data);
  const head = vi.fn(async () => null);
  const app = createApp({ db: data.db, store: { head } as unknown as ObjectStore,
    auth: baseAuth, discarded: EMPTY_DISCARDED_SIGNALS, checkDb: async () => ({ ok: true }),
    classification: { cursorKeyring: { currentKeyId: "test-key", keys: new Map([["test-key", Buffer.alloc(32, 19)]]) },
      apiOrigin: "https://api.example.test", now: () => 1000 },
    checkObjectStore: async () => ({ ok: true }), ...extra });
  const request = async (suffix: string, sub = data.contributor.sub, workspaceId = data.workspaceId) =>
    app.request(`/api/v1/workspaces/${workspaceId}/${suffix}`, { headers: { cookie: await baseCookie(sub) } });
  return { data, signal, app, request, head };
}
