import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture } from "./base-api-lot-http-fixture.js";

describeDb("b5 composed lot concurrency and revocation", () => {
  it("settles one winner when distinct commands race the same head", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const base = { mode: "real", target, displayed_version: displayed, expected_head_id: null };
    const before = (await f.fixture.pool.query("SELECT COUNT(*)::integer AS n FROM facet_events"))
      .rows[0]!.n as number;
    const [left, right] = await Promise.all([
      f.command("workspace",
        { ...base, mutation: { action: "set_pipeline", status: "sollicite" } }, sub),
      f.command("workspace",
        { ...base, mutation: { action: "set_pipeline", status: "lettre_envoyee" } }, sub),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const after = (await f.fixture.pool.query("SELECT COUNT(*)::integer AS n FROM facet_events"))
      .rows[0]!.n as number;
    expect(after).toBe(before + 1);
  });

  it("replays identical idempotency keys with one SQL mutation", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(1);
    const sub = f.fixture.contributor.sub;
    const body = { mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "sollicite" } };
    const key = randomUUID();
    const before = await f.sqlSnapshot();
    const [left, right] = await Promise.all([
      f.command("workspace", body, sub, key),
      f.command("workspace", body, sub, key),
    ]);
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(await right.text()).toBe(await left.text());
    const events = (await f.fixture.pool.query("SELECT COUNT(*)::integer AS n FROM facet_events"))
      .rows[0]!.n as number;
    expect(events).toBe((before[0] as unknown[]).length + 1);
  });

  it("conflicts on stale content fingerprints with the current version", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    await f.fixture.pool.query("UPDATE lot_versions SET raw_ref=$1 WHERE id=$2",
      ["synthetic-6j-stale-probe", displayed.lot_version_id]);
    const before = await f.sqlSnapshot();
    const stale = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket },
    }, sub);
    expect(stale.status).toBe(409);
    const current = await stale.json() as {
      error: string; current: { version: { lot_version_id: string; fingerprint: string } } };
    expect(current.error).toBe("target_version_conflict");
    expect(current.current.version.lot_version_id).toBe(displayed.lot_version_id);
    expect(current.current.version.fingerprint).not.toBe(displayed.fingerprint);
    expect(await f.sqlSnapshot()).toEqual(before);
  });

  it("denies revoked receipt recovery without business payload or mutation", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(1);
    const sub = f.fixture.contributor.sub;
    const key = randomUUID();
    const body = { mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "sollicite" } };
    expect((await f.command("workspace", body, sub, key)).status).toBe(200);
    const before = await f.sqlSnapshot();
    await f.fixture.pool.query(
      "UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
      [f.fixture.workspaceId, f.fixture.contributor.id]);
    const denied = await f.command("workspace", body, sub, key);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "workspace_membership_required" });
    expect(await f.sqlSnapshot()).toEqual(before);
  });
});
