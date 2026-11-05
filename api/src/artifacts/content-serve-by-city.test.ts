import { describe, expect, it, vi } from "vitest";
import { createReaderContentApp, type ContentServeDeps } from "./content-serve.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintGrant } from "./preview-grant.js";
import { credentials, GRANT_SECRET, SESSION_SECRET, ISSUER, HOST } from "./reader-test-fixture.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
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

function setup(overrides: Partial<ContentServeDeps> = {}, nowMs = 1_000) {
  const read = vi.fn(async (_op: string, _params: unknown, _context: unknown): Promise<unknown> => validBody());
  const app = createReaderContentApp({ contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET, issuer: ISSUER, authority: createFixtureAuthority(),
    now: () => nowMs, readOperation: read,
    releaseFiles: createMemoryReleaseFiles([
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: "<!doctype html><html><body>x</body></html>" },
    ]),
    basketConsent: { hasLiveConsent: async () => true }, ...overrides });
  return { app, read };
}

const zeroStages = { avis_motion: 0, projet_reglement: 0, consultation_publique: 0,
  second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 };

function validBody(): unknown {
  const stages = { ...zeroStages, second_projet: 1 };
  return { ok: true, totalCount: 1,
    cities: [{ citySlug: "valleyfield", signalCount: 1,
      subsetCounts: { "": 0, z: 1, m: 0, p: 0, r: 1, "z|m": 0, "z|p": 0, "z|r": 1,
        "m|p": 0, "m|r": 0, "p|r": 0, "z|m|p": 0, "z|m|r": 0, "z|p|r": 0,
        "m|p|r": 0, "z|m|p|r": 0 },
      vivierV2Counts: { qualified: 1, residentialUnknown: 0,
        excludedByReason: { non_residentiel_franc: 0, piia_non_pertinent: 0, hors_zonage: 0,
          derogation_hors_sujet: 0 },
        stageCounts: stages, stageCountsHorsZonage: zeroStages,
        stageCountsResEligible: stages, stageCountsResEligibleHorsZonage: zeroStages, total: 1 } }] };
}

const opPath = "/__reader/api/signals.by-city.v1";
const query = `?workspaceId=${WORKSPACE}`;
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

describe("signals.by-city.v1 dispatch (§4.3, §15)", () => {
  it("should serve the allowlisted aggregate on the same service contract", async () => {
    const { app, read } = setup();
    const res = await get(app, query, await headers());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual(validBody());
    expect(read).toHaveBeenCalledTimes(1);
    const [op, params] = read.mock.calls[0]!;
    expect(op).toBe("signals.by-city.v1");
    expect(params).toEqual({ workspaceId: WORKSPACE });
  });

  it("should refuse gates without any business call", async () => {
    const { app, read } = setup();
    const valid = await headers();
    const leaked: string[] = [];
    const refusals: Array<[Response, number, string]> = [];
    refusals.push([await get(app, query), 401, "unauthenticated"]);
    refusals.push([await get(app, query, { ...valid, "x-preview-grant": "forged" }), 401, "unauthenticated"]);
    refusals.push([await get(app, query, { ...valid, "x-reader-sub": "publisher" } as never), 400, "invalid_authority"]);
    refusals.push([await get(app, query, await headers("reader-alice", false)), 403, "basket_consent_required"]);
    for (const [res, status, code] of refusals) {
      expect(res.status).toBe(status);
      const body = await res.json();
      leaked.push(JSON.stringify(body));
      expect(errorCode(body)).toBe(code);
    }
    // No workspace identity, city, signal or query echoes in typed refusals.
    expect(leaked.join("\n")).not.toContain(WORKSPACE);
    expect(leaked.join("\n")).not.toContain("valleyfield");
    expect(read).not.toHaveBeenCalled();
  });

  it("should reject 405 on any non-GET without a business call", async () => {
    const { app, read } = setup();
    const valid = await headers();
    const res = await app.request(`https://${HOST}${opPath}${query}`,
      { method: "POST", headers: valid as never });
    expect(res.status).toBe(405);
    expect(read).not.toHaveBeenCalled();
  });

  it("should refuse showDiscarded, unknown or duplicated params and disordered dates", async () => {
    // One dispatch per refusal: each budget window stays fresh, so every
    // refusal below is proven independent of the §13 budget state.
    const valid = await headers();
    const leaked: string[] = [];
    const bad: Array<[string, number]> = [
      [`${query}&showDiscarded=1`, 400],
      [`${query}&showDiscarded=0`, 400],
      [`${query}&dateFrom=2024-01-01`, 200],
      [`${query}&dateFrom=2024-01-01&dateFrom=2024-02-01`, 400],
      [`${query}&dateFrom=2024-03-01&dateTo=2024-01-01`, 400],
      [`${query}&unknown=1`, 400],
      [`${query}&pad=${"x".repeat(16384)}`, 414],
    ];
    for (const [qs, status] of bad) {
      const { app, read } = setup();
      const res = await get(app, qs, valid);
      expect(res.status).toBe(status);
      if (status === 200) {
        expect(read).toHaveBeenCalledTimes(1);
      } else {
        leaked.push(JSON.stringify(await res.json()));
        expect(read).not.toHaveBeenCalled();
      }
    }
    // Filters the app client emits stay accepted, mapped to the service query.
    const { app, read } = setup();
    const ok = await get(app, `${query}&dateFrom=2024-01-01&dateTo=2024-03-01&dateBasis=scrap&excludePiia=1&excludeDerogations=1`, valid);
    expect(ok.status).toBe(200);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![1]).toEqual({ workspaceId: WORKSPACE, dateFrom: "2024-01-01",
      dateTo: "2024-03-01", dateBasis: "scrap", excludePiia: "1", excludeDerogations: "1" });
    expect(leaked.join("\n")).not.toContain(WORKSPACE);
    expect(leaked.join("\n")).not.toContain("showDiscarded");
  });

  it("should fail closed with a typed 502 on an unexpected upstream key, never transmitted", async () => {
    const { app, read } = setup();
    const tainted = validBody() as { cities: Array<Record<string, unknown>> };
    tainted.cities[0]!["internalScore"] = 0.99;
    read.mockResolvedValue(tainted);
    const res = await get(app, query, await headers());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(errorCode(body)).toBe("upstream_bad_payload");
    expect(JSON.stringify(body)).not.toContain("internalScore");
    expect(JSON.stringify(body)).not.toContain("0.99");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("should enforce the §13 budget with Retry-After", async () => {
    const { app, read } = setup();
    const valid = await headers();
    for (let call = 0; call < 3; call += 1) expect((await get(app, query, valid)).status).toBe(200);
    const limited = await get(app, query, valid);
    expect(limited.status).toBe(429);
    expect(errorCode(await limited.json())).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("should serialize only one call per reader at a time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { app, read } = setup();
    read.mockImplementation(async () => { await gate; return validBody(); });
    const valid = await headers();
    const first = get(app, query, valid);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await get(app, query, valid);
    expect(second.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });

  it("should discard the response after an authorization change", async () => {
    let calls = 0;
    const authority = { ...createFixtureAuthority(), getAuthorizationVersion: async () => (++calls <= 4 ? "v1" : "v2") };
    const { app, read } = setup({ authority });
    const res = await get(app, query, await headers());
    expect(res.status).toBe(401);
    expect(errorCode(await res.json())).toBe("unauthenticated");
    expect(read).not.toHaveBeenCalled();
  });
});
