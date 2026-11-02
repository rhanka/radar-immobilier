import { describe, expect, it, vi } from "vitest";
import { ARTIFACT_P0B, ARTIFACT_PROFILE_DESCRIPTOR, ACTIVE_ARTIFACT_TOOLS } from "@radar/artifacts-host";
import type { ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { bindArtifactProvider, IMMO_ARTIFACT_PROFILE as profile } from "./artifact-provider.js";
import { getAuthoringGuide } from "./artifact-authoring-guide.js";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const request = (scopes: string[]): VerifiedMcpRequest => ({ principal: { issuer: "test", sub: "alice",
  scopes, claims: [], attributes: {} }, resource: "test:mcp", correlationId: "test", signal: new AbortController().signal });
const body = (result: { content: unknown[] }) => JSON.parse((result.content[0] as { text: string }).text);
function setup() {
  const execute = vi.fn<ArtifactsApp["execute"]>(async (_input, invocation) => ({ ok: true,
    result: { status: 200, body: { artifactId: ID, files: [{ path: "app.js", bytes: [49] }] } },
    invocationId: invocation.invocationId, replayed: false, commitState: "not_committed" }));
  const prepareDelete = vi.fn(async (_actor: string, args: Record<string, unknown>) => ({ ...args, expectedCurrentReleaseId: RELEASE }));
  const binding = bindArtifactProvider({ app: { execute, selectedCapabilities: profile.selectedCapabilities, profileDigest: profile.profileDigest },
    storageScopeId: "scope", scopePolicy: { legacyReadScope: true }, prepareDelete,
    authorizeCommit: () => async () => ({ allowed: false, reason: "denied", publicCode: "access_denied", status: 403, retriable: false }) });
  return { execute, binding, prepareDelete };
}

describe("installed artifact boundary", () => {
  it("should select only qualified tools for the installed provider", () => {
    expect(profile.selectedCapabilities).toEqual(ACTIVE_ARTIFACT_TOOLS);
    for (const disabled of ["restore", "fork", "promote", "renew"]) {
      expect(() => profile.validate(`artifacts_${disabled}`, { artifactId: ID })).toThrow("capability_unavailable");
    }
    expect(profile.schemas.artifacts_publish?.required).not.toContain("expectedCurrentReleaseId");
    expect(ARTIFACT_PROFILE_DESCRIPTOR.requireExpectedCurrentReleaseId).toBe(false);
  });
});

describe.skipIf(!ARTIFACT_P0B)("P0b MCP binding", () => {
  it("should publish annotations, profile metadata and optional delete snapshot", () => {
    const { binding } = setup();
    const tool = (name: string) => binding.tools.find((t) => t.name === `artifacts_${name}`)!;
    expect(tool("get_source").annotations).toMatchObject({ readOnlyHint: true });
    expect(tool("set_access").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tool("delete").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool("delete").inputSchema.required).not.toContain("expectedCurrentReleaseId");
    expect(tool("get")._meta).toEqual({ "immo/artifactsProfile": ARTIFACT_PROFILE_DESCRIPTOR });
    expect(getAuthoringGuide().artifactLifecycle?.descriptor).toEqual(ARTIFACT_PROFILE_DESCRIPTOR);
  });

  it.each([
    ["artifacts_get_source", { artifactId: ID }, "immo:artifacts:read"],
    ["artifacts_set_access", { artifactId: ID, action: "grant", principalId: "idp-bob", grant: "read", idempotencyKey: "share" }, "immo:artifacts:write"],
    ["artifacts_delete", { artifactId: ID, idempotencyKey: "delete" }, "immo:artifacts:write"],
  ])("should enforce the explicit scope before dispatching %s", async (tool, args, scope) => {
    const h = setup();
    expect(body(await h.binding.invoke(tool, args, request(["immo:read"])))).toMatchObject({ error: "artifact_scope_denied", requiredScope: scope });
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.prepareDelete).not.toHaveBeenCalled();
    const accepted = await h.binding.invoke(tool, args, request([scope]));
    expect(accepted.isError).not.toBe(true);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.execute.mock.calls[0]![1]).toMatchObject({ actorId: "alice", storageScopeId: "scope" });
    if (tool === "artifacts_get_source") expect(body(accepted).authoringGuide).toHaveProperty("artifactLifecycle");
    if (tool === "artifacts_delete") expect(h.execute.mock.calls[0]![0].body).toHaveProperty("expectedCurrentReleaseId", RELEASE);
  });

  it("should preserve confirmation details without exposing the private cause", async () => {
    const h = setup();
    const details = { confirmationRef: ID, managementUrl: "https://app.test/confirm", expiresAt: "2026-11-02T00:00:00Z" };
    h.execute.mockImplementation(async (_input, invocation) => ({ ok: false, failure: {
      kind: "operational", category: "unauthorized_at_commit", publicCode: "confirmation_required", httpStatus: 409,
      retriable: false, invocationId: invocation.invocationId, operation: "delete", phase: "dispatch",
      commitState: "not_committed", details, cause: new Error("private SQL") } }));
    const response = await h.binding.invoke("artifacts_delete", { artifactId: ID, idempotencyKey: "delete" }, request(["immo:artifacts:write"]));
    expect(body(response)).toEqual({ error: "confirmation_required", retryable: false, details });
    expect(JSON.stringify(response)).not.toContain("private SQL");
  });
});
