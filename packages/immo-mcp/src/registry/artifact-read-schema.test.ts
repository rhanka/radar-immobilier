import { describe, expect, it } from "vitest";
import type { ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { bindArtifactProvider, IMMO_ARTIFACT_MANIFEST, IMMO_ARTIFACT_PROFILE } from "./artifact-provider.js";

const page = { artifactId: "123e4567-e89b-12d3-a456-426614174000", bindingName: "Valleyfield",
  stableUrl: "https://123e4567-e89b-12d3-a456-426614174000.pages.test/", pinnedUrl: null, currentReleaseId: null,
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: null, state: "active", published: false };
const request: VerifiedMcpRequest = { principal: { issuer: "test", sub: "alice", scopes: ["immo:artifacts:read"],
  claims: [], attributes: {} }, resource: "test:mcp", correlationId: "test", signal: new AbortController().signal };
function binding(body: unknown) {
  const app: ArtifactsApp = { selectedCapabilities: IMMO_ARTIFACT_PROFILE.selectedCapabilities,
    profileDigest: IMMO_ARTIFACT_PROFILE.profileDigest, execute: async (_input, invocation) => ({ ok: true,
      result: { status: 200, body }, invocationId: invocation.invocationId, replayed: false, commitState: "not_committed" }) };
  return bindArtifactProvider({ app, storageScopeId: "scope", authorizeCommit: () => async () => ({ allowed: true }) });
}

describe("IMMO artifact discovery schemas", () => {
  it("should expose required metadata, nullable publication fields and the list order on both manifests", () => {
    const tools = binding(page).tools;
    for (const name of ["artifacts_list", "artifacts_get"]) {
      const tool = tools.find((entry) => entry.name === name)!;
      const manifestTool = IMMO_ARTIFACT_MANIFEST.tools.find((entry) => entry.name === name)!;
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.outputSchema).toEqual(manifestTool.outputSchema);
      const schema = tool.outputSchema as { required: string[]; properties: Record<string, { items?: unknown; type?: unknown }> };
      const summary = (name === "artifacts_list" ? schema.properties.artifacts!.items : schema) as typeof schema;
      expect(summary.required).toEqual(expect.arrayContaining(["artifactId", "bindingName", "stableUrl", "pinnedUrl",
        "currentReleaseId", "createdAt", "updatedAt", "state", "published"]));
      for (const key of ["pinnedUrl", "currentReleaseId", "updatedAt"]) expect(summary.properties[key]?.type).toEqual(["string", "null"]);
      expect(summary.properties).not.toHaveProperty("title");
      expect(summary.properties).not.toHaveProperty("description");
      if (name === "artifacts_list") {
        for (const text of [tool.description, JSON.stringify(tool.outputSchema)]) {
          expect(text).toContain("updatedAt descending, nulls last, then createdAt descending");
          expect(text).toContain("before offset/limit pagination");
        }
      }
    }
  });

  it.each([
    ["artifacts_get", { artifactId: page.artifactId }, page],
    ["artifacts_list", {}, { total: 1, artifacts: [page] }],
  ])("should preserve %s metadata in both text and structured MCP results", async (name, args, body) => {
    const result = await binding(body).invoke(name as string, args, request);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject(body);
    const text = JSON.parse((result.content[0] as { text: string }).text);
    expect(text).toEqual(result.structuredContent);
    if (name === "artifacts_get") expect(text.authoringGuide).toHaveProperty("guideId", "immo-artifact-authoring");
  });
});
