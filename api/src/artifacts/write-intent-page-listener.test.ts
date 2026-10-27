// PW-C PWC-09: the page listener forwards to the H receiver with a
// demand-only grant and never lets the content forge server proof headers.
import { describe, expect, it, vi } from "vitest";
import { pageWriteListenerRoute, type PageListenerDeps } from "./write-intent-page-listener.js";
import { PW_PAGE_PREPARE_PATH, PW_PAGE_STATUS_PATH } from "./write-intent-page-gesture.js";
import type { PageWriteAuthority } from "./write-intent-page-authority.js";

const HEX64 = "a".repeat(64);
const UUID = "11111111-1111-4111-8111-111111111111";
const SECRET = "0123456789abcdef0123456789abcdef";

const GRANT = { issuer: "https://h5.example.test", audience: "radar-artifact-write",
  tier: "preprod", identityIssuer: "https://auth.example.test",
  jti: UUID, sessionId: "page-session", sub: "reader", readerSub: "reader",
  artifactId: "artifact-1", releaseId: "release-1", host: "pages.example.test",
  profileName: "h5-signal-write-v2", profileFingerprint: "fp-1", policyRevision: "policy-1",
  workspaceId: UUID, citySlug: "demo-town",
  operations: ["facets.signals.personal.select.v1"] };

const PAGE = { grant: GRANT, pageInstanceId: "instance-1", pageExpiresAtMs: 60_000,
  delegationExpiresAtMs: 60_000, authorityReferences: {} } as PageWriteAuthority;

const BODY = { operation: "facets.signals.personal.select.v1", workspaceId: UUID,
  target: { citySlug: "demo-town", type: "Signal", id: "sig-1" }, basket: "pertinent",
  expectedHeadId: null, displayedFingerprint: HEX64, expectedProjectionToken: HEX64 };

const HOST = `${UUID}.pages.example.test`;
const ORIGIN = `https://${HOST}`;

function depsFor(forward: (req: Request) => Promise<Response>,
  page: PageWriteAuthority | null = PAGE): PageListenerDeps {
  return { contentBase: "pages.example.test", grantIssuer: GRANT, grantKeyId: "key-1",
    grantSecret: SECRET, resolvePage: async () => page, forward, nowMs: () => 1000 };
}

function prepareRequest(headers: Record<string, string> = {}, body: unknown = BODY): Request {
  return new Request(`${ORIGIN}${PW_PAGE_PREPARE_PATH}`,
    { method: "POST", headers: { host: HOST, "content-type": "application/json",
      "idempotency-key": UUID, ...headers }, body: JSON.stringify(body) });
}

describe("page write listener", () => {
  it.each([201, 409, 429])("should preserve private headers on forwarded HTTP %s", async (status) => {
    const body = JSON.stringify({ operation: "facets.write-intents.prepare.v1",
      error: { code: "write_rate_limited" } });
    const app = pageWriteListenerRoute(depsFor(async () => new Response(body, { status,
      headers: { "content-type": "application/json", "retry-after": "7", "cache-control": "public" } })));
    const response = await app.request(prepareRequest());
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("should stay closed without authority and refuse wrong methods", async () => {
    const app = pageWriteListenerRoute(null);
    const closed = await app.request(`${ORIGIN}${PW_PAGE_PREPARE_PATH}`, { method: "POST" });
    expect(closed.status).toBe(503);
    expect(await closed.json()).toMatchObject({ operation: "facets.write-intents.prepare.v1",
      error: { code: "write_transport_closed", action: "contact_operator" } });
    const closedStatus = await app.request(`${ORIGIN}${PW_PAGE_STATUS_PATH}?intentId=${UUID}`);
    expect(closedStatus.status).toBe(503);
    expect(await closedStatus.json()).toMatchObject({ operation: "facets.write-intents.status.v1",
      error: { code: "write_transport_closed" } });
    expect((await app.request(`${ORIGIN}${PW_PAGE_PREPARE_PATH}`)).status).toBe(405);
    expect((await app.request(`${ORIGIN}${PW_PAGE_STATUS_PATH}`, { method: "POST" })).status)
      .toBe(405);
    const foreign = await app.request(`https://app.example.test${PW_PAGE_PREPARE_PATH}`,
      { method: "POST" });
    expect(foreign.status).toBe(503);
  });

  it("should forward prepare with a minted grant and the page cookie only", async () => {
    const seen: Request[] = [];
    const forward = async (req: Request): Promise<Response> => {
      seen.push(req);
      return new Response(JSON.stringify({ operation: "facets.write-intents.prepare.v1",
        data: { intentId: UUID } }), { status: 201,
        headers: { "content-type": "application/json" } });
    };
    const app = pageWriteListenerRoute(depsFor(forward));
    const response = await app.request(prepareRequest({ cookie: "page=1", origin: ORIGIN }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { intentId: UUID } });
    expect(seen).toHaveLength(1);
    const forwarded = seen[0]!;
    expect(forwarded.url).toBe("https://page-write.internal/write-intents");
    expect(forwarded.headers.get("x-preview-write-grant")).toMatch(/^eyJ/);
    expect(forwarded.headers.get("x-preview-session")).toBeNull();
    expect(forwarded.headers.get("cookie")).toBe("page=1");
    expect(forwarded.headers.get("idempotency-key")).toBe(UUID);
    expect(await forwarded.json()).toEqual(BODY);
  });

  it("should refuse forged server headers and cross origins without forwarding", async () => {
    const forward = vi.fn(async () => new Response("{}", { status: 200 }));
    const app = pageWriteListenerRoute(depsFor(forward));
    for (const header of ["x-preview-write-grant", "x-preview-session"]) {
      const refused = await app.request(prepareRequest({ [header]: "forged" }));
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ operation: "facets.write-intents.prepare.v1",
        error: { code: "write_grant_required" } });
    }
    const cross = await app.request(prepareRequest({ origin: "https://evil.example.test" }));
    expect(cross.status).toBe(403);
    expect(await cross.json()).toMatchObject({ error: { code: "csrf_refused" } });
    expect(forward).not.toHaveBeenCalled();
  });

  it("should forward status without minting a grant", async () => {
    const seen: Request[] = [];
    const forward = async (req: Request): Promise<Response> => {
      seen.push(req);
      return new Response(JSON.stringify({ operation: "facets.write-intents.status.v1",
        data: { intentId: UUID, state: "pending" } }), { status: 200,
        headers: { "content-type": "application/json" } });
    };
    const app = pageWriteListenerRoute(depsFor(forward));
    const response = await app.request(`${ORIGIN}${PW_PAGE_STATUS_PATH}?intentId=${UUID}`,
      { headers: { host: HOST, cookie: "page=1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { intentId: UUID, state: "pending" } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`https://page-write.internal/write-intents/${UUID}`);
    expect(seen[0]!.headers.get("x-preview-write-grant")).toBeNull();
    expect(seen[0]!.headers.get("cookie")).toBe("page=1");
    const missing = await app.request(`${ORIGIN}${PW_PAGE_STATUS_PATH}`, { headers: { host: HOST } });
    expect(missing.status).toBe(400);
    expect(forward).toHaveLength(1);
  });

  it("should map a missing page authority without minting or forwarding", async () => {
    const forward = vi.fn(async () => new Response("{}", { status: 200 }));
    const app = pageWriteListenerRoute(depsFor(forward, null));
    const response = await app.request(prepareRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "write_grant_required" } });
    expect(forward).not.toHaveBeenCalled();
  });
});
