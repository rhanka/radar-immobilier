import { describe, expect, it } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { signSession, SESSION_COOKIE_NAME } from "../services/auth/session.js";
import { createFixtureAuthority } from "./reader-profile.js";
import { createReaderOpening, refusedReaderOpeningHtml } from "./reader-opening.js";
import { createTicketStore } from "./preview-tickets.js";
import type { AuthConfig } from "../config.js";

/**
 * Lot I2 acceptance, automated part:
 * - a static shared page opens with zero basket screen;
 * - the first H5 call triggers the basket consent once, then reads the
 *   READER's own data;
 * - refusals stay indistinguishable (unknown UUID vs restricted artifact,
 *   unknown vs non-reader) on every surface.
 * The Claude-conversation steps (no "Always allow" re-prompt, "share with
 * Farid" round-trip) are manual and marked in the I2 report.
 */

const BASE = "pages.example.test";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const UNKNOWN = "123e4567-e89b-12d3-a456-426614174099";
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

function buildWorld() {
  const opening = createReaderOpening({ auth: AUTH, contentBase: BASE,
    authority: createFixtureAuthority(), tickets: createTicketStore() as never,
    issuer: ISSUER, grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
    getArtifactIdForRelease: async (releaseId) => releaseId === RELEASE ? ARTIFACT : null });
  const readOperation = (async () => ({ ok: true as const,
    workspaces: [{ id: WORKSPACE, slug: "team", label: "Team",
      signals: { availability: { state: "open" as const } },
      workspace: { id: WORKSPACE, slug: "team", label: "Team" },
      moderateArchive: false, manageMembers: false }] })) as never;
  const app = createReaderContentApp({ authority: createFixtureAuthority(), readOperation,
    contentBase: BASE, grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
    issuer: ISSUER, openingContent: opening.content,
    releaseFiles: createMemoryReleaseFiles([
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: "<!doctype html><html><body>shared</body></html>" },
    ]) });
  return { application: opening.application, app };
}

async function appSession(sub: string): Promise<string> {
  const token = await signSession({ sub, emailVerified: true, idpIssuer: "https://auth.example.test" },
    { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function cookieValue(setCookies: string[], name: string): string {
  const hit = setCookies.find((h) => h.startsWith(`${name}=`));
  return hit!.split(";")[0]!;
}

function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) fields[m[1]!] = m[2]!;
  return fields;
}

function form(body: Record<string, string>): { body: URLSearchParams; headers: Record<string, string> } {
  return { body: new URLSearchParams(body),
    headers: { origin: "https://app.example.test", "content-type": "application/x-www-form-urlencoded" } };
}

describe("deferred basket consent opening", () => {
  it("should open a static page with zero basket screen, then consent once and read the reader data", async () => {
    const { application, app } = buildWorld();
    const session = await appSession("reader-alice");

    // 1. Anonymous probe bounces to the control opening.
    const start = await app.request(`https://${ARTIFACT}.${BASE}/__reader/start`,
      { headers: { host: `${ARTIFACT}.${BASE}` } });
    expect(start.status).toBe(303);
    const approveUrl = new URL(start.headers.get("location")!);
    const initCookie = cookieValue(start.headers.getSetCookie(), "__Host-preview-init");

    // 2. Neutral opening screen: zero basket copy.
    const approve = await application.request(`/approve${approveUrl.search}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(approve.status).toBe(200);
    const approveBody = await approve.text();
    expect(approveBody).toContain("Ouvrir la page");
    expect(approveBody).not.toContain("panier");
    expect(approveBody).not.toContain("Auteur");

    // 3. Confirm the opening, exchange the ticket, open the static page.
    const fields = hiddenFields(approveBody);
    const posted = form({ artifactId: ARTIFACT, binding: fields.binding!,
      origin: `https://${ARTIFACT}.${BASE}`, releaseId: fields.releaseId!,
      profileFingerprint: fields.profileFingerprint! });
    const confirmed = await application.request("/approve",
      { method: "POST", headers: { cookie: session, ...posted.headers }, body: posted.body });
    expect(confirmed.status).toBe(303);
    const exchangeUrl = new URL(confirmed.headers.get("location")!);
    const exchanged = await app.request(`${exchangeUrl.pathname}${exchangeUrl.search}`,
      { headers: { host: `${ARTIFACT}.${BASE}`, cookie: initCookie } });
    expect(exchanged.status).toBe(303);
    const grant = new URL(exchanged.headers.get("location")!, "https://x.test").searchParams.get("grant")!;
    expect(grant.length).toBeGreaterThan(0);
    const docCookie = cookieValue(exchanged.headers.getSetCookie(), "__Host-preview-session");
    const page = await app.request(`https://${ARTIFACT}.${BASE}/index.html?grant=${grant}`,
      { headers: { host: `${ARTIFACT}.${BASE}`, cookie: docCookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("shared");

    // 4. First H5 call: typed consent refusal, exactly once.
    const h5path = `/__reader/api/workspaces.list.v1`;
    const refused = await app.request(`https://${ARTIFACT}.${BASE}${h5path}?grant=${grant}`,
      { headers: { host: `${ARTIFACT}.${BASE}`, cookie: docCookie } });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("basket_consent_required");

    // 5. Consent top-level: the moved DS page names the reader's own baskets.
    const consentStart = await app.request(`https://${ARTIFACT}.${BASE}/__reader/consent`,
      { headers: { host: `${ARTIFACT}.${BASE}`, cookie: docCookie, ...BROWSER } });
    expect(consentStart.status).toBe(303);
    const consentUrl = new URL(consentStart.headers.get("location")!);
    const consentInit = cookieValue(consentStart.headers.getSetCookie(), "__Host-preview-init");
    const consentPage = await application.request(`/consent${consentUrl.search}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(consentPage.status).toBe(200);
    const consentBody = await consentPage.text();
    expect(consentBody).toContain("Autoriser la lecture de vos paniers");
    expect(consentBody).toContain("vos propres paniers");

    // 6. Consent POST replays through exchange into a basket-scoped session.
    const consentFields = hiddenFields(consentBody);
    const consentPosted = form({ artifactId: ARTIFACT, binding: consentFields.binding!,
      origin: `https://${ARTIFACT}.${BASE}`, releaseId: consentFields.releaseId!,
      profileFingerprint: consentFields.profileFingerprint! });
    const consented = await application.request("/consent",
      { method: "POST", headers: { cookie: session, ...consentPosted.headers }, body: consentPosted.body });
    expect(consented.status).toBe(303);
    const exchange2Url = new URL(consented.headers.get("location")!);
    const exchanged2 = await app.request(`${exchange2Url.pathname}${exchange2Url.search}`,
      { headers: { host: `${ARTIFACT}.${BASE}`, cookie: consentInit, ...BROWSER } });
    expect(exchanged2.status).toBe(303);
    const grant2 = new URL(exchanged2.headers.get("location")!, "https://x.test").searchParams.get("grant")!;
    const scopedCookie = cookieValue(exchanged2.headers.getSetCookie(), "__Host-preview-session");

    // 7. The replayed call reads the READER's data; later calls just work.
    const first = await app.request(`https://${ARTIFACT}.${BASE}${h5path}?grant=${grant2}`,
      { headers: { host: `${ARTIFACT}.${BASE}`, cookie: scopedCookie } });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { workspaces: Array<{ workspace: { id: string } }> }).workspaces[0]?.workspace.id).toBe(WORKSPACE);
    const second = await app.request(`https://${ARTIFACT}.${BASE}${h5path}?grant=${grant2}`,
      { headers: { host: `${ARTIFACT}.${BASE}`, cookie: scopedCookie } });
    expect(second.status).toBe(200);
  });

  it("should refuse unknown labels and non-readers with byte-identical pages", async () => {
    const { application } = buildWorld();
    const alice = await appSession("reader-alice");
    const mallory = await appSession("reader-mallory");
    const unknown = await application.request(
      `/approve?binding=${"a".repeat(64)}&origin=${encodeURIComponent(`https://${UNKNOWN}.${BASE}`)}`,
      { headers: { cookie: alice, ...BROWSER } });
    expect(unknown.status).toBe(404);
    const nonReader = await application.request(
      `/approve?binding=${"a".repeat(64)}&origin=${encodeURIComponent(`https://${ARTIFACT}.${BASE}`)}`,
      { headers: { cookie: mallory, ...BROWSER } });
    expect(nonReader.status).toBe(404);
    const unknownBody = await unknown.text();
    expect(unknownBody).toBe(await nonReader.text());
    expect(unknownBody).toBe(refusedReaderOpeningHtml());
  });

  it("should answer anonymous probes of unknown and restricted labels identically", async () => {
    const { app } = buildWorld();
    const probe = async (label: string) => app.request(`https://${label}.${BASE}/__reader/start`,
      { headers: { host: `${label}.${BASE}` } });
    const known = await probe(ARTIFACT);
    const missing = await probe(UNKNOWN);
    expect(known.status).toBe(303);
    expect(missing.status).toBe(303);
    const knownTarget = new URL(known.headers.get("location")!);
    const missingTarget = new URL(missing.headers.get("location")!);
    expect(`${knownTarget.origin}${knownTarget.pathname}`).toBe(`${missingTarget.origin}${missingTarget.pathname}`);
    for (const res of [known, missing]) {
      expect(res.headers.get("location")).not.toMatch(new RegExp(RELEASE));
      expect(res.headers.get("set-cookie")).toContain("__Host-preview-init=");
    }
  });
});
