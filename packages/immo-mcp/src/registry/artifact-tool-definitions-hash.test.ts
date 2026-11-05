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
 * 0.2.15 ships all three with static, frozen-at-birth definitions. The
 * fifteen historical definitions are locked per-definition below (frozen
 * sha256 over the served name, description, inputSchema and annotations);
 * only the three additions feed the new golden. The historical lock is
 * valid because the LOT 2 diff is additions-only on every definition
 * input: same provider pin, untouched stabilize functions, unchanged
 * summaries and guide snippet for the fifteen, no MIME enum in the served
 * schemas (see also the stability suite, which asserts shared tools
 * byte-identical across profiles).
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

/**
 * Frozen sha256 per historical definition, over the canonical served
 * {name, description, inputSchema, annotations}. Any byte change on a
 * pre-existing definition fails here by name. Re-baseline only with owner
 * sign-off, and only with a definition diff that proves the change.
 */
const HISTORICAL_TOOL_DEFINITIONS_HASH: Record<string, string> = {
  artifacts_commit_upload: "0fe19dc750081befcbf38d0a2ddc17dbab2c669154cc4ff7edfa6297a21396a3",
  artifacts_create_upload: "8b6a32bee9fa39b3c6d37424e89022bbf67c8ad792fb8a60f2ff165f20a1b44a",
  artifacts_delete: "cfabf6e930fb252fa666bf6ee89c5e52d8935587de188b5c8a3a3ef13e0cdc6e",
  artifacts_ensure: "3f90f4ed9138379843d88cbe5d92745a9c8b132449d51bd4d5ec438293a3ea2b",
  artifacts_get: "d37591fb2bbd0cf99e7cc0c8d19e6de8139012fa40c5118508700d9e70c932d7",
  artifacts_get_source: "9d7128dc409ae0882ba2426d322f6ba9edd30dd1ec9ad7e7c825a20089bef3f2",
  artifacts_list: "688d81732bfedb6d237096c16c9f1261b7346222767fc736cfae7b8ce793cb07",
  artifacts_list_access: "06d346987f94853d3479d5bb38f5cc96b22bcde42caec0231387b7755d8abb0e",
  artifacts_list_versions: "3ae9165e4af0aaf35a8ebe01e8dd267e98835b5e902a9796aa9170d13227cf48",
  artifacts_lookup_people: "e272c45dc768f06d2711642984d827553cdfd23676f9601dddd16cae344f942c",
  artifacts_publish: "99eeb81b8b3736ca455ddaff8864d5774afef80450b3e992ca8dce788056ea6e",
  artifacts_publish_bundle: "ccd1e7002ea8ffe724695db9f06abe4298221e2284440c5a8894162a4cd1a668",
  artifacts_revert: "3d05459b9ba5c3fd8cb5322ba375de0c6d304b3684b00a8212a977331e2b2b31",
  artifacts_revoke_reader_consent: "eb7b783eec34b9f84f7eb2aefe7131e401dd2f401cae56c728a6ca8f81901307",
  artifacts_set_access: "4796f0658c334b9cd484357e5a0b311f0c49355357c54520dc197a0f84ed8e1e",
};

/** Files parity LOT 2 additions: the only tools that feed the new golden. */
const NEW_TOOL_NAMES: readonly string[] = [
  "artifacts_create_upload_page",
  "artifacts_list_assets",
  "artifacts_publish_bundle_v2",
];

/** Golden sha256 over the canonical served definitions of the three additions only. */
const NEW_TOOL_DEFINITIONS_HASH = "3cece8f3e0523737a0f8f04ffdb5902c87df52fdcfc9cc5833aeea408409fb12";

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

  it("should keep every historical definition bit-identical (frozen per-tool hash)", () => {
    const byName = new Map(tools.map((tool) => [String(tool.name), tool]));
    expect([...byName.keys()].sort()).toEqual([...EXPECTED_ARTIFACT_TOOL_DEFINITIONS]);
    for (const [name, frozen] of Object.entries(HISTORICAL_TOOL_DEFINITIONS_HASH)) {
      const tool = byName.get(name);
      expect(tool, `missing historical tool ${name}`).toBeDefined();
      const digest = createHash("sha256").update(JSON.stringify(canonicalize(tool))).digest("hex");
      expect(digest, `historical definition drift on ${name}`).toBe(frozen);
    }
  });

  it("should feed the new golden with the three additions only", () => {
    const added = [...tools]
      .filter((tool) => NEW_TOOL_NAMES.includes(String(tool.name)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    expect(added.map((tool) => tool.name)).toEqual([...NEW_TOOL_NAMES]);
    const digest = createHash("sha256").update(JSON.stringify(canonicalize(added))).digest("hex");
    expect(digest).toBe(NEW_TOOL_DEFINITIONS_HASH);
  });

  it("should produce identical bytes across two builds", async () => {
    const first = await loadV2Tools();
    const second = await loadV2Tools();
    const bytesOf = (entries: Record<string, unknown>[]) => JSON.stringify(canonicalize(
      [...entries].sort((a, b) => String(a.name).localeCompare(String(b.name)))));
    expect(bytesOf(second)).toBe(bytesOf(first));
  });
});
