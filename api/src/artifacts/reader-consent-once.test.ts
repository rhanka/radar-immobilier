import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { signSession, SESSION_COOKIE_NAME } from "../services/auth/session.js";
import { mintGrant } from "./preview-grant.js";
import { mintSessionCookie } from "./preview-session.js";
import { fingerprintReaderProfile, type AuthorityReader, type ReaderProfile } from "./reader-profile.js";
import { consentDecisionInvalidHtml, consentErrorHtml, createReaderOpening } from "./reader-opening.js";
import { createTicketStore } from "./preview-tickets.js";
import { BASKET_READ_SCOPE_ID, type ReaderConsentService } from "./reader-consent.js";
import { READER_EVENT_CODES, readerFailureCode, sanitizeReaderEvent, type ReaderEvent } from "./reader-event-log.js";
import { CLASSIFICATION_CODES } from "../services/facets/classification-errors.js";
import type { AuthConfig } from "../config.js";

/**
 * Lot J1.3a — immo consent with no loop.
 * - first opening in ONE gesture, the acknowledgement recorded before the ticket;
 * - reopening (same release or a NEW release of the artifact) shows no screen;
 * - revocation brings the screen back, with the revocation state;
 * - a ledger failure is an explicit error, never a grant;
 * - an old-bridge page whose « Réouvrir » restarts at /__reader/start ends
 *   on the consent screen, not on a document-only approve loop;
 * - « Ne pas autoriser » opens the document only and records nothing; the
 *   reader can still consent later through « Réouvrir »;
 * - a POST without an explicit decision records nothing;
 * - the journal carries closed typed codes only.
 */

const BASE = "pages.example.test";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE_1 = "123e4567-e89b-12d3-a456-426614174001";
const RELEASE_2 = "123e4567-e89b-12d3-a456-426614174002";
const HOST = `${ARTIFACT}.${BASE}`;
const ORIGIN = `https://${HOST}`;
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CITY = "salaberry-de-valleyfield";

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
const PROFILE: ReaderProfile = { name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] };
const FINGERPRINT = fingerprintReaderProfile(PROFILE);
const LEGACY_READER_JS = readFileSync(
  new URL("../../../packages/artifacts-host/src/reader-bridge-legacy.fixture.txt", import.meta.url), "utf8");

/** Mutable single-artifact authority: `publish()` makes a new current release. */
function mutableAuthority() {
  let current = RELEASE_1;
  const authority: AuthorityReader = {
    getAuthorizationVersion: async (id) => id === ARTIFACT ? `v-${current}` : null,
    getContentOrigin: async (id) => id === ARTIFACT ? ORIGIN : null,
    getRelease: async (id, requested) => {
      if (id === ARTIFACT && (requested === undefined || requested === current)) {
        return { artifactId: ARTIFACT, releaseId: current, authorSub: "author-alice" };
      }
      if (id === current && requested === undefined) return { artifactId: ARTIFACT, releaseId: current, authorSub: "author-alice" };
      return null;
    },
    getProfile: async (id) => id === ARTIFACT ? { ...PROFILE, capabilities: [...PROFILE.capabilities] } : null,
    getRights: async (readerSub, id) => id === ARTIFACT && readerSub === "reader-alice"
      ? { readerSub, artifactId: ARTIFACT, approved: true, capabilities: [...PROFILE.capabilities] } : null,
  };
  return { authority, publish: (releaseId: string) => { current = releaseId; }, current: () => current };
}

/** In-memory ledger with failure switches; records the call order against ticket mints. */
function memoryLedger(order: string[]) {
  const live = new Set<string>();
  const revoked = new Set<string>();
  const key = (reader: string, artifact: string, scope: string) => `${reader} ${artifact} ${scope}`;
  const failures = { read: false, write: false };
  const service = {
    store: {} as never,
    findLiveConsent: async () => undefined,
    hasLiveConsent: vi.fn(async (reader: string, artifact: string, scope: string) => {
      if (failures.read) throw new Error("ledger down");
      return live.has(key(reader, artifact, scope));
    }),
    hasRevokedConsent: vi.fn(async (reader: string, artifact: string, scope: string) => {
      if (failures.read) throw new Error("ledger down");
      return revoked.has(key(reader, artifact, scope));
    }),
    grantScopes: vi.fn(async (reader: string, artifact: string, scopes: readonly string[]) => {
      if (failures.write) throw new Error("ledger down");
      for (const scope of scopes) live.add(key(reader, artifact, scope));
      order.push("ledger");
      return [];
    }),
  };
  return { service: service as unknown as ReaderConsentService, live, failures,
    revoke: (reader: string) => {
      live.delete(key(reader, ARTIFACT, BASKET_READ_SCOPE_ID));
      revoked.add(key(reader, ARTIFACT, BASKET_READ_SCOPE_ID));
    },
    grantScopes: service.grantScopes };
}

function buildWorld() {
  const order: string[] = [];
  const events: ReaderEvent[] = [];
  const sink = (event: ReaderEvent) => { events.push(event); };
  const authority = mutableAuthority();
  const ledger = memoryLedger(order);
  const store = createTicketStore();
  const tickets = { ...store, mint: (input: Parameters<typeof store.mint>[0]) => {
    order.push("ticket");
    return store.mint(input);
  } };
  const opening = createReaderOpening({ auth: AUTH, contentBase: BASE, authority: authority.authority,
    tickets: tickets as never, issuer: ISSUER, grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
    consent: ledger.service, events: sink,
    getArtifactIdForRelease: async (releaseId) => releaseId === authority.current() ? ARTIFACT : null });
  const readOperation = (async () => ({ ok: true as const,
    workspaces: [{ id: WORKSPACE, slug: "team", label: "Team",
      signals: { availability: { state: "open" as const } },
      workspace: { id: WORKSPACE, slug: "team", label: "Team" },
      moderateArchive: false, manageMembers: false }] })) as never;
  const files = [RELEASE_1, RELEASE_2].flatMap((releaseId) => [
    { artifactId: ARTIFACT, releaseId, path: "/index.html",
      body: `<!doctype html><html><head></head><body>shared ${releaseId}<script src="/reader.js"></script></body></html>` },
    { artifactId: ARTIFACT, releaseId, path: "/reader.js", body: LEGACY_READER_JS },
  ]);
  const app = createReaderContentApp({ authority: authority.authority, readOperation,
    contentBase: BASE, grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
    issuer: ISSUER, openingContent: opening.content, basketConsent: ledger.service,
    readerEvents: sink, releaseFiles: createMemoryReleaseFiles(files) });
  return { application: opening.application, app, authority, ledger, order, events };
}

async function appSession(sub: string): Promise<string> {
  const token = await signSession({ sub, emailVerified: true, idpIssuer: "https://auth.example.test" },
    { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function cookieValue(setCookies: string[], name: string): string {
  const hit = setCookies.find((h) => h.startsWith(`${name}=`));
  if (!hit) throw new Error(`missing cookie ${name}`);
  return hit.split(";")[0]!;
}

function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) fields[m[1]!] = m[2]!;
  return fields;
}

function decisionForm(fields: Record<string, string>, decision: "grant" | "refuse" | null | string) {
  return { body: new URLSearchParams({ artifactId: ARTIFACT, binding: fields.binding!, origin: ORIGIN,
    releaseId: fields.releaseId!, profileFingerprint: fields.profileFingerprint!,
    ...(decision === null ? {} : { decision }) }),
  headers: { origin: AUTH.appBaseUrl, "content-type": "application/x-www-form-urlencoded", ...BROWSER } };
}

type World = ReturnType<typeof buildWorld>;

/** Start an opening on the content host: returns the control URL and the init cookie. */
async function start(world: World, cookie?: string) {
  const res = await world.app.request(`${ORIGIN}/__reader/start`,
    { headers: { host: HOST, ...BROWSER, ...(cookie ? { cookie } : {}) } });
  expect(res.status).toBe(303);
  return res;
}

/** Exchange a ticket redirect on the content host and return the page grant + session cookie. */
async function exchange(world: World, location: string, initCookie: string) {
  const url = new URL(location);
  expect(`${url.origin}${url.pathname}`).toBe(`${ORIGIN}/__reader/exchange`);
  const res = await world.app.request(`${url.pathname}${url.search}`,
    { headers: { host: HOST, cookie: initCookie, ...BROWSER } });
  expect(res.status).toBe(303);
  const grant = new URL(res.headers.get("location")!, "https://x.test").searchParams.get("grant")!;
  return { grant, cookie: cookieValue(res.headers.getSetCookie(), "__Host-preview-session") };
}

async function h5(world: World, credentials: { grant: string; cookie: string }, query = "") {
  return world.app.request(`${ORIGIN}/__reader/api/workspaces.list.v1?grant=${credentials.grant}${query}`,
    { headers: { host: HOST, cookie: credentials.cookie } });
}

/** Full first opening through the single screen. */
async function firstOpening(world: World, session: string) {
  const started = await start(world);
  const initCookie = cookieValue(started.headers.getSetCookie(), "__Host-preview-init");
  const approveUrl = new URL(started.headers.get("location")!);
  const screen = await world.application.request(`/approve${approveUrl.search}`,
    { headers: { cookie: session, ...BROWSER } });
  expect(screen.status).toBe(200);
  const html = await screen.text();
  const posted = decisionForm(hiddenFields(html), "grant");
  const confirmed = await world.application.request("/approve",
    { method: "POST", headers: { cookie: session, ...posted.headers }, body: posted.body });
  return { html, confirmed, initCookie };
}

/** Reopen: start → GET /approve; returns the control response (303 when skipped). */
async function reopen(world: World, session: string) {
  const started = await start(world);
  const initCookie = cookieValue(started.headers.getSetCookie(), "__Host-preview-init");
  const approveUrl = new URL(started.headers.get("location")!);
  const res = await world.application.request(`/approve${approveUrl.search}`,
    { headers: { cookie: session, ...BROWSER } });
  return { res, initCookie };
}

/** A document-only page session minted before J1.3a (no basket scope). */
async function legacyDocumentSession() {
  const resource = { ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE_1,
    readerSub: "reader-alice", sessionId: "legacy-session", profileName: PROFILE.name,
    policyRevision: PROFILE.policyRevision, profileFingerprint: FINGERPRINT };
  const now = Date.now();
  const grant = await mintGrant(resource, GRANT_SECRET, now);
  const cookie = (await mintSessionCookie({ sid: "legacy-session", readerSub: "reader-alice",
    artifactId: ARTIFACT, createdAt: now, expiresAt: now + 900_000, resource }, SESSION_SECRET)).split(";")[0]!;
  return { grant, cookie };
}

describe("J1.3a consent once, no loop", () => {
  it("should open the first time in one gesture, recording the acknowledgement before the ticket", async () => {
    const world = buildWorld();
    const session = await appSession("reader-alice");
    const { html, confirmed, initCookie } = await firstOpening(world, session);
    // One screen, one decision: opening + the reader's own baskets, memorized until revocation.
    expect(html).toContain("<h1>Ouvrir la page</h1>");
    expect(html).toContain("vos propres paniers");
    expect(html).toContain("mémorisé pour cette page jusqu’à sa révocation");
    expect(confirmed.status).toBe(303);
    expect(world.ledger.grantScopes).toHaveBeenCalledWith("reader-alice", ARTIFACT, [BASKET_READ_SCOPE_ID]);
    // Durable acknowledgement BEFORE the ticket exists.
    expect(world.order).toEqual(["ledger", "ticket"]);
    const credentials = await exchange(world, confirmed.headers.get("location")!, initCookie);
    // The very first business call reads the reader's data: no 403, no second screen.
    const first = await h5(world, credentials);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { workspaces: Array<{ workspace: { id: string } }> }).workspaces[0]?.workspace.id).toBe(WORKSPACE);
  });

  it("should reopen the same artifact with no prompt", async () => {
    const world = buildWorld();
    const session = await appSession("reader-alice");
    const { confirmed } = await firstOpening(world, session);
    expect(confirmed.status).toBe(303);
    const { res, initCookie } = await reopen(world, session);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/__reader/exchange?ticket=");
    const credentials = await exchange(world, res.headers.get("location")!, initCookie);
    expect((await h5(world, credentials)).status).toBe(200);
    // Exactly one recorded gesture across both openings.
    expect(world.ledger.grantScopes).toHaveBeenCalledTimes(1);
  });

  it("should reopen a NEW release of the same artifact with no prompt", async () => {
    const world = buildWorld();
    const session = await appSession("reader-alice");
    await firstOpening(world, session);
    world.authority.publish(RELEASE_2);
    const { res, initCookie } = await reopen(world, session);
    expect(res.status).toBe(303);
    const credentials = await exchange(world, res.headers.get("location")!, initCookie);
    const page = await world.app.request(`${ORIGIN}/index.html?grant=${credentials.grant}`,
      { headers: { host: HOST, cookie: credentials.cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`shared ${RELEASE_2}`);
    expect((await h5(world, credentials)).status).toBe(200);
    expect(world.ledger.grantScopes).toHaveBeenCalledTimes(1);
  });

  it("should show the screen again after revocation, with the revocation state on the 403 path", async () => {
    const world = buildWorld();
    const session = await appSession("reader-alice");
    const { confirmed, initCookie } = await firstOpening(world, session);
    const credentials = await exchange(world, confirmed.headers.get("location")!, initCookie);
    world.ledger.revoke("reader-alice");

    // Live page: the next business call is refused at once and marks the host.
    const refused = await h5(world, credentials);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("basket_consent_required");
    const pending = cookieValue(refused.headers.getSetCookie(), "__Host-reader-consent");
    expect(pending).toBe("__Host-reader-consent=required");

    // The bridge navigates top-level to /__reader/consent: the screen states
    // the revocation, read from the ledger (no client hint is forwarded).
    const entry = await world.app.request(`${ORIGIN}/__reader/consent`,
      { headers: { host: HOST, cookie: `${credentials.cookie}; ${pending}`, ...BROWSER } });
    expect(entry.status).toBe(303);
    const consentUrl = new URL(entry.headers.get("location")!);
    expect(consentUrl.searchParams.has("reason")).toBe(false);
    expect(entry.headers.getSetCookie().some((h) => h.startsWith("__Host-reader-consent=;"))).toBe(true);
    const screen = await world.application.request(`/consent${consentUrl.search}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(screen.status).toBe(200);
    expect(await screen.text()).toContain("Votre accord précédent pour cette page a été retiré");

    // A fresh opening prompts again too.
    const { res } = await reopen(world, session);
    expect(res.status).toBe(200);
    const reopenHtml = await res.text();
    expect(reopenHtml).toContain("<h1>Ouvrir la page</h1>");
    expect(reopenHtml).toContain("Votre accord précédent pour cette page a été retiré");
  });

  it("should never show the revocation wording from a client hint without a revoked ledger row", async () => {
    const world = buildWorld();
    const session = await appSession("reader-alice");
    const forged = await world.application.request(
      `/consent?binding=${"c".repeat(64)}&origin=${encodeURIComponent(ORIGIN)}&reason=revoked`,
      { headers: { cookie: `${session}; __Host-reader-consent=revoked`, ...BROWSER } });
    expect(forged.status).toBe(200);
    const html = await forged.text();
    expect(html).toContain("Autoriser la lecture de vos paniers");
    expect(html).not.toContain("a été retiré");
  });

  it("should answer a ledger write failure with an explicit error and no ticket", async () => {
    const world = buildWorld();
    const session = await appSession("reader-alice");
    world.ledger.failures.write = true;
    const { confirmed } = await firstOpening(world, session);
    expect(confirmed.status).toBe(503);
    const body = await confirmed.text();
    expect(body).toBe(consentErrorHtml());
    expect(body).not.toContain("Autorisé");
    expect(confirmed.headers.get("location")).toBeNull();
    expect(world.order).not.toContain("ticket");
    expect(world.events).toContainEqual({ surface: "opening", code: "consent_ledger_write_failed", status: 503 });
  });

  it("should answer a ledger read failure with an explicit error on the opening and on H5", async () => {
    const world = buildWorld();
    const session = await appSession("reader-alice");
    const { confirmed, initCookie } = await firstOpening(world, session);
    const credentials = await exchange(world, confirmed.headers.get("location")!, initCookie);
    world.ledger.failures.read = true;
    const { res } = await reopen(world, session);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(consentErrorHtml());
    const api = await h5(world, credentials);
    expect(api.status).toBe(503);
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe("consent_ledger_unavailable");
    expect(api.headers.getSetCookie().some((h) => h.startsWith("__Host-reader-consent="))).toBe(false);
  });

  it("should take an old-bridge page « Réouvrir » to the consent screen, not the approve loop", async () => {
    const world = buildWorld();
    const session = await appSession("reader-alice");
    const legacy = await legacyDocumentSession();

    // The served bridge is upgraded (typed 403 → one top-level navigation).
    const bridge = await world.app.request(`${ORIGIN}/reader.js?grant=${legacy.grant}`,
      { headers: { host: HOST, cookie: legacy.cookie } });
    expect(await bridge.text()).toContain('location.assign("/__reader/consent")');

    // First H5 call of the document-only session: typed refusal, host marked.
    const refused = await h5(world, legacy);
    expect(refused.status).toBe(403);
    const pending = cookieValue(refused.headers.getSetCookie(), "__Host-reader-consent");
    expect(pending).toBe("__Host-reader-consent=required");

    // « Réouvrir la page » (href /__reader/start) now lands on the consent entry…
    const reopened = await start(world, `${legacy.cookie}; ${pending}`);
    expect(reopened.headers.get("location")).toBe("/__reader/consent");
    const entry = await world.app.request(`${ORIGIN}/__reader/consent`,
      { headers: { host: HOST, cookie: `${legacy.cookie}; ${pending}`, ...BROWSER } });
    expect(entry.status).toBe(303);
    const consentUrl = new URL(entry.headers.get("location")!);
    // …which is the control-origin consent screen, never /approve.
    expect(consentUrl.pathname).toBe("/api/v1/artifacts/reader/consent");
    const initCookie = cookieValue(entry.headers.getSetCookie(), "__Host-preview-init");
    const screen = await world.application.request(`/consent${consentUrl.search}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(screen.status).toBe(200);
    const html = await screen.text();
    expect(html).toContain("Autoriser la lecture de vos paniers");

    // One click, then the replayed call reads the data: the loop is closed.
    const posted = decisionForm(hiddenFields(html), "grant");
    const consented = await world.application.request("/consent",
      { method: "POST", headers: { cookie: session, ...posted.headers }, body: posted.body });
    expect(consented.status).toBe(303);
    const credentials = await exchange(world, consented.headers.get("location")!, initCookie);
    expect((await h5(world, credentials)).status).toBe(200);

    // Without the marker (no typed refusal seen), /__reader/start keeps the normal opening.
    const plain = await start(world, legacy.cookie);
    expect(new URL(plain.headers.get("location")!).pathname).toBe("/api/v1/artifacts/reader/approve");
  });

  it("should open the DOCUMENT ONLY on « Ne pas autoriser », record nothing, and let the reader consent later", async () => {
    const world = buildWorld();
    const session = await appSession("reader-alice");
    const started = await start(world);
    const initCookie = cookieValue(started.headers.getSetCookie(), "__Host-preview-init");
    const approveUrl = new URL(started.headers.get("location")!);
    const screen = await world.application.request(`/approve${approveUrl.search}`,
      { headers: { cookie: session, ...BROWSER } });
    const html = await screen.text();
    expect(html).toContain("Sans votre accord, la page s’ouvre sans lire vos paniers.");
    const posted = decisionForm(hiddenFields(html), "refuse");
    const refused = await world.application.request("/approve",
      { method: "POST", headers: { cookie: session, ...posted.headers }, body: posted.body });
    expect(refused.status).toBe(303);
    expect(world.ledger.grantScopes).not.toHaveBeenCalled();
    expect(world.order).toEqual(["ticket"]);
    expect(world.events).toContainEqual({ surface: "opening", code: "consent_refused", status: 303 });

    // Exchange: a document-only session, the host marked as declined.
    const url = new URL(refused.headers.get("location")!);
    const exchanged = await world.app.request(`${url.pathname}${url.search}`,
      { headers: { host: HOST, cookie: initCookie, ...BROWSER } });
    expect(exchanged.status).toBe(303);
    const grant = new URL(exchanged.headers.get("location")!, "https://x.test").searchParams.get("grant")!;
    const docCookie = cookieValue(exchanged.headers.getSetCookie(), "__Host-preview-session");
    const declined = cookieValue(exchanged.headers.getSetCookie(), "__Host-reader-consent");
    expect(declined).toBe("__Host-reader-consent=declined");
    const page = await world.app.request(`${ORIGIN}/index.html?grant=${grant}`,
      { headers: { host: HOST, cookie: docCookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`shared ${RELEASE_1}`);

    // Basket calls stay refused with a typed code that no bridge turns into
    // an automatic navigation (no screen on every load).
    const api = await h5(world, { grant, cookie: `${docCookie}; ${declined}` });
    expect(api.status).toBe(403);
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe("basket_consent_declined");
    expect(world.ledger.live.size).toBe(0);

    // « Réouvrir la page » reaches the consent screen: the reader can consent later.
    const reopened = await start(world, `${docCookie}; ${declined}`);
    expect(reopened.headers.get("location")).toBe("/__reader/consent");
    const entry = await world.app.request(`${ORIGIN}/__reader/consent`,
      { headers: { host: HOST, cookie: `${docCookie}; ${declined}`, ...BROWSER } });
    const consentUrl = new URL(entry.headers.get("location")!);
    expect(consentUrl.pathname).toBe("/api/v1/artifacts/reader/consent");
    const consentScreen = await world.application.request(`/consent${consentUrl.search}`,
      { headers: { cookie: session, ...BROWSER } });
    expect(consentScreen.status).toBe(200);
    expect(await consentScreen.text()).toContain("Autoriser la lecture de vos paniers");
  });

  it("should record nothing and mint nothing when the decision is missing or unknown", async () => {
    for (const decision of [null, "", "yes", "GRANT"]) {
      const world = buildWorld();
      const session = await appSession("reader-alice");
      const started = await start(world);
      const approveUrl = new URL(started.headers.get("location")!);
      const screen = await world.application.request(`/approve${approveUrl.search}`,
        { headers: { cookie: session, ...BROWSER } });
      const posted = decisionForm(hiddenFields(await screen.text()), decision);
      const res = await world.application.request("/approve",
        { method: "POST", headers: { cookie: session, ...posted.headers }, body: posted.body });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe(consentDecisionInvalidHtml());
      expect(res.headers.get("location")).toBeNull();
      expect(world.ledger.grantScopes).not.toHaveBeenCalled();
      expect(world.order).toEqual([]);
    }
  });

  it("should journal typed codes without city, signal or query values", async () => {
    const world = buildWorld();
    const legacy = await legacyDocumentSession();
    await h5(world, legacy, `&citySlug=${CITY}&q=secret-query`);
    const session = await appSession("reader-alice");
    const { confirmed, initCookie } = await firstOpening(world, session);
    const credentials = await exchange(world, confirmed.headers.get("location")!, initCookie);
    await h5(world, credentials);
    expect(world.events).toContainEqual(expect.objectContaining({ surface: "h5", code: "basket_consent_required",
      status: 403, op: "workspaces.list.v1" }));
    expect(world.events).toContainEqual(expect.objectContaining({ surface: "h5", code: "ok",
      status: 200, op: "workspaces.list.v1", count: 1 }));
    expect(world.events).toContainEqual({ surface: "opening", code: "consent_recorded", status: 303 });
    const journal = JSON.stringify(world.events);
    for (const leaked of [CITY, "secret-query", WORKSPACE, "reader-alice", ARTIFACT, RELEASE_1]) {
      expect(journal).not.toContain(leaked);
    }
  });

  it("should keep the journal to a closed list of codes", () => {
    // A well-formed but unlisted string echoed from a body never reaches the journal.
    expect(readerFailureCode({ error: { code: CITY.replace(/-/g, "_") } }, 403)).toBe("unclassified");
    expect(readerFailureCode({ error: "salaberry" }, 404)).toBe("unclassified");
    expect(readerFailureCode({ error: { code: "basket_consent_declined" } }, 403)).toBe("basket_consent_declined");
    expect(readerFailureCode(null, 503)).toBe("http_503");
    expect(readerFailureCode(null, 418)).toBe("unclassified");
    expect(sanitizeReaderEvent({ surface: "h5", code: "some_city_slug", status: 200, op: "secret.op" }))
      .toEqual({ surface: "h5", code: "unclassified", status: 200, op: "unknown" });
    // Merged list: every closed classification code and the named-op codes are journaled as is.
    for (const code of CLASSIFICATION_CODES) expect(READER_EVENT_CODES.has(code)).toBe(true);
    expect(readerFailureCode({ error: "rate_limited" }, 429)).toBe("rate_limited");
  });
});
