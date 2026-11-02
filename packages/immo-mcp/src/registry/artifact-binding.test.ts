import { describe, expect, it, vi } from "vitest";
import type { ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { ImmoStatefulHost } from "../stateful-host.js";
import { Hono } from "hono";
import { composeStatefulImmo } from "./stateful-composition.js";
import { ARTIFACT_NATIVE_ADAPTER, bindArtifactProvider, IMMO_ARTIFACT_PROFILE as profile,
  IMMO_ARTIFACT_MANIFEST, type ArtifactMcpBinding } from "./artifact-provider.js";

const authority: VerifiedMcpRequest = {
  principal: { issuer: "synthetic", sub: "alice", scopes: ["immo:read", "immo:artifacts:read", "immo:artifacts:write"],
    claims: [], attributes: {} },
  resource: "synthetic:mcp", correlationId: "test", signal: new AbortController().signal,
};
const guard = vi.fn(async () => ({ allowed: false as const, reason: "denied" as const,
  publicCode: "access_denied", status: 403, retriable: false }));
const withScopes = (scopes: string[]): VerifiedMcpRequest => ({
  ...authority, principal: { ...authority.principal, scopes },
});
const denial = (result: { content: unknown[] }) => JSON.parse((result.content[0] as { text: string }).text);
const ENSURE = { bindingName: "summer", idempotencyKey: "k" };
const PUBLISH = { artifactId: "123e4567-e89b-12d3-a456-426614174000", idempotencyKey: "k",
  files: [{ path: "index.html", mimeType: "text/html", text: "<p>x</p>" }] };
function setup(scopePolicy?: { legacyReadScope: boolean }) {
  const execute = vi.fn<ArtifactsApp["execute"]>(async (_request, invocation) => ({
    ok: false, failure: { kind: "operational", category: "provider_unavailable", httpStatus: 503,
      publicCode: "capability_unavailable", retriable: true, invocationId: invocation.invocationId,
      operation: "publish", phase: "prepare", commitState: "not_committed", cause: new Error("private driver") },
  }));
  const app = { execute, profileDigest: profile.profileDigest, selectedCapabilities: profile.selectedCapabilities };
  const createGuard = vi.fn(() => guard);
  return { execute, app, createGuard, binding: bindArtifactProvider({ app,
    storageScopeId: "synthetic", authorizeCommit: createGuard, scopePolicy }) };
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
    const unselected = await h.binding.invoke("artifacts_restore", {}, authority);
    expect(unselected.isError).toBe(true);
    expect(JSON.stringify(unselected)).toContain("capability_unavailable");
    expect(denial(await h.binding.invoke("artifacts_list", {}, withScopes([]))))
      .toEqual({ error: "artifact_scope_denied", retryable: false, requiredScope: "immo:artifacts:read" });
    await expect(ARTIFACT_NATIVE_ADAPTER.invokeTool()).rejects.toThrow("native_wire_dispatch_required");
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.createGuard).not.toHaveBeenCalled();
  });

  it.each([
    ["artifacts_ensure", ENSURE],
    ["artifacts_publish", PUBLISH],
  ] as const)("should refuse %s with a typed artifact_scope_denied without the write scope", async (tool, args) => {
    for (const policy of [undefined, { legacyReadScope: true }]) {
      const h = setup(policy);
      for (const scopes of [["immo:read"], ["immo:read", "immo:search", "immo:documents:read"], ["immo:artifacts:read"]]) {
        const result = await h.binding.invoke(tool, args, withScopes(scopes));
        expect(result.isError).toBe(true);
        expect(denial(result)).toEqual({ error: "artifact_scope_denied", retryable: false,
          requiredScope: "immo:artifacts:write" });
      }
      expect(h.execute).not.toHaveBeenCalled();
      expect(h.createGuard).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["artifacts_ensure", ENSURE],
    ["artifacts_publish", PUBLISH],
  ] as const)("should dispatch %s once the write scope is granted", async (tool, args) => {
    const h = setup();
    const result = await h.binding.invoke(tool, args, withScopes(["immo:artifacts:write"]));
    // The contract double answers capability_unavailable: reaching it proves admission.
    expect(denial(result).error).not.toBe("artifact_scope_denied");
    expect(h.createGuard).toHaveBeenCalledTimes(1);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it("should accept immo:read for reads only while the transition flag is on", async () => {
    const strict = setup();
    expect(denial(await strict.binding.invoke("artifacts_list", {}, withScopes(["immo:read"]))).error)
      .toBe("artifact_scope_denied");
    expect(strict.execute).not.toHaveBeenCalled();
    await strict.binding.invoke("artifacts_list", {}, withScopes(["immo:artifacts:read"]));
    expect(strict.execute).toHaveBeenCalledTimes(1);
    const legacy = setup({ legacyReadScope: true });
    expect(legacy.binding.scopePolicy.legacyReadScope).toBe(true);
    await legacy.binding.invoke("artifacts_list", {}, withScopes(["immo:read"]));
    await legacy.binding.invoke("artifacts_get", { artifactId: PUBLISH.artifactId }, withScopes(["immo:read"]));
    expect(legacy.execute).toHaveBeenCalledTimes(2);
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
