/**
 * H5 browser fixture for expired grants and local session revocation.
 * A pre-expired grant does not measure wall-clock cutoff or active streams.
 * Synthetic ports do not qualify durable storage or receiving API identity.
 */
import { createServer, type Server } from "node:http";
import { test, expect, type Page } from "@playwright/test";
import { getRequestListener } from "@hono/node-server";
import { createReaderContentApp } from "../../src/artifacts/content-serve.js";
import { mintGrant } from "../../src/artifacts/preview-grant.js";
import { mintSessionCookie } from "../../src/artifacts/preview-session.js";
import { createRevocationList } from "../../src/artifacts/preview-renewal.js";
import { fixtureReaderDeps } from "../../src/artifacts/reader-test-fixture.js";

const GRANT_SECRET = "grant-secret-32-bytes-long-padding!";
const SESSION_SECRET = "session-secret-32-bytes-long-pad!!";
const ISSUER = { issuer: "https://api.example.test", audience: "https://api.example.test/reader", tier: "preprod" };
const HOST = "123e4567-e89b-12d3-a456-426614174000.localhost";

let server: Server;
let baseURL = "";
const revoked = createRevocationList();

async function cookieFor(page: Page, readerSub: string, sessionId: string, atMs: number): Promise<void> {
  const sealed = mintSessionCookie(
    { sid: sessionId, readerSub, artifactId: "123e4567-e89b-12d3-a456-426614174000", createdAt: atMs, expiresAt: atMs + 900_000 },
    SESSION_SECRET,
  );
  await page.context().addCookies([{
    name: "__Host-preview-session",
    value: sealed.split(";")[0]?.split("=")[1] ?? "",
    domain: HOST,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
  }]);
  expect((await page.context().cookies(baseURL)).find(cookie => cookie.name === "__Host-preview-session"))
    .toMatchObject({ domain: HOST, secure: true, httpOnly: true, path: "/" });
}

test.beforeAll(async () => {
  const app = createReaderContentApp({
    ...fixtureReaderDeps(),
    contentBase: "localhost",
    grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET,
    issuer: ISSUER,
    isRevoked: (sid) => revoked.isRevoked(sid),
  });
  const listener = getRequestListener(app.fetch);
  server = createServer((req, res) => listener(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  // Loopback subdomain: Chromium resolves *.localhost locally, so the Host
  // header reaches the reader as the bound content host (grant-checked).
  baseURL = `http://123e4567-e89b-12d3-a456-426614174000.localhost:${port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("expired grant is refused in a real browser", async ({ page }) => {
  const nowMs = Date.now();
  const claims = { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-old", profileName: "demo", policyRevision: "pol-001" };
  await cookieFor(page, "reader-alice", "session-old", nowMs);
  const valid = await mintGrant(claims, GRANT_SECRET, nowMs);
  expect((await page.goto(`${baseURL}/index.html?grant=${valid}`))?.status()).toBe(200);
  await expect(page.getByTestId("reader-status")).toHaveText("Connected.");
  const grant = await mintGrant(claims, GRANT_SECRET, nowMs - 120_000);
  const res = await page.goto(`${baseURL}/index.html?grant=${grant}`);
  expect(res?.status()).toBe(401);
});

test("revoked session closes page access without touching other sessions", async ({ page }) => {
  const nowMs = Date.now();
  const grant = await mintGrant(
    { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-revoked-1", profileName: "demo", policyRevision: "pol-001" },
    GRANT_SECRET,
    nowMs,
  );
  await cookieFor(page, "reader-alice", "session-revoked-1", nowMs);
  expect((await page.goto(`${baseURL}/index.html?grant=${grant}`))?.status()).toBe(200);
  await expect(page.getByTestId("reader-status")).toHaveText("Connected.");
  revoked.revoke("session-revoked-1");
  expect((await page.goto(`${baseURL}/index.html?grant=${grant}`))?.status()).toBe(401);

  const fresh = await mintGrant(
    { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-fresh-1", profileName: "demo", policyRevision: "pol-001" },
    GRANT_SECRET,
    nowMs,
  );
  await page.context().clearCookies();
  await cookieFor(page, "reader-alice", "session-fresh-1", nowMs);
  await page.goto(`${baseURL}/index.html?grant=${fresh}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("reader-status")).toHaveText("Connected.");
});

test("service worker and embed stay unavailable in a real browser", async ({ page }) => {
  const nowMs = Date.now();
  const grant = await mintGrant(
    { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-sw-1", profileName: "demo", policyRevision: "pol-001" },
    GRANT_SECRET,
    nowMs,
  );
  await cookieFor(page, "reader-alice", "session-sw-1", nowMs);
  expect((await page.goto(`${baseURL}/index.html?grant=${grant}`))?.status()).toBe(200);
  await expect(page.getByTestId("reader-status")).toHaveText("Connected.");
  expect((await page.goto(`${baseURL}/sw.js?grant=${grant}`))?.status()).toBe(404);
  expect((await page.goto(`${baseURL}/embed/123e4567-e89b-12d3-a456-426614174000?grant=${grant}`))?.status()).toBe(404);
});
