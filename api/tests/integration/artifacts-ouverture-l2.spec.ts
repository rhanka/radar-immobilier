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
  ALICE, BOB, STALE, UNKNOWN_ARTIFACT,
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
    await expect(bound.binding.invoke("artifacts_list", {},
      bindingRequest(ALICE, []))).rejects.toThrow("artifact_scope_denied");
    await expect(bound.binding.invoke("artifacts_list", {},
      bindingRequest(ALICE, ["immo:search"]))).rejects.toThrow("artifact_scope_denied");
    expect(await h.durable()).toEqual(before);
  });

  it("admits stale workspace claims on artifact tools over HTTP but keeps business controls", async () => {
    const app = createImmoHttpApp(HTTP_CONFIG, { keySource: keys.keySource, artifacts: bound.binding,
      authorize: accountAuthorizer(h.pool) });
    const token = await signToken(keys.privateKey, { sub: ALICE, workspaces: [STALE] });
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
    const business = await (await post({ jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "search_signals", arguments: { city: "longueuil" } } }, sessionId)).json() as {
      result?: { isError?: boolean; content?: { text: string }[] } };
    expect(business.result?.isError).toBe(true);
    expect(JSON.stringify(business.result)).toContain("composition_account");
  });
});
