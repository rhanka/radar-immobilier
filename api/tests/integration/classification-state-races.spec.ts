import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import * as heads from "../../src/services/facets/classification-heads.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { revokeMembership } from "../../src/services/workspaces/mutations.js";

describeDb("classification state business outcomes in coherent projections", () => {
  for (const outcome of ["reveal_required", "target_not_found"] as const) {
    for (const revoked of [false, true]) {
      it(`should ${revoked ? "refuse revoked access" : "retry"} after stale ${outcome} heads`, async () => {
        const f = await classificationFixture();
        const command = { target: f.signal.target, displayedFingerprint: f.signal.fingerprint, commandKey: randomUUID() };
        const archive = outcome === "reveal_required" ? await writeScopedPersonalFacet(f.data.db, f.data.contributor.sub,
          f.data.workspaceId, { ...command, action: "discard", reasonCode: "N-NON-RES", expectedHeadId: null }) : null;
        const original = heads.readClassificationHeads;
        const spy = vi.spyOn(heads, "readClassificationHeads").mockImplementationOnce(async (...args) => {
          const result = await original(...args);
          await writeScopedPersonalFacet(f.data.db, f.data.contributor.sub, f.data.workspaceId, archive
            ? { ...command, commandKey: randomUUID(), action: "restore", expectedHeadId: archive.id }
            : { ...command, action: "discard", reasonCode: "N-NON-RES", expectedHeadId: null });
          if (outcome === "target_not_found") {
            await f.data.pool.query("DELETE FROM graph_nodes WHERE city_slug=$1 AND id=$2", [f.signal.target.citySlug, f.signal.target.id]);
          }
          if (revoked) await revokeMembership(f.data.db, { workspaceId: f.data.workspaceId,
            targetAccountId: f.data.contributor.id, actorSub: f.data.moderator.sub,
            expectedRevision: 1, reason: "Synthetic state authority race" });
          return result;
        });
        try {
          const response = await f.request(`signal-facets/state?citySlug=synthetic-city&type=Signal&id=${f.signal.target.id}`);
          const body = await response.json();
          expect(response.status).toBe(revoked ? 403 : 200);
          if (revoked) {
            expect(body.error.code).toBe("workspace_not_authorized");
            expect(body.item).toBeUndefined();
            expect(body.snapshot).toBeUndefined();
            expect(spy).toHaveBeenCalledTimes(1);
          } else {
            expect(body.item.readiness).toBe(outcome === "reveal_required" ? "ready" : "source_unavailable");
            expect(body.item.facets.personalHidden).toBe(outcome === "target_not_found");
            expect(spy).toHaveBeenCalledTimes(2);
            expect(body.snapshot.kind).toBe("signal-projection-v1");
          }
          expect(response.headers.get("cache-control")).toBe("private, no-store");
        } finally { spy.mockRestore(); }
      });
    }
  }
});
