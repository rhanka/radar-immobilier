import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ARTIFACT_P0B } from "./p0b-profile.js";
import { p0bFixture } from "./p0b.test-support.js";

describe.skipIf(!ARTIFACT_P0B || !process.env.P0B_DATABASE_URL)("P0b host with real PostgreSQL", () => {
  let h: Awaited<ReturnType<typeof p0bFixture>>;
  beforeAll(async () => { h = await p0bFixture(); });
  afterAll(async () => { await h?.close(); });
  beforeEach(async () => {
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit=1000,byte_limit=10000000");
    await h.pool.query("UPDATE artifacts.host_actor_quotas SET operation_limit=1000,byte_limit=10000000");
    await h.pool.query("UPDATE account_users SET status='approved' WHERE sub='idp-bob'");
  });
  const challenge = async (artifactId: string) => {
    const args = { artifactId, idempotencyKey: randomUUID() };
    const refused = await h.call("delete", args);
    expect(refused).toMatchObject({ status: 409, body: { error: "confirmation_required", details: {
      managementUrl: expect.stringContaining("https://app.test/api/v1/artifacts/control/delete-confirmations/") } } });
    return { args, ref: (refused.body as { details: { confirmationRef: string } }).details.confirmationRef };
  };

  it("should return full get/list summaries and retained source for editing and republication", async () => {
    const p = await h.page();
    const meta = await h.call("meta", { artifactId: p.artifactId });
    expect(meta.body).toMatchObject({ artifactId: p.artifactId, currentReleaseId: p.releaseId, bindingName: expect.any(String),
      ownerId: "alice", storageScopeId: "p0b", state: "active", permissions: { read: true, source: true, write: true } });
    expect((await h.call("list", {})).body).toMatchObject({ artifacts: expect.arrayContaining([expect.objectContaining({
      artifactId: p.artifactId, currentReleaseId: p.releaseId, stableUrl: `https://${p.artifactId}.pages.test/` })]) });
    const source = await h.call("get_source", { artifactId: p.artifactId });
    expect(source.status).toBe(200);
    const snapshot = source.body as { manifest: string; files: { path: string; mimeType: string; bytes: number[] }[] };
    expect(JSON.parse(snapshot.manifest)).toMatchObject({ artifactId: p.artifactId });
    expect(new TextDecoder().decode(Uint8Array.from(snapshot.files[0]!.bytes))).toBe("<h1>Before</h1>");
    const published = await h.call("publish", { artifactId: p.artifactId, idempotencyKey: randomUUID(),
      files: snapshot.files.map((file) => ({ path: file.path, mimeType: file.mimeType, text: "<h1>After</h1>" })) });
    expect(published.status).toBe(201);
    expect((await h.call("get_source", { artifactId: p.artifactId, releaseId: p.releaseId })).status).toBe(200);
  });

  it("should allow only named approved IdP subjects, preserve read-only grants and revoke at exhausted quota", async () => {
    const { artifactId } = await h.page();
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit=operations_used,byte_limit=bytes_used");
    const share = { artifactId, action: "grant", principalId: "idp-bob", grant: "read", idempotencyKey: randomUUID() };
    const granted = await h.call("set_access", share);
    expect(granted).toMatchObject({ status: 200, body: { isPublic: false, grants: [{ principalId: "idp-bob", grant: "read" }] } });
    expect((await h.call("set_access", share)).body).toEqual(granted.body);
    expect((await h.call("meta", { artifactId }, "idp-bob")).status).toBe(200);
    expect((await h.call("get_source", { artifactId }, "idp-bob")).status).toBe(403);
    expect((await h.call("set_access", { ...share, idempotencyKey: randomUUID() }, "idp-bob")).status).toBe(403);
    for (const principalId of ["pending", "unknown", "bob@example.test"]) {
      expect((await h.call("set_access", { ...share, principalId, idempotencyKey: randomUUID() })).status).toBe(403);
    }
    await h.pool.query("UPDATE account_users SET status='pending' WHERE sub='idp-bob'");
    expect((await h.call("set_access", { artifactId, action: "revoke", principalId: "idp-bob", idempotencyKey: randomUUID() })).status).toBe(200);
    expect((await h.call("meta", { artifactId }, "idp-bob")).status).toBeGreaterThanOrEqual(400);
  });

  it("should reread recipient approval on the transaction after the request snapshot", async () => {
    const { artifactId } = await h.page();
    const query = h.pool.query.bind(h.pool);
    let armed = true;
    const spy = vi.spyOn(h.pool, "query").mockImplementation(async (...args: Parameters<typeof h.pool.query>) => {
      const result = await query(...args);
      if (armed && String(args[0]).startsWith("SELECT sub, status FROM account_users")) {
        armed = false;
        await query("UPDATE account_users SET status='pending' WHERE sub='idp-bob'");
      }
      return result;
    });
    try {
      expect((await h.call("set_access", { artifactId, action: "grant", principalId: "idp-bob", grant: "read", idempotencyKey: randomUUID() })).status).toBe(403);
      expect((await query("SELECT 1 FROM artifacts.artifact_access WHERE artifact_id=$1", [artifactId])).rowCount).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it("should require human approval, roll proof consumption back on denial and replay a terminal deletion", async () => {
    const p = await h.page();
    const { args, ref } = await challenge(p.artifactId);
    expect(await h.confirmation.approve(ref, "idp-bob")).toBe(false);
    expect((await h.call("delete", { ...args, confirmationRef: ref })).body).toMatchObject({ error: "confirmation_invalid" });
    expect(await h.confirmation.approve(ref, "alice")).toBe(true);
    const prepared = await h.confirmation.prepareDelete("alice", { ...args, confirmationRef: ref });
    const denied = await h.host.execute({ method: "POST", path: "/delete", actorId: "alice", body: prepared }, {
      invocationId: randomUUID(), actorId: "alice", storageScopeId: "p0b", authorizeCommit: async () => ({
        allowed: false, reason: "denied", publicCode: "access_denied", status: 403, retriable: false }) });
    expect(denied.ok).toBe(false);
    expect((await h.confirmation.read(ref, "alice"))?.consumed).toBe(false);
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit=operations_used,byte_limit=bytes_used");
    const deleted = await h.call("delete", { ...args, confirmationRef: ref });
    expect(deleted).toMatchObject({ status: 200, body: { terminal: true, state: "deleted", purgeState: "pending" } });
    expect((await h.confirmation.read(ref, "alice"))?.consumed).toBe(true);
    expect((await h.call("delete", { ...args, confirmationRef: ref })).body).toEqual(deleted.body);
    expect((await h.call("get_source", { artifactId: p.artifactId, releaseId: p.releaseId })).status).toBe(410);
    expect((await h.call("ensure", { bindingName: p.bindingName, idempotencyKey: randomUUID() })).status).toBe(410);
    await expect(h.pool.query("UPDATE artifacts.artifacts SET lifecycle_state='active' WHERE id=$1", [p.artifactId])).rejects.toMatchObject({ code: "23514" });
    for (const op of ["restore", "fork", "promote", "renew"]) expect((await h.call(op, { artifactId: p.artifactId })).status).toBe(503);
  });

  it("should reject expired, forged, mismatched and stale confirmations", async () => {
    const p = await h.page();
    const { args, ref } = await challenge(p.artifactId);
    expect(await h.confirmation.approve(ref, "alice")).toBe(true);
    expect((await h.call("delete", { ...args, confirmationRef: randomUUID() })).body).toMatchObject({ error: "confirmation_invalid" });
    expect((await h.call("delete", { ...args, idempotencyKey: randomUUID(), confirmationRef: ref })).body).toMatchObject({ error: "confirmation_invalid" });
    await h.pool.query("UPDATE artifacts.delete_confirmations SET expires_at=now()-interval '1 second' WHERE confirmation_ref=$1", [ref]);
    expect((await h.call("delete", { ...args, confirmationRef: ref })).body).toMatchObject({ error: "confirmation_expired" });
    const fresh = await challenge(p.artifactId);
    await h.confirmation.approve(fresh.ref, "alice");
    expect((await h.call("publish", { artifactId: p.artifactId, files: p.files, idempotencyKey: randomUUID() })).status).toBe(201);
    expect((await h.call("delete", { ...fresh.args, confirmationRef: fresh.ref })).body).toMatchObject({ error: "confirmation_stale" });
  });
});
