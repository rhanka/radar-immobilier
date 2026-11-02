import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRECONDITION_REQUIRED_MESSAGE } from "@sentropic/artifacts/mcp-core";
import { p0bFixture } from "./p0b.test-support.js";
import { compileHostArtifactProfile } from "./p0b-profile.js";
import { migrateArtifactCasPolicy } from "./policy-switch.js";
import { createArtifactControl } from "./facade.js";

const legacy = compileHostArtifactProfile({ profileRevisionId: "immo-artifacts.p0b.v1", requireExpectedCurrentReleaseId: false, resultEnvelopeVersion: 1 });
const strict = (version: 1 | 2) => compileHostArtifactProfile({
  profileRevisionId: version === 1 ? "immo-artifacts.cas.v2" : "immo-artifacts.v2",
  requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: version,
});
const files = [{ path: "index.html", mimeType: "text/html", text: "<h1>Before</h1>" }];
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!process.env.P0B_DATABASE_URL)("P0-C switchovers on real PostgreSQL", () => {
  let h: Awaited<ReturnType<typeof p0bFixture>>;
  beforeEach(async () => { h = await p0bFixture(legacy); });
  afterEach(async () => { vi.restoreAllMocks(); await h?.close(); });
  const usage = async () => (await h.pool.query("SELECT operations_used, bytes_used FROM artifacts.host_quotas")).rows[0];
  async function activate(version: 1 | 2) {
    await migrateArtifactCasPolicy(h.pool, "p0b");
    const host = await h.connect(strict(version));
    return { host, control: createArtifactControl(host, "p0b", "pages.test") };
  }

  it("should fence old instances and waiting writes, migrate twice, and replay a historic v1 receipt without quota", async () => {
    const page = await h.page();
    const args = { artifactId: page.artifactId, files, idempotencyKey: randomUUID() };
    const original = await h.call("publish", args);
    expect(original.status).toBe(201);
    // Exact historic receipt shape: no metadata, previousReleaseId or projection fields.
    await h.pool.query(`UPDATE artifacts.operation_receipts SET receipt=jsonb_build_object(
      'releaseId', receipt->'releaseId', 'manifest', receipt->'manifest') WHERE receipt->>'releaseId'=$1`,
    [(original.body as { releaseId: string }).releaseId]);
    const reached = barrier();
    const resume = barrier();
    const put = h.blobs.putBlob.bind(h.blobs);
    vi.spyOn(h.blobs, "putBlob").mockImplementationOnce(async (...input) => {
      reached.resolve(); await resume.promise; return put(...input);
    });
    const waiting = h.call("publish", { ...args, idempotencyKey: randomUUID(), files: [{ ...files[0], text: "waiting" }] });
    await reached.promise;
    const cas = await activate(1);
    await migrateArtifactCasPolicy(h.pool, "p0b");
    resume.resolve();
    expect((await waiting).status).toBe(403);
    expect((await h.call("publish", { ...args, idempotencyKey: randomUUID() })).status).toBe(403);
    const before = await usage();
    expect((await cas.control.handle("publish", "alice", args)).body).toMatchObject({ releaseId: (original.body as { releaseId: string }).releaseId });
    const v2 = await activate(2);
    expect((await v2.control.handle("publish", "alice", args)).body).toMatchObject({
      ok: true, commitState: "committed", replayed: true, output: { releaseId: (original.body as { releaseId: string }).releaseId },
    });
    expect(await usage()).toEqual(before);
    const changed = await v2.control.handle("publish", "alice", { ...args, files: [{ ...files[0], text: "changed" }] });
    expect(changed).toMatchObject({ status: 409, body: { error: { code: "conflict", details: { variant: "command_conflict" } } } });
    expect(await usage()).toEqual(before);
    await h.pool.query("UPDATE artifacts.operation_receipts SET receipt='{}' WHERE receipt->>'releaseId'=$1", [(original.body as { releaseId: string }).releaseId]);
    expect((await v2.control.handle("publish", "alice", args)).body).toMatchObject({ ok: false, commitState: "unknown" });
    expect(await usage()).toEqual(before);
  });

  it("should wait for pre-switch shared policy locks before establishing the exclusive switchover", async () => {
    const client = await h.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT revision FROM artifacts.host_policy WHERE storage_scope_id='p0b' FOR SHARE");
      const transition = migrateArtifactCasPolicy(h.pool, "p0b");
      await vi.waitFor(async () => {
        const blocked = await h.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE artifacts.host_policy%'");
        expect(blocked.rowCount).toBe(1);
      });
      await client.query("COMMIT");
      await transition;
      expect((await h.pool.query("SELECT revision FROM artifacts.host_policy")).rows[0].revision).toBe("radar-c4-r3-artifacts-cas");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });

  it("should replay a completed P0b deletion with its historic codec without filling a new strict omission", async () => {
    const page = await h.page();
    const untouched = await h.page();
    const args = { artifactId: page.artifactId, idempotencyKey: randomUUID() };
    const challenge = await h.call("delete", args);
    const confirmationRef = (challenge.body as { details: { confirmationRef: string } }).details.confirmationRef;
    expect(await h.confirmation.approve(confirmationRef, "alice")).toBe(true);
    const command = { ...args, confirmationRef };
    const deleted = await h.call("delete", command);
    expect(deleted.status).toBe(200);
    const v2 = await activate(2);
    const before = await usage();
    const replay = await v2.control.handle("delete", "alice", command);
    expect(replay).toMatchObject({ status: 200, body: { ok: true, commitState: "committed", replayed: true, output: deleted.body } });
    expect(command).not.toHaveProperty("expectedCurrentReleaseId");
    expect(await usage()).toEqual(before);
    expect(await v2.control.handle("delete", "alice", { artifactId: untouched.artifactId, idempotencyKey: randomUUID() }))
      .toMatchObject({ status: 428, body: { error: { code: "precondition_required" } } });
  });

  it.each([1, 2] as const)("should reject a new omission after authorization and publish null only after a read in envelope %s", async (version) => {
    const { control } = await activate(version);
    const ensured = await control.handle("ensure", "alice", { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    const output = (body: unknown) => (version === 2 ? (body as { output: Record<string, unknown> }).output : body) as Record<string, unknown>;
    const artifactId = String(output(ensured.body).artifactId);
    const read = await control.handle("meta", "alice", { artifactId });
    expect(output(read.body).currentReleaseId).toBeNull();
    const before = await usage();
    const args = { artifactId, files, idempotencyKey: randomUUID() };
    const refused = await control.handle("publish", "alice", args);
    const details = { profileRevisionId: strict(version).profileRevisionId, resultEnvelopeVersion: version,
      requiredField: "expectedCurrentReleaseId", readTools: ["artifacts_get", "artifacts_list"] };
    expect(refused).toMatchObject({ status: 428, body: version === 1
      ? { error: "precondition_required", message: PRECONDITION_REQUIRED_MESSAGE, retryable: false, details }
      : { ok: false, commitState: "not_committed", error: { code: "precondition_required", message: PRECONDITION_REQUIRED_MESSAGE, retriable: false, details } } });
    expect(await usage()).toEqual(before);
    expect((await control.handle("publish", "idp-bob", args)).status).toBe(404);
    expect((await control.handle("publish", "alice", { ...args, expectedCurrentReleaseId: null })).status).toBe(201);
    expect((await control.handle("publish", "alice", { ...args, idempotencyKey: randomUUID(), expectedCurrentReleaseId: null })).status).toBe(409);
  });
});
