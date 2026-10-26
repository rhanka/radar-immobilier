import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@sentropic/artifacts/http", async (original) => {
  const { withCandidateProfile } = await import("./artifacts-legacy-profile.helpers.js");
  return withCandidateProfile(await original<typeof import("@sentropic/artifacts/http")>());
});
import { composeArtifactHost, createArtifactControl, createMemoryCommitLedger,
  type AdmissionAuthority } from "@radar/artifacts-host";
import { createMcpArtifactAdapter } from "../../../packages/artifacts-host/src/mcp-app-adapter.js";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { auth, cookie, startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { seedArtifactMemberships } from "./artifacts-membership.helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness("mcpadapter");
  await h.pool.query("INSERT INTO account_users (sub, email, status) VALUES " +
    "('alice','alice@example.test','approved'), ('bob','bob@example.test','approved')");
  await seedArtifactMemberships(h.pool);
});
afterAll(async () => { await h?.close(); });

async function http(op: string, args: unknown) {
  const app = controlRoute({ auth, accounts: h.pool, backend: h.control });
  const response = await app.request(`https://app.example.test/${op}`, {
    method: "POST", headers: { cookie: await cookie("alice"), origin: auth.appBaseUrl,
      "content-type": "application/json" }, body: JSON.stringify(args),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
const count = async () => (await h.pool.query(`SELECT
  (SELECT count(*) FROM artifacts.releases)::int AS releases,
  (SELECT count(*) FROM artifacts.operation_receipts)::int AS keys`)).rows[0];
const file = { path: "index.html", mimeType: "text/html", text: "hello" };

describe("unexposed MCP adapter with the composed provider", () => {
  it("refuses suspension and expiry after entry without a durable write", async () => {
    const before = await count();
    for (const change of ["suspension", "expiry"]) {
      let reads = 0;
      let now = 0;
      const authority: AdmissionAuthority = {
        nowMs: () => now,
        readActivation: () => ({ enabled: true, subjects: ["alice"], expiresAtMs: 100 }),
        readStatus: async () => {
          if (++reads === 2) {
            if (change === "suspension") return "suspended";
            now = 100;
          }
          return (await h.pool.query("SELECT status FROM account_users WHERE sub = 'alice' ")).rows[0].status;
        },
      };
      const adapter = createMcpArtifactAdapter(createArtifactControl(
        h.host, h.config.storageScope, "pages.example.test", authority));
      expect(await adapter.execute({ method: "POST", path: "/ensure",
        args: { bindingName: change, idempotencyKey: change } }, { actorId: "alice" }))
        .toMatchObject({ ok: false, status: 403 });
      expect(reads).toBe(2);
    }
    expect(await count()).toEqual(before);
    expect((await h.pool.query("SELECT count(*)::int AS n FROM artifacts.artifacts")).rows[0].n).toBe(0);
  });

  it("counts a finalization admission outage once without a durable success", async () => {
    let reads = 0;
    const authority: AdmissionAuthority = {
      nowMs: () => 0,
      readActivation: () => ({ enabled: true, subjects: ["alice"], expiresAtMs: 100 }),
      readStatus: async () => {
        if (++reads === 3) throw new Error("private admission database cause");
        return (await h.pool.query("SELECT status FROM account_users WHERE sub = 'alice'")).rows[0].status;
      },
    };
    const { ledger, entries } = createMemoryCommitLedger();
    const adapter = createMcpArtifactAdapter(createArtifactControl(
      h.host, h.config.storageScope, "pages.example.test", authority, { ledger, nowMs: () => 0 }));
    const before = await count();
    expect(await adapter.execute({ method: "POST", path: "/ensure",
      args: { bindingName: "outage", idempotencyKey: "outage" } }, { actorId: "alice" }))
      .toEqual({ ok: false, status: 503, code: "capability_unavailable", retryable: true,
        error: { error: "capability_unavailable" } });
    expect(entries).toEqual([{ invocationId: expect.any(String), op: "ensure", actorId: "alice", reason: "unauthorized_at_commit",
      status: 503, atMs: 0 }]);
    expect(await count()).toEqual(before);
  });

  it.each(["http-first", "mcp-first"])("replays %s across separate compositions", async (direction) => {
    const ensured = await http("ensure", { bindingName: direction, idempotencyKey: direction });
    expect(ensured.status).toBe(201);
    const artifactId = ensured.body.artifactId as string;
    const second = (await composeArtifactHost(h.pool, h.config, h.blobs))!;
    try {
      const adapter = createMcpArtifactAdapter(
        createArtifactControl(second, h.config.storageScope, "pages.example.test"));
      const args = { artifactId, files: [file], idempotencyKey: ` ${direction} ` };
      const mcp = () => adapter.execute({ method: "POST", path: "/publish", args }, { actorId: "alice" });
      const before = await count();
      const first = direction === "http-first" ? await http("publish", args) : await mcp();
      const replay = direction === "http-first" ? await mcp() : await http("publish", args);
      const body = (value: typeof first) => "body" in value ? value.body : value.ok ? value.data : undefined;
      expect(first.status).toBe(201); expect(replay.status).toBe(201);
      expect(await count()).toEqual({ releases: before.releases + 1, keys: before.keys + 1 });
      expect(body(replay)).toEqual(body(first));
      for (const change of [
        { files: [{ ...file, text: "changed" }] }, { files: [{ ...file, path: "other.html" }] },
        { files: [{ ...file, mimeType: "text/css" }] }, { profile: { theme: "dark" } },
      ]) {
        expect(await adapter.execute({ method: "POST", path: "/publish", args: { ...args, ...change } },
          { actorId: "alice" })).toMatchObject({ ok: false, status: 409, code: "conflict" });
      }
      expect(await count()).toEqual({ releases: before.releases + 1, keys: before.keys + 1 });
    } finally { second.close(); }
  });

  it("preserves ordered command identity and hides foreign metadata and lists", async () => {
    const ensured = await http("ensure", { bindingName: "ordered", idempotencyKey: "ordered" });
    const artifactId = ensured.body.artifactId as string;
    const adapter = createMcpArtifactAdapter(h.control);
    const args = { artifactId, idempotencyKey: "ordered-files",
      files: [file, { ...file, path: "other.html" }] };
    const before = await count();
    expect((await http("publish", args)).status).toBe(201);
    expect(await adapter.execute({ method: "POST", path: "/publish",
      args: { ...args, files: [...args.files].reverse() } }, { actorId: "alice" }))
      .toMatchObject({ ok: false, status: 409 });
    expect(await count()).toEqual({ releases: before.releases + 1, keys: before.keys + 1 });
    const meta = (id: string) => adapter.execute({ method: "GET", path: `/meta/${id}`, args: {} },
      { actorId: "bob" });
    const hidden = await meta(artifactId);
    expect(hidden).toEqual(await meta("123e4567-e89b-12d3-a456-426614174000"));
    expect(hidden).toMatchObject({ ok: false, status: 404 });
    expect(await adapter.execute({ method: "POST", path: "/list", args: { limit: 1, offset: 0 } },
      { actorId: "bob" })).toMatchObject({ ok: true, data: { artifacts: [], total: 0 } });
    const listed = await adapter.execute({ method: "POST", path: "/list", args: { limit: 1, offset: 1 } },
      { actorId: "alice" });
    expect(listed).toMatchObject({ ok: true, data: { artifacts: [expect.any(Object)], total: 3 } });
  });
});
