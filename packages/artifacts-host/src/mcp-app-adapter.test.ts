import { controlTestHost } from "./control-test-host.js";
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, createArtifactCommand, createRadarKeyDerivation } from "@sentropic/artifacts/mcp-core";
import type { HttpRequest } from "@sentropic/artifacts/http";
import type { ArtifactInvocationContext } from "@sentropic/artifacts/server/commit-contract";
import { describe, expect, it, vi } from "vitest";
import type { ActivationConfig } from "./activation.js";
import type { AdmissionAuthority } from "./admission.js";
import { createArtifactControl, type ArtifactControl } from "./facade.js";
import { createMcpArtifactAdapter, type McpProviderRequest } from "./mcp-app-adapter.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const DIGEST = "ab".repeat(32);
const NOW = Date.parse("2026-10-21T00:00:00Z");
const FUTURE = Date.parse("2026-10-22T00:00:00Z");

const live = (subjects: string[] = ["alice"]): ActivationConfig =>
  ({ enabled: true, subjects, expiresAtMs: FUTURE });

function stubControl(response: unknown, handle?: ReturnType<typeof vi.fn>): ArtifactControl {
  const fn = handle ?? vi.fn(async () => response);
  return { handle: fn } as unknown as ArtifactControl;
}

function mcp(method: string, path: string, args: unknown): McpProviderRequest {
  return { method, path, args };
}

// Transport-only double; command identity uses the published canonical codec.
function createReplayHost() {
  const kept = new Map<string, { paramsHash: string; status: number; body: unknown }>();
  const bodies: Array<Record<string, unknown>> = [];
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const derivation = createRadarKeyDerivation({ storageScopeId: "scope", actorIds: ["alice", "bob"] });
  const handle = vi.fn(async (input: HttpRequest, invocation: ArtifactInvocationContext) => {
    const body = input.body as Record<string, unknown>;
    bodies.push(body);
    const command = createArtifactCommand(profile, input.path === "/ensure" ? "artifacts_ensure" : "artifacts_publish",
      body, invocation, derivation);
    const internal = command.identity.internalKey;
    const hash = command.identity.commandHash;
    const prev = kept.get(internal);
    if (prev !== undefined) {
      if (prev.paramsHash === hash) return { status: prev.status, body: prev.body };
      return { status: 409, body: { error: "conflict" } };
    }
    if (typeof body["bindingName"] === "string") {
      const response = { status: 201, body: { artifactId: ARTIFACT, replayed: false } };
      kept.set(internal, { paramsHash: hash, status: response.status, body: response.body });
      return response;
    }
    const response = { status: 201,
      body: { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }) } };
    kept.set(internal, { paramsHash: hash, status: response.status, body: response.body });
    return response;
  });
  const host = controlTestHost(handle);
  return { host, handle, kept, bodies };
}

const publishArgs = (overrides: Record<string, unknown> = {}) => ({
  artifactId: ARTIFACT,
  files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
  idempotencyKey: "key-1",
  ...overrides,
});

describe("mcp adapter minimal profile", () => {
  it("accepts a minimal ensure call", async () => {
    const { host, handle } = createReplayHost();
    const control = createArtifactControl(host, "scope", "pages.example.test");
    const adapter = createMcpArtifactAdapter(control);
    const result = await adapter.execute(
      mcp("POST", "/ensure", { bindingName: "summer", idempotencyKey: "key-1" }), { actorId: "alice" });
    expect(result.ok).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("accepts a minimal publish call", async () => {
    const { host, handle } = createReplayHost();
    const control = createArtifactControl(host, "scope", "pages.example.test");
    const adapter = createMcpArtifactAdapter(control);
    const result = await adapter.execute(mcp("POST", "/publish", publishArgs()), { actorId: "alice" });
    expect(result).toEqual({ ok: true, status: 201,
      data: { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }), digest: DIGEST,
        stableUrl: `https://${ARTIFACT}.pages.example.test/`,
        pinnedUrl: `https://${RELEASE}.pinned.pages.example.test/` } });
    expect(handle).toHaveBeenCalledTimes(1);
  });
});

describe("mcp adapter replay parity (preparation mock)", () => {
  it("replays HTTP then MCP into one release with the same semantic receipt", async () => {
    const shared = createReplayHost();
    const http = createArtifactControl(shared.host, "scope", "pages.example.test");
    const mcpControl = createArtifactControl(shared.host, "scope", "pages.example.test");
    const adapter = createMcpArtifactAdapter(mcpControl);
    const first = await http.handle("publish", "alice", publishArgs());
    const second = await adapter.execute(mcp("POST", "/publish", publishArgs()), { actorId: "alice" });
    expect(first.status).toBe(201);
    expect(second).toEqual({ ok: true, status: 201, data: first.body });
    expect(shared.kept.size).toBe(1);
  });

  it("replays MCP then HTTP into one release", async () => {
    const shared = createReplayHost();
    const http = createArtifactControl(shared.host, "scope", "pages.example.test");
    const adapter = createMcpArtifactAdapter(
      createArtifactControl(shared.host, "scope", "pages.example.test"));
    const first = await adapter.execute(mcp("POST", "/publish", publishArgs()), { actorId: "alice" });
    const second = await http.handle("publish", "alice", publishArgs());
    expect(first.ok).toBe(true);
    expect(second.body).toEqual(first.ok ? first.data : undefined);
    expect(shared.kept.size).toBe(1);
  });

  it("converges equivalent text and bytes inputs", async () => {
    const { host, kept } = createReplayHost();
    const control = createArtifactControl(host, "scope", "pages.example.test");
    const adapter = createMcpArtifactAdapter(control);
    const textBytes = Array.from(new TextEncoder().encode("hello"));
    const first = await adapter.execute(mcp("POST", "/publish", publishArgs()), { actorId: "alice" });
    const second = await adapter.execute(mcp("POST", "/publish",
      publishArgs({ files: [{ path: "index.html", mimeType: "text/html", bytes: textBytes }] })),
      { actorId: "alice" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(kept.size).toBe(1);
  });

  it("ignores object key order but keeps file order significant", async () => {
    const { host, kept } = createReplayHost();
    const control = createArtifactControl(host, "scope", "pages.example.test");
    const adapter = createMcpArtifactAdapter(control);
    const base = publishArgs({ profile: { a: 1, b: 2 } });
    const reordered = publishArgs({ profile: { b: 2, a: 1 } });
    expect(await adapter.execute(mcp("POST", "/publish", base), { actorId: "alice" })).toMatchObject({ ok: true });
    expect(await adapter.execute(mcp("POST", "/publish", reordered), { actorId: "alice" }))
      .toMatchObject({ ok: true });
    expect(kept.size).toBe(1);
    const twoFiles = [
      { path: "a.html", mimeType: "text/html", text: "a" },
      { path: "b.html", mimeType: "text/html", text: "b" },
    ];
    const firstOrder = publishArgs({ files: twoFiles, idempotencyKey: "order-key" });
    const secondOrder = publishArgs({ files: [...twoFiles].reverse(), idempotencyKey: "order-key" });
    expect(await adapter.execute(mcp("POST", "/publish", firstOrder), { actorId: "alice" }))
      .toMatchObject({ ok: true });
    const conflict = await adapter.execute(mcp("POST", "/publish", secondOrder), { actorId: "alice" });
    expect(conflict).toEqual({ ok: false, status: 409, code: "conflict",
      retryable: false, error: { error: "conflict" } });
    expect(kept.size).toBe(2);
  });
});

describe("mcp adapter changed-content conflict (preparation mock)", () => {
  it.each([
    ["bytes", { files: [{ path: "index.html", mimeType: "text/html", text: "changed" }] }],
    ["path", { files: [{ path: "other.html", mimeType: "text/html", text: "hello" }] }],
    ["mime", { files: [{ path: "index.html", mimeType: "text/css", text: "hello" }] }],
    ["profile", { profile: { theme: "dark" } }],
  ])("returns conflict for changed %s without a new release", async (_name, change) => {
    const { host, kept } = createReplayHost();
    const adapter = createMcpArtifactAdapter(createArtifactControl(host, "scope", "pages.example.test"));
    expect(await adapter.execute(mcp("POST", "/publish", publishArgs()), { actorId: "alice" }))
      .toMatchObject({ ok: true });
    expect(kept.size).toBe(1);
    const conflict = await adapter.execute(mcp("POST", "/publish", publishArgs(change)),
      { actorId: "alice" });
    expect(conflict).toEqual({ ok: false, status: 409, code: "conflict",
      retryable: false, error: { error: "conflict" } });
    expect(kept.size).toBe(1);
  });
});

describe("mcp adapter caller key validation", () => {
  it.each(["ensure", "publish"])("preserves the original %s caller key", async (op) => {
    const handle = vi.fn(async () => ({ status: 201, body: {} }));
    const adapter = createMcpArtifactAdapter(stubControl({}, handle));
    const idempotencyKey = " \tcaller-key\n ";
    const args = op === "ensure" ? { bindingName: "summer", idempotencyKey } : publishArgs({ idempotencyKey });
    expect(await adapter.execute(mcp("POST", `/${op}`, args), { actorId: "alice" }))
      .toMatchObject({ ok: true });
    expect(handle).toHaveBeenCalledExactlyOnceWith(op, "alice", args);
  });

  it.each([
    ["absent", { bindingName: "summer" }, "POST", "/ensure"],
    ["empty", { bindingName: "summer", idempotencyKey: "" }, "POST", "/ensure"],
    ["blank", { bindingName: "summer", idempotencyKey: "   " }, "POST", "/ensure"],
    ["overlong", { bindingName: "summer", idempotencyKey: "k".repeat(257) }, "POST", "/ensure"],
    ["non-string", { bindingName: "summer", idempotencyKey: 42 }, "POST", "/ensure"],
    ["absent publish", { artifactId: ARTIFACT, files: publishArgs().files }, "POST", "/publish"],
  ])("refuses %s caller key without dispatch", async (_n, args, method, path) => {
    const handle = vi.fn(async () => ({ status: 201, body: {} }));
    const adapter = createMcpArtifactAdapter(stubControl({}, handle));
    const result = await adapter.execute(mcp(method, path, args), { actorId: "alice" });
    expect(result).toEqual({ ok: false, status: 400, code: "invalid_request",
      retryable: false, error: { error: "invalid_request" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("enforces the 256 UTF-16 boundary including surrogate pairs", async () => {
    const handle = vi.fn(async () => ({ status: 201, body: {} }));
    const adapter = createMcpArtifactAdapter(stubControl({}, handle));
    const ok256 = await adapter.execute(
      mcp("POST", "/ensure", { bindingName: "summer", idempotencyKey: "k".repeat(256) }),
      { actorId: "alice" });
    expect(ok256.ok).toBe(true);
    const house = "🏠";
    expect(house.length).toBe(2);
    const okEmoji = await adapter.execute(
      mcp("POST", "/ensure", { bindingName: "summer", idempotencyKey: house.repeat(128) }),
      { actorId: "alice" });
    expect(okEmoji.ok).toBe(true);
    const tooLong = await adapter.execute(
      mcp("POST", "/ensure", { bindingName: "summer", idempotencyKey: house.repeat(129) }),
      { actorId: "alice" });
    expect(tooLong).toMatchObject({ ok: false, status: 400 });
    expect(handle).toHaveBeenCalledTimes(2);
  });
});

describe("mcp adapter forged authority and unsupported routes", () => {
  it.each([
    [{ bindingName: "summer", idempotencyKey: "k", storageScopeId: "forged" }],
    [{ bindingName: "summer", idempotencyKey: "k", actorId: "bob" }],
    [{ bindingName: "summer", idempotencyKey: "k", paramsHash: "forged" }],
    [{ bindingName: "summer", idempotencyKey: "k", source: { kind: "base-commit" } }],
    [{ artifactId: ARTIFACT, files: publishArgs().files, idempotencyKey: "k", paramsHash: "x" }],
    [{ artifactId: ARTIFACT, files: publishArgs().files, idempotencyKey: "k", source: { kind: "x" } }],
    [{ artifactId: ARTIFACT, files: publishArgs().files, idempotencyKey: "k", ownerId: "bob" }],
  ])("refuses forged server-owned fields without dispatch", async (args) => {
    const handle = vi.fn(async () => ({ status: 201, body: {} }));
    const adapter = createMcpArtifactAdapter(stubControl({}, handle));
    const path = "bindingName" in args ? "/ensure" : "/publish";
    const result = await adapter.execute(mcp("POST", path, args), { actorId: "alice" });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(handle).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/ensure"],
    ["POST", "/fork"],
    ["POST", "/delete"],
    ["GET", "/list"],
    ["POST", "/meta/abc"],
    ["DELETE", "/publish"],
    ["POST", "/ensure/"],
    ["POST", "/ENSURE"],
  ])("refuses unsupported %s %s before dispatch", async (method, path) => {
    const handle = vi.fn(async () => ({ status: 201, body: {} }));
    const adapter = createMcpArtifactAdapter(stubControl({}, handle));
    const result = await adapter.execute(mcp(method, path, {}), { actorId: "alice" });
    expect(result).toEqual({ ok: false, status: 503, code: "capability_unavailable",
      retryable: false, error: { error: "capability_unavailable" } });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses a meta path and body mismatch", async () => {
    const handle = vi.fn(async () => ({ status: 200, body: {} }));
    const adapter = createMcpArtifactAdapter(stubControl({}, handle));
    const other = "123e4567-e89b-12d3-a456-426614174009";
    const result = await adapter.execute(
      mcp("GET", `/meta/${ARTIFACT}`, { artifactId: other }), { actorId: "alice" });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("mcp adapter foreign metadata and pagination", () => {
  it("preserves identical foreign and unknown meta bodies", async () => {
    const missing = { status: 404, body: { error: "not_found" } };
    const handle = vi.fn(async () => missing);
    const adapter = createMcpArtifactAdapter(stubControl(missing, handle));
    const foreign = await adapter.execute(mcp("GET", `/meta/${ARTIFACT}`, {}), { actorId: "bob" });
    const unknownId = "123e4567-e89b-12d3-a456-426614174009";
    const unknown = await adapter.execute(mcp("GET", `/meta/${unknownId}`, {}), { actorId: "bob" });
    expect(foreign).toEqual(unknown);
    expect(foreign).toMatchObject({ ok: false, status: 404 });
  });

  it.each([
    [{ limit: 1, offset: 0 }],
    [{ limit: 100 }],
    [{ offset: 5 }],
    [{}],
  ])("accepts valid pagination %s", async (args) => {
    const handle = vi.fn(async () => ({ status: 200, body: { artifacts: [], total: 0 } }));
    const adapter = createMcpArtifactAdapter(stubControl({}, handle));
    const result = await adapter.execute(mcp("POST", "/list", args), { actorId: "alice" });
    expect(result.ok).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ limit: 0 }],
    [{ limit: 101 }],
    [{ limit: 1.5 }],
    [{ limit: "20" }],
    [{ offset: -1 }],
    [{ offset: 1.2 }],
    [{ limit: 20, offset: -5 }],
  ])("refuses invalid pagination %s without dispatch", async (args) => {
    const handle = vi.fn(async () => ({ status: 200, body: {} }));
    const adapter = createMcpArtifactAdapter(stubControl({}, handle));
    const result = await adapter.execute(mcp("POST", "/list", args), { actorId: "alice" });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(handle).not.toHaveBeenCalled();
  });

  it("checks authorization before paginated dispatch", async () => {
    const authority: AdmissionAuthority = {
      readActivation: () => live(), nowMs: () => NOW, readStatus: async () => "suspended",
    };
    const handle = vi.fn(async () => ({ status: 200, body: { artifacts: [], total: 0 } }));
    const host = controlTestHost(handle);
    const adapter = createMcpArtifactAdapter(
      createArtifactControl(host, "scope", "pages.example.test", authority));
    const result = await adapter.execute(mcp("POST", "/list", { limit: 20, offset: 0 }),
      { actorId: "alice" });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("mcp adapter admission before dispatch", () => {
  it.each(["suspension", "expiry"])("rereads %s after entry before provider dispatch", async (change) => {
    let reads = 0;
    let now = NOW;
    const authority: AdmissionAuthority = {
      readActivation: () => live(), nowMs: () => now,
      readStatus: async () => {
        if (++reads === 2) {
          if (change === "suspension") return "suspended";
          now = FUTURE;
        }
        return "approved";
      },
    };
    const shared = createReplayHost();
    const adapter = createMcpArtifactAdapter(
      createArtifactControl(shared.host, "scope", "pages.example.test", authority));
    expect(await adapter.execute(mcp("POST", "/publish", publishArgs()), { actorId: "alice" }))
      .toMatchObject({ ok: false, status: 403 });
    expect(shared.handle).not.toHaveBeenCalled();
    expect(shared.kept.size).toBe(0);
  });

  it.each([
    ["suspended", "suspended", live()],
    ["expired activation", "approved", { enabled: false, reason: "activation_off" } as ActivationConfig],
    ["non-cohort", "approved", live(["bob"])],
  ])("refuses %s publish without dispatch", async (_n, status, activation) => {
    const authority: AdmissionAuthority = {
      readActivation: () => activation, nowMs: () => NOW, readStatus: async () => status,
    };
    const handle = vi.fn(async () => ({ status: 201, body: {} }));
    const host = controlTestHost(handle);
    const adapter = createMcpArtifactAdapter(
      createArtifactControl(host, "scope", "pages.example.test", authority));
    const result = await adapter.execute(mcp("POST", "/publish", publishArgs()), { actorId: "alice" });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(handle).not.toHaveBeenCalled();
  });

  it("derives the same durable identity across separate instances", async () => {
    const shared = createReplayHost();
    const firstControl = createArtifactControl(shared.host, "scope", "pages.example.test");
    const secondControl = createArtifactControl(shared.host, "scope", "pages.example.test");
    const first = createMcpArtifactAdapter(firstControl);
    const second = createMcpArtifactAdapter(secondControl);
    expect(await first.execute(mcp("POST", "/publish", publishArgs()), { actorId: "alice" }))
      .toMatchObject({ ok: true });
    expect(await second.execute(mcp("POST", "/publish", publishArgs()), { actorId: "alice" }))
      .toMatchObject({ ok: true });
    expect(shared.kept.size).toBe(1);
    expect(shared.bodies).toHaveLength(2);
    expect(shared.bodies[0]?.["idempotencyKey"]).toBe(shared.bodies[1]?.["idempotencyKey"]);
    expect(shared.bodies.every((body) => !Object.hasOwn(body, "paramsHash"))).toBe(true);
  });
});
