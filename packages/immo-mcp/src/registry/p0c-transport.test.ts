import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRECONDITION_REQUIRED_MESSAGE, type ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { ARTIFACT_STRICT, ARTIFACT_PART1, ARTIFACT_PROFILE_DESCRIPTOR, HOST_ARTIFACT_PROFILE } from "@radar/artifacts-host";
import { p0bFixture } from "../../../artifacts-host/src/p0b.test-support.js";
import { bindArtifactProvider, IMMO_ARTIFACT_PROFILE, type ArtifactMcpBinding } from "./artifact-provider.js";
import { assertArtifactAssembly, readArtifactConfig } from "./artifact-config.js";
import { generateKeyPair, SignJWT } from "jose";
import { createImmoHttpApp } from "../server-http.js";

const request = (scopes = ["immo:artifacts:read", "immo:artifacts:write"]): VerifiedMcpRequest => ({
  principal: { issuer: "test", sub: "alice", scopes, claims: [], attributes: {} },
  resource: "test:mcp", correlationId: "p0c", signal: new AbortController().signal,
});
const body = (result: { content: unknown[] }) => JSON.parse((result.content[0] as { text: string }).text);
const output = (result: { content: unknown[] }) => ARTIFACT_PART1 ? body(result).output : body(result);

describe("artifact assembly refusal", () => {
  it("should refuse an independently changed manifest before binding startup", () => {
    const config = readArtifactConfig();
    config.effectiveProfile.descriptor.resultEnvelopeVersion = 999;
    expect(() => assertArtifactAssembly(config)).toThrow("artifact_profile_assembly_incoherent");
  });
});

describe.skipIf(!ARTIFACT_STRICT || !process.env.P0B_DATABASE_URL)("strict MCP binding with PostgreSQL", () => {
  let h: Awaited<ReturnType<typeof p0bFixture>>;
  let binding: ArtifactMcpBinding;
  beforeAll(async () => {
    h = await p0bFixture(HOST_ARTIFACT_PROFILE);
    binding = bindArtifactProvider({ app: h.host.app, storageScopeId: "p0b", scopePolicy: { legacyReadScope: true },
      authorizeCommit: () => h.host.authorizeCommit });
  });
  afterAll(async () => { await h?.close(); });

  it("should retain the qualified descriptor, exact precondition refusal and guide location", async () => {
    const ensure = await binding.invoke("artifacts_ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() }, request());
    const artifactId = output(ensure).artifactId;
    expect(output(ensure).authoringGuide.descriptor).toEqual(ARTIFACT_PROFILE_DESCRIPTOR);
    expect(output(ensure).authoringGuide.lifecycle.editing.join(" ")).toContain("Conversation files alone do not establish the current release.");
    if (ARTIFACT_PART1) {
      expect(body(ensure)).toMatchObject({ ok: true, commitState: "committed", replayed: false });
      expect(body(ensure)).not.toHaveProperty("authoringGuide");
      expect(ensure).not.toHaveProperty("structuredContent");
    }
    const read = await binding.invoke("artifacts_get", { artifactId }, request());
    expect(output(read).currentReleaseId).toBeNull();
    const args = { artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "page" }], idempotencyKey: randomUUID() };
    const quota = async () => (await h.pool.query("SELECT operations_used,bytes_used FROM artifacts.host_quotas")).rows[0];
    const before = await quota();
    const refused = await binding.invoke("artifacts_publish", args, request());
    expect(refused.isError).toBe(true);
    const details = { ...ARTIFACT_PROFILE_DESCRIPTOR, requiredField: "expectedCurrentReleaseId", readTools: ["artifacts_get", "artifacts_list"] };
    delete (details as Partial<typeof details>).requireExpectedCurrentReleaseId;
    expect(body(refused)).toMatchObject(ARTIFACT_PART1
      ? { ok: false, commitState: "not_committed", error: { code: "precondition_required", message: PRECONDITION_REQUIRED_MESSAGE, retriable: false, details } }
      : { error: "precondition_required", retryable: false, message: PRECONDITION_REQUIRED_MESSAGE, details });
    expect(await quota()).toEqual(before);
    const published = await binding.invoke("artifacts_publish", { ...args, expectedCurrentReleaseId: null }, request());
    expect(published.isError).not.toBe(true);
    expect(output(published)).toHaveProperty("releaseId");
  });

  it("should require explicit source and version scopes and derive annotations by operation", async () => {
    const artifactId = randomUUID();
    for (const name of ["artifacts_get_source", ...(ARTIFACT_PART1 ? ["artifacts_list_versions"] : [])]) {
      const result = await binding.invoke(name, { artifactId }, request(["immo:read"]));
      expect(result.isError).toBe(true);
      expect(body(result)).toMatchObject(ARTIFACT_PART1
        ? { commitState: "not_committed", error: { code: "artifact_scope_denied", details: { requiredScope: "immo:artifacts:read" } } }
        : { error: "artifact_scope_denied", requiredScope: "immo:artifacts:read" });
    }
    // Files parity LOT 1 — the upload channel joins every strict profile;
    // I2 on G2 adds the share tooling; reader consent LOT 1 adds the
    // self-revocation tool.
    expect(binding.tools).toHaveLength(ARTIFACT_PART1 ? 15 : 13);
    if (ARTIFACT_PART1) {
      expect(binding.tools.find((tool) => tool.name === "artifacts_list_versions")?.annotations).toMatchObject({ readOnlyHint: true });
      expect(binding.tools.find((tool) => tool.name === "artifacts_revert")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    }
    expect(binding.tools.find((tool) => tool.name === "artifacts_create_upload")?.annotations).toMatchObject(
      { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    expect(binding.tools.find((tool) => tool.name === "artifacts_commit_upload")?.annotations).toMatchObject(
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(binding.tools.find((tool) => tool.name === "artifacts_publish_bundle")?.annotations).toMatchObject(
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    // I2 on G2: directory reads stay read-only (provider mutability).
    expect(binding.tools.find((tool) => tool.name === "artifacts_lookup_people")?.annotations).toMatchObject(
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(binding.tools.find((tool) => tool.name === "artifacts_list_access")?.annotations).toMatchObject(
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    // Reader consent LOT 1: self-revocation is a state-transition writer
    // (provider mutability), idempotency-required like every writer.
    expect(binding.tools.find((tool) => tool.name === "artifacts_revoke_reader_consent")?.annotations).toMatchObject(
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(binding.tools.find((tool) => tool.name === "artifacts_delete")?.annotations?.destructiveHint).toBe(true);
  });

  it("should return the exact domain refusal through real MCP discovery and tools/call", async () => {
    const keys = await generateKeyPair("RS256");
    const issuer = "https://synthetic.test";
    const app = createImmoHttpApp({ issuer, resource: `${issuer}/mcp`, requiredScopes: [], scopesSupported: ["immo:artifacts:read", "immo:artifacts:write"],
      dataMode: "simulation", port: 0, sessionIdleTimeoutMs: 1000, sessionMaxLifetimeMs: 2000 }, {
      artifacts: binding, authorize: async () => true, keySource: { resolveKey: async () => keys.publicKey } });
    const token = await new SignJWT({ scope: "immo:artifacts:read immo:artifacts:write" }).setIssuer(issuer).setAudience(`${issuer}/mcp`)
      .setSubject("alice").setIssuedAt().setExpirationTime("5m").setProtectedHeader({ alg: "RS256" }).sign(keys.privateKey);
    const post = (message: object, session?: string) => app.request("/mcp", { method: "POST", headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
      ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(message) });
    const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "p0c-wire", version: "1" } } });
    expect(initialized.status).toBe(200);
    const session = initialized.headers.get("mcp-session-id")!;
    const listed = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, session)).json();
    const publish = listed.result.tools.find((tool: { name: string }) => tool.name === "artifacts_publish");
    expect(Object.keys(publish.inputSchema.properties)).toContain("expectedCurrentReleaseId");
    expect(publish.inputSchema.required).not.toContain("expectedCurrentReleaseId");
    const ensured = await binding.invoke("artifacts_ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() }, request());
    const response = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "artifacts_publish", arguments: {
      artifactId: output(ensured).artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "x" }], idempotencyKey: randomUUID() } } }, session);
    const result = (await response.json()).result;
    expect(result.isError).toBe(true);
    expect(body(result)).toMatchObject(ARTIFACT_PART1
      ? { ok: false, commitState: "not_committed", error: { code: "precondition_required", message: PRECONDITION_REQUIRED_MESSAGE } }
      : { error: "precondition_required", message: PRECONDITION_REQUIRED_MESSAGE });
    const get = await (await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: {
      name: "artifacts_get", arguments: { artifactId: output(ensured).artifactId } } }, session)).json();
    expect(output(get.result).authoringGuide.descriptor).toEqual(ARTIFACT_PROFILE_DESCRIPTOR);
    if (ARTIFACT_PART1) expect(body(get.result)).toMatchObject({ ok: true, commitState: "not_committed", output: { currentReleaseId: null } });
  });
});

describe.skipIf(!ARTIFACT_PART1)("v2 MCP failure codec", () => {
  it("should preserve unknown and early validation/admission refusals without protocol errors", async () => {
    const execute = vi.fn<ArtifactsApp["execute"]>(async (_request, invocation) => ({ ok: false, failure: {
      kind: "operational", category: "provider_unavailable", publicCode: "capability_unavailable", httpStatus: 503,
      retriable: true, invocationId: invocation.invocationId, operation: "publish", phase: "commit", commitState: "unknown" } }));
    const binding = bindArtifactProvider({ app: { execute, profileDigest: IMMO_ARTIFACT_PROFILE.profileDigest,
      selectedCapabilities: IMMO_ARTIFACT_PROFILE.selectedCapabilities }, storageScopeId: "p0b",
      authorizeCommit: () => async () => ({ allowed: false, reason: "denied", publicCode: "access_denied", status: 403, retriable: false }) });
    const args = { artifactId: randomUUID(), expectedCurrentReleaseId: null, files: [{ path: "index.html", mimeType: "text/html", text: "x" }], idempotencyKey: "same-key" };
    expect(body(await binding.invoke("artifacts_publish", args, request()))).toMatchObject({ ok: false, commitState: "unknown", error: { code: "capability_unavailable", retriable: true } });
    expect(body(await binding.invoke("artifacts_publish", { ...args, actorId: "forged" }, request())))
      .toMatchObject({ ok: false, commitState: "not_committed", error: { code: "invalid_request", retriable: false } });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
