import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { describeDb, unresolvedRevisionFixture } from "../../src/services/facets/projection-revisions-fixture.js";
import { readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { FACET_PROFILE } from "../../src/services/facets/codebook.js";

describeDb("classification signal-only BASE history barrier", () => {
  for (const family of ["signal", "lot"] as const) {
    it(`should keep ${family} personal history unresolved without opening lot modes`, async () => {
      const f = await unresolvedRevisionFixture(family === "signal" ? {} : { targetType: "lot", nodeType: "Lot",
        nodeId: "unattached-lot", facet: "archive", basket: null, state: "active", mode: "real",
        profileId: FACET_PROFILE, reasonCode: "N-NON-RES", verdict: "non_pertinent", observedLotVersion: randomUUID() });
      const app = createApp({ db: f.db, store: {} as ObjectStore, auth: baseAuth,
        checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
        classification: { cursorKeyring: { currentKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 21)]]) } } });
      const headers = { cookie: await baseCookie(f.contributor.sub) };
      const prefix = `/api/v1/workspaces/${f.workspaceId}`;
      for (const suffix of ["signal-facets/search?citySlug=synthetic-city", "signal-facets/state?citySlug=synthetic-city&type=Signal&id=id&reveal=true"]) {
        const response = await app.request(`${prefix}/${suffix}`, { headers });
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ ok: false, error: { code: "personal_history_unresolved", action: "contact_operator" } });
      }
      const context = await (await app.request(`${prefix}/facet-context`, { headers })).json();
      expect(context.context.signals.availability).toEqual({ state: "unavailable", reason: "unresolved_history" });
      await expect(readProjectionScope(f.db, f.contributor.sub, f.workspaceId, "synthetic-city", "real")).rejects.toThrow("unsupported_projection_mode");
    });
  }
});
