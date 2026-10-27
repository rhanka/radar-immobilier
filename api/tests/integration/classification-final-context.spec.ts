import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import * as catalog from "../../src/services/facets/classification-catalog.js";

describeDb("classification final durable context availability", () => {
  for (const closure of ["signal", "lot"] as const) {
    it(`should resample when ${closure} closes after the second catalog read`, async () => {
      const f = await classificationFixture();
      await f.data.pool.query("INSERT INTO lot_cutover_state(workspace_id) VALUES($1)", [f.data.workspaceId]);
      const original = catalog.readClassificationCatalog;
      let reads = 0;
      const spy = vi.spyOn(catalog, "readClassificationCatalog").mockImplementation(async (...args) => {
        const result = await original(...args);
        if (++reads === 2) {
          const query = closure === "signal" ? "UPDATE facet_activation_state SET maintenance_barrier=true WHERE workspace_id=$1"
            : "UPDATE lot_cutover_state SET maintenance_barrier=true WHERE workspace_id=$1";
          await f.data.pool.query(query, [f.data.workspaceId]);
        }
        return result;
      });
      try {
        const response = await f.request("facet-context");
        expect(response.status).toBe(200);
        const { context } = await response.json();
        expect(reads).toBeGreaterThanOrEqual(2);
        if (closure === "signal") {
          expect(context.signals.availability).toEqual({ state: "closed", reason: "maintenance" });
          expect(context.reasonCatalog).toEqual({ availability: { state: "closed", reason: "maintenance" },
            profileId: null, digest: null, entries: null });
        } else {
          expect(context.signals.availability).toEqual({ state: "open" });
        }
        expect(context.lots.availability).toEqual({ state: "closed", reason: "maintenance" });
        expect(context.lots.selectionBasket).toBeNull();
        expect(context.lots.modes).toEqual([]);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
      } finally { spy.mockRestore(); }
    });
  }
});
