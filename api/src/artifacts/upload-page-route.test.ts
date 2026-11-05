import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmacUploadPageCookieSigner, createMemoryUploadPageStore, createUploadPageService, type UploadPageService } from "@sentropic/artifacts/server/upload-page";
import { createMemoryStaging, createMemoryUploadSessionStore } from "@sentropic/artifacts/server/uploads";
import { createMemoryBlobStore } from "@sentropic/artifacts/server/publication";
import type { AccountStatusQueryable, ActivationConfig } from "@radar/artifacts-host";
import type { AuthConfig } from "../config.js";
import { signSession } from "../services/auth/session.js";
import { uploadPageRoute } from "./upload-page-route.js";

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar-immobilier",
  clientSecret: "super-secret", redirectUri: "https://app.example.test/api/v1/auth/oauth/callback",
  scopes: "openid profile email", appBaseUrl: "https://app.example.test",
  sessionSecret: "session-secret-32-bytes-long-padding!!", sessionTtlSeconds: 3600,
  sessionAbsoluteTtlSeconds: 7200, jwksUri: "https://auth.example.test/.well-known/jwks.json",
  bearerAudiences: ["https://app.example.test", "https://app.example.test/mcp"],
};

const APP_HOST = "app.example.test";
const ARTIFACT_ID = "123e4567-e89b-12d3-a456-426614174000";

function accounts(): AccountStatusQueryable {
  return {
    async query(_text: string) {
      return { rows: [{ status: "approved", workspace_id: "test-workspace" }] };
    },
  };
}

async function cookieFor(sub: string): Promise<string> {
  const token = await signSession(
    { sub },
    { sessionSecret: AUTH.sessionSecret, ttlSeconds: AUTH.sessionTtlSeconds },
  );
  return `radar_session=${token}`;
}

function pageService(): { service: UploadPageService; put: (key: string, bytes: Uint8Array) => Promise<void> } {
  const sessions = createMemoryUploadSessionStore();
  const staging = createMemoryStaging();
  const blobs = createMemoryBlobStore();
  const signer = {
    async signPut(input: { key: string; contentType: string; contentLength: number; expiresInSeconds: number }) {
      return { url: `https://s3.test/staging/${input.key}`, method: "PUT" as const,
        headers: { "content-type": input.contentType, "content-length": String(input.contentLength) },
        expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString() };
    },
  };
  const refs = { async pin() { }, async unpin() { } };
  const service = createUploadPageService({
    pages: createMemoryUploadPageStore(),
    sessions, staging, signer: signer as never, blobs: blobs as never, refs: refs as never,
    cookieSigner: createHmacUploadPageCookieSigner({ secret: "test-upload-page-secret-32-bytes-padding" }),
    controlOrigin: AUTH.appBaseUrl, pageBaseUrl: `${AUTH.appBaseUrl}/api/v1`, s3Origins: ["https://s3.test"],
    profile: { maxFiles: 32, maxFileBytes: 262144, maxTotalBytes: 262144,
      mimeTypes: ["text/html", "image/png", "application/pdf"] },
    budget: { filesMax: 32, totalBytesMax: 262144 },
  });
  return { service, put: (key, bytes) => staging.put(key, bytes) };
}

function makeApp(service: UploadPageService): Hono {
  return new Hono().route("/api/v1/artifacts", uploadPageRoute({
    auth: AUTH, accounts: accounts(),
    readActivation: (): ActivationConfig => ({ enabled: true, subjects: ["alice"],
      expiresAtMs: Date.now() + 3600_000 }),
    service, config: { controlOrigin: AUTH.appBaseUrl, s3Origins: ["https://s3.test"] },
  }));
}

async function mint(service: UploadPageService) {
  return service.mint({ artifactId: ARTIFACT_ID, storageScopeId: "test", ownerId: "alice-id" });
}

const jsonHeaders = (cookie: string, extra: Record<string, string> = {}) => ({
  host: APP_HOST, origin: AUTH.appBaseUrl, "content-type": "application/json",
  "x-artifact-upload": "1", cookie, ...extra,
});

describe("uploadPageRoute browser journey", () => {
  let app: Hono;
  let service: UploadPageService;
  let put: (key: string, bytes: Uint8Array) => Promise<void>;
  let cookie: string;
  beforeEach(async () => {
    vi.restoreAllMocks();
    ({ service, put } = pageService());
    app = makeApp(service);
    cookie = await cookieFor("alice");
  });

  it("should serve the page document to a session navigation and refuse anonymous reads", async () => {
    const minted = await mint(service);
    const sid = minted.pageSessionId;
    const anonymous = await app.request(`http://${APP_HOST}/api/v1/artifacts/upload/${sid}`,
      { headers: { host: APP_HOST } });
    expect(anonymous.status).toBe(401);
    const served = await app.request(`http://${APP_HOST}/api/v1/artifacts/upload/${sid}`, {
      headers: { host: APP_HOST, cookie, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("text/html");
    const html = await served.text();
    expect(html).toContain("https://s3.test");
    expect(html).toContain("x-artifact-upload");
  });

  it("should exchange the minted token once, then stage and commit a file without model bytes", async () => {
    const minted = await mint(service);
    const sid = minted.pageSessionId;
    const base = `http://${APP_HOST}/api/v1/artifacts/upload/${sid}`;
    const exchange = await app.request(`${base}/exchange`, { method: "POST",
      headers: jsonHeaders(cookie), body: JSON.stringify({ token: minted.token }) });
    expect(exchange.status).toBe(200);
    const setCookie = exchange.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Host-artifacts_upload=");
    const pageCookie = setCookie.split(";")[0]!;
    // Single exchange: the token never works twice.
    const replay = await app.request(`${base}/exchange`, { method: "POST",
      headers: jsonHeaders(cookie), body: JSON.stringify({ token: minted.token }) });
    expect(replay.status).toBe(409);
    // The mint, exchange, create and commit payloads are JSON metadata only.
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const digest = `sha256:${createHash("sha256").update(pngBytes).digest("hex")}`;
    const createdRes = await app.request(`${base}/files`, { method: "POST",
      headers: { ...jsonHeaders(cookie), cookie: `${cookie}; ${pageCookie}` },
      body: JSON.stringify({ artifactId: ARTIFACT_ID, path: "photo.png", mimeType: "image/png", size: pngBytes.length }) });
    expect(createdRes.status).toBe(201);
    const created = await createdRes.json() as { uploadId: string; stagingKey: string; uploadUrl: string };
    expect(created.uploadUrl).toContain("https://s3.test/");
    // The browser PUT goes straight to storage (here the memory double).
    await put(created.stagingKey, pngBytes);
    const missingBody = await app.request(`${base}/files/${created.uploadId}/commit`, { method: "POST",
      headers: { ...jsonHeaders(cookie), cookie: `${cookie}; ${pageCookie}` },
      });
    expect(missingBody.status).toBe(400);
    const committed = await app.request(`${base}/files/${created.uploadId}/commit`, { method: "POST",
      headers: { ...jsonHeaders(cookie), cookie: `${cookie}; ${pageCookie}` },
      body: JSON.stringify({ artifactId: ARTIFACT_ID, path: "photo.png", mimeType: "image/png",
        digest, size: pngBytes.length, idempotencyKey: randomUUID() }) });
    expect(committed.status).toBe(201);
    const listed = await app.request(`${base}/files?artifactId=${ARTIFACT_ID}`, {
      headers: { host: APP_HOST, origin: AUTH.appBaseUrl, "x-artifact-upload": "1",
        cookie: `${cookie}; ${pageCookie}` },
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ files: [{
      artifactId: ARTIFACT_ID, createdAt: expect.any(String), path: "photo.png",
      mimeType: "image/png", size: pngBytes.length, digest,
      uploadId: created.uploadId, pageSessionId: sid }],
    });
  });

  it("should refuse page calls without the custom header or bound to another artifact", async () => {
    const minted = await mint(service);
    const sid = minted.pageSessionId;
    const base = `http://${APP_HOST}/api/v1/artifacts/upload/${sid}`;
    const exchange = await app.request(`${base}/exchange`, { method: "POST",
      headers: jsonHeaders(cookie), body: JSON.stringify({ token: minted.token }) });
    const pageCookie = (exchange.headers.get("set-cookie") ?? "").split(";")[0]!;
    const noCustomHeader = await app.request(`${base}/files`, { method: "POST",
      headers: { host: APP_HOST, origin: AUTH.appBaseUrl, "content-type": "application/json",
        cookie: `${cookie}; ${pageCookie}` },
      body: JSON.stringify({ artifactId: ARTIFACT_ID, path: "a.png", mimeType: "image/png", size: 4 }) });
    expect(noCustomHeader.status).toBe(403);
    const otherArtifact = await app.request(`${base}/files`, { method: "POST",
      headers: { ...jsonHeaders(cookie), cookie: `${cookie}; ${pageCookie}` },
      body: JSON.stringify({ artifactId: "223e4567-e89b-12d3-a456-426614174000",
        path: "a.png", mimeType: "image/png", size: 4 }) });
    expect(otherArtifact.status).toBe(403);
  });
});
