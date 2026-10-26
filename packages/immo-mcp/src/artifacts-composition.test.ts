import { describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { createImmoHttpApp, type ImmoHttpConfig } from "./server-http.js";
import { bindArtifactProvider, IMMO_ARTIFACT_PROFILE as profile } from "./registry/artifact-provider.js";
import type { ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { ArtifactInvocationContext } from "@sentropic/artifacts/server/commit-contract";

const config: ImmoHttpConfig = {
  issuer: "https://synthetic.test", resource: "https://synthetic.test/mcp", requiredScopes: [],
  scopesSupported: ["immo:read"], dataMode: "simulation", port: 0,
  sessionIdleTimeoutMs: 1000, sessionMaxLifetimeMs: 2000,
};
async function setup(withAccountBinding = true) {
  const keys = await generateKeyPair("RS256");
  const seen: ArtifactInvocationContext[] = [];
  const execute = vi.fn<ArtifactsApp["execute"]>(async (_request, invocation) => {
    seen.push(invocation);
    return { ok: true, result: { status: 200, body: { artifacts: [] } },
      invocationId: invocation.invocationId, commitState: "committed", replayed: false };
  });
  const createGuard = vi.fn(() => vi.fn(async () => ({ allowed: false as const,
    reason: "denied" as const, publicCode: "access_denied", status: 403, retriable: false })));
  const artifacts = bindArtifactProvider({ app: { execute, profileDigest: profile.profileDigest,
    selectedCapabilities: profile.selectedCapabilities }, storageScopeId: "synthetic-scope", authorizeCommit: createGuard });
  const authorize = vi.fn(async () => true);
  const app = createImmoHttpApp(config, { artifacts, ...(withAccountBinding ? { authorize } : {}),
    keySource: { resolveKey: async () => keys.publicKey } });
  const token = (scope = "immo:read") => new SignJWT({ scope }).setIssuer(config.issuer).setAudience(config.resource)
    .setSubject("alice").setIssuedAt().setExpirationTime("5m").setProtectedHeader({ alg: "RS256" }).sign(keys.privateKey);
  const post = async (message: object, session?: string, scope?: string) => app.request("/mcp", { method: "POST",
    headers: { authorization: `Bearer ${await token(scope)}`, "content-type": "application/json",
      accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
    body: JSON.stringify(message) });
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" },
  } });
  expect(init.status).toBe(200);
  const session = init.headers.get("mcp-session-id")!;
  const call = (name: string, args: object = {}, scope?: string) => post({ jsonrpc: "2.0", id: 3,
    method: "tools/call", params: { name, arguments: args } }, session, scope);
  return { app, post, session, call, execute, createGuard, seen, authorize };
}

describe("P7 composed transport (contract double; no storage qualification)", () => {
  it("should list exactly twelve plus four and dispatch each call once with fresh frozen authority", async () => {
    const h = await setup();
    const list = await (await h.post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, h.session)).json();
    expect(list.result.tools).toHaveLength(16);
    expect(list.result.tools.filter((t: { name: string }) => t.name.startsWith("artifacts_")).map((t: { name: string }) => t.name))
      .toEqual(profile.selectedCapabilities);
    for (let i = 0; i < 2; i++) {
      const result = await (await h.call("artifacts_list")).json();
      expect(result.result.isError).not.toBe(true);
    }
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(h.seen.every((invocation) => Object.isFrozen(invocation) && invocation.actorId === "alice"
      && invocation.storageScopeId === "synthetic-scope")).toBe(true);
    expect(h.seen[0]!.invocationId).not.toBe(h.seen[1]!.invocationId);
  });

  it("should deny removed scopes, current account denial and caller authority before provider effects", async () => {
    const h = await setup();
    expect((await (await h.call("artifacts_list", {}, "")).json()).result.isError).toBe(true);
    expect((await (await h.call("artifacts_list", { actorId: "mallory" })).json()).result.isError).toBe(true);
    h.authorize.mockResolvedValue(false);
    expect((await (await h.call("artifacts_list")).json()).result.isError).toBe(true);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.createGuard).not.toHaveBeenCalled();
  });

  it("should carry the supported worst-case decoded-byte envelope through the bridge", async () => {
    const h = await setup();
    const result = await (await h.call("artifacts_publish", {
      artifactId: "123e4567-e89b-12d3-a456-426614174000", idempotencyKey: "k",
      files: [{ path: "index.html", mimeType: "text/html", text: "\u0001".repeat(262144) }],
    })).json();
    expect(result.result.isError).not.toBe(true);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it("should deny artifact effects when the account port is absent even with fixture business data", async () => {
    const h = await setup(false);
    const result = await (await h.call("artifacts_list")).json();
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0].text).toContain("composition_account");
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.createGuard).not.toHaveBeenCalled();
  });
});
