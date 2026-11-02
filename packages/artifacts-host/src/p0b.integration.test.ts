import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ARTIFACT_P0B } from "./p0b-profile.js";
import { p0bFixture } from "./p0b.test-support.js";
import { createStoredReader } from "../../../api/src/artifacts/reader-storage.js";
import type { FinalizeTxClient } from "@sentropic/artifacts/server/commit-contract";
import { createAdmissionAuthority } from "./admission.js";
import { createArtifactControl } from "./facade.js";

describe.skipIf(!process.env.P0B_DATABASE_URL)("IMMO artifact host with real PostgreSQL", () => {
  let h: Awaited<ReturnType<typeof p0bFixture>>;
  beforeAll(async () => { h = await p0bFixture(); });
  afterAll(async () => { await h?.close(); });
  beforeEach(async () => {
    await h.pool.query("DELETE FROM artifacts.host_actor_rate");
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

  it("should expose current publication metadata and order visible artifacts before pagination", async () => {
    const first = await h.page();
    const second = await h.page();
    const drafts: string[] = [];
    for (const day of [3, 4]) {
      const ensured = await h.call("ensure", { bindingName: `draft-${randomUUID()}`, idempotencyKey: randomUUID() });
      expect(ensured.status).toBe(201);
      const { artifactId } = ensured.body as { artifactId: string };
      drafts.push(artifactId);
      await h.pool.query("UPDATE artifacts.artifacts SET created_at=$2 WHERE id=$1", [artifactId, `2026-10-0${day}T00:00:00Z`]);
    }
    for (const [page, day] of [[first, 1], [second, 2]] as const) {
      await h.pool.query("UPDATE artifacts.artifacts SET created_at=$2 WHERE id=$1", [page.artifactId, `2026-10-0${day}T00:00:00Z`]);
      await h.pool.query("UPDATE artifacts.releases SET created_at='2026-10-05T00:00:00Z' WHERE id=$1", [page.releaseId]);
    }
    type Summary = { artifactId: string; bindingName: string; currentReleaseId: string | null;
      stableUrl: string; pinnedUrl: string | null; createdAt: string; updatedAt: string | null; state: string; published: boolean };
    const list = async (args = {}) => {
      const response = await h.call("list", args);
      expect(response.status).toBe(200);
      return response.body as { total: number; artifacts: Summary[] };
    };
    const before = await list();
    expect(before.artifacts.map((item) => item.artifactId)).toEqual([second.artifactId, first.artifactId, drafts[1], drafts[0]]);
    expect(before.artifacts[0]).toMatchObject({ bindingName: second.bindingName, currentReleaseId: second.releaseId,
      stableUrl: `https://${second.artifactId}.pages.test/`, pinnedUrl: `https://${second.releaseId}.pinned.pages.test/`,
      createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", state: "active", published: true });
    expect(before.artifacts[2]).toMatchObject({ currentReleaseId: null, pinnedUrl: null, updatedAt: null, state: "active", published: false });
    expect((await h.call("meta", { artifactId: drafts[1] })).body).toMatchObject(before.artifacts[2]!);
    const republished = await h.call("publish", { artifactId: first.artifactId, files: first.files, idempotencyKey: randomUUID() });
    expect(republished.status).toBe(201);
    const releaseId = (republished.body as { releaseId: string }).releaseId;
    const publication = await h.pool.query("SELECT created_at, manifest_digest FROM artifacts.releases WHERE id=$1", [releaseId]);
    // A newer unpromoted release must not replace the current publication's timestamp.
    await h.pool.query(`INSERT INTO artifacts.releases (id,artifact_id,manifest_digest,manifest,state,created_at)
      SELECT $1,artifact_id,manifest_digest,manifest,state,'2099-01-01' FROM artifacts.releases WHERE id=$2`, [randomUUID(), releaseId]);
    const after = await list();
    expect(after.artifacts.map((item) => item.artifactId)).toEqual([first.artifactId, second.artifactId, drafts[1], drafts[0]]);
    expect(after.artifacts[0]).toMatchObject({ currentReleaseId: releaseId, pinnedUrl: `https://${releaseId}.pinned.pages.test/`,
      updatedAt: (publication.rows[0].created_at as Date).toISOString(), bindingName: first.bindingName });
    if (ARTIFACT_P0B) expect(after.artifacts[0]).toHaveProperty("digest", publication.rows[0].manifest_digest);
    expect((await h.call("meta", { artifactId: first.artifactId })).body).toMatchObject(after.artifacts[0]!);
    expect(await list({ limit: 1, offset: 1 })).toEqual({ total: 4, artifacts: [after.artifacts[1]] });
    expect((await h.call("list", {}, "idp-bob")).body).toMatchObject({ total: 0, artifacts: [] });
    expect((await h.call("meta", { artifactId: first.artifactId }, "idp-bob")).status).toBe(404);
  });

  it.skipIf(!ARTIFACT_P0B)("should return full get/list summaries and retained source for editing and republication", async () => {
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

  it.skipIf(!ARTIFACT_P0B).each([
    ["account", { error: "account_not_approved", status: "pending" }],
    ["activation", { error: "activation_closed" }],
    ["membership", { error: "workspace_membership_required" }],
    ["unavailable", { error: "capability_unavailable" }],
  ] as const)("should refuse source bytes after %s authority changes during the blob read", async (revocation, error) => {
    const { artifactId } = await h.page();
    let enabled = true;
    let memberships = ["p0b"];
    const authority = { ...createAdmissionAuthority(h.pool, () => enabled
      ? { enabled: true, subjects: ["alice"], expiresAtMs: Number.POSITIVE_INFINITY }
      : { enabled: false, reason: "activation_off" }, undefined, "p0b"),
      readMemberships: async () => memberships };
    const control = createArtifactControl(h.host, "p0b", "pages.test", authority);
    const getBlob = h.host.blobs.getBlob.bind(h.host.blobs);
    const spy = vi.spyOn(h.host.blobs, "getBlob").mockImplementationOnce(async (key) => {
      const bytes = await getBlob(key);
      if (revocation === "account") await h.pool.query("UPDATE account_users SET status='pending' WHERE sub='alice'");
      if (revocation === "activation") enabled = false;
      if (revocation === "membership") memberships = [];
      if (revocation === "unavailable") vi.spyOn(authority, "readStatus").mockRejectedValue(new Error("database unavailable"));
      return bytes;
    });
    try {
      const response = await control.handle("get_source", "alice", { artifactId });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ status: revocation === "unavailable" ? 503 : 403, body: error });
      if (revocation === "unavailable") expect(response).toHaveProperty("retryable", true);
    } finally {
      spy.mockRestore();
      await h.pool.query("UPDATE account_users SET status='approved' WHERE sub='alice'");
    }
  });

  it.skipIf(!ARTIFACT_P0B)("should allow only named approved IdP subjects, preserve read-only grants and revoke at exhausted quota", async () => {
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

  it.skipIf(!ARTIFACT_P0B)("should reread recipient approval on the transaction after the request snapshot", async () => {
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

  it.skipIf(!ARTIFACT_P0B)("should require human approval, roll proof consumption back on denial and replay a terminal deletion", async () => {
    const p = await h.page();
    const { args, ref } = await challenge(p.artifactId);
    const reader = createStoredReader(h.pool, "p0b", "pages.test", h.host.blobs);
    expect(await reader.authority.getContentOrigin(p.artifactId)).not.toBeNull();
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
    expect(await reader.authority.getContentOrigin(p.artifactId)).toBeNull();
    expect(await reader.authority.getRelease(p.artifactId, p.releaseId)).toBeNull();
    expect(await reader.getArtifactIdForRelease(p.releaseId)).toBeNull();
    expect(await reader.releaseFiles.getFile(p.artifactId, p.releaseId, "index.html")).toBeNull();
    expect((await h.call("ensure", { bindingName: p.bindingName, idempotencyKey: randomUUID() })).status).toBe(410);
    await expect(h.pool.query("UPDATE artifacts.artifacts SET lifecycle_state='active' WHERE id=$1", [p.artifactId])).rejects.toMatchObject({ code: "23514" });
    for (const op of ["restore", "fork", "promote", "renew"]) expect((await h.call(op, { artifactId: p.artifactId })).status).toBe(503);
  });

  it.skipIf(!ARTIFACT_P0B)("should refuse a confirmation that expires while consumption waits for its row lock", async () => {
    const { artifactId } = await h.page();
    const { ref } = await challenge(artifactId);
    expect(await h.confirmation.approve(ref, "alice")).toBe(true);
    const context = (await h.confirmation.read(ref, "alice"))!;
    const locking = await h.pool.connect();
    const consuming = await h.pool.connect();
    let pending: ReturnType<typeof h.confirmation.port.consume> | undefined;
    try {
      await locking.query("BEGIN");
      await locking.query("SELECT 1 FROM artifacts.delete_confirmations WHERE confirmation_ref=$1 FOR UPDATE", [ref]);
      await consuming.query("BEGIN");
      const pid = (await consuming.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      pending = h.confirmation.port.consume(consuming as unknown as FinalizeTxClient, context, ref);
      await vi.waitFor(async () => {
        const waiting = await h.pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]);
        expect(waiting.rows[0]?.wait_event_type).toBe("Lock");
      });
      // Expire after BEGIN and while the consumer is blocked, using only the DB clock.
      await locking.query("UPDATE artifacts.delete_confirmations SET expires_at=clock_timestamp() WHERE confirmation_ref=$1", [ref]);
      await locking.query("COMMIT");
      expect(await pending).toBe("expired");
      await consuming.query("COMMIT");
      expect((await h.confirmation.read(ref, "alice"))?.consumed).toBe(false);
    } finally {
      await locking.query("ROLLBACK");
      await pending?.catch(() => undefined);
      await consuming.query("ROLLBACK");
      locking.release();
      consuming.release();
    }
  });

  it.skipIf(!ARTIFACT_P0B)("should reject expired, forged, mismatched and stale confirmations", async () => {
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
