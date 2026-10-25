import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { SignalStateResponse } from "../../src/services/facets/classification-state.js";

describeDb("classification state HTTP and disappeared sources", () => {
  it("should retain inactive personal history after source loss and return 404 without authorized history", async () => {
    const f = await classificationFixture();
    const { data: d, signal: s } = f;
    const params = new URLSearchParams(s.target);
    const read = (extra = "", sub = d.contributor.sub, workspaceId = d.workspaceId) =>
      f.request(`signal-facets/state?${params}${extra}`, sub, workspaceId);
    const first = await read();
    expect(first.status).toBe(200);
    expect(SignalStateResponse.parse(await first.json()).item.readiness).toBe("ready");
    const selected = await writeScopedPersonalFacet(d.db, d.contributor.sub, d.workspaceId, {
      action: "select", basket: "pertinent", target: s.target, expectedHeadId: null,
      displayedFingerprint: s.fingerprint, commandKey: randomUUID(),
    });
    await writeScopedPersonalFacet(d.db, d.contributor.sub, d.workspaceId, {
      action: "deselect", basket: "pertinent", target: s.target, expectedHeadId: selected!.id,
      displayedFingerprint: s.fingerprint, commandKey: randomUUID(),
    });
    await d.pool.query("DELETE FROM graph_nodes WHERE city_slug=$1 AND id=$2", [s.target.citySlug, s.target.id]);
    const lost = await read();
    expect(lost.status).toBe(200);
    expect(SignalStateResponse.parse(await lost.json()).item).toMatchObject({ readiness: "source_unavailable", card: null,
      displayedFingerprint: null, facets: { personalHistoryState: "has_history", selection: { pertinent: { state: "inactive" } } } });
    for (const [sub, workspaceId] of [[d.moderator.sub, d.workspaceId], [d.contributor.sub, d.otherId]]) {
      const missing = await read("", sub, workspaceId);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ ok: false, error: { code: "target_not_found", action: "correct_query" } });
    }
    expect((await (await f.request("signal-facets/search?citySlug=synthetic-city")).json()).counts.eligible).toBe(0);
  });
  it("should require reveal on HTTP while retaining common history when the source disappears", async () => {
    const f = await classificationFixture();
    const { data: d, signal: s } = f;
    await writeWorkspaceArchiveFacet(d.db, d.moderator.sub, d.workspaceId, {
      action: "discard", target: s.target, reasonCode: "N-NON-RES", expectedHeadId: null,
      displayedFingerprint: s.fingerprint, commandKey: randomUUID(),
    });
    const path = `signal-facets/state?${new URLSearchParams(s.target)}`;
    const hidden = await f.request(path);
    expect(hidden.status).toBe(409);
    expect(await hidden.json()).toMatchObject({ ok: false, error: { code: "reveal_required", retryable: false, action: "request_reveal" } });
    const revealed = await f.request(`${path}&reveal=true`);
    expect(revealed.status).toBe(200);
    expect((await revealed.json()).item.facets.personalHistoryState).toBe("untouched");
    for (const extra of ["&reveal=1", "&reveal=TRUE", "&reveal=true&reveal=false", "&ownerId=other"]) {
      expect((await f.request(`${path}${extra}`)).status).toBe(400);
    }
    await d.pool.query("DELETE FROM graph_nodes WHERE city_slug=$1 AND id=$2", [s.target.citySlug, s.target.id]);
    const missing = await f.request(path);
    expect(missing.status).toBe(200);
    expect((await missing.json()).item).toMatchObject({ readiness: "source_unavailable", facets: { workspaceHidden: true, personalHistoryState: "untouched" } });
  });
});
