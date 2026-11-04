import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, cookie, startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { createStoredReader } from "../../src/artifacts/reader-storage.js";
import { createReaderOpening } from "../../src/artifacts/reader-opening.js";
import { createReaderConsentService } from "../../src/artifacts/reader-consent.js";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { GRANT_SECRET, ISSUER, SESSION_SECRET } from "../../src/artifacts/reader-test-fixture.js";

/**
 * Reader consent LOT 1, immo side — persistent opening consent through the
 * generic host port.
 * - first opening renders the neutral screen, the confirmation click records
 *   the consent;
 * - second opening skips the screen (live row plus fresh rights);
 * - revocation through the API brings the screen back;
 * - a suspended account is refused even with a live row.
 */
const CONTENT_BASE = "pages.example.test";
const BROWSER = { accept: "text/html,application/xhtml+xml" };

function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) fields[m[1]!] = m[2]!;
  return fields;
}

describe("reader consent opening bypass", () => {
  let h: Harness;
  let artifactId: string;
  const author = "consent-author";
  const reader = "consent-reader";
  beforeAll(async () => {
    h = await startHarness("consent", [author, reader]);
    const ensured = await h.control.handle("ensure", author,
      { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    expect(ensured.status).toBe(201);
    artifactId = (ensured.body as { artifactId: string }).artifactId;
    const published = await h.control.handle("publish", author, { artifactId,
      files: [{ path: "index.html", mimeType: "text/html", text: "<h1>Partagé</h1>" }],
      idempotencyKey: randomUUID() });
    expect(published.status).toBe(201);
    await h.pool.query(`INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
      VALUES ($1, $2, 'read')`, [artifactId, reader]);
  });
  afterAll(async () => { await h?.close(); });

  function opening() {
    const stored = createStoredReader(h.pool, h.config.storageScope, CONTENT_BASE, h.blobs);
    return createReaderOpening({ ...stored, auth, contentBase: CONTENT_BASE,
      issuer: ISSUER, grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
      consent: createReaderConsentService(h.pool, h.config.storageScope) }).application;
  }

  function approveQuery(binding: string): string {
    return `/approve?binding=${binding}&origin=${encodeURIComponent(`https://${artifactId}.${CONTENT_BASE}`)}`;
  }

  it("should screen the first opening, skip the second, screen again after API revocation", async () => {
    const application = opening();
    const session = await cookie(reader);
    const origin = `https://${artifactId}.${CONTENT_BASE}`;

    // 1. First opening: the neutral screen, no consent row yet.
    const first = await application.request(approveQuery(randomBytes(32).toString("hex")),
      { headers: { cookie: session, ...BROWSER } });
    expect(first.status).toBe(200);
    const fields = hiddenFields(await first.text());
    expect(fields.artifactId).toBe(artifactId);

    // 2. The click records the first-party consent and mints the ticket.
    const posted = await application.request("/approve", { method: "POST",
      headers: { cookie: session, origin: auth.appBaseUrl, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ artifactId, binding: fields.binding!,
        origin, releaseId: fields.releaseId!, profileFingerprint: fields.profileFingerprint! }) });
    expect(posted.status).toBe(303);
    expect(posted.headers.get("location")).toContain("/__reader/exchange?ticket=");

    // 3. Second opening with a fresh binding: no screen.
    const second = await application.request(approveQuery(randomBytes(32).toString("hex")),
      { headers: { cookie: session, ...BROWSER } });
    expect(second.status).toBe(303);
    expect(second.headers.get("location")).toContain("/__reader/exchange?ticket=");

    // 4. Revocation through the API (control route, session cookie).
    const api = controlRoute({ auth, accounts: h.pool, backend: h.control,
      storageScope: h.config.storageScope });
    const revoked = await api.request("/revoke_reader_consent", { method: "POST",
      headers: { cookie: session, origin: auth.appBaseUrl, "content-type": "application/json" },
      body: JSON.stringify({ artifactId, idempotencyKey: randomUUID() }) });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ artifactId, changed: true });

    // 5. The screen is back after revocation.
    const third = await application.request(approveQuery(randomBytes(32).toString("hex")),
      { headers: { cookie: session, ...BROWSER } });
    expect(third.status).toBe(200);
    expect(await third.text()).toContain("Ouvrir la page");
  });

  it("should refuse a suspended account even with a live consent row", async () => {
    const consent = createReaderConsentService(h.pool, h.config.storageScope);
    await consent.grantOnScreen(reader, artifactId);
    await h.pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = $1", [reader]);
    try {
      const application = opening();
      const refused = await application.request(approveQuery(randomBytes(32).toString("hex")),
        { headers: { cookie: await cookie(reader), ...BROWSER } });
      expect(refused.status).toBe(404);
    } finally {
      await h.pool.query("UPDATE account_users SET status = 'approved' WHERE sub = $1", [reader]);
    }
  });
});
