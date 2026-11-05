import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { casBlobKey, createMemoryStaging, createMemoryUploadSessionStore, createMemoryUploadSigner,
  ORPHAN_SWEEP_MAX_KEYS, stagingKey } from "@sentropic/artifacts/server/uploads";
import { createPostgresUploadPageStore, createPostgresUploadSessionStore } from "@sentropic/artifacts/adapters/postgres-uploads";
import { createUploadSweeper } from "@sentropic/artifacts/server/gc";
import { p0bFixture } from "./p0b.test-support.js";

/**
 * Files parity LOT 1 — outside-the-model upload channel on the immo host:
 * create_upload (signed PUT) → staged PUT → commit_upload (server
 * re-verification) → publish_bundle (atomic release), plus the enforced
 * staging sweeper. Memory staging/signer doubles stand in for S3 with the
 * same header-enforcement semantics; the real presigned-PUT path against the
 * test S3 is covered by the api files-parity spec.
 */
function pngBytes(size: number): Uint8Array {
  const body = randomBytes(size);
  body.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return body;
}

function pdfBytes(size: number): Uint8Array {
  const body = randomBytes(size);
  body.set(Buffer.from("%PDF-1.7\n"), 0);
  return body;
}

function digestOf(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function checksumOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

describe.skipIf(!process.env.P0B_DATABASE_URL)("files parity upload channel", () => {
  let fixture: Awaited<ReturnType<typeof p0bFixture>>;
  let call: (op: string, args: unknown, actor?: string) => Promise<{ status: number; body: unknown }>;
  const staging = createMemoryStaging();
  const sessions = createMemoryUploadSessionStore();
  const signerDouble = createMemoryUploadSigner();
  beforeAll(async () => {
    fixture = await p0bFixture();
    const { createArtifactControl } = await import("./facade.js");
    const host = await fixture.connect(undefined,
      { uploads: { sessions, staging, signer: signerDouble.signer } });
    const control = createArtifactControl(host, "p0b", "pages.test");
    call = (op, args, actor = "alice") => control.handle(op, actor, args);
  });
  afterAll(async () => { await fixture?.close(); });

  async function upload(artifactId: string, path: string, mimeType: string, bytes: Uint8Array,
    actor = "alice", idempotencyKey = randomUUID()) {
    const created = await call("create_upload", { artifactId, mimeType, maxSize: bytes.length }, actor);
    expect(created.status, `create ${path}`).toBe(201);
    const body = created.body as { uploadId: string; requiredHeaders: Record<string, string> };
    const key = stagingKey("p0b", body.uploadId);
    signerDouble.put({ key, contentType: mimeType, contentLength: bytes.length }, bytes,
      { ...body.requiredHeaders, "x-amz-checksum-sha256": checksumOf(bytes) });
    await staging.put(key, bytes);
    const committed = await call("commit_upload", { artifactId, uploadId: body.uploadId,
      path, mimeType, digest: digestOf(bytes), size: bytes.length, idempotencyKey }, actor);
    expect(committed.status, `commit ${path}`).toBe(201);
    return { uploadId: body.uploadId, committedBody: committed.body };
  }

  it("should publish a bundle mixing inline files and verified uploads", async () => {
    const ensured = await call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const png = pngBytes(4096);
    const pdf = pdfBytes(2048);
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>`);
    const pngKey = randomUUID();
    const pngPinned = await upload(artifactId, "assets/photo.png", "image/png", png, "alice", pngKey);
    const pdfPinned = await upload(artifactId, "assets/dossier.pdf", "application/pdf", pdf);
    expect(pngPinned.uploadId).not.toBe(pdfPinned.uploadId);
    // Same-key commit returns the identical staged outcome instead of
    // double-pinning (the session is already closed, so a fresh key fails).
    const fresh = await call("commit_upload", { artifactId, uploadId: pngPinned.uploadId,
      path: "assets/photo.png", mimeType: "image/png", digest: digestOf(png),
      size: png.length, idempotencyKey: randomUUID() });
    expect(fresh.status).toBe(422);
    const replayed = await call("commit_upload", { artifactId, uploadId: pngPinned.uploadId,
      path: "assets/photo.png", mimeType: "image/png", digest: digestOf(png),
      size: png.length, idempotencyKey: pngKey });
    expect(replayed.status).toBe(201);
    expect(replayed.body).toEqual(pngPinned.committedBody);
    const published = await call("publish_bundle", { artifactId, idempotencyKey: randomUUID(),
      expectedCurrentReleaseId: null,
      files: [{ path: "index.html", mimeType: "text/html",
        text: "<!doctype html><img src=\"/assets/photo.png\">" }],
      assets: [
        { path: "assets/photo.png", uploadId: pngPinned.uploadId },
        { path: "assets/dossier.pdf", uploadId: pdfPinned.uploadId },
      ] });
    expect(published.status).toBe(201);
    const releaseId = (published.body as { releaseId: string }).releaseId;
    const { rows } = await fixture.pool.query<{ manifest: string }>(
      "SELECT manifest FROM artifacts.releases WHERE artifact_id=$1 AND id=$2", [artifactId, releaseId]);
    const manifest = JSON.parse(rows[0]?.manifest ?? "null") as { files: { path: string }[] };
    expect(manifest.files).toHaveLength(3);
    expect(manifest.files.map((file) => file.path).sort()).toEqual([
      "assets/dossier.pdf", "assets/photo.png", "index.html",
    ]);
    // SVG without scripts passes verification.
    const svgPinned = await upload(artifactId, "assets/logo.svg", "image/svg+xml", svg);
    expect(typeof svgPinned.uploadId).toBe("string");
  });

  it("should complete the guide's literal upload sequence with the exact byte size (R4)", async () => {
    // Follows artifactLifecycle.edit word for word: create_upload with
    // maxSize set to the exact file byte size, PUT of exactly those bytes
    // with the checksum header, commit pinning, then one atomic bundle.
    const ensured = await call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const bytes = pngBytes(3000);
    // "artifacts_create_upload({artifactId, mimeType, maxSize:<exact file byte size>})"
    const created = await call("create_upload", { artifactId, mimeType: "image/png", maxSize: bytes.length });
    expect(created.status).toBe(201);
    const createdBody = created.body as { uploadId: string; uploadUrl: string; requiredHeaders: Record<string, string> };
    // "PUT the exact bytes with the checksum header"
    const key = stagingKey("p0b", createdBody.uploadId);
    signerDouble.put({ key, contentType: "image/png", contentLength: bytes.length }, bytes,
      { ...createdBody.requiredHeaders, "x-amz-checksum-sha256": checksumOf(bytes) });
    await staging.put(key, bytes);
    // "artifacts_commit_upload({artifactId, uploadId, path, mimeType, digest, size, idempotencyKey}) to pin"
    const committed = await call("commit_upload", { artifactId, uploadId: createdBody.uploadId,
      path: "assets/guide-photo.png", mimeType: "image/png", digest: digestOf(bytes),
      size: bytes.length, idempotencyKey: randomUUID() });
    expect(committed.status).toBe(201);
    // "artifacts_publish_bundle({artifactId, files, assets, expectedCurrentReleaseId, idempotencyKey})"
    const published = await call("publish_bundle", { artifactId, idempotencyKey: randomUUID(),
      expectedCurrentReleaseId: null,
      files: [{ path: "index.html", mimeType: "text/html", text: "<!doctype html><h1>Guide</h1>" }],
      assets: [{ path: "assets/guide-photo.png", uploadId: createdBody.uploadId }] });
    expect(published.status).toBe(201);
  });

  it("should bind the ceiling Content-Length when maxSize is omitted (why the guide requires it)", async () => {
    const ensured = await call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    // Same host shape, durable session ledger: the bound size is readable.
    const { createArtifactControl: controlFor } = await import("./facade.js");
    const durable = await fixture.connect(undefined,
      { uploads: { sessions: createPostgresUploadSessionStore(fixture.pool), staging, signer: signerDouble.signer } });
    const durableCall = (op: string, args: unknown, actor = "alice") =>
      controlFor(durable, "p0b", "pages.test").handle(op, actor, args);
    const created = await durableCall("create_upload", { artifactId, mimeType: "image/png" });
    expect(created.status).toBe(201);
    // Without maxSize the signature binds the 16 MiB ceiling, so a PUT of
    // the real (smaller) file is refused by S3: the guide must pass maxSize.
    const session = await createPostgresUploadSessionStore(fixture.pool)
      .get((created.body as { uploadId: string }).uploadId);
    expect(session?.maxSize).toBe(16 * 1024 * 1024);
  });

  it("should refuse a scripted SVG at commit", async () => {
    const ensured = await call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const evil = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
    const created = await call("create_upload", { artifactId, mimeType: "image/svg+xml", maxSize: evil.length });
    expect(created.status).toBe(201);
    const body = created.body as { uploadId: string; requiredHeaders: Record<string, string> };
    const key = stagingKey("p0b", body.uploadId);
    signerDouble.put({ key, contentType: "image/svg+xml", contentLength: evil.length }, evil,
      { ...body.requiredHeaders, "x-amz-checksum-sha256": checksumOf(evil) });
    await staging.put(key, evil);
    const committed = await call("commit_upload", { artifactId, uploadId: body.uploadId, path: "evil.svg",
      mimeType: "image/svg+xml", digest: digestOf(evil), size: evil.length, idempotencyKey: randomUUID() });
    expect(committed.status).toBe(422);
    expect((committed.body as { error: string }).error).toBe("verification_failed");
  });

  it("should persist sessions in Postgres and sweep expired ones", async () => {
    const ensured = await call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    const boundArtifactId = (ensured.body as { artifactId: string }).artifactId;
    const store = createPostgresUploadSessionStore(fixture.pool);
    await store.create({ uploadId: randomUUID(), artifactId: boundArtifactId, storageScopeId: "p0b",
      ownerId: "alice", mimeType: "image/png", maxSize: 8, state: "open",
      expiresAt: new Date(Date.now() - 1000).toISOString(), createdAt: new Date().toISOString() });
    expect(await store.countOpen("p0b", "alice")).toBeGreaterThanOrEqual(1);
    expect((await store.listExpiredOpen(new Date()))).not.toHaveLength(0);
    const sweeper = createUploadSweeper({ sessions: store, staging });
    const report = await sweeper.sweep();
    expect(report.expired).not.toHaveLength(0);
    expect(report.failures).toHaveLength(0);
    expect(await store.listExpiredOpen(new Date())).toHaveLength(0);
  });

  it("should flip an expired page without touching the live release blob", async () => {
    const ensured = await call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const text = "<h1>Sweep</h1>";
    const published = await call("publish", { artifactId,
      files: [{ path: "index.html", mimeType: "text/html", text }],
      idempotencyKey: randomUUID() });
    expect(published.status).toBe(201);
    const minted = await call("create_upload_page", { artifactId });
    expect(minted.status).toBe(201);
    const pageSessionId = (minted.body as { pageSessionId: string }).pageSessionId;
    await fixture.pool.query(
      "UPDATE artifacts.upload_pages SET expires_at = now() - interval '1 second' WHERE id = $1",
      [pageSessionId]);
    // Same Postgres page ledger the host mints into; the orphan-key bound
    // stays visible at the sweep call like in production composition.
    const sweeper = createUploadSweeper({ sessions: createPostgresUploadSessionStore(fixture.pool),
      staging, pages: createPostgresUploadPageStore(fixture.pool),
      orphanKeyLimit: ORPHAN_SWEEP_MAX_KEYS });
    const report = await sweeper.sweep(undefined, { scopes: ["p0b"] });
    expect(report.failures).toEqual([]);
    expect(report.pagesExpired).toContain(pageSessionId);
    const row = await fixture.pool.query<{ state: string }>(
      "SELECT state FROM artifacts.upload_pages WHERE id = $1", [pageSessionId]);
    expect(row.rows).toEqual([{ state: "expired" }]);
    const hex = createHash("sha256").update(text, "utf8").digest("hex");
    expect(await fixture.blobs.getBlob(casBlobKey("p0b", `sha256:${hex}`)))
      .toEqual(new Uint8Array(Buffer.from(text, "utf8")));
  });
});
