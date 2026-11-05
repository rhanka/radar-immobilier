import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Bit-identical artifact tool definitions across deploys.
 *
 * claude.ai resets the owner's per-tool "Always allow" grant whenever a tool
 * definition changes, so the nine served `artifacts_*` definitions (name,
 * description, inputSchema, annotations) must be byte-identical across
 * deploys, package versions and profile switches. Upstream 0.2.9 makes every
 * definition a compile-time constant (`ARTIFACTS_TOOL_DEFINITIONS`); the
 * active profile only selects the exposed tool set and stays visible in
 * manifest audit metadata and typed result details, never in a definition.
 * The 0.2.8 -> 0.2.9 bump changes the definitions one final time by design
 * (static schemas replace profile-dependent bounds); this test locks the
 * 0.2.9 result, re-verified byte-identical under the 0.2.10 and 0.2.12 pins. The 0.2.13 pin
 * (sentropic train #911) changes NONE of the nine served definitions — the
 * provider diff touches only the version constant, a code comment on
 * get_source and the six appended tools. This train adds them in three
 * waves: files parity (artifacts_create_upload, artifacts_commit_upload,
 * artifacts_publish_bundle) then I2 on G2 (artifacts_lookup_people,
 * artifacts_list_access) then reader consent LOT 1
 * (artifacts_revoke_reader_consent). Proven by per-tool JSON comparison of
 * the committed catalogue snapshots across p0b.v1, cas.v2 and v2: additions
 * only, zero removals, zero byte changes on the pre-existing definitions.
 * The fifteenth definition is provider-published (staticTool in mcp-core at
 * 0.2.13: self-revocation, required artifactId plus idempotencyKey, optional
 * scope); the catalogue serves it with the stable immo summary only.
 * The provider here keeps the qualified catalogue surface
 * (CAS guard optional, `paths` description-less, stable summaries) via
 * `stabilizeArtifactInputSchema`.
 *
 * outputSchema is deliberately outside this contract (it tracks the result
 * envelope version, as in `artifact-tool-catalogue-stability.test.ts`).
 *
 * Files parity LOT 2 adds exactly three definitions and changes none of the
 * fifteen pre-existing ones: artifacts_create_upload_page (owner-only page
 * mint, write), artifacts_list_assets (staged/released listing, read) and
 * artifacts_publish_bundle_v2 (copy/carry/keep bundle, write). The provider
 * 0.2.15 ships all three with static, frozen-at-birth definitions; the new
 * golden below re-baselines the catalogue for that reason only. Proven by
 * per-tool JSON comparison of the committed catalogue snapshots across
 * p0b.v1, cas.v2 and v2: three additions, zero removals, zero byte changes
 * on the pre-existing definitions (see also the stability suite, which
 * asserts shared tools byte-identical across profiles).
 */

const EXPECTED_ARTIFACT_TOOL_DEFINITIONS: readonly string[] = [
  "artifacts_commit_upload",
  "artifacts_create_upload",
  "artifacts_create_upload_page",
  "artifacts_delete",
  "artifacts_ensure",
  "artifacts_get",
  "artifacts_get_source",
  "artifacts_list",
  "artifacts_list_access",
  "artifacts_list_assets",
  "artifacts_list_versions",
  "artifacts_lookup_people",
  "artifacts_publish",
  "artifacts_publish_bundle",
  "artifacts_publish_bundle_v2",
  "artifacts_revert",
  "artifacts_revoke_reader_consent",
  "artifacts_set_access",
];

/** Golden sha256 over the canonical catalogue. Re-baseline only with owner sign-off. */
const EXPECTED_TOOL_DEFINITIONS_HASH = "e92d58ff875deb987c3f9f717c5e8ad9616b345d26d40b56448879c6d5d0f23e";

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

  it("should serve exactly the eighteen qualified artifact tools", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_ARTIFACT_TOOL_DEFINITIONS]);
  });

  it("should keep the served definitions bit-identical (golden hash)", () => {
    const ordered = [...tools].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const digest = createHash("sha256").update(JSON.stringify(canonicalize(ordered))).digest("hex");
    expect(digest).toBe(EXPECTED_TOOL_DEFINITIONS_HASH);
  });

  it("should produce identical bytes across two builds", async () => {
    const first = await loadV2Tools();
    const second = await loadV2Tools();
    const bytesOf = (entries: Record<string, unknown>[]) => JSON.stringify(canonicalize(
      [...entries].sort((a, b) => String(a.name).localeCompare(String(b.name)))));
    const firstBytes = bytesOf(first);
    const secondBytes = bytesOf(second);
    expect(secondBytes).toBe(firstBytes);
    const digest = createHash("sha256").update(firstBytes).digest("hex");
    expect(digest).toBe(EXPECTED_TOOL_DEFINITIONS_HASH);
  });
});
