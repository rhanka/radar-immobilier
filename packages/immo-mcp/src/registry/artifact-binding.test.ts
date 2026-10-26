import { describe, expect, it, vi } from "vitest";
import type { ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { ImmoStatefulHost } from "../stateful-host.js";
import { Hono } from "hono";
import { composeStatefulImmo } from "./stateful-composition.js";
import { ARTIFACT_NATIVE_ADAPTER, bindArtifactProvider, IMMO_ARTIFACT_PROFILE as profile,
  IMMO_ARTIFACT_MANIFEST, type ArtifactMcpBinding } from "./artifact-provider.js";

const authority: VerifiedMcpRequest = {
  principal: { issuer: "synthetic", sub: "alice", scopes: ["immo:read"], claims: [], attributes: {} },
  resource: "synthetic:mcp", correlationId: "test", signal: new AbortController().signal,
};
const guard = vi.fn(async () => ({ allowed: false as const, reason: "denied" as const,
  publicCode: "access_denied", status: 403, retriable: false }));
function setup() {
  const execute = vi.fn<ArtifactsApp["execute"]>(async (_request, invocation) => ({
    ok: false, failure: { kind: "operational", category: "provider_unavailable", httpStatus: 503,
      publicCode: "capability_unavailable", retriable: true, invocationId: invocation.invocationId,
      operation: "publish", phase: "prepare", commitState: "not_committed", cause: new Error("private driver") },
  }));
  const app = { execute, profileDigest: profile.profileDigest, selectedCapabilities: profile.selectedCapabilities };
  const createGuard = vi.fn(() => guard);
  return { execute, app, createGuard, binding: bindArtifactProvider({ app,
    storageScopeId: "synthetic", authorizeCommit: createGuard }) };
}

describe("P7 trusted artifact binding", () => {
  it("should refuse app/profile mismatch and missing authority at construction", async () => {
    const h = setup();
    expect(() => bindArtifactProvider({ app: { ...h.app, profileDigest: "other" },
      storageScopeId: "synthetic", authorizeCommit: h.createGuard })).toThrow("app/profile mismatch");
    expect(() => bindArtifactProvider({ app: h.app, storageScopeId: " ",
      authorizeCommit: h.createGuard })).toThrow("artifact_binding_incomplete");
    expect(Object.isFrozen(IMMO_ARTIFACT_MANIFEST.tools[0]!.requiredScopes)).toBe(true);
    expect(Object.isFrozen(h.binding.configuration)).toBe(true);
    expect((await ARTIFACT_NATIVE_ADAPTER.listCapabilities()).map((tool) => tool.name)).toEqual(profile.selectedCapabilities);
  });

  it("should close the entire namespace for an unrecognized binding", async () => {
    const host = new ImmoStatefulHost(new Hono());
    const effect = vi.fn(async () => 1);
    await expect(composeStatefulImmo(host, async () => true, {} as ArtifactMcpBinding))
      .rejects.toThrow("artifact_binding_unrecognized");
    await expect(host.run(authority, effect)).rejects.toThrow("composition_unavailable");
    expect(effect).not.toHaveBeenCalled();
  });

  it("should refuse direct unselected dispatch and removed scope before creating authority", async () => {
    const h = setup();
    const unselected = await h.binding.invoke("artifacts_delete", {}, authority);
    expect(unselected.isError).toBe(true);
    expect(JSON.stringify(unselected)).toContain("capability_unavailable");
    await expect(h.binding.invoke("artifacts_list", {}, {
      ...authority, principal: { ...authority.principal, scopes: [] },
    })).rejects.toThrow("artifact_scope_denied");
    await expect(ARTIFACT_NATIVE_ADAPTER.invokeTool()).rejects.toThrow("native_wire_dispatch_required");
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.createGuard).not.toHaveBeenCalled();
  });

  it("should preserve retry classification while hiding private causes", async () => {
    const h = setup();
    const result = await h.binding.invoke("artifacts_list", {}, authority);
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content[0] as { text: string }).text))
      .toEqual({ error: "capability_unavailable", retryable: true });
    expect(JSON.stringify(result)).not.toContain("private driver");
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.createGuard).toHaveBeenCalledExactlyOnceWith(authority, undefined);
  });

  it("should return a public refusal for semantic input errors without creating authority", async () => {
    const h = setup();
    const result = await h.binding.invoke("artifacts_ensure", {
      bindingName: "x", idempotencyKey: "\ud800",
    }, authority);
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content[0] as { text: string }).text))
      .toEqual({ error: "invalid_request", retryable: false });
    expect(h.createGuard).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("should refuse unavailable invocation authority before dispatch without exposing its cause", async () => {
    const h = setup();
    h.createGuard.mockImplementation(() => { throw new Error("private authority query"); });
    const result = await h.binding.invoke("artifacts_list", {}, authority);
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content[0] as { text: string }).text))
      .toEqual({ error: "capability_unavailable", retryable: true });
    expect(JSON.stringify(result)).not.toContain("private authority query");
    expect(h.execute).not.toHaveBeenCalled();
  });
});
