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

// Preparation-only provider mock: durable replay/conflict keyed by the
// facade-derived internal key plus effective params hash. It stands in for
// the real store and proves adapter wiring only, not provider persistence.
function createReplayHost() {
  const kept = new Map<string, { paramsHash: string; status: number; body: unknown }>();
  const bodies: Array<Record<string, unknown>> = [];
  const handle = vi.fn(async (input: { body: Record<string, unknown> }) => {
    const body = input.body;
    bodies.push(body);
    const internal = body["idempotencyKey"] as string;
    const hash = body["paramsHash"] as string;
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
  const host = { app: { handle } } as unknown as Parameters<typeof createArtifactControl>[0];
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
      data: { artifactId: ARTIFACT, releaseId: RELEASE, digest: DIGEST,
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
    ["absent", {}, "POST", "/ensure"],
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
