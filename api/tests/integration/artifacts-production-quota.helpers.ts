import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { startHarness } from "./artifacts-h2.helpers.js";
import { openProductionPeer } from "./artifacts-production-worker.helpers.js";

export async function qualifyLastQuotaUnit() {
  const h = await startHarness("quotaprocess");
  let peer: Awaited<ReturnType<typeof openProductionPeer>> | undefined;
  try {
    await h.pool.query("INSERT INTO account_users (sub, status) VALUES ('alice', 'approved')");
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit = 1, byte_limit = 0");
    peer = await openProductionPeer(h);
    expect(peer.pid).not.toBe(process.pid);
    const commands = [{ bindingName: "quota-a", idempotencyKey: "quota-a" },
      { bindingName: "quota-b", idempotencyKey: "quota-b" }];
    const results = await Promise.all([h.control.handle("ensure", "alice", commands[0]),
      peer.ensure(commands[1]!.bindingName, commands[1]!.idempotencyKey)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = results.findIndex((r) => r.status === 201);
    const count = async () => (await h.pool.query(`SELECT
      (SELECT count(*) FROM artifacts.artifacts)::int AS artifacts,
      (SELECT count(*) FROM artifacts.operation_receipts)::int AS receipts,
      (SELECT operations_used FROM artifacts.host_quotas)::int AS used`)).rows[0];
    expect(await count()).toEqual({ artifacts: 1, receipts: 1, used: 1 });
    await peer.close();
    peer = await openProductionPeer(h);
    const replay = await peer.ensure(commands[winner]!.bindingName, commands[winner]!.idempotencyKey);
    expect(replay).toMatchObject({ status: 201, body: { replayed: true } });
    expect(await count()).toEqual({ artifacts: 1, receipts: 1, used: 1 });
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit = 2");
    const loser = commands[1 - winner]!;
    expect(await peer.ensure(loser.bindingName, loser.idempotencyKey)).toMatchObject({ status: 201 });
    expect(await count()).toEqual({ artifacts: 2, receipts: 2, used: 2 });
  } finally { await peer?.close(); await h.close(); }
}

export async function qualifyAdmissionQuotaAccounting() {
  const h = await startHarness("quotaadmission");
  try {
    await h.pool.query("INSERT INTO account_users (sub, status) VALUES ('alice', 'approved')");
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit = 1, byte_limit = 0");
    const invocationId = randomUUID();
    const request = { method: "POST", path: "/ensure", actorId: "alice",
      body: { bindingName: "denied-quota", idempotencyKey: "denied-quota" } };
    const invocation = { invocationId, actorId: "alice", storageScopeId: h.config.storageScope,
      authorizeCommit: async () => ({ allowed: false as const, reason: "revoked" as const,
        publicCode: "access_denied", status: 403, retriable: false }) };
    const first = await h.host.execute(request, invocation);
    expect(first).toMatchObject({ ok: false, failure: { category: "unauthorized_at_commit" } });
    await h.host.execute(request, invocation);
    const state = (await h.pool.query(`SELECT
      (SELECT count(*) FROM artifacts.artifacts)::int AS artifacts,
      (SELECT count(*) FROM artifacts.operation_receipts)::int AS receipts,
      (SELECT count(*) FROM artifacts.host_failures WHERE invocation_id = $1)::int AS failures,
      (SELECT operations_used FROM artifacts.host_quotas)::int AS used`, [invocationId])).rows[0];
    expect(state).toEqual({ artifacts: 0, receipts: 0, failures: 1, used: 0 });
    const retry = await h.host.execute(request,
      { ...invocation, invocationId: randomUUID(), authorizeCommit: h.host.authorizeCommit });
    expect(retry).toMatchObject({ ok: true, replayed: false });
    expect((await h.pool.query("SELECT operations_used FROM artifacts.host_quotas")).rows[0].operations_used).toBe("1");
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit = 2");
    await h.pool.query("UPDATE artifacts.host_policy SET revision = 'withdrawn-policy'");
    const staleHost = await h.host.execute({ ...request,
      body: { bindingName: "stale-policy", idempotencyKey: "stale-policy" } },
    { ...invocation, invocationId: randomUUID(), authorizeCommit: h.host.authorizeCommit });
    expect(staleHost).toMatchObject({ ok: false, failure: { category: "unauthorized_at_commit" } });
    expect((await h.pool.query("SELECT operations_used FROM artifacts.host_quotas")).rows[0].operations_used).toBe("1");
    expect((await h.pool.query("SELECT count(*) FROM artifacts.operation_receipts")).rows[0].count).toBe("1");
  } finally { await h.close(); }
}
