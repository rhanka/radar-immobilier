import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { p0bFixture } from "./p0b.test-support.js";
import { compileHostArtifactProfile } from "./p0b-profile.js";
import { createPostgresCommitExecutor } from "@sentropic/artifacts/adapters/postgres-commit";
import { createArtifactCommitCoordinator } from "@sentropic/artifacts/server/commit-contract";
import { createHostPolicy } from "./commit-policy.js";
import { createArtifactControl } from "./facade.js";
import { createAdmissionAuthority } from "./admission.js";

const profile = compileHostArtifactProfile({ profileRevisionId: "immo-artifacts.v2", requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: 2 });
const files = [{ path: "index.html", mimeType: "text/html", text: "<h1>Before</h1>" }];
type Output = { artifactId: string; releaseId: string; stableUrl: string; currentReleaseId: string | null; files: { text?: string; base64?: string; encoding: string }[] };
const output = (response: { body: unknown }) => (response.body as { output: Output }).output;

describe.skipIf(!process.env.P0B_DATABASE_URL)("strict P0-A artifact lifecycle", () => {
  let h: Awaited<ReturnType<typeof p0bFixture>>;
  beforeEach(async () => { h = await p0bFixture(profile); });
  afterEach(async () => { vi.restoreAllMocks(); await h?.close(); });
  async function draft() {
    const result = await h.call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID(), title: "First", description: "Initial page", icon: "house" });
    expect(result.status).toBe(201);
    const artifactId = output(result).artifactId;
    const read = await h.call("meta", { artifactId });
    expect(output(read).currentReleaseId).toBeNull();
    const native = await h.host.app.handle({ actorId: "alice", method: "GET", path: `/meta/${artifactId}`, body: undefined }, {
      invocationId: randomUUID(), actorId: "alice", storageScopeId: "p0b", authorizeCommit: h.host.authorizeCommit });
    expect(native.body).toMatchObject({ ok: true, commitState: "not_committed", output: { artifactId, currentReleaseId: null } });
    return artifactId;
  }
  const publish = (artifactId: string, expectedCurrentReleaseId: string | null, args = {}) =>
    h.call("publish", { artifactId, expectedCurrentReleaseId, files, idempotencyKey: randomUUID(), ...args });

  it("should ensure, read null, publish A, read source, edit B, list versions and revert A over B as C", async () => {
    const artifactId = await draft();
    const a = await publish(artifactId, null);
    expect(a.status).toBe(201);
    const A = output(a).releaseId;
    const source = await h.call("get_source", { artifactId, releaseId: A });
    expect(output(source).releaseId).toBe(A);
    expect(output(source).files[0]).toMatchObject({ text: files[0]!.text, encoding: "utf8" });
    const b = await h.call("publish", { artifactId, expectedCurrentReleaseId: A, idempotencyKey: randomUUID(),
      edits: [{ path: "index.html", oldStr: "Before", newStr: "After" }], title: "Current", description: "Edited page", icon: "building" });
    expect(b.status).toBe(201);
    const B = output(b).releaseId;
    const stale = await h.call("publish", { artifactId, expectedCurrentReleaseId: A, idempotencyKey: randomUUID(),
      edits: [{ path: "index.html", oldStr: "Before", newStr: "Other" }] });
    expect(stale).toMatchObject({ status: 409, body: { error: { code: "conflict", details: {
      variant: "pointer_conflict", currentReleaseId: B, currentSource: { releaseId: B, files: [{ path: "index.html", text: "<h1>After</h1>" }] } } } } });
    const versions = await h.call("list_versions", { artifactId });
    expect(versions.status).toBe(200);
    expect(JSON.stringify(versions.body)).toContain(A);
    expect(JSON.stringify(versions.body)).toContain(B);
    const bobRef = (await h.pool.query<{ id: string }>(
      "SELECT id FROM account_users WHERE sub = 'idp-bob'")).rows[0]!.id;
    await h.call("set_access", { artifactId, action: "grant", principalId: bobRef, grant: "read", idempotencyKey: randomUUID() });
    const c = await h.call("revert", { artifactId, targetReleaseId: A, expectedCurrentReleaseId: B, idempotencyKey: randomUUID() });
    expect(c.status).toBe(201);
    const C = output(c).releaseId;
    expect([A, B]).not.toContain(C);
    expect(output(c).stableUrl).toBe(output(a).stableUrl);
    const restored = await h.call("get_source", { artifactId, releaseId: C });
    expect(output(restored).files).toEqual(output(source).files);
    // I2 on G2: served summaries project the opaque userRef, never the sub.
    expect((await h.call("meta", { artifactId })).body).toMatchObject({ output: { title: "Current", description: "Edited page", icon: "building", grants: [{ principalId: bobRef, grant: "read" }] } });
    const lineage = await h.pool.query("SELECT author_principal_id, parent_release_id, reverted_from_release_id FROM artifacts.releases WHERE id=$1", [C]);
    expect(lineage.rows[0]).toEqual({ author_principal_id: "alice", parent_release_id: B, reverted_from_release_id: A });
    await h.pool.query("UPDATE artifacts.releases SET state='purged' WHERE id=$1", [A]);
    expect(await h.call("revert", { artifactId, targetReleaseId: A, expectedCurrentReleaseId: C, idempotencyKey: randomUUID() }))
      .toMatchObject({ status: 410, body: { error: { code: "release_unavailable", details: { reason: "purged" } } } });
  });

  it("should choose one publisher on B, replay a lost response once, and reject ambiguous edits atomically", async () => {
    const artifactId = await draft();
    const A = output(await publish(artifactId, null)).releaseId;
    const B = output(await publish(artifactId, A, { files: [{ ...files[0], text: "same same" }] })).releaseId;
    const quota = async () => (await h.pool.query("SELECT operations_used FROM artifacts.host_quotas")).rows[0].operations_used;
    const before = BigInt(await quota());
    const args = { artifactId, expectedCurrentReleaseId: B, files, idempotencyKey: randomUUID() };
    const contenders = [args, { ...args, idempotencyKey: randomUUID() }];
    const racers = await Promise.all(contenders.map((input) => h.call("publish", input)));
    expect(racers.map((result) => result.status).sort()).toEqual([201, 409]);
    const winner = racers.find((result) => result.status === 201)!;
    const winningArgs = contenders[racers.findIndex((result) => result.status === 201)]!;
    const conflict = racers.find((result) => result.status === 409)!;
    expect(conflict.body).toMatchObject({ commitState: "not_committed", error: { code: "conflict", details: {
      variant: "pointer_conflict", artifactId, expectedCurrentReleaseId: B, currentReleaseId: output(winner).releaseId } } });
    expect(BigInt(await quota()) - before).toBe(1n);
    const retry = await h.call("publish", winningArgs);
    expect(retry.body).toMatchObject({ ok: true, commitState: "committed", replayed: true, output: { releaseId: output(winner).releaseId } });
    expect(BigInt(await quota()) - before).toBe(1n);
    const current = output(winner).releaseId;
    const duplicated = await publish(artifactId, current, { files: [{ ...files[0], text: "same same" }] });
    const head = output(duplicated).releaseId;
    const beforeEdit = await quota();
    expect(await h.call("publish", { artifactId, expectedCurrentReleaseId: head, idempotencyKey: randomUUID(),
      edits: [{ path: "index.html", oldStr: "same", newStr: "changed" }] })).toMatchObject({
      status: 422, body: { commitState: "not_committed", error: { code: "edit_mismatch", details: { path: "index.html", editIndex: 0, reason: "ambiguous" } } } });
    expect(output(await h.call("meta", { artifactId })).currentReleaseId).toBe(head);
    expect(await quota()).toBe(beforeEdit);
  });

  it("should reconcile a real committed transaction after lost COMMIT acknowledgement with the identical key", async () => {
    const artifactId = await draft();
    const executor = createPostgresCommitExecutor(h.pool);
    const begin = executor.beginFinalization.bind(executor);
    let lose = true;
    executor.beginFinalization = async () => {
      const transaction = await begin();
      const commit = transaction.commit.bind(transaction);
      transaction.commit = async () => {
        await commit();
        if (lose) { lose = false; throw Object.assign(new Error("acknowledgement lost"), { code: "artifact_connection_lost" }); }
      };
      return transaction;
    };
    const policy = await createHostPolicy(h.pool, "p0b", () => ({ enabled: true, mode: "general", subjects: [], expiresAtMs: Infinity }), "radar-c4-r3-artifacts-cas");
    const coordinator = createArtifactCommitCoordinator({ executor, policy });
    const host = await h.connect(profile, { coordinator });
    const control = createArtifactControl(host, "p0b", "pages.test");
    const args = { artifactId, expectedCurrentReleaseId: null, files, idempotencyKey: randomUUID() };
    const unknown = await control.handle("publish", "alice", args);
    expect(unknown.body).toMatchObject({ ok: false, commitState: "unknown", error: { code: "capability_unavailable", retriable: true } });
    const before = (await h.pool.query("SELECT operations_used,bytes_used FROM artifacts.host_quotas")).rows;
    const replay = await control.handle("publish", "alice", args);
    expect(replay.body).toMatchObject({ ok: true, commitState: "committed", replayed: true });
    expect((await h.pool.query("SELECT operations_used,bytes_used FROM artifacts.host_quotas")).rows).toEqual(before);
    expect((await h.pool.query("SELECT id FROM artifacts.releases WHERE artifact_id=$1", [artifactId])).rows)
      .toEqual([{ id: output(replay).releaseId }]);
  });

  it("should discard conflict source when IMMO admission is revoked during the source read", async () => {
    const artifactId = await draft();
    const A = output(await publish(artifactId, null)).releaseId;
    await publish(artifactId, A, { files: [{ ...files[0], text: "<h1>After</h1>" }] });
    const admission = createAdmissionAuthority(h.pool, () => ({ enabled: true, mode: "general", subjects: [], expiresAtMs: Infinity }));
    const control = createArtifactControl(h.host, "p0b", "pages.test", admission);
    const getBlob = h.blobs.getBlob.bind(h.blobs);
    vi.spyOn(h.blobs, "getBlob").mockImplementation(async (key) => {
      const bytes = await getBlob(key);
      if (bytes && new TextDecoder().decode(bytes).includes("After")) {
        await h.pool.query("UPDATE account_users SET status='pending' WHERE sub='alice'");
      }
      return bytes;
    });
    const refused = await control.handle("publish", "alice", { artifactId, expectedCurrentReleaseId: A, idempotencyKey: randomUUID(),
      edits: [{ path: "index.html", oldStr: "Before", newStr: "Other" }] });
    expect(refused).toMatchObject({ status: 403, body: { ok: false, commitState: "not_committed", error: { code: "account_not_approved" } } });
    expect(JSON.stringify(refused.body)).not.toMatch(/currentSource|After/);
  });
});
