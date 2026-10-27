import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALICE, BOB, CAROL, SCOPE, W1, W2,
  startOuverture, type Ouverture,
} from "./artifacts-ouverture.helpers.js";

describe("ouverture L1 general admission on the host", () => {
  let h: Ouverture;
  beforeAll(async () => { h = await startOuverture("host"); });
  afterAll(async () => { await h?.close(); });

  it("admits publication with zero and with two memberships and no cohort", async () => {
    await h.memberships([]);
    const first = await h.control.handle("ensure", ALICE, { bindingName: "zero-ws", idempotencyKey: "zero-ws" });
    expect(first.status).toBe(201);
    await h.memberships([W1, W2]);
    const second = await h.control.handle("ensure", ALICE, { bindingName: "two-ws", idempotencyKey: "two-ws" });
    expect(second.status).toBe(201);
    for (const [key, result] of [["zero-ws", first], ["two-ws", second]] as const) {
      await h.memberships(key === "zero-ws" ? [] : [W1, W2]);
      expect(await h.control.handle("publish", ALICE, {
        artifactId: (result.body as { artifactId: string }).artifactId, idempotencyKey: `publish-${key}`,
        files: [{ path: "index.html", mimeType: "text/html", text: `<h1>${key}</h1>` }],
      })).toMatchObject({ status: 201 });
    }
    await h.memberships([]);
  });

  it("refuses a suspended account at entry and on replay without charging quotas", async () => {
    const approved = await h.control.handle("ensure", ALICE, { bindingName: "replay-ws", idempotencyKey: "replay-ws" });
    expect(approved.status).toBe(201);
    const before = await h.durable();
    await h.setStatus(ALICE, "suspended");
    try {
      const denied = await h.control.handle("ensure", ALICE, { bindingName: "denied-ws", idempotencyKey: "denied-ws" });
      expect(denied).toMatchObject({ status: 403, body: { error: "account_not_approved" } });
      const replay = await h.control.handle("ensure", ALICE, { bindingName: "replay-ws", idempotencyKey: "replay-ws" });
      expect(replay).toMatchObject({ status: 403, body: { error: "account_not_approved" } });
      expect(await h.durable()).toEqual(before);
    } finally {
      await h.setStatus(ALICE, "approved");
    }
  });

  it("isolates two actors sharing one binding name and key, and hides cross reads", async () => {
    const fromAlice = await h.control.handle("ensure", ALICE, { bindingName: "shared", idempotencyKey: "shared" });
    const fromBob = await h.control.handle("ensure", BOB, { bindingName: "shared", idempotencyKey: "shared" });
    expect(fromAlice.status).toBe(201);
    expect(fromBob.status).toBe(201);
    const idAlice = (fromAlice.body as { artifactId: string }).artifactId;
    const idBob = (fromBob.body as { artifactId: string }).artifactId;
    expect(idBob).not.toBe(idAlice);
    expect(await h.control.handle("meta", BOB, { artifactId: idAlice })).toMatchObject({ status: 404 });
    const listed = await h.control.handle("list", BOB, { limit: 100, offset: 0 });
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(idAlice);
    expect(JSON.stringify(listed.body)).toContain(idBob);
  });

  it("enforces concurrent global ceilings without double charging replay", async () => {
    const before = await h.durable();
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit = operations_used + 1 WHERE storage_scope_id = $1", [SCOPE]);
    try {
      const results = await Promise.all([
        h.control.handle("ensure", ALICE, { bindingName: "quota-a", idempotencyKey: "quota-a" }),
        h.control.handle("ensure", ALICE, { bindingName: "quota-b", idempotencyKey: "quota-b" }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      const first = results[0];
      if (!first) throw new Error("expected two quota race results");
      const winner = first.status === 201 ? "quota-a" : "quota-b";
      const count = async () => (await h.pool.query(`SELECT
        (SELECT count(*) FROM artifacts.artifacts)::int AS artifacts,
        (SELECT count(*) FROM artifacts.operation_receipts)::int AS receipts,
        (SELECT operations_used FROM artifacts.host_quotas)::int AS used`)).rows[0];
      expect(await count()).toMatchObject({ used: before.operations! + 1 });
      const replay = await h.control.handle("ensure", ALICE, { bindingName: winner, idempotencyKey: winner });
      expect(replay.status).toBe(201);
      expect((await count()).used).toBe(before.operations! + 1);
    } finally {
      await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit = 1000000 WHERE storage_scope_id = $1", [SCOPE]);
    }
  });

  it("enforces the durable per-actor ceiling", async () => {
    await h.pool.query("UPDATE artifacts.host_actor_quotas SET operation_limit = 1 WHERE storage_scope_id = $1 AND actor_id = $2",
      [SCOPE, ALICE]);
    const before = await h.durable();
    try {
      const denied = await h.control.handle("ensure", ALICE, { bindingName: "actor-capped", idempotencyKey: "actor-capped" });
      expect(denied.status).toBe(409);
      expect(await h.durable()).toEqual({ ...before, rate: before.rate! + 1 });
    } finally {
      await h.pool.query("UPDATE artifacts.host_actor_quotas SET operation_limit = 1000000 WHERE storage_scope_id = $1 AND actor_id = $2",
        [SCOPE, ALICE]);
    }
  });

  it("refuses over the shared minute bound before S3 without charging quotas", async () => {
    await h.pool.query(`INSERT INTO artifacts.host_actor_rate (storage_scope_id, actor_id, window_start, count)
      VALUES ($1, $2, date_trunc('minute', now()), 10)
      ON CONFLICT (storage_scope_id, actor_id, window_start) DO UPDATE SET count = 10`, [SCOPE, CAROL]);
    const before = await h.durable();
    const denied = await h.control.handle("ensure", CAROL, { bindingName: "rate-capped", idempotencyKey: "rate-capped" });
    expect(denied).toMatchObject({ status: 429, body: { error: "rate_limited", retryable: true } });
    expect(await h.durable()).toEqual(before);
    await h.pool.query("DELETE FROM artifacts.host_actor_rate WHERE storage_scope_id = $1 AND actor_id = $2", [SCOPE, CAROL]);
    expect(await h.control.handle("ensure", CAROL, { bindingName: "rate-capped", idempotencyKey: "rate-capped" }))
      .toMatchObject({ status: 201 });
  });
});
