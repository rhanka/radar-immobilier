import { describe, expect, it, vi } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { signSession, SESSION_COOKIE_NAME } from "../services/auth/session.js";
import { mintSessionCookie } from "./preview-session.js";
import { mintGrant } from "./preview-grant.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createReaderOpening } from "./reader-opening.js";
import { createTicketStore } from "./preview-tickets.js";
import type { AuthConfig } from "../config.js";
import {
  BASKET_CONSENT_SCOPES,
  BASKET_READ_SCOPE_ID,
  BASKET_WRITE_PREPARE_SCOPE_ID,
  basketsScopesForPage,
  consentScopeForReadOperation,
  type ReaderConsentService,
} from "./reader-consent.js";

/**
 * R2 — the persisted consent is the BASKETS consent (reader-consent design,
 * central decision, §2 Gate B and §3.3), never the opening screen:
 * - J1.3a: the opening is the single gesture, records the baskets consent
 *   and is skipped while the rows live;
 * - the baskets screen persists `baskets.read` (+ `baskets.write.prepare`
 *   when the page may prepare actions) and states what is memorized, until
 *   when, and where it is revoked;
 * - GET /consent skips its screen when a live row plus fresh rights covers
 *   the reader;
 * - every business H5 call re-reads the store: revocation refuses at the
 *   next call even under a live grant + cookie.
 */

const BASE = "pages.example.test";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar-immobilier",
  clientSecret: "super-secret",
  redirectUri: "https://app.example.test/api/v1/auth/oauth/callback",
  scopes: "openid profile email", appBaseUrl: "https://app.example.test",
  sessionSecret: "session-secret-32-bytes-long-padding!!",
  sessionTtlSeconds: 3600, sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.example.test/.well-known/jwks.json",
  bearerAudiences: ["https://app.example.test", "https://app.example.test/mcp"],
};

const ISSUER = { issuer: "https://app.example.test", audience: "https://app.example.test/reader", tier: "preprod" };
const GRANT_SECRET = "grant-secret-32-bytes-long-padding!";
const SESSION_SECRET = "session-secret-32-bytes-long-pad!!";
const BROWSER = { accept: "text/html,application/xhtml+xml" };
const WRITE_DOMAIN = { identityIssuer: "https://auth.example.test", tier: "preprod" as const,
  appOrigin: "https://app.example.test", clientId: "radar-immobilier" };

function memoryConsent(): ReaderConsentService & { live: Set<string> } {
  const live = new Set<string>();
  const key = (reader: string, artifact: string, scope: string) => `${reader} ${artifact} ${scope}`;
  const grantScopes = vi.fn(async (readerAccountId: string, artifactId: string, scopeIds: readonly string[]) => {
    for (const scopeId of scopeIds) live.add(key(readerAccountId, artifactId, scopeId));
    return [];
  });
  return {
    live, grantScopes,
    store: {} as never,
    findLiveConsent: async (readerAccountId: string, artifactId: string, scopeId: string) =>
      live.has(key(readerAccountId, artifactId, scopeId)) ? ({ scopeId } as never) : undefined,
    hasLiveConsent: async (readerAccountId: string, artifactId: string, scopeId: string) =>
      live.has(key(readerAccountId, artifactId, scopeId)),
  } as unknown as ReaderConsentService & { live: Set<string> };
}

function buildOpening(consent: ReaderConsentService, withWrite = false) {
  return createReaderOpening({ auth: AUTH, contentBase: BASE,
    authority: createFixtureAuthority(), tickets: createTicketStore() as never,
    issuer: ISSUER, grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
    consent,
    getArtifactIdForRelease: async (releaseId) => releaseId === RELEASE ? ARTIFACT : null,
    ...(withWrite ? { writeDomain: WRITE_DOMAIN, permitsWrite: async () => true } : {}) });
}

async function appSession(sub: string): Promise<string> {
  const token = await signSession({ sub, emailVerified: true, idpIssuer: "https://auth.example.test" },
    { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) fields[m[1]!] = m[2]!;
  return fields;
}

function form(body: Record<string, string>): { body: URLSearchParams; headers: Record<string, string> } {
  return { body: new URLSearchParams({ decision: "grant", ...body }),
    headers: { origin: "https://app.example.test", "content-type": "application/x-www-form-urlencoded" } };
}

async function openApprove(application: ReturnType<typeof buildOpening>["application"], session: string) {
  const approve = await application.request(
    `/approve?binding=${"b".repeat(64)}&origin=${encodeURIComponent(`https://${ARTIFACT}.${BASE}`)}`,
    { headers: { cookie: session, ...BROWSER } });
  expect(approve.status).toBe(200);
  return hiddenFields(await approve.text());
}

describe("baskets consent scopes", () => {
  it("should map every H5 business read to baskets.read and nothing else", () => {
    expect(BASKET_CONSENT_SCOPES).toEqual([BASKET_READ_SCOPE_ID, BASKET_WRITE_PREPARE_SCOPE_ID]);
    for (const op of ["workspaces.list.v1", "baskets.context.v1", "baskets.search.v1", "baskets.state.v1"]) {
      expect(consentScopeForReadOperation(op)).toBe(BASKET_READ_SCOPE_ID);
    }
    for (const op of ["geo.cities.v1", "geo.collection-items.v1", "signals.protected-read.v1", "status.closed.v1"]) {
      expect(consentScopeForReadOperation(op)).toBeNull();
    }
    expect(basketsScopesForPage(false)).toEqual([BASKET_READ_SCOPE_ID]);
    expect(basketsScopesForPage(true)).toEqual([BASKET_READ_SCOPE_ID, BASKET_WRITE_PREPARE_SCOPE_ID]);
  });
});

describe("opening is the single consent gesture (J1.3a)", () => {
  it("should record the baskets consent on the opening click, then skip the opening while live", async () => {
    const consent = memoryConsent();
    const opening = buildOpening(consent);
    const session = await appSession("reader-alice");

    // No live row: the opening screen renders and states memorization.
    const screen = await opening.application.request(
      `/approve?binding=${"b".repeat(64)}&origin=${encodeURIComponent(`https://${ARTIFACT}.${BASE}`)}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(screen.status).toBe(200);
    const body = await screen.text();
    expect(body).toContain("Ouvrir la page");
    expect(body).toContain("mémorisé pour cette page jusqu’à sa révocation");

    // Confirming records the baskets consent, then mints the ticket.
    const fields = hiddenFields(body);
    const posted = form({ artifactId: ARTIFACT, binding: fields.binding!,
      origin: `https://${ARTIFACT}.${BASE}`, releaseId: fields.releaseId!,
      profileFingerprint: fields.profileFingerprint! });
    const confirmed = await opening.application.request("/approve",
      { method: "POST", headers: { cookie: session, ...posted.headers }, body: posted.body });
    expect(confirmed.status).toBe(303);
    expect(consent.grantScopes).toHaveBeenCalledWith("reader-alice", ARTIFACT, [BASKET_READ_SCOPE_ID]);

    // Live row: the next opening skips its screen.
    const skipped = await opening.application.request(
      `/approve?binding=${"b".repeat(64)}&origin=${encodeURIComponent(`https://${ARTIFACT}.${BASE}`)}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(skipped.status).toBe(303);
    expect(skipped.headers.get("location")).toContain("/__reader/exchange?ticket=");
  });

  it("should keep the screen on a write page until write-prepare is live too", async () => {
    const consent = memoryConsent();
    const opening = buildOpening(consent, true);
    const session = await appSession("reader-alice");
    consent.live.add(`reader-alice ${ARTIFACT} ${BASKET_READ_SCOPE_ID}`);
    const fields = await openApprove(opening.application, session);
    expect(fields.releaseId).toBe(RELEASE);
    consent.live.add(`reader-alice ${ARTIFACT} ${BASKET_WRITE_PREPARE_SCOPE_ID}`);
    const skipped = await opening.application.request(
      `/approve?binding=${"b".repeat(64)}&origin=${encodeURIComponent(`https://${ARTIFACT}.${BASE}`)}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(skipped.status).toBe(303);
  });
});

describe("baskets screen persists the baskets consent", () => {
  it("should grant baskets.read on a read-only page and state memorization plus revocation", async () => {
    const consent = memoryConsent();
    const opening = buildOpening(consent);
    const session = await appSession("reader-alice");

    const page = await opening.application.request(
      `/consent?binding=${"c".repeat(64)}&origin=${encodeURIComponent(`https://${ARTIFACT}.${BASE}`)}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Autoriser la lecture de vos paniers");
    expect(html).toContain("mémorisé pour cette page jusqu’à sa révocation");
    expect(html).toContain("réglages de votre compte");

    const fields = hiddenFields(html);
    const posted = form({ artifactId: ARTIFACT, binding: fields.binding!,
      origin: `https://${ARTIFACT}.${BASE}`, releaseId: fields.releaseId!,
      profileFingerprint: fields.profileFingerprint! });
    const consented = await opening.application.request("/consent",
      { method: "POST", headers: { cookie: session, ...posted.headers }, body: posted.body });
    expect(consented.status).toBe(303);
    expect(consent.grantScopes).toHaveBeenCalledTimes(1);
    expect(consent.grantScopes).toHaveBeenCalledWith("reader-alice", ARTIFACT, [BASKET_READ_SCOPE_ID]);
    expect(await consent.hasLiveConsent("reader-alice", ARTIFACT, BASKET_READ_SCOPE_ID)).toBe(true);
    expect(await consent.hasLiveConsent("reader-alice", ARTIFACT, BASKET_WRITE_PREPARE_SCOPE_ID)).toBe(false);
    expect(await consent.hasLiveConsent("reader-alice", ARTIFACT, "reader")).toBe(false);
  });

  it("should also grant write-prepare when the page may prepare actions", async () => {
    const consent = memoryConsent();
    const opening = buildOpening(consent, true);
    const session = await appSession("reader-alice");
    const page = await opening.application.request(
      `/consent?binding=${"c".repeat(64)}&origin=${encodeURIComponent(`https://${ARTIFACT}.${BASE}`)}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(page.status).toBe(200);
    const writeHtml = await page.text();
    expect(writeHtml).toContain("préparer des modifications");
    const fields = hiddenFields(writeHtml);
    const posted = form({ artifactId: ARTIFACT, binding: fields.binding!,
      origin: `https://${ARTIFACT}.${BASE}`, releaseId: fields.releaseId!,
      profileFingerprint: fields.profileFingerprint! });
    const consented = await opening.application.request("/consent",
      { method: "POST", headers: { cookie: session, ...posted.headers }, body: posted.body });
    expect(consented.status).toBe(303);
    expect(consent.grantScopes).toHaveBeenCalledWith("reader-alice", ARTIFACT,
      [BASKET_READ_SCOPE_ID, BASKET_WRITE_PREPARE_SCOPE_ID]);
  });

  it("should skip the screen when a live row plus fresh rights covers the reader", async () => {
    const consent = memoryConsent();
    const opening = buildOpening(consent);
    const session = await appSession("reader-alice");
    consent.live.add(`reader-alice ${ARTIFACT} ${BASKET_READ_SCOPE_ID}`);
    const skipped = await opening.application.request(
      `/consent?binding=${"c".repeat(64)}&origin=${encodeURIComponent(`https://${ARTIFACT}.${BASE}`)}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(skipped.status).toBe(303);
    expect(skipped.headers.get("location")).toContain("/__reader/exchange?ticket=");
  });
});

describe("Gate B on every business H5 call", () => {
  const FINGERPRINT = fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
    capabilities: ["geo.read", "signals.protected-read"] });
  const HOST = `${ARTIFACT}.${BASE}`;

  function buildContent(gate: { hasLiveConsent: (r: string, a: string, s: string) => Promise<boolean> }) {
    const readOperation = (async () => ({ ok: true as const,
      workspaces: [{ id: WORKSPACE, slug: "team", label: "Team",
        signals: { availability: { state: "open" as const } },
        workspace: { id: WORKSPACE, slug: "team", label: "Team" },
        moderateArchive: false, manageMembers: false }] })) as never;
    return createReaderContentApp({ authority: createFixtureAuthority(), readOperation,
      contentBase: BASE, grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
      issuer: ISSUER, basketConsent: gate, now: () => 1_000,
      releaseFiles: createMemoryReleaseFiles([
        { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: "<!doctype html><html><body>shared</body></html>" },
      ]) });
  }

  async function credentials(): Promise<{ cookie: string; grant: string }> {
    const grant = await mintGrant({ ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE,
      readerSub: "reader-alice", sessionId: "session-1", profileName: "demo", policyRevision: "pol-001",
      profileFingerprint: FINGERPRINT, basketScope: true }, GRANT_SECRET, 1_000);
    const cookie = (await mintSessionCookie({ sid: "session-1", readerSub: "reader-alice",
      artifactId: ARTIFACT, createdAt: 1_000, expiresAt: 1_000 + 900_000,
      resource: { ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE,
        readerSub: "reader-alice", sessionId: "session-1", profileName: "demo",
        policyRevision: "pol-001", profileFingerprint: FINGERPRINT, basketScope: true as const },
      basketScope: true as const }, SESSION_SECRET)).split(";")[0]!;
    return { cookie, grant };
  }

  async function h5(app: ReturnType<typeof buildContent>, cookie: string, grant: string) {
    return app.request(`https://${HOST}/__reader/api/workspaces.list.v1?grant=${grant}`,
      { headers: { host: HOST, cookie } });
  }

  it("should serve the call with a live row and refuse it once revoked, same live cookie", async () => {
    let live = true;
    const app = buildContent({ hasLiveConsent: async () => live });
    const { cookie, grant } = await credentials();
    const first = await h5(app, cookie, grant);
    expect(first.status).toBe(200);
    // Revocation lands: the very next call under the same live grant and
    // cookie is refused (design §3.3), and the sealed claim alone never
    // authorizes.
    live = false;
    const refused = await h5(app, cookie, grant);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code)
      .toBe("basket_consent_required");
  });

  it("should fail closed with an explicit typed error when the store is unreadable", async () => {
    const app = buildContent({ hasLiveConsent: async () => { throw new Error("store down"); } });
    const { cookie, grant } = await credentials();
    const refused = await h5(app, cookie, grant);
    // J1.3a: a ledger outage is never a consent prompt the reader cannot satisfy.
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: { code: string } }).error.code)
      .toBe("consent_ledger_unavailable");
  });
});
