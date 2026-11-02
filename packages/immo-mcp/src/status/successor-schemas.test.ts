import { describe, expect, it } from "vitest";
import { ALL_TOOL_DEFINITIONS } from "../tool-definitions.js";
import { STATUS_TOOL_NAMES } from "./command-contracts.js";
import { STATUS_TOOL_CONTRACTS } from "./tool-contracts.js";
import { SUCCESSOR_TOOL_NAMES, SuccessorManifestSchema,
  SuccessorSearchSignalsInputSchema } from "./successor-schemas.js";
import { H4_CHECKPOINT_TOOL_COUNT, SUCCESSOR_TOOL_COUNT } from "./successor-contract.js";

const digest = "a".repeat(64);
describe("inert successor compatibility", () => {
  it("should retain exactly twelve live definitions and the baseline search schema", () => {
    const names = ALL_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names).toHaveLength(12);
    expect(names.filter((name) => (STATUS_TOOL_NAMES as readonly string[]).includes(name))).toEqual([]);
    expect(Object.keys(STATUS_TOOL_CONTRACTS)).toEqual([...STATUS_TOOL_NAMES]);
    expect(Object.keys(ALL_TOOL_DEFINITIONS.find((tool) => tool.name === "search_signals")!.inputSchema))
      .toEqual(["city", "etape", "query", "showDiscarded", "limit"]);
  });

  it("should preserve search filters, reveal and bounds with only an optional successor selector", () => {
    const input = { city: "longueuil", etape: "adoption", query: "densification", showDiscarded: true, limit: 100 };
    expect(SuccessorSearchSignalsInputSchema.parse(input)).toEqual(input);
    expect(SuccessorSearchSignalsInputSchema.safeParse({ ...input,
      workspaceId: "11111111-2222-4333-8444-555555555555" }).success).toBe(true);
    for (const patch of [{ workspaceId: "default" }, { limit: 101 }, { actor: "x" }]) {
      expect(SuccessorSearchSignalsInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });

  it("should bind all successor definitions and versions while preserving the H4 checkpoint", () => {
    const manifest = { version: "status-v1", baseline: { toolCount: 12, digest }, h4: { toolCount: H4_CHECKPOINT_TOOL_COUNT, digest },
      successor: { toolCount: SUCCESSOR_TOOL_COUNT, digest, definitionsVersion: "v1", capabilitiesVersion: "v1",
        handlersVersion: "v1", schemasVersion: "v1", searchSignalsContract: "search_signals.status-v1",
        tools: SUCCESSOR_TOOL_NAMES.map((name) => ({ name, schemaDigest: digest,
          handlerDigest: digest, capabilities: ["synthetic"] })) } };
    expect(SuccessorManifestSchema.safeParse(manifest).success).toBe(true);
    expect(SuccessorManifestSchema.safeParse({ ...manifest, h4: { toolCount: 22, digest } }).success).toBe(false);
    const tools = [...manifest.successor.tools];
    tools[0] = tools[1]!;
    expect(SuccessorManifestSchema.safeParse({ ...manifest, successor: { ...manifest.successor, tools } }).success)
      .toBe(false);
    expect(SuccessorManifestSchema.safeParse({ ...manifest, successor: {
      ...manifest.successor, searchSignalsContract: "legacy" } }).success).toBe(false);
  });
});
