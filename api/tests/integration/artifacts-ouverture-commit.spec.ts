import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALICE, BOB, CAROL, SCOPE, startOuverture, type Ouverture } from "./artifacts-ouverture.helpers.js";

describe("general admission at the PostgreSQL commit boundary", () => {
  let h: Ouverture;
  beforeAll(async () => { h = await startOuverture("commit"); });
  afterAll(async () => { await h?.close(); });

  function ensure(actorId: string, key: string) {
    return h.host.execute({ method: "POST", path: "/ensure", actorId,
      body: { bindingName: key, idempotencyKey: key } }, {
      invocationId: randomUUID(), actorId, storageScopeId: SCOPE,
      authorizeCommit: h.host.authorizeCommit,
    });
  }

  it("refuses suspension during upload and on direct replay with no debit", async () => {
    const ensured = await h.control.handle("ensure", ALICE,
      { bindingName: "suspend-upload", idempotencyKey: "suspend-upload" });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    let entered!: () => void;
    let release!: () => void;
    const uploading = new Promise<void>((done) => { entered = done; });
    const gate = new Promise<void>((done) => { release = done; });
    h.beforeUpload(async () => { entered(); await gate; });
    const before = await h.durable();
    const pending = h.control.handle("publish", ALICE, { artifactId,
      idempotencyKey: "suspend-publish", files: [
        { path: "index.html", mimeType: "text/html", text: "suspended during upload" }],
    });
    try {
      await uploading;
      await h.setStatus(ALICE, "suspended");
      release();
      expect(await pending).toMatchObject({ status: 403, body: { error: "account_not_approved" } });
      expect(await ensure(ALICE, "suspend-upload")).toMatchObject({ ok: false,
        failure: { publicCode: "account_not_approved", httpStatus: 403 } });
      expect(await h.durable()).toEqual(before);
    } finally {
      release(); await pending; h.beforeUpload(async () => {});
      await h.setStatus(ALICE, "approved");
    }
  });

  it("reserves the last actor unit once and replays without partial debit", async () => {
    await h.pool.query(`INSERT INTO artifacts.host_actor_quotas
      (storage_scope_id, actor_id, operation_limit, byte_limit) VALUES ($1,$2,1,1000000)`, [SCOPE, CAROL]);
    const before = await h.durable();
    const results = await Promise.all([ensure(CAROL, "actor-race-a"), ensure(CAROL, "actor-race-b")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const after = await h.durable();
    expect(after.operations).toBe(before.operations! + 1);
    expect(after.actor_operations).toBe(before.actor_operations! + 1);
    expect(after.rate).toBe(before.rate! + 1);
    const winner = results[0]!.ok ? "actor-race-a" : "actor-race-b";
    expect(await ensure(CAROL, winner)).toMatchObject({ ok: true });
    expect(await h.durable()).toEqual(after);
  });

  it("serializes the last minute unit across concurrent transactions", async () => {
    const second = Number((await h.pool.query("SELECT extract(second FROM clock_timestamp()) AS second")).rows[0].second);
    if (second > 50) await new Promise((done) => setTimeout(done, (61 - second) * 1000));
    await h.pool.query(`INSERT INTO artifacts.host_actor_rate (storage_scope_id, actor_id, window_start, count)
      VALUES ($1,$2,date_trunc('minute',now()),9)`, [SCOPE, BOB]);
    const results = await Promise.all([ensure(BOB, "minute-race-a"), ensure(BOB, "minute-race-b")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const rate = await h.pool.query("SELECT count FROM artifacts.host_actor_rate WHERE actor_id=$1", [BOB]);
    expect(rate.rows).toEqual([{ count: 10 }]);
    const quota = await h.pool.query("SELECT operations_used::int AS used FROM artifacts.host_actor_quotas WHERE actor_id=$1", [BOB]);
    expect(quota.rows).toEqual([{ used: 1 }]);
    const after = await h.durable();
    expect(await ensure(BOB, results[0]!.ok ? "minute-race-a" : "minute-race-b")).toMatchObject({ ok: true });
    expect(await h.durable()).toEqual(after);
  });
});
