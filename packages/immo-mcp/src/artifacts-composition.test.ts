import { describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { createImmoHttpApp, type ImmoHttpConfig } from "./server-http.js";
import { bindArtifactProvider, IMMO_ARTIFACT_PROFILE as profile } from "./registry/artifact-provider.js";
import type { ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { ArtifactInvocationContext } from "@sentropic/artifacts/server/commit-contract";
import { ARTIFACT_P0B } from "@radar/artifacts-host";

const config: ImmoHttpConfig = {
  issuer: "https://synthetic.test", resource: "https://synthetic.test/mcp", requiredScopes: [],
  scopesSupported: ["immo:read"], dataMode: "simulation", port: 0,
  sessionIdleTimeoutMs: 1000, sessionMaxLifetimeMs: 2000,
};
const ALL_SCOPES = "immo:read immo:artifacts:read immo:artifacts:write";
const PUBLISH = { artifactId: "123e4567-e89b-12d3-a456-426614174000", idempotencyKey: "k",
  files: [{ path: "index.html", mimeType: "text/html", text: "<p>x</p>" }] };
const SUMMARY = { artifactId: PUBLISH.artifactId, bindingName: "summer", state: "active", published: false,
  stableUrl: `https://${PUBLISH.artifactId}.pages.test/`, pinnedUrl: null, currentReleaseId: null,
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: null };
async function setup(withAccountBinding = true, scopePolicy?: { legacyReadScope: boolean }) {
  const keys = await generateKeyPair("RS256");
  const seen: ArtifactInvocationContext[] = [];
  const execute = vi.fn<ArtifactsApp["execute"]>(async (input, invocation) => {
    seen.push(invocation);
    return { ok: true, result: { status: 200, body: input.path.startsWith("/meta/") ? SUMMARY : { total: 1, artifacts: [SUMMARY] } },
      invocationId: invocation.invocationId, commitState: "committed", replayed: false };
  });
  const createGuard = vi.fn(() => vi.fn(async () => ({ allowed: false as const,
    reason: "denied" as const, publicCode: "access_denied", status: 403, retriable: false })));
  const artifacts = bindArtifactProvider({ app: { execute, profileDigest: profile.profileDigest,
    selectedCapabilities: profile.selectedCapabilities }, storageScopeId: "synthetic-scope", authorizeCommit: createGuard, scopePolicy,
    prepareDelete: async (_actor, args) => ({ ...args, expectedCurrentReleaseId: null }) });
  const authorize = vi.fn(async () => true);
  const app = createImmoHttpApp(config, { artifacts, ...(withAccountBinding ? { authorize } : {}),
    keySource: { resolveKey: async () => keys.publicKey } });
  const token = (scope = ALL_SCOPES) => new SignJWT({ scope }).setIssuer(config.issuer).setAudience(config.resource)
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

const payload = async (response: Response) => {
  const json = await response.json() as { result: { isError?: boolean; content: { text: string }[] } };
  return { isError: json.result.isError === true, body: JSON.parse(json.result.content[0]!.text) as Record<string, unknown> };
};

describe("explicit artifact scopes over the MCP transport", () => {
  it.skipIf(!ARTIFACT_P0B).each([
    ["artifacts_get_source", { artifactId: PUBLISH.artifactId }, "immo:artifacts:read"],
    ["artifacts_set_access", { artifactId: PUBLISH.artifactId, action: "grant", principalId: "idp-bob", grant: "read", idempotencyKey: "share" }, "immo:artifacts:write"],
    ["artifacts_delete", { artifactId: PUBLISH.artifactId, idempotencyKey: "delete" }, "immo:artifacts:write"],
  ])("should enforce scopes and dispatch %s through the real MCP transport", async (tool, args, scope) => {
    const h = await setup();
    expect((await payload(await h.call(tool, args, "immo:read"))).body).toMatchObject({ error: "artifact_scope_denied" });
    expect(h.execute).not.toHaveBeenCalled();
    expect((await payload(await h.call(tool, args, `immo:read ${scope}`))).isError).toBe(false);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["artifacts_ensure", { bindingName: "summer", idempotencyKey: "k" }],
    ["artifacts_publish", PUBLISH],
  ] as const)("should refuse %s with a typed artifact_scope_denied without immo:artifacts:write", async (tool, args) => {
    for (const policy of [undefined, { legacyReadScope: true }]) {
      const h = await setup(true, policy);
      for (const scope of ["immo:read", "immo:read immo:search immo:documents:read", "immo:read immo:artifacts:read"]) {
        const refused = await payload(await h.call(tool, args, scope));
        expect(refused.isError).toBe(true);
        expect(refused.body).toMatchObject({ error: "artifact_scope_denied", retryable: false,
          requiredScope: "immo:artifacts:write", tool });
      }
      expect(h.execute).not.toHaveBeenCalled();
      expect(h.createGuard).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["artifacts_ensure", { bindingName: "summer", idempotencyKey: "k" }],
    ["artifacts_publish", PUBLISH],
  ] as const)("should dispatch %s with immo:artifacts:write", async (tool, args) => {
    const h = await setup();
    const accepted = await payload(await h.call(tool, args, "immo:read immo:artifacts:write"));
    expect(accepted.isError).toBe(false);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.seen[0]!.actorId).toBe("alice");
  });

  it("should require immo:artifacts:read for reads unless the transition flag is on", async () => {
    const strict = await setup();
    const refused = await payload(await strict.call("artifacts_list", {}, "immo:read"));
    expect(refused.body).toMatchObject({ error: "artifact_scope_denied", requiredScope: "immo:artifacts:read" });
    expect(strict.execute).not.toHaveBeenCalled();
    expect((await payload(await strict.call("artifacts_list", {}, "immo:read immo:artifacts:read"))).isError).toBe(false);
    expect(strict.execute).toHaveBeenCalledTimes(1);

    const legacy = await setup(true, { legacyReadScope: true });
    expect((await payload(await legacy.call("artifacts_list", {}, "immo:read"))).isError).toBe(false);
    expect((await payload(await legacy.call("artifacts_get", { artifactId: PUBLISH.artifactId }, "immo:read"))).isError)
      .toBe(false);
    expect((await payload(await legacy.call("artifacts_list", {}, "immo:search"))).body)
      .toMatchObject({ error: "artifact_scope_denied" });
    expect(legacy.execute).toHaveBeenCalledTimes(2);
  });
});

describe("P7 composed transport (contract double; no storage qualification)", () => {
  it("should list exactly twelve plus four and dispatch each call once with fresh frozen authority", async () => {
    const h = await setup();
    const list = await (await h.post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, h.session)).json();
    expect(list.result.tools).toHaveLength(12 + profile.selectedCapabilities.length);
    expect(list.result.tools.filter((t: { name: string }) => t.name.startsWith("artifacts_")).map((t: { name: string }) => t.name))
      .toEqual(profile.selectedCapabilities);
    for (const name of ["artifacts_list", "artifacts_get"]) {
      const tool = list.result.tools.find((t: { name: string }) => t.name === name);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true });
      expect(JSON.stringify(tool.outputSchema)).toContain("currentReleaseId");
      expect(JSON.stringify(tool.outputSchema)).toContain("updatedAt");
    }
    if (ARTIFACT_P0B) {
      const tool = (name: string) => list.result.tools.find((t: { name: string }) => t.name === `artifacts_${name}`);
      expect(tool("get_source").annotations).toMatchObject({ readOnlyHint: true });
      expect(tool("set_access").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      expect(tool("delete").annotations).toMatchObject({ destructiveHint: true });
    }
    for (let i = 0; i < 2; i++) {
      const result = await (await h.call("artifacts_list")).json();
      expect(result.result.isError).not.toBe(true);
      expect(JSON.parse(result.result.content[0].text).artifacts).toEqual([SUMMARY]);
      expect(result.result.structuredContent).toEqual({ total: 1, artifacts: [SUMMARY] });
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
