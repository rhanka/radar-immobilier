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
