import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { createHostPolicy } from "../../../packages/artifacts-host/src/commit-policy.js";
import { ALICE, WORKSPACE, SECOND, barrier, live, startAstra, type Astra } from "./artifacts-astra-a5.helpers.js";

describe("astra A5 transactional scope membership", () => {
  let h: Astra;
  beforeAll(async () => { h = await startAstra("finalization"); });
  beforeEach(async () => { await h.memberships([WORKSPACE]); });
  afterAll(async () => { await h?.close(); });

  it("should reject missing and ambiguous membership in the coordinator without entry admission", async () => {
    const { host } = await h.openHost();
    for (const [ids, publicCode, httpStatus] of [[[], "workspace_membership_required", 403],
      [[WORKSPACE, SECOND], "workspace_ambiguous", 409]] as const) {
      await h.memberships([...ids]);
      const before = await h.durable();
      const outcome = await host.execute({ method: "POST", path: "/ensure", actorId: ALICE,
        body: { bindingName: "denied", idempotencyKey: "denied" } }, h.invocation(host));
      expect(outcome).toMatchObject({ ok: false, failure: { publicCode, httpStatus, retriable: false } });
      expect(await h.durable()).toEqual(before);
    }
  });

  it("should roll back publication, receipt and quota when membership is revoked during upload", async () => {
    const entered = barrier();
    const release = barrier();
    const { host, control } = await h.openHost({ ...h.blobs, async putBlob(...args) {
      entered.resolve(); await release.promise; return h.blobs.putBlob(...args);
    } });
    let pending: ReturnType<typeof control.handle> | undefined;
    try {
      const ensured = await control.handle("ensure", ALICE, { bindingName: "race", idempotencyKey: "race" });
      expect(ensured.status).toBe(201);
      const artifactId = (ensured.body as { artifactId: string }).artifactId;
      const before = await h.durable();
      pending = control.handle("publish", ALICE, { artifactId, idempotencyKey: "race-publish",
        files: [{ path: "index.html", mimeType: "text/html", text: "revoked during upload" }] });
      await entered.promise;
      await h.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now()");
      release.resolve();
      const denied = await pending;
      expect(denied).toMatchObject({ status: 403, body: { error: "workspace_membership_required" } });
      expect(await h.durable()).toEqual(before);
      expect((await h.pool.query("SELECT count(*)::int AS n FROM artifacts.host_failures")).rows[0].n).toBeGreaterThan(0);
    } finally { release.resolve(); await pending; host.close(); }
  });

  it("should reject replay after membership revocation without recharging quota", async () => {
    const { host } = await h.openHost();
    const request = { method: "POST", path: "/ensure", actorId: ALICE,
      body: { bindingName: "replay", idempotencyKey: "replay" } };
    expect(await host.execute(request, h.invocation(host))).toMatchObject({ ok: true });
    const before = await h.durable();
    await h.memberships([]);
    expect(await host.execute(request, h.invocation(host))).toMatchObject({ ok: false,
      failure: { publicCode: "workspace_membership_required", httpStatus: 403 } });
    expect(await h.durable()).toEqual(before);
  });

  it("should hold membership authority until the transaction commits", async () => {
    const { host } = await h.openHost();
    const policy = await createHostPolicy(h.pool, h.config.storageScope, live);
    const client = await h.pool.connect();
    const peer = new pg.Client(h.params);
    await peer.connect();
    let revocation: Promise<pg.QueryResult> | undefined;
    try {
      await client.query("BEGIN");
      const participant = policy.createParticipant(client, "astra-lock");
      expect(await participant.checkApproval!({ actorId: ALICE, operation: "publish" })).toMatchObject({ approved: true });
      const pid = Number((await peer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      revocation = peer.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now()");
      await expect.poll(async () => (await h.pool.query(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.wait_event_type,
      { timeout: 500 }).toBe("Lock");
      expect(await participant.checkApproval!({ actorId: ALICE, operation: "publish" })).toMatchObject({ approved: true });
      await client.query("COMMIT");
      await revocation;
    } finally { await client.query("ROLLBACK"); await revocation; client.release(); await peer.end(); host.close(); }
  });
});
