import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadConfig } from "../../src/config.js";
import { startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { createStoredReader, BASKET_READER_PROFILE } from "../../src/artifacts/reader-storage.js";
import { createReaderContentApp } from "../../src/artifacts/content-serve.js";
import { mintGrant } from "../../src/artifacts/preview-grant.js";
import { fingerprintReaderProfile } from "../../src/artifacts/reader-profile.js";
import { mintSessionCookie } from "../../src/artifacts/preview-session.js";
import { GRANT_SECRET, ISSUER, SESSION_SECRET } from "../../src/artifacts/reader-test-fixture.js";

/**
 * Files parity LOT 1, immo side — the exact provider call sequence from the
 * LOT 1 contract: create_upload → signed PUT → commit_upload →
 * publish_bundle, then sub-resources served with 200 and the declared MIME
 * type on the stable host. 30 files / ~10 MB: PNG and PDF travel the upload
 * channel, HTML/CSS stay inline.
 *
 * LOT 2 adds: variable fonts and funnel videos through the same channel
 * (magic-byte verified, declared MIME served), single-range 206/416 with
 * HEAD parity on both content hosts, and the browser upload page journey
 * (mint → exchange → stage → publish_bundle_v2 with zero file bytes in any
 * MCP payload).
 */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = Buffer.from("GIF89a");
const WOFF2 = Buffer.from("wOF2");
const MP4_PREFIX = Buffer.from("ftyp");
const MP4_BRAND = Buffer.from("isom");
const WEBP_PREFIX = Buffer.from("RIFF");
const PDF_PREFIX = Buffer.from("%PDF-1.7\n");

function uploadBytes(kind: string, size: number): Uint8Array {
  const body = randomBytes(size);
  if (kind === "image/png") body.set(PNG, 0);
  else if (kind === "image/jpeg") body.set(JPEG, 0);
  else if (kind === "image/gif") body.set(GIF, 0);
  else if (kind === "image/webp") {
    body.set(WEBP_PREFIX, 0);
    body.writeUInt32LE(Math.max(size - 8, 0), 4);
    body.set(Buffer.from("WEBP"), 8);
  } else if (kind === "application/pdf") body.set(PDF_PREFIX, 0);
  else throw new Error(`unknown upload kind: ${kind}`);
  return body;
}

const UPLOADS: { path: string; mimeType: string }[] = [
  ...Array.from({ length: 13 }, (_, i) => ({ path: `assets/photo-${i}.png`, mimeType: "image/png" })),
  ...Array.from({ length: 5 }, (_, i) => ({ path: `assets/photo-${i}.jpg`, mimeType: "image/jpeg" })),
  ...Array.from({ length: 3 }, (_, i) => ({ path: `assets/anim-${i}.gif`, mimeType: "image/gif" })),
  ...Array.from({ length: 3 }, (_, i) => ({ path: `assets/photo-${i}.webp`, mimeType: "image/webp" })),
  ...Array.from({ length: 2 }, (_, i) => ({ path: `assets/dossier-${i}.pdf`, mimeType: "application/pdf" })),
  ...Array.from({ length: 2 }, (_, i) => ({ path: `assets/logo-${i}.svg`, mimeType: "image/svg+xml" })),
];

describe("files parity bundle publish and serve", () => {
  let h: Harness;
  // Staging keys of refused commits are never pinned; the harness only
  // deletes blob keys, so the spec removes its own leftovers for the
  // bucket deletion in close().
  const stagingLeftovers: string[] = [];
  beforeAll(async () => { h = await startHarness("filesparity", ["author-alice"]); });
  afterAll(async () => {
    try {
      const env = loadConfig();
      const s3 = new S3Client({ endpoint: env.S3_ENDPOINT, forcePathStyle: true, region: "us-east-1",
        credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
      for (const uploadId of stagingLeftovers) {
        await s3.send(new DeleteObjectCommand({ Bucket: h.config.s3Bucket,
          Key: `artifacts/${h.config.storageScope}/staging/${uploadId}` })).catch(() => {});
      }
      s3.destroy();
    } finally {
      await h?.close();
    }
  });

  it("should publish a 30-file 10 MB bundle and serve every sub-resource on the stable host", async () => {
    const ensured = await h.control.handle("ensure", "author-alice",
      { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const readerSub = "files-reader";
    await h.pool.query("INSERT INTO account_users (sub, status) VALUES ($1, 'approved')", [readerSub]);
    await h.pool.query("INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ($1, $2, 'read')",
      [artifactId, readerSub]);

    const assets: { path: string; uploadId: string }[] = [];
    let totalBytes = 0;
    for (const [index, file] of UPLOADS.entries()) {
      const bytes = file.mimeType === "image/svg+xml"
        ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="${index + 1}" height="8"/></svg>`)
        : uploadBytes(file.mimeType, 410_000 + index * 997);
      totalBytes += bytes.length;
      const created = await h.control.handle("create_upload", "author-alice",
        { artifactId, mimeType: file.mimeType, maxSize: bytes.length });
      expect(created.status, `create ${file.path}`).toBe(201);
      const session = created.body as { uploadId: string; uploadUrl: string;
        requiredHeaders: Record<string, string>; checksumHeader: string };
      const checksum = createHash("sha256").update(bytes).digest("base64");
      const put = await fetch(session.uploadUrl, { method: "PUT",
        headers: { ...session.requiredHeaders, [session.checksumHeader]: checksum },
        body: Buffer.from(bytes) });
      expect(put.status, `PUT ${file.path}`).toBeLessThan(300);
      const committed = await h.control.handle("commit_upload", "author-alice", { artifactId,
        uploadId: session.uploadId, path: file.path, mimeType: file.mimeType,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        size: bytes.length, idempotencyKey: randomUUID() });
      expect(committed.status, `commit ${file.path}`).toBe(201);
      assets.push({ path: file.path, uploadId: session.uploadId });
    }
    expect(totalBytes).toBeGreaterThan(10 * 1024 * 1024);
    const inline = [
      { path: "index.html", mimeType: "text/html",
        text: `<!doctype html><html><body>${assets.filter((a) => a.path.endsWith(".png")).map((a) => `<img src="/${a.path}">`).join("")}</body></html>` },
      { path: "style.css", mimeType: "text/css", text: "body{margin:0}" },
    ];
    const published = await h.control.handle("publish_bundle", "author-alice", { artifactId,
      idempotencyKey: randomUUID(), expectedCurrentReleaseId: null, files: inline, assets });
    expect(published.status).toBe(201);
    const releaseId = (published.body as { releaseId: string }).releaseId;
    const { rows } = await h.pool.query<{ manifest: string }>(
      "SELECT manifest FROM artifacts.releases WHERE artifact_id=$1 AND id=$2", [artifactId, releaseId]);
    const manifest = JSON.parse(rows[0]?.manifest ?? "null") as { files: { path: string; size: number }[] };
    expect(manifest.files).toHaveLength(30);
    expect(manifest.files.reduce((sum, file) => sum + file.size, 0)).toBeGreaterThan(10 * 1024 * 1024);

    // Digest-verified serving with the declared MIME type.
    const stored = createStoredReader(h.pool, h.config.storageScope, "pages.example.test", h.blobs);
    for (const file of [...UPLOADS, ...inline.map(({ path, mimeType }) => ({ path, mimeType }))]) {
      const expectedType = file.mimeType.startsWith("text/") ? `${file.mimeType}; charset=utf-8` : file.mimeType;
      const served = await stored.releaseFiles.getFile(artifactId, releaseId, `/${file.path}`);
      expect(served?.contentType, file.path).toBe(expectedType);
      expect(served!.body.byteLength).toBeGreaterThan(0);
    }

    // Stable host: 200 on every kind, sandbox on the active types.
    const app = createReaderContentApp({ ...stored, contentBase: "pages.example.test",
      grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER });
    const host = `${artifactId}.pages.example.test`;
    const now = Date.now();
    const sid = randomUUID();
    const grant = await mintGrant({ ...ISSUER, host, artifactId, releaseId, readerSub, sessionId: sid,
      profileName: BASKET_READER_PROFILE.name, policyRevision: BASKET_READER_PROFILE.policyRevision,
      profileFingerprint: fingerprintReaderProfile(BASKET_READER_PROFILE) }, GRANT_SECRET, now);
    const cookie = mintSessionCookie({ sid, readerSub, artifactId, createdAt: now, expiresAt: now + 900_000 },
      SESSION_SECRET).split(";")[0]!;
    const get = (path: string) => app.request(`https://${host}${path}?grant=${grant}`, { headers: { host, cookie } });
    for (const [path, type, sandbox] of [
      ["/index.html", "text/html; charset=utf-8", false],
      ["/assets/photo-0.png", "image/png", false],
      ["/assets/dossier-0.pdf", "application/pdf", true],
      ["/assets/logo-0.svg", "image/svg+xml", true],
    ] as const) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      // Charset case is a server spelling detail (Hono emits UTF-8 on the
      // normalized HTML path); the declared MIME type must match exactly.
      expect(res.headers.get("content-type")?.toLowerCase(), path).toBe(type);
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      const csp = res.headers.get("content-security-policy") ?? "";
      if (sandbox) {
        // SVG/PDF are active-content types: a sandboxed document even
        // though commit verification already rejects scripts.
        expect(csp, path).toBe("sandbox");
      } else {
        expect(csp, path).toContain("frame-ancestors 'none'");
      }
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  });

  it("should refuse a scripted SVG at commit and a corrupt digest", async () => {
    const ensured = await h.control.handle("ensure", "author-alice",
      { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const evil = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
    const created = await h.control.handle("create_upload", "author-alice",
      { artifactId, mimeType: "image/svg+xml", maxSize: evil.length });
    expect(created.status).toBe(201);
    const session = created.body as { uploadId: string; uploadUrl: string;
      requiredHeaders: Record<string, string>; checksumHeader: string };
    stagingLeftovers.push(session.uploadId);
    const put = await fetch(session.uploadUrl, { method: "PUT",
      headers: { ...session.requiredHeaders,
        [session.checksumHeader]: createHash("sha256").update(evil).digest("base64") },
      body: evil });
    expect(put.status).toBeLessThan(300);
    const committed = await h.control.handle("commit_upload", "author-alice", { artifactId,
      uploadId: session.uploadId, path: "evil.svg", mimeType: "image/svg+xml",
      digest: `sha256:${createHash("sha256").update(evil).digest("hex")}`,
      size: evil.length, idempotencyKey: randomUUID() });
    expect(committed.status).toBe(422);
    expect((committed.body as { error: string }).error).toBe("verification_failed");
  });

  it("should publish a WOFF2 font and an MP4 video and serve both with the declared MIME type", async () => {
    const ensured = await h.control.handle("ensure", "author-alice",
      { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const fontBytes = Buffer.concat([WOFF2, randomBytes(2048)]);
    const videoBytes = Buffer.concat([MP4_PREFIX, Buffer.alloc(4), MP4_BRAND, randomBytes(8192)]);
    const staged: { path: string; uploadId: string }[] = [];
    for (const [path, mimeType, bytes] of [
      ["assets/display.woff2", "font/woff2", fontBytes],
      ["assets/funnel.mp4", "video/mp4", videoBytes],
    ] as const) {
      const created = await h.control.handle("create_upload", "author-alice",
        { artifactId, mimeType, maxSize: bytes.length });
      expect(created.status, `create ${path}`).toBe(201);
      const session = created.body as { uploadId: string; uploadUrl: string;
        requiredHeaders: Record<string, string>; checksumHeader: string };
      const put = await fetch(session.uploadUrl, { method: "PUT",
        headers: { ...session.requiredHeaders,
          [session.checksumHeader]: createHash("sha256").update(bytes).digest("base64") },
        body: Buffer.from(bytes) });
      expect(put.status, `PUT ${path}`).toBeLessThan(300);
      const committed = await h.control.handle("commit_upload", "author-alice", { artifactId,
        uploadId: session.uploadId, path, mimeType,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        size: bytes.length, idempotencyKey: randomUUID() });
      expect(committed.status, `commit ${path}`).toBe(201);
      staged.push({ path, uploadId: session.uploadId });
    }
    const published = await h.control.handle("publish_bundle", "author-alice", { artifactId,
      idempotencyKey: randomUUID(), expectedCurrentReleaseId: null,
      files: [{ path: "index.html", mimeType: "text/html", text: "<!doctype html><html><body>media</body></html>" }],
      assets: staged });
    expect(published.status).toBe(201);
    const releaseId = (published.body as { releaseId: string }).releaseId;
    const stored = createStoredReader(h.pool, h.config.storageScope, "pages.example.test", h.blobs);
    for (const [path, mimeType, bytes] of [
      ["assets/display.woff2", "font/woff2", fontBytes],
      ["assets/funnel.mp4", "video/mp4", videoBytes],
    ] as const) {
      const served = await stored.releaseFiles.getFile(artifactId, releaseId, `/${path}`);
      expect(served?.contentType, path).toBe(mimeType);
      expect(Buffer.from(served!.body as Uint8Array).equals(Buffer.from(bytes)), path).toBe(true);
    }
  });

  it("should serve single ranges with 206, refuse unsatisfiable ones with 416, and keep HEAD parity", async () => {
    const ensured = await h.control.handle("ensure", "author-alice",
      { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const videoBytes = Buffer.concat([MP4_PREFIX, Buffer.alloc(4), MP4_BRAND, randomBytes(10_000 - 12)]);
    const created = await h.control.handle("create_upload", "author-alice",
      { artifactId, mimeType: "video/mp4", maxSize: videoBytes.length });
    const session = created.body as { uploadId: string; uploadUrl: string;
      requiredHeaders: Record<string, string>; checksumHeader: string };
    await fetch(session.uploadUrl, { method: "PUT",
      headers: { ...session.requiredHeaders,
        [session.checksumHeader]: createHash("sha256").update(videoBytes).digest("base64") },
      body: videoBytes });
    await h.control.handle("commit_upload", "author-alice", { artifactId,
      uploadId: session.uploadId, path: "assets/clip.mp4", mimeType: "video/mp4",
      digest: `sha256:${createHash("sha256").update(videoBytes).digest("hex")}`,
      size: videoBytes.length, idempotencyKey: randomUUID() });
    const published = await h.control.handle("publish_bundle", "author-alice", { artifactId,
      idempotencyKey: randomUUID(), expectedCurrentReleaseId: null,
      files: [{ path: "index.html", mimeType: "text/html", text: "<!doctype html><html><body>ranges</body></html>" }],
      assets: [{ path: "assets/clip.mp4", uploadId: session.uploadId }] });
    expect(published.status).toBe(201);
    const releaseId = (published.body as { releaseId: string }).releaseId;
    const size = videoBytes.length;
    const app = createReaderContentApp({ ...createStoredReader(h.pool, h.config.storageScope,
      "pages.example.test", h.blobs), contentBase: "pages.example.test",
      grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER });
    const now = Date.now();
    const readerSub = "range-reader";
    await h.pool.query("INSERT INTO account_users (sub, status) VALUES ($1, 'approved')", [readerSub]);
    await h.pool.query("INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ($1, $2, 'read')",
      [artifactId, readerSub]);
    // One session id shared by the grant and the session cookie, as the
    // reader host binds them together.
    const sid = randomUUID();
    const grantFor = async (host: string) => mintGrant({ ...ISSUER, host,
      artifactId, releaseId, readerSub, sessionId: sid,
      profileName: BASKET_READER_PROFILE.name, policyRevision: BASKET_READER_PROFILE.policyRevision,
      profileFingerprint: fingerprintReaderProfile(BASKET_READER_PROFILE) }, GRANT_SECRET, now);
    const cookie = mintSessionCookie({ sid, readerSub, artifactId,
      createdAt: now, expiresAt: now + 900_000 }, SESSION_SECRET).split(";")[0]!;
    const stableHost = `${artifactId}.pages.example.test`;
    const grant = await grantFor(stableHost);
    const get = (path: string, range?: string) => app.request(`https://${stableHost}${path}?grant=${grant}`,
      { headers: { host: stableHost, cookie, ...(range ? { range } : {}) } });
    const head = (path: string, range?: string) => app.request(`https://${stableHost}${path}?grant=${grant}`,
      { method: "HEAD", headers: { host: stableHost, cookie, ...(range ? { range } : {}) } });
    // Valid range: first 100 bytes with the byte-range headers.
    const first = await get("/assets/clip.mp4", "bytes=0-99");
    expect(first.status).toBe(206);
    expect(first.headers.get("content-range")).toBe(`bytes 0-99/${size}`);
    expect(first.headers.get("accept-ranges")).toBe("bytes");
    expect(first.headers.get("content-type")).toBe("video/mp4");
    expect(first.headers.get("content-length")).toBe("100");
    expect(Buffer.from(await first.arrayBuffer()).equals(videoBytes.subarray(0, 100))).toBe(true);
    // Suffix range: the last 10 bytes.
    const tail = await get("/assets/clip.mp4", `bytes=${size - 10}-`);
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe(`bytes ${size - 10}-${size - 1}/${size}`);
    expect(Buffer.from(await tail.arrayBuffer()).equals(videoBytes.subarray(size - 10))).toBe(true);
    // Unsatisfiable start: 416 with the size hint, no body bytes.
    const pastEnd = await get("/assets/clip.mp4", `bytes=${size}-`);
    expect(pastEnd.status).toBe(416);
    expect(pastEnd.headers.get("content-range")).toBe(`bytes */${size}`);
    expect(pastEnd.headers.get("accept-ranges")).toBe("bytes");
    // Malformed and inverted ranges fall back to the whole file.
    for (const range of ["bytes=abc", "bytes=50-40", "items=0-99", "bytes=0-1,2-3"]) {
      const full = await get("/assets/clip.mp4", range);
      expect(full.status, range).toBe(200);
      expect(full.headers.get("accept-ranges"), range).toBe("bytes");
      expect(Number(full.headers.get("content-length")), range).toBe(size);
    }
    // HEAD parity: same status and content headers as GET, never a body.
    const headFull = await head("/assets/clip.mp4");
    expect(headFull.status).toBe(200);
    expect(headFull.headers.get("content-type")).toBe("video/mp4");
    expect(headFull.headers.get("content-length")).toBe(String(size));
    expect(headFull.headers.get("accept-ranges")).toBe("bytes");
    expect((await headFull.arrayBuffer()).byteLength).toBe(0);
    const headRange = await head("/assets/clip.mp4", "bytes=0-99");
    expect(headRange.status).toBe(206);
    expect(headRange.headers.get("content-range")).toBe(`bytes 0-99/${size}`);
    expect(headRange.headers.get("content-length")).toBe("100");
    expect((await headRange.arrayBuffer()).byteLength).toBe(0);
    // Release host: the same range contract on the exact release.
    const releaseHost = `${releaseId}.pages.example.test`;
    const releaseGrant = await grantFor(releaseHost);
    const releaseRanged = await app.request(`https://${releaseHost}/assets/clip.mp4?grant=${releaseGrant}`,
      { headers: { host: releaseHost, cookie, range: "bytes=0-9" } });
    expect(releaseRanged.status).toBe(206);
    expect(releaseRanged.headers.get("content-range")).toBe(`bytes 0-9/${size}`);
    expect(Buffer.from(await releaseRanged.arrayBuffer()).equals(videoBytes.subarray(0, 10))).toBe(true);
  });

  it("should run the browser upload page journey from mint to publish_bundle_v2 without model bytes", async () => {
    const service = h.host.uploadPageService;
    expect(service).toBeDefined();
    const ensured = await h.control.handle("ensure", "author-alice",
      { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    // MCP mint: JSON metadata only — the token rides the URL fragment (never
    // the wire, never a JSON body) and the payload carries no file bytes.
    const minted = await h.control.handle("create_upload_page", "author-alice", { artifactId });
    expect(minted.status).toBe(201);
    const mint = minted.body as { pageSessionId: string; uploadPageUrl: string };
    expect(mint.uploadPageUrl).toContain(`/artifacts/upload/${mint.pageSessionId}#t=`);
    const mintJson = JSON.stringify(minted.body);
    expect(mintJson).not.toContain("base64");
    // The token rides the URL fragment only (fragments never hit the wire):
    // no token field, no file bytes in any MCP payload.
    expect(mintJson).not.toContain('"token"');
    expect(mintJson.length).toBeLessThan(2000);
    const token = new URL(mint.uploadPageUrl).hash.replace(/^#t=/, "");
    expect(token.length).toBeGreaterThan(16);
    const origin = "https://app.example.test";
    const exchanged = await service!.exchange({ pageSessionId: mint.pageSessionId,
      token, origin });
    expect(exchanged.cookie).toContain("__Host-artifacts_upload=");
    const pngBytes = Buffer.concat([Buffer.from(PNG), randomBytes(4096 - 8)]);
    const pdfBytes = Buffer.concat([PDF_PREFIX, randomBytes(8192 - PDF_PREFIX.length)]);
    const staged: { path: string; uploadId: string }[] = [];
    for (const [path, mimeType, bytes] of [
      ["assets/flyer.png", "image/png", pngBytes],
      ["assets/plan.pdf", "application/pdf", pdfBytes],
    ] as const) {
      const created = await service!.createFile({ cookie: exchanged.cookie, origin,
        customHeader: true, artifactId, path, mimeType, size: bytes.length });
      // The browser PUTs bytes straight to object storage (MinIO here).
      const put = await fetch(created.uploadUrl, { method: "PUT",
        headers: { ...created.requiredHeaders,
          [created.checksumHeader!]: createHash("sha256").update(bytes).digest("base64") },
        body: Buffer.from(bytes) });
      expect(put.status, `PUT ${path}`).toBeLessThan(300);
      const record = await service!.commitFile({ cookie: exchanged.cookie, origin,
        customHeader: true, artifactId, uploadId: created.uploadId, path, mimeType,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        size: bytes.length, idempotencyKey: randomUUID() });
      expect(record.path).toBe(path);
      staged.push({ path, uploadId: created.uploadId });
    }
    const assets = await h.control.handle("list_assets", "author-alice", { artifactId });
    expect(assets.status).toBe(200);
    expect(((assets.body as { assets: { path: string }[] }).assets ?? []).map((a) => a.path).sort())
      .toEqual(["assets/flyer.png", "assets/plan.pdf"]);
    const published = await h.control.handle("publish_bundle_v2", "author-alice", { artifactId,
      idempotencyKey: randomUUID(), expectedCurrentReleaseId: null,
      files: [{ path: "index.html", mimeType: "text/html",
        text: "<!doctype html><html><body>page assets</body></html>" }],
      assets: staged });
    expect(published.status).toBe(201);
    const releaseId = (published.body as { releaseId: string }).releaseId;
    const stored = createStoredReader(h.pool, h.config.storageScope, "pages.example.test", h.blobs);
    for (const [path, mimeType, bytes] of [
      ["assets/flyer.png", "image/png", pngBytes],
      ["assets/plan.pdf", "application/pdf", pdfBytes],
    ] as const) {
      const served = await stored.releaseFiles.getFile(artifactId, releaseId, `/${path}`);
      expect(served?.contentType, path).toBe(mimeType);
      expect(Buffer.from(served!.body as Uint8Array).equals(Buffer.from(bytes)), path).toBe(true);
    }
  });
});
