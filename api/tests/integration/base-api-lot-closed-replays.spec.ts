import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture } from "./base-api-lot-http-fixture.js";

describeDb("b5 populated destination closure", () => {
  it("closes public reads and existing single and batch receipts without mutation", async () => {
    const f = await lotHttpFixture();
    const sub = f.fixture.contributor.sub;
    const first = await f.resolve(0);
    const second = await f.resolve(1);
    const item = (resolved: typeof first) => ({ target: resolved.target,
      displayed_version: resolved.displayed, expected_head_id: null,
      mutation: { action: "select", basket_id: f.fixture.selectionBasket } });
    const singleKey = randomUUID();
    const batchKey = randomUUID();
    const single = { mode: "real", ...item(first) };
    const batch = { mode: "real", items: [item(second)] };
    expect((await f.command("workspace", single, sub, singleKey)).status).toBe(200);
    expect((await f.batch("workspace", batch, sub, batchKey)).status).toBe(200);
    expect((await f.fixture.pool.query("SELECT * FROM facet_commands")).rows).toHaveLength(2);
    await f.fixture.pool.query("UPDATE lot_cutover_state SET destination_open=false WHERE workspace_id=$1",
      [f.fixture.workspaceId]);
    const before = await f.sqlSnapshot();
    const query = `citySlug=${first.target.citySlug}&canonicalId=${first.target.canonicalId}&mode=real`;
    for (const path of [`${f.lotBase}?${query}`, `${f.lotBase}/history?${query}`,
      `${f.lotBase}/heads?citySlug=${first.target.citySlug}&mode=real`,
      `${f.lotBase}/source-history?chainId=synthetic-chain`,
      `${f.lotBase}?${query}&allowClosed=true&internal=true&readback=true`]) {
      const response = await f.request(path, sub);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "lot_cutover_closed" });
    }
    for (const response of [await f.command("workspace", single, sub, singleKey),
      await f.batch("workspace", batch, sub, batchKey)]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "lot_cutover_closed" });
    }
    expect(await f.sqlSnapshot()).toEqual(before);
  });
});
