import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Bit-identical artifact tool definitions across provider bumps.
 *
 * claude.ai resets the owner's per-tool "Always allow" grant whenever a tool
 * definition changes, so the nine served `artifacts_*` definitions (name,
 * description, inputSchema, annotations) must be byte-identical before and
 * after a `@sentropic/artifacts` bump. The upstream 0.2.6 -> 0.2.8 bump only
 * changed a `paths` property description on `artifacts_get_source`; the
 * provider here pins that description back to the qualified surface (see
 * `stabilizeArtifactInputSchema`), and this test locks the result.
 *
 * outputSchema is deliberately outside this contract (it tracks the result
 * envelope version, as in `artifact-tool-catalogue-stability.test.ts`).
 */

const EXPECTED_ARTIFACT_TOOL_DEFINITIONS: readonly string[] = [
  "artifacts_delete",
  "artifacts_ensure",
  "artifacts_get",
  "artifacts_get_source",
  "artifacts_list",
  "artifacts_list_versions",
  "artifacts_publish",
  "artifacts_revert",
  "artifacts_set_access",
];

/** Golden sha256 over the canonical catalogue. Re-baseline only with owner sign-off. */
const EXPECTED_TOOL_DEFINITIONS_HASH = "ab57457b6582734b3a772175c24a5db885308e31e88c61bc805c713d0f4a9621";

const ENV_KEYS = ["ARTIFACTS_PROFILE_REVISION", "ARTIFACTS_INPUTS_QUALIFIED", "ARTIFACTS_RESULTS_QUALIFIED"] as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

interface LoadedTool { readonly name: string }

async function loadV2Tools(): Promise<Record<string, unknown>[]> {
  vi.resetModules();
  const saved = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.ARTIFACTS_PROFILE_REVISION = "immo-artifacts.v2";
    process.env.ARTIFACTS_INPUTS_QUALIFIED = "true";
    process.env.ARTIFACTS_RESULTS_QUALIFIED = "true";
    const provider = await import("./artifact-provider.js");
    const app = {
      execute: async (): Promise<never> => { throw new Error("no_execute_in_hash_test"); },
      profileDigest: provider.IMMO_ARTIFACT_PROFILE.profileDigest,
      selectedCapabilities: provider.IMMO_ARTIFACT_PROFILE.selectedCapabilities,
    };
    const binding = provider.bindArtifactProvider({
      app: app as never,
      storageScopeId: "tool-definitions-hash",
      authorizeCommit: (() => async () => ({ allowed: false as const })) as never,
    });
    return (binding.tools as (Record<string, unknown> & LoadedTool)[]).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

let tools: Record<string, unknown>[] = [];

describe("artifact tool definitions hash", () => {
  beforeAll(async () => {
    tools = await loadV2Tools();
  }, 120000);

  it("should serve exactly the nine qualified artifact tools", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_ARTIFACT_TOOL_DEFINITIONS]);
  });

  it("should keep the served definitions bit-identical (golden hash)", () => {
    const ordered = [...tools].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const digest = createHash("sha256").update(JSON.stringify(canonicalize(ordered))).digest("hex");
    expect(digest).toBe(EXPECTED_TOOL_DEFINITIONS_HASH);
  });
});
