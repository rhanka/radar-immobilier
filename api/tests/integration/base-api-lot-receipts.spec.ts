import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture } from "./base-api-lot-http-fixture.js";
import { runLotImport } from "../../src/services/facets/lots/lot-importer.js";
import { qualifiedLotReport } from "../../src/services/facets/lots/lot-import-input.js";

describeDb("b5 composed lot receipts and history", () => {
  it("recovers exact receipts with unchanged SQL in both scopes", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const single = { mode: "real", target, displayed_version: displayed,
      expected_head_id: null,
      mutation: { action: "select", basket_id: f.fixture.selectionBasket } };
    const key = randomUUID();
    const first = await f.command("workspace", single, f.fixture.contributor.sub, key);
    expect(first.status).toBe(200);
    const receipt = await first.text();
    const before = await f.sqlSnapshot();
    const replayed = await f.command("workspace", single, f.fixture.contributor.sub, key);
    expect(replayed.status).toBe(200);
    expect(await replayed.text()).toBe(receipt);
    expect(await f.sqlSnapshot()).toEqual(before);
    const personal = { ...single,
      mutation: { action: "discard", reasonCode: "N-NON-RES" } };
    const personalKey = randomUUID();
    const created = await f.command("personal", personal, f.fixture.contributor.sub, personalKey);
    expect(created.status).toBe(200);
    const stored = await created.text();
    const settled = await f.sqlSnapshot();
    const again = await f.command("personal", personal, f.fixture.contributor.sub, personalKey);
    expect(await again.text()).toBe(stored);
    expect(await f.sqlSnapshot()).toEqual(settled);
  });

  it("conflicts on changed payload under the same key without SQL mutation", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(1);
    const sub = f.fixture.contributor.sub;
    const key = randomUUID();
    const first = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "sollicite" },
    }, sub, key);
    expect(first.status).toBe(200);
    const before = await f.sqlSnapshot();
    const conflicted = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "lettre_envoyee" },
    }, sub, key);
    expect(conflicted.status).toBe(409);
    expect(await conflicted.json()).toMatchObject({ error: "idempotency_key_conflict" });
    expect(await f.sqlSnapshot()).toEqual(before);
  });

  it("leaves failed expectations without fabricated receipts", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const staleKey = randomUUID();
    const stale = { mode: "real", target, displayed_version: displayed,
      expected_head_id: "00000000-0000-4000-8000-000000000000",
      mutation: { action: "select", basket_id: f.fixture.selectionBasket } };
    const first = await f.command("workspace", stale, sub, staleKey);
    expect(first.status).toBe(409);
    const failure = await first.json() as { error: string; current: { heads: unknown } };
    expect(failure).toMatchObject({ error: "facet_head_conflict" });
    const before = await f.sqlSnapshot();
    const repeated = await f.command("workspace", stale, sub, staleKey);
    expect(repeated.status).toBe(409);
    expect(await f.sqlSnapshot()).toEqual(before);
    expect(Array.isArray(failure.current.heads)).toBe(true);
  });

  it("paginates destination and source history", async () => {
    const f = await lotHttpFixture();
    await runLotImport(f.fixture.db, { workspaceId: f.fixture.workspaceId,
      actorSub: f.fixture.moderator.sub, report: qualifiedLotReport(), importKey: randomUUID() },
      { enabled: true });
    const sub = f.fixture.contributor.sub;
    const { displayed } = await f.resolve(0);
    expect((await f.command("workspace", {
      mode: "real",
      target: { type: "Lot", authority: "lot_versions",
        citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" },
      displayed_version: displayed, expected_head_id: null,
      mutation: { action: "select", basket_id: f.fixture.selectionBasket },
    }, sub)).status).toBe(200);
    const base = `${f.lotBase}/history?citySlug=synthetic-6j-city&canonicalId=lot-canonical-syn-6j-01&mode=real`;
    const first = await f.request(`${base}&offset=0&limit=1`, sub);
    expect(first.status).toBe(200);
    const page = await first.json() as { events: Array<{ id: string }>; nextOffset: number | null };
    expect(page.events).toHaveLength(1);
    expect(page.nextOffset).toBe(1);
    const second = await f.request(`${base}&offset=1&limit=1`, sub);
    expect(second.status).toBe(200);
    const following = await second.json() as { events: Array<{ id: string }> };
    expect(following.events).toHaveLength(1);
    expect(following.events[0]!.id).not.toBe(page.events[0]!.id);
    const state = await (await f.request(
      `${f.lotBase}?citySlug=synthetic-6j-city&canonicalId=lot-canonical-syn-6j-01&mode=real`,
      sub)).json() as { archive: { workspace: { source: { sourceChainId: string } | null } } };
    const chainId = state.archive.workspace.source!.sourceChainId;
    const chain = await f.request(
      `${f.lotBase}/source-history?chainId=${encodeURIComponent(chainId)}&offset=0&limit=2`,
      sub);
    expect(chain.status).toBe(200);
    const rows = await chain.json() as { rows: Array<{ sourceId: string }>; nextOffset: number | null };
    expect(rows.rows.map((row) => row.sourceId)).toEqual(["mark-6j-0001", "mark-6j-0002"]);
    expect(rows.nextOffset).toBe(2);
    const next = await f.request(
      `${f.lotBase}/source-history?chainId=${encodeURIComponent(chainId)}&offset=2&limit=2`, sub);
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ rows: [{ sourceId: "mark-6j-0003" }], nextOffset: null });
    expect((await f.request(`${f.lotBase}/heads?citySlug=synthetic-6j-city&mode=real`, sub)).status)
      .toBe(200);
    expect((await f.request(
      `${f.lotBase}/source-history?chainId=${encodeURIComponent(chainId)}`, f.fixture.outsider.sub))
      .status).toBe(403);
  });
});
