/**
 * H5 browser proof: real Chromium -> real content app -> named API ops.
 * Spins the reader content app on localhost with synthetic fixtures (no
 * DB, no network); drives two readers plus the closed capability through
 * a real browser. Excluded from Vitest; selected by the H5 Playwright
 * config (testDir ../api/tests/e2e, testMatch artifacts-reader*.spec.ts).
 */
import { createServer, type Server } from "node:http";
import { test, expect, type Page } from "@playwright/test";
import { getRequestListener } from "@hono/node-server";
import { createReaderContentApp } from "../../src/artifacts/content-serve.js";
import { mintGrant } from "../../src/artifacts/preview-grant.js";
import { mintSessionCookie } from "../../src/artifacts/preview-session.js";

const GRANT_SECRET = "grant-secret-32-bytes-long-padding!";
const SESSION_SECRET = "session-secret-32-bytes-long-pad!!";
const ISSUER = { issuer: "https://api.example.test", audience: "https://api.example.test/reader", tier: "preprod" };
const HOST = "123e4567-e89b-12d3-a456-426614174000.localhost";

let server: Server;
let baseURL = "";

async function grantFor(readerSub: string, sessionId: string): Promise<{ grant: string; cookieValue: string }> {
  const nowMs = Date.now();
  const grant = await mintGrant(
    { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub, sessionId, profileName: "demo", policyRevision: "pol-001" },
    GRANT_SECRET,
    nowMs,
  );
  const sealed = mintSessionCookie(
    { sid: sessionId, readerSub, artifactId: "123e4567-e89b-12d3-a456-426614174000", createdAt: nowMs, expiresAt: nowMs + 900_000 },
    SESSION_SECRET,
  );
  const cookieValue = sealed.split(";")[0]?.split("=")[1] ?? "";
  return { grant, cookieValue };
}

async function hostCookie(page: Page, cookieValue: string): Promise<void> {
  await page.context().addCookies([{
    name: "__Host-preview-session",
    value: cookieValue,
    domain: "localhost",
    path: "/",
    secure: true,
  }]);
}

test.beforeAll(async () => {
  const app = createReaderContentApp({
    contentBase: "localhost",
    grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET,
    issuer: ISSUER,
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

test("reader-alice loads the connected page with Geo and protected signals", async ({ page }) => {
  const { grant, cookieValue } = await grantFor("reader-alice", "session-alice-1");
  await hostCookie(page, cookieValue);
  await page.goto(`${baseURL}/index.html?grant=${grant}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("reader-status")).toHaveText("Connected.");
  const geo = JSON.parse((await page.getByTestId("geo-output").textContent()) ?? "{}") as { features: unknown[] };
  expect(geo.features.length).toBeGreaterThan(0);
  const signals = JSON.parse((await page.getByTestId("signals-output").textContent()) ?? "{}") as {
    signals: { detail: string | null }[];
  };
  expect(signals.signals).toHaveLength(2);
  expect(signals.signals[0]?.detail).not.toBeNull();
  expect(page.url()).not.toContain("grant=");
});

test("reader-bob sees redacted protected signals", async ({ page }) => {
  const { grant, cookieValue } = await grantFor("reader-bob", "session-bob-1");
  await hostCookie(page, cookieValue);
  await page.goto(`${baseURL}/index.html?grant=${grant}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("reader-status")).toHaveText("Connected.");
  const signals = JSON.parse((await page.getByTestId("signals-output").textContent()) ?? "{}") as {
    signals: { detail: string | null }[];
  };
  expect(signals.signals).toHaveLength(1);
  expect(signals.signals[0]?.detail).toBeNull();
});

test("closed capability fails locally without disabling the page", async ({ page }) => {
  const { grant, cookieValue } = await grantFor("reader-alice", "session-alice-2");
  await hostCookie(page, cookieValue);
  await page.goto(`${baseURL}/index.html?grant=${grant}`, { waitUntil: "domcontentloaded" });
  const closed = await page.evaluate(async (g: string) => {
    const res = await fetch("/__reader/api/status.closed.v1", { headers: { "x-preview-grant": g } });
    return res.status;
  }, grant);
  expect(closed).toBe(503);
  await expect(page.getByTestId("reader-status")).toHaveText("Connected.");
});

test("anonymous browser gets no content", async ({ page }) => {
  const res = await page.goto(`${baseURL}/index.html`);
  expect(res?.status()).toBe(401);
});
