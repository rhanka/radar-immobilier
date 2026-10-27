import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { graphNodes } from "../../src/db/schema.js";
import { SignalSearchResponse } from "../../src/services/facets/classification-search-contract.js";

describeDb("classification PostgreSQL confidentiality", () => {
  it("should isolate two readers, workspaces and native IDs reused across cities", async () => {
    const f = await classificationFixture();
    const { data: d, signal: s } = f;
    await d.db.insert(graphNodes).values({ id: s.target.id, type: "Signal", citySlug: "other-city", label: "Other city" });
    const select = async (sub: string, basket: "pertinent" | "a_surveiller", workspaceId = d.workspaceId) =>
      writeScopedPersonalFacet(d.db, sub, workspaceId, { action: "select", basket, target: s.target,
        expectedHeadId: null, displayedFingerprint: s.fingerprint, commandKey: randomUUID() });
    const search = async (sub = d.contributor.sub, workspaceId = d.workspaceId, query = "") => {
      const response = await f.request(`signal-facets/search?citySlug=synthetic-city${query}`, sub, workspaceId);
      expect(response.status).toBe(200);
      return SignalSearchResponse.parse(await response.json());
    };
    await select(d.contributor.sub, "pertinent");
    const before = await search();
    const privateHead = await select(d.moderator.sub, "a_surveiller");
    const after = await search();
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain(privateHead!.id);
    expect(after.items[0]!.facets.selection.pertinent?.state).toBe("active");
    expect(after.items[0]!.facets.selection.a_surveiller).toBeNull();
    const moderator = await search(d.moderator.sub);
    expect(moderator.items[0]!.facets.selection.pertinent).toBeNull();
    expect(moderator.items[0]!.facets.selection.a_surveiller?.id).toBe(privateHead!.id);
    expect((await search(d.contributor.sub, d.otherId)).counts.navigation.selectedDistinct).toBe(0);
    const city = await (await f.request("signal-facets/search?citySlug=other-city")).json();
    expect(city.items[0].facets.personalHistoryState).toBe("untouched");
    expect(city.items[0].card.label).toBe("Other city");
    const common = await writeWorkspaceArchiveFacet(d.db, d.moderator.sub, d.workspaceId,
      { action: "discard", target: s.target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: s.fingerprint, commandKey: randomUUID() });
    const hidden = await search();
    expect(hidden.items).toEqual([]);
    expect(hidden.counts).toMatchObject({ eligible: 1, visible: 0, discarded: 1 });
    expect(hidden.snapshot.queryToken).not.toBe(before.snapshot.queryToken);
    const revealed = await search(d.contributor.sub, d.workspaceId, "&archive=only");
    expect(revealed.items[0]!.facets.archive.workspace?.id).toBe(common!.id);
    expect(revealed.items[0]!.facets.selection.pertinent?.state).toBe("active");
    expect(revealed.items[0]!.facets.archive.personal).toBeNull();
    const text = JSON.stringify(revealed);
    for (const key of ["ownerId", "actorId", "commandDigest", "commandKey", "props", "receipt"]) expect(text).not.toContain(`"${key}"`);
  });
  it("should produce a real empty city and keep missing signing configuration closed", async () => {
    const f = await classificationFixture({ classification: {} });
    const closed = await f.request("signal-facets/search?citySlug=synthetic-city");
    expect(closed.status).toBe(503);
    expect((await closed.json()).error.code).toBe("transport_unavailable");
    const normal = await classificationFixture();
    const empty = await normal.request("signal-facets/search?citySlug=empty-city");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ items: [], counts: { eligible: 0, matched: 0 }, page: { nextCursor: null, truncated: false } });
  });
  it("should leave every business table unchanged across reads and refusals", async () => {
    const f = await classificationFixture();
    const totals = async () => {
      const result = await f.data.pool.query("SELECT (SELECT count(*) FROM facet_events) events, (SELECT count(*) FROM facet_commands) receipts, (SELECT count(*) FROM facet_event_bindings) bindings, (SELECT count(*) FROM facet_activation_state) epochs, (SELECT count(*) FROM lot_import_runs) imports");
      return result.rows;
    };
    const before = await totals();
    expect((await f.request("facet-context")).status).toBe(200);
    expect((await f.request("signal-facets/search?citySlug=synthetic-city")).status).toBe(200);
    expect((await f.request("signal-facets/search?citySlug=synthetic-city&ownerId=other")).status).toBe(400);
    expect(await totals()).toEqual(before);
  });
});
