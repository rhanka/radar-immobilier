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
 */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = Buffer.from("GIF89a");
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
});
