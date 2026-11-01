import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactBinding } from "../../../packages/immo-mcp/src/artifact-binding.js";
import { accountAuthorizer } from "../../../packages/immo-mcp/src/account-binding.js";
import {
  createImmoHttpApp,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_MAX_LIFETIME_MS,
  type ImmoHttpConfig,
} from "../../../packages/immo-mcp/src/server-http.js";
import {
  ALICE, ARTIFACT_SCOPES, BOB, STALE, UNKNOWN_ARTIFACT,
  bindingRequest, body, ouvertureKeys, signToken, startOuverture,
  ISSUER, RESOURCE, type Ouverture, type OuvertureKeys,
} from "./artifacts-ouverture.helpers.js";

const HTTP_CONFIG: ImmoHttpConfig = {
  issuer: ISSUER,
  resource: RESOURCE,
  requiredScopes: ["immo:read"],
  scopesSupported: ["immo:read", "immo:search", "immo:documents:read"],
  port: 0,
  dataMode: "simulation",
  sessionIdleTimeoutMs: DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  sessionMaxLifetimeMs: DEFAULT_SESSION_MAX_LIFETIME_MS,
};

describe("ouverture L2 artifact tools on the MCP binding", () => {
  let h: Ouverture;
  let bound: NonNullable<Awaited<ReturnType<typeof createArtifactBinding>>>;
  let keys: OuvertureKeys;
  beforeAll(async () => {
    keys = await ouvertureKeys();
    h = await startOuverture("mcp");
    await h.memberships([]);
    const created = await createArtifactBinding({ ...h.bindingEnv });
    if (!created) throw new Error("artifact binding unavailable in general mode");
    bound = created;
  });
  afterAll(async () => { await bound?.close(); await h?.close(); });

  it("exposes the four artifact tools and publishes two real accounts", async () => {
    expect(bound.binding.tools.map((tool) => tool.name).sort()).toEqual(
      ["artifacts_ensure", "artifacts_get", "artifacts_list", "artifacts_publish"]);
    const alice = await bound.binding.invoke("artifacts_ensure",
      { bindingName: "mcp-shared", idempotencyKey: "mcp-shared" }, bindingRequest(ALICE));
    expect(alice.isError).not.toBe(true);
    const bob = await bound.binding.invoke("artifacts_ensure",
      { bindingName: "mcp-shared", idempotencyKey: "mcp-shared" }, bindingRequest(BOB));
    expect(bob.isError).not.toBe(true);
    expect(body(bob).artifactId).not.toBe(body(alice).artifactId);
    const published = await bound.binding.invoke("artifacts_publish", {
      artifactId: body(alice).artifactId, idempotencyKey: "mcp-page",
      files: [{ path: "index.html", mimeType: "text/html", text: "<h1>ouverture</h1>" }] },
    bindingRequest(ALICE));
    expect(published.isError, JSON.stringify(published)).not.toBe(true);
    const bobPublished = await bound.binding.invoke("artifacts_publish", {
      artifactId: body(bob).artifactId, idempotencyKey: "mcp-page",
      files: [{ path: "index.html", mimeType: "text/html", text: "<h1>Bob</h1>" }] }, bindingRequest(BOB));
    expect(bobPublished.isError, JSON.stringify(bobPublished)).not.toBe(true);
    expect(body(bobPublished).releaseId).not.toBe(body(published).releaseId);
    const listed = await bound.binding.invoke("artifacts_list", { limit: 100 }, bindingRequest(BOB));
    expect(JSON.stringify(body(listed))).toContain(body(bob).artifactId);
    expect(JSON.stringify(body(listed))).not.toContain(body(alice).artifactId);
    const foreign = await bound.binding.invoke("artifacts_get", { artifactId: body(alice).artifactId },
      bindingRequest(BOB));
    const unknown = await bound.binding.invoke("artifacts_get", { artifactId: UNKNOWN_ARTIFACT },
      bindingRequest(BOB));
    expect(foreign.isError).toBe(true);
    expect(body(foreign)).toEqual(body(unknown));
  });

  it("refuses forged actor, owner and storage fields without dispatch", async () => {
    const before = await h.durable();
    for (const forged of [{ actorId: "mallory" }, { ownerId: "mallory" }, { storageScopeId: "forged" },
      { actor: "mallory" }, { owner: "mallory" }, { storageScope: "forged" }]) {
      const denied = await bound.binding.invoke("artifacts_ensure",
        { bindingName: "forged", idempotencyKey: "forged", ...forged }, bindingRequest(ALICE));
      expect(denied.isError, JSON.stringify(forged)).toBe(true);
      expect(body(denied), JSON.stringify(forged)).toEqual({ error: "invalid_request", retryable: false });
    }
    expect(await h.durable()).toEqual(before);
  });

  it("refuses a missing or foreign invocation scope without dispatch", async () => {
    const before = await h.durable();
    for (const scopes of [[], ["immo:search"], ["immo:read"]]) {
      const denied = await bound.binding.invoke("artifacts_list", {}, bindingRequest(ALICE, scopes));
      expect(denied.isError).toBe(true);
      expect(body(denied)).toEqual({ error: "artifact_scope_denied", retryable: false,
        requiredScope: "immo:artifacts:read" });
    }
    expect(await h.durable()).toEqual(before);
  });

  it("refuses writes without immo:artifacts:write and leaves storage untouched", async () => {
    const before = await h.durable();
    for (const scopes of [["immo:read"], ["immo:read", "immo:search", "immo:documents:read"],
      ["immo:read", "immo:artifacts:read"]]) {
      const denied = await bound.binding.invoke("artifacts_ensure",
        { bindingName: "no-write", idempotencyKey: "no-write" }, bindingRequest(ALICE, scopes));
      expect(denied.isError).toBe(true);
      expect(body(denied)).toEqual({ error: "artifact_scope_denied", retryable: false,
        requiredScope: "immo:artifacts:write" });
      const unpublished = await bound.binding.invoke("artifacts_publish", { artifactId: UNKNOWN_ARTIFACT,
        idempotencyKey: "no-write", files: [{ path: "index.html", mimeType: "text/html", text: "<p>x</p>" }] },
      bindingRequest(ALICE, scopes));
      expect(body(unpublished)).toMatchObject({ error: "artifact_scope_denied", requiredScope: "immo:artifacts:write" });
    }
    expect(await h.durable()).toEqual(before);
    const granted = await bound.binding.invoke("artifacts_ensure",
      { bindingName: "write-granted", idempotencyKey: "write-granted" },
      bindingRequest(ALICE, ["immo:read", "immo:artifacts:write"]));
    expect(granted.isError, JSON.stringify(granted)).not.toBe(true);
    expect(body(granted)).toMatchObject({ artifactId: expect.any(String) });
  });

  it("accepts immo:read for reads only behind IMMO_MCP_ARTIFACTS_LEGACY_READ_SCOPE", async () => {
    const legacy = await createArtifactBinding({ ...h.bindingEnv, IMMO_MCP_ARTIFACTS_LEGACY_READ_SCOPE: "true" });
    if (!legacy) throw new Error("artifact binding unavailable in general mode");
    try {
      const listed = await legacy.binding.invoke("artifacts_list", {}, bindingRequest(ALICE, ["immo:read"]));
      expect(listed.isError, JSON.stringify(listed)).not.toBe(true);
      const before = await h.durable();
      const denied = await legacy.binding.invoke("artifacts_ensure",
        { bindingName: "legacy-write", idempotencyKey: "legacy-write" }, bindingRequest(ALICE, ["immo:read"]));
      expect(body(denied)).toEqual({ error: "artifact_scope_denied", retryable: false,
        requiredScope: "immo:artifacts:write" });
      expect(await h.durable()).toEqual(before);
    } finally { await legacy.close(); }
    await expect(createArtifactBinding({ ...h.bindingEnv, IMMO_MCP_ARTIFACTS_LEGACY_READ_SCOPE: "yes" }))
      .rejects.toThrow("artifact_legacy_read_scope_invalid");
  });

  it("admits stale workspace claims on artifact tools over HTTP but keeps business controls", async () => {
    const app = createImmoHttpApp(HTTP_CONFIG, { keySource: keys.keySource, artifacts: bound.binding,
      authorize: accountAuthorizer(h.pool, h.bindingEnv) });
    const token = await signToken(keys.privateKey, {
      sub: ALICE, scope: [...ARTIFACT_SCOPES, "immo:search"].join(" "), workspaces: [STALE],
    });
    const headers = (sessionId?: string | null): HeadersInit => ({
      "content-type": "application/json", accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`, ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    });
    const post = (payload: unknown, sessionId?: string | null) => app.request("/mcp",
      { method: "POST", headers: headers(sessionId), body: JSON.stringify(payload) });
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    expect(init.status).toBe(200);
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId)).status).toBe(202);
    const list = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, sessionId)).json() as {
      result?: { tools?: { name: string }[] } };
    const names = (list.result?.tools ?? []).map((tool) => tool.name);
    for (const tool of ["artifacts_ensure", "artifacts_publish", "artifacts_list", "artifacts_get"]) {
      expect(names).toContain(tool);
    }
    const ensured = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "artifacts_ensure",
        arguments: { bindingName: "http-stale", idempotencyKey: "http-stale" } } }, sessionId)).json() as {
      result?: { isError?: boolean; content?: { text: string }[] } };
    expect(ensured.result?.isError).not.toBe(true);
    expect(JSON.parse(ensured.result?.content?.[0]?.text ?? "{}"))
      .toMatchObject({ artifactId: expect.any(String) });
    const business = await (await post({ jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "search_signals", arguments: { city: "longueuil" } } }, sessionId)).json() as {
      result?: { isError?: boolean; content?: { text: string }[] } };
    expect(business.result?.isError).toBe(true);
    expect(JSON.stringify(business.result)).toContain("composition_account");
  });
});
