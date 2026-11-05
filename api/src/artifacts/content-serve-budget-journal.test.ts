import { describe, expect, it, vi } from "vitest";
import { createReaderContentApp, readerDigest, type ContentServeDeps, type ReaderAccessLine } from "./content-serve.js";
import { createBudgetStore, minute } from "./reader-budgets.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintGrant } from "./preview-grant.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { credentials, GRANT_SECRET, SESSION_SECRET, ISSUER, HOST } from "./reader-test-fixture.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CITY = "valleyfield";
const profile = { name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] as const };

async function headers(sub = "reader-alice") {
  const grant = await mintGrant({ ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE,
    readerSub: sub, sessionId: "session-1", profileName: profile.name,
    policyRevision: profile.policyRevision, profileFingerprint: fingerprintReaderProfile(profile),
    basketScope: true as const }, GRANT_SECRET, 1_000);
  return { host: HOST, cookie: await credentials(sub, "session-1", 1_000, { basketScope: true }),
    "x-preview-grant": grant };
}

const workspacesBody = { ok: true, workspaces: [{ id: WORKSPACE, slug: "team", label: "Team",
  signals: { availability: { state: "open" } },
  workspace: { id: WORKSPACE, slug: "team", label: "Team" }, moderateArchive: false, manageMembers: false }] };

function setup(overrides: Partial<ContentServeDeps> = {}) {
  const lines: ReaderAccessLine[] = [];
  const read = vi.fn(async (_op: string, _params: unknown, _context: unknown): Promise<unknown> => workspacesBody);
  const app = createReaderContentApp({ contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET, issuer: ISSUER, authority: createFixtureAuthority(),
    now: () => 1_000, readOperation: read, accessLog: (line) => lines.push(line),
    releaseFiles: createMemoryReleaseFiles([
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: "<!doctype html><html><body>x</body></html>" },
    ]),
    basketConsent: { hasLiveConsent: async () => true }, ...overrides });
  return { app, read, lines };
}

describe("workspaces.list.v1 budget (B1, §13)", () => {
  it("should keep a typed 429 + Retry-After once the budget is spent, never a remapped 500", async () => {
    const { app, read } = setup();
    const auth = await headers();
    const get = () => app.request(`https://${HOST}/__reader/api/workspaces.list.v1`, { headers: auth as never });
    for (let call = 0; call < 3; call += 1) expect((await get()).status).toBe(200);
    const limited = await get();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("cache-control")).toBe("private, no-store");
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe("typed access journal (M3, §0.4/§13)", () => {
  it("should write one business-data-free line per op call, 429 and refusals included", async () => {
    const { app, lines } = setup();
    const auth = await headers();
    const qs = `?workspaceId=${WORKSPACE}&citySlug=${CITY}&mode=signal`;
    await app.request(`https://${HOST}/__reader/api/workspaces.list.v1`, { headers: auth as never });
    for (let call = 0; call < 4; call += 1) {
      await app.request(`https://${HOST}/__reader/api/workspaces.list.v1`, { headers: auth as never });
    }
    await app.request(`https://${HOST}/__reader/api/signals.coherent-city.v1${qs}`, { headers: { host: HOST } as never });
    await app.request(`https://${HOST}/__reader/api/not-an-op.v1${qs}`, { headers: auth as never });
    expect(lines.map((line) => [line.op, line.status])).toEqual([
      ["workspaces.list.v1", 200], ["workspaces.list.v1", 200], ["workspaces.list.v1", 200],
      ["workspaces.list.v1", 429], ["workspaces.list.v1", 429],
      ["signals.coherent-city.v1", 401], ["unknown", 404],
    ]);
    const first = lines[0]!;
    expect(first).toMatchObject({ event: "reader_op", reader: readerDigest("reader-alice"),
      artifact: ARTIFACT, release: RELEASE });
    expect(first.bytes).toBeGreaterThan(0);
    expect(lines[5]!.reader).toBeNull();
    const journal = JSON.stringify(lines);
    for (const leak of [CITY, WORKSPACE, "reader-alice", "citySlug", "not-an-op", "?"]) {
      expect(journal).not.toContain(leak);
    }
  });

  it("should never fail a read when the journal sink throws", async () => {
    const { app } = setup({ accessLog: () => { throw new Error("sink down"); } });
    const res = await app.request(`https://${HOST}/__reader/api/workspaces.list.v1`, { headers: await headers() as never });
    expect(res.status).toBe(200);
  });
});

describe("budget store memory and workspace admission (M4)", () => {
  it("should sweep idle keys and check without recording", () => {
    const store = createBudgetStore();
    const windows = [minute(2)];
    for (let index = 0; index < 50; index += 1) store.consume(`k${index}`, windows, 0);
    expect(store.size()).toBe(50);
    expect(store.check("fresh", windows, 1_000)).toEqual({ ok: true });
    expect(store.size()).toBe(50);
    // One hour and a minute later, a single call sweeps every idle key.
    store.consume("late", windows, 3_700_000);
    expect(store.size()).toBe(1);
  });

  it("should spend the workspace admission only after the scoped service authorized the reader", async () => {
    const base = createBudgetStore();
    const spent: string[] = [];
    const budgets = { ...base, consume: (key: string, windows: Parameters<typeof base.consume>[1], nowMs: number) => {
      spent.push(key); return base.consume(key, windows, nowMs); } };
    const { app, read } = setup({ budgets });
    read.mockRejectedValueOnce(new WorkspaceError(403, "workspace_membership_required"));
    const auth = await headers();
    const qs = `?workspaceId=${WORKSPACE}`;
    const refused = await app.request(`https://${HOST}/__reader/api/signals.by-city.v1${qs}`, { headers: auth as never });
    expect(refused.status).toBe(403);
    expect(spent.some((key) => key.startsWith("ws\u0000"))).toBe(false);
    read.mockResolvedValueOnce({ ok: true, totalCount: 0, cities: [] });
    expect((await app.request(`https://${HOST}/__reader/api/signals.by-city.v1${qs}`, { headers: auth as never })).status)
      .toBe(200);
    expect(spent.filter((key) => key.startsWith("ws\u0000"))).toHaveLength(1);
  });
});
