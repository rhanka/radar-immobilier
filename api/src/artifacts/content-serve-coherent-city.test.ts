/* eslint-disable @typescript-eslint/no-explicit-any -- assertions probe the served JSON shape */
import { describe, expect, it, vi } from "vitest";
import { toDegradedSignalCard } from "../routes/graph-signals.js";
import { createReaderContentApp, type ContentServeDeps } from "./content-serve.js";
import { buildCoherentCityResponse } from "./reader-coherent-city.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintGrant } from "./preview-grant.js";
import { credentials, GRANT_SECRET, SESSION_SECRET, ISSUER, HOST } from "./reader-test-fixture.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 7);
const CITY = "valleyfield";
const profile = { name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] as const };

async function headers(sub = "reader-alice", basketScope = true) {
  const grant = await mintGrant({ ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE,
    readerSub: sub, sessionId: "session-1", profileName: profile.name,
    policyRevision: profile.policyRevision, profileFingerprint: fingerprintReaderProfile(profile),
    ...(basketScope ? { basketScope: true as const } : {}) }, GRANT_SECRET, 1_000);
  return { host: HOST, cookie: await credentials(sub, "session-1", 1_000, { basketScope }),
    "x-preview-grant": grant };
}

function validBody(signalCount = 1): Record<string, unknown> {
  const nodes = Array.from({ length: signalCount }, (_, index) => ({
    id: `sig-${index}`, type: "Signal", label: `Signal ${index}`, citySlug: CITY, sourceRef: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    props: { description: "x".repeat(1900), refs: [{ docSha: "c".repeat(64), excerpt: "y".repeat(1900) }] },
  })) as Array<Parameters<typeof toDegradedSignalCard>[0]>;
  return buildCoherentCityResponse({ artifactId: ARTIFACT, readerSub: "reader-alice", workspaceId: WORKSPACE,
    citySlug: CITY, serverToken: "server", tokenKey: KEY, total: signalCount, hidden: 0, selected: 0,
    legacyProjection: { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } },
    sources: nodes.map((node) => ({ node, card: toDegradedSignalCard(node) })) });
}

function setup(overrides: Partial<ContentServeDeps> = {}) {
  const read = vi.fn(async (_op: string, _params: unknown, _context: unknown): Promise<unknown> => validBody());
  const app = createReaderContentApp({ contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET, issuer: ISSUER, authority: createFixtureAuthority(),
    now: () => 1_000, readOperation: read,
    releaseFiles: createMemoryReleaseFiles([
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: "<!doctype html><html><body>x</body></html>" },
    ]),
    basketConsent: { hasLiveConsent: async () => true }, ...overrides });
  return { app, read };
}

const opPath = "/__reader/api/signals.coherent-city.v1";
const query = `?workspaceId=${WORKSPACE}&citySlug=${CITY}&mode=signal`;
const get = (app: ReturnType<typeof setup>["app"], qs = query, auth: Record<string, string> = { host: HOST }) =>
  app.request(`https://${HOST}${opPath}${qs}`, { headers: auth as never });

function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return null;
}

describe("signals.coherent-city.v1 dispatch (§5.5, §15)", () => {
  it("should serve the closed DTO with no-store and exact params", async () => {
    const { app, read } = setup();
    const res = await get(app, query, await headers());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual(validBody());
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toBe("signals.coherent-city.v1");
    expect(read.mock.calls[0]![1]).toEqual({ workspaceId: WORKSPACE, citySlug: CITY, mode: "signal" });
  });

  it("should refuse gates without any business call and without echoing business data", async () => {
    const { app, read } = setup();
    const valid = await headers();
    const refusals: Array<[Response, number, string]> = [
      [await get(app, query), 401, "unauthenticated"],
      [await get(app, query, { ...valid, "x-preview-grant": "forged" }), 401, "unauthenticated"],
      [await get(app, query, { ...valid, authorization: "Bearer x" }), 400, "invalid_authority"],
      [await get(app, query, { ...valid, "x-reader-sub": "publisher" }), 400, "invalid_authority"],
      [await get(app, query, await headers("reader-alice", false)), 403, "basket_consent_required"],
      [await get(app, query, await headers("reader-mallory")), 401, "unauthenticated"],
    ];
    const leaked: string[] = [];
    for (const [res, status, code] of refusals) {
      expect(res.status).toBe(status);
      const body = await res.json();
      leaked.push(JSON.stringify(body));
      expect(errorCode(body)).toBe(code);
    }
    expect(leaked.join("\n")).not.toContain(WORKSPACE);
    expect(leaked.join("\n")).not.toContain(CITY);
    expect(read).not.toHaveBeenCalled();
  });

  it("should refuse a revoked consent at the next call", async () => {
    let live = true;
    const { app, read } = setup({ basketConsent: { hasLiveConsent: async () => live } });
    const valid = await headers();
    expect((await get(app, query, valid)).status).toBe(200);
    live = false;
    const refused = await get(app, query, valid);
    expect(refused.status).toBe(403);
    expect(errorCode(await refused.json())).toBe("basket_consent_required");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("should answer 405 on any non-GET without a business call", async () => {
    const { app, read } = setup();
    const valid = await headers();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await app.request(`https://${HOST}${opPath}${query}`, { method, headers: valid as never });
      expect(res.status).toBe(405);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("should refuse unknown, duplicated or missing params before any business call", async () => {
    const valid = await headers();
    const bad: Array<[string, number]> = [
      [`?workspaceId=${WORKSPACE}&citySlug=${CITY}`, 400],
      [`${query}&mode=signal`, 400],
      [`?workspaceId=${WORKSPACE}&citySlug=${CITY}&mode=lot`, 400],
      [`${query}&showDiscarded=1`, 400],
      [`${query}&unknown=1`, 400],
      [`?workspaceId=${WORKSPACE}&citySlug=Bad_City&mode=signal`, 400],
      [`${query}&pad=${"x".repeat(16384)}`, 414],
    ];
    for (const [qs, status] of bad) {
      const { app, read } = setup();
      const res = await get(app, qs, valid);
      expect(res.status).toBe(status);
      expect(JSON.stringify(await res.json())).not.toContain(CITY);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("should fail closed with a typed 502 on a leaked key, never transmitted", async () => {
    const { app, read } = setup();
    const tainted = validBody() as Record<string, any>;
    tainted.signals[0].facetFingerprint = "f".repeat(64);
    tainted.revisions = { personal: 1 };
    read.mockResolvedValue(tainted);
    const res = await get(app, query, await headers());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(errorCode(body)).toBe("upstream_bad_payload");
    expect(JSON.stringify(body)).not.toContain("f".repeat(64));
  });

  it("should refuse an oversized projection with projection_payload_too_large, never truncating", async () => {
    const { app, read } = setup();
    read.mockResolvedValue(validBody(600));
    const res = await get(app, query, await headers());
    // Existing typed code of the classification table (503, contact_operator).
    expect(res.status).toBe(503);
    expect(errorCode(await res.json())).toBe("projection_payload_too_large");
  });

  it("should enforce the §13 burst budget with Retry-After", async () => {
    const { app, read } = setup();
    const valid = await headers();
    for (let call = 0; call < 3; call += 1) expect((await get(app, query, valid)).status).toBe(200);
    const limited = await get(app, query, valid);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("should allow at most two concurrent calls per reader", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { app, read } = setup();
    read.mockImplementation(async () => { await gate; return validBody(); });
    const valid = await headers();
    const first = get(app, query, valid);
    const second = get(app, query, valid);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await get(app, query, valid)).status).toBe(429);
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it("should discard the response after an authorization change and log no business data", async () => {
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); }));
    try {
      // The authorization changes while the business call runs.
      let changed = false;
      const authority = { ...createFixtureAuthority(), getAuthorizationVersion: async () => (changed ? "v2" : "v1") };
      const { app, read } = setup({ authority });
      read.mockImplementation(async () => { changed = true; return validBody(); });
      const res = await get(app, query, await headers());
      expect(res.status).toBe(401);
      expect(read).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(await res.json())).not.toContain("sig-0");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(logs.join("\n")).not.toContain(CITY);
    expect(logs.join("\n")).not.toContain(WORKSPACE);
    expect(logs.join("\n")).not.toContain("sig-0");
  });
});
