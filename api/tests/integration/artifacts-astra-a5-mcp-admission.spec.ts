import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { createArtifactBinding } from "../../../packages/immo-mcp/src/artifact-binding.js";
import { ALICE, WORKSPACE, SECOND, startAstra, type Astra } from "./artifacts-astra-a5.helpers.js";

const request: VerifiedMcpRequest = {
  principal: { issuer: "synthetic", sub: ALICE, scopes: ["immo:read", "immo:artifacts:read", "immo:artifacts:write"], claims: [], attributes: {} },
  resource: "synthetic:mcp", correlationId: "astra", signal: new AbortController().signal,
};
const body = (result: CallToolResult) => JSON.parse((result.content[0] as { text: string }).text);

describe("astra A5 production MCP admission", () => {
  let h: Astra;
  let bound: NonNullable<Awaited<ReturnType<typeof createArtifactBinding>>>;
  let env: NodeJS.ProcessEnv;
  let artifactId: string;
  beforeAll(async () => { h = await startAstra("mcp"); await h.openHost(); });
  beforeEach(async () => {
    await bound?.close();
    await h.memberships([WORKSPACE]);
    env = { ...h.bindingEnv };
    bound = (await createArtifactBinding(env))!;
    const result = await bound.binding.invoke("artifacts_ensure", {
      bindingName: "astra-mcp", idempotencyKey: "astra-mcp" }, request);
    expect(result.isError).not.toBe(true);
    artifactId = body(result).artifactId;
    expect(artifactId).toBeTypeOf("string");
  });
  afterAll(async () => { await bound?.close(); await h?.close(); });

  async function readsAllowed() {
    for (const [tool, args] of [["artifacts_list", {}], ["artifacts_get", { artifactId }]] as const) {
      const result = await bound.binding.invoke(tool, args, request);
      expect(result.isError, tool).not.toBe(true);
      expect(body(result), tool).toBeTruthy();
    }
  }
  async function allDenied(error: string) {
    const before = await h.durable();
    for (const [tool, args] of [["artifacts_list", {}], ["artifacts_get", { artifactId }],
      ["artifacts_ensure", { bindingName: "denied", idempotencyKey: "denied" }],
      ["artifacts_publish", { artifactId, idempotencyKey: "denied", files: [
        { path: "index.html", mimeType: "text/html", text: "denied" }] }]] as const) {
      const result = await bound.binding.invoke(tool, args, request);
      expect(result.isError, tool).toBe(true);
      expect(body(result), tool).toEqual({ error, retryable: false });
    }
    expect(await h.durable()).toEqual(before);
  }
  it("should allow reads then reject all tools after activation expires on the same binding", async () => {
    await readsAllowed();
    env.ARTIFACTS_VALIDATION_UNTIL = "2020-01-01T00:00:00Z";
    await allDenied("activation_closed");
  });
  it("should reject all tools after removal from the cohort on the same binding", async () => {
    await readsAllowed();
    env.ARTIFACTS_VALIDATION_SUBJECTS = "another-subject";
    await allDenied("not_in_cohort");
  });
  it("should reject absent membership on the production binding", async () => {
    await h.memberships([]);
    await allDenied("workspace_membership_required");
  });
  it("should reject ambiguous membership on the production binding", async () => {
    await h.memberships([WORKSPACE, SECOND]);
    await allDenied("workspace_ambiguous");
  });
});
