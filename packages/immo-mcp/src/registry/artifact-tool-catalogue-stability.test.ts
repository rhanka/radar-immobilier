import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Stable artifact tool catalogue.
 *
 * claude.ai resets the owner's per-tool "Always allow" grant whenever a tool
 * definition changes, so the served tools/list entries (name, description,
 * input schema, annotations, _meta) must be byte-identical across the
 * p0b, cas.v2 and v2 profiles. Only adding or removing a tool (the two part1
 * tools exist in v2 only) may change the catalogue. The dynamic contract
 * (profileRevisionId, requireExpectedCurrentReleaseId, resultEnvelopeVersion,
 * guide revision) lives in results (authoringGuide.descriptor, error details)
 * and the guide — never in descriptions or _meta.
 *
 * outputSchema is deliberately outside this contract: output schemas track
 * the result envelope version (v1 root fields vs v2 output.*), a genuine
 * result-shape difference in the same class as the extra part1 tools.
 */

interface ProfileCase {
  readonly revision: string;
  readonly env: Record<string, string>;
  readonly toolCount: number;
}

const PROFILES: readonly ProfileCase[] = [
  // Files parity LOT 1: the upload channel (create/commit/publish_bundle)
  // joins every P0b profile; files parity LOT 2 adds the page mint, the
  // asset listing and the v2 bundle; I2 on G2 adds the share tooling;
  // reader consent LOT 1 adds the self-revocation tool.
  { revision: "immo-artifacts.p0b.v1", env: {}, toolCount: 16 },
  { revision: "immo-artifacts.cas.v2", env: {}, toolCount: 16 },
  { revision: "immo-artifacts.v2",
    env: { ARTIFACTS_INPUTS_QUALIFIED: "true", ARTIFACTS_RESULTS_QUALIFIED: "true" },
    toolCount: 18 },
];

/** Tools only selected by the v2 (part1) profile. */
const PART1_ONLY_TOOLS = ["artifacts_list_versions", "artifacts_revert"];

/**
 * Upstream 0.2.9 makes every tool definition a compile-time constant: the
 * active profile only selects the exposed tool set, never what a definition
 * says. Shared tools are therefore byte-identical across p0b, cas.v2 and v2;
 * only the two part1 tools exist in v2. No per-profile schema additions
 * remain (page metadata and files|edits are static in every profile).
 */
const PART1_SCHEMA_ADDITIONS: Record<string, readonly string[]> = {};

/** Fragments that prove a description embeds deployment/profile state. */
const DYNAMIC_DESCRIPTION_MARKERS = [
  "Active profile:",
  "Contract:",
  "profileRevisionId",
  "resultEnvelopeVersion",
  "requireExpectedCurrentReleaseId",
  "immo-artifacts.",
  "2026-11-0",
];

/** Tools whose description must point the model at the versioned guide. */
const GUIDE_DESCRIPTION_TOOLS = ["artifacts_ensure", "artifacts_publish", "artifacts_publish_bundle_v2", "artifacts_get", "artifacts_get_source"];

/** Writes guarded by optimistic concurrency: the property stays, requiredness does not. */
const CAS_GUARDED_TOOLS = ["artifacts_publish", "artifacts_delete", "artifacts_revert"];

const ENV_KEYS = ["ARTIFACTS_PROFILE_REVISION", "ARTIFACTS_INPUTS_QUALIFIED", "ARTIFACTS_RESULTS_QUALIFIED"] as const;

interface LoadedCatalogue {
  readonly revision: string;
  readonly tools: Record<string, unknown>[];
  readonly immoTools: Record<string, unknown>[];
}

function projectTool(tool: { name: string } & Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    ...("_meta" in tool ? { _meta: tool._meta } : {}),
  }));
}

async function loadCatalogue(profile: ProfileCase): Promise<LoadedCatalogue> {
  vi.resetModules();
  const saved = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.ARTIFACTS_PROFILE_REVISION = profile.revision;
    for (const [key, value] of Object.entries(profile.env)) process.env[key] = value;
    const provider = await import("./artifact-provider.js");
    const composition = await import("./stateful-composition.js");
    const app = {
      execute: async (): Promise<never> => { throw new Error("no_execute_in_catalogue_test"); },
      profileDigest: provider.IMMO_ARTIFACT_PROFILE.profileDigest,
      selectedCapabilities: provider.IMMO_ARTIFACT_PROFILE.selectedCapabilities,
    };
    const binding = provider.bindArtifactProvider({
      app: app as never,
      storageScopeId: "catalogue-stability",
      authorizeCommit: (() => async () => ({ allowed: false as const })) as never,
    });
    return {
      revision: profile.revision,
      tools: (binding.tools as (Record<string, unknown> & { name: string })[]).map(projectTool),
      immoTools: (composition.IMMO_WIRE_TOOLS as (Record<string, unknown> & { name: string })[]).map(projectTool),
    };
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const catalogues = new Map<string, LoadedCatalogue>();
const byName = (catalogue: LoadedCatalogue) =>
  Object.fromEntries(catalogue.tools.map((tool) => [(tool.name as string), tool]));

describe("artifact tool catalogue stability", () => {
  beforeAll(async () => {
    for (const profile of PROFILES) catalogues.set(profile.revision, await loadCatalogue(profile));
  }, 120000);

  it.each(PROFILES)("should serve $toolCount tools without _meta for $revision", (profile) => {
    const catalogue = catalogues.get(profile.revision)!;
    expect(catalogue.tools.map((tool) => tool.name).sort()).toHaveLength(profile.toolCount);
    for (const tool of catalogue.tools) {
      expect(tool, `${tool.name} must not carry _meta`).not.toHaveProperty("_meta");
    }
  });

  it.each(PROFILES)("should keep $revision descriptions free of deployment state", (profile) => {
    for (const tool of [...catalogues.get(profile.revision)!.tools, ...catalogues.get(profile.revision)!.immoTools]) {
      for (const marker of DYNAMIC_DESCRIPTION_MARKERS) {
        expect(String(tool.description), `${tool.name} description embeds ${marker}`).not.toContain(marker);
      }
    }
    const tools = byName(catalogues.get(profile.revision)!);
    for (const name of GUIDE_DESCRIPTION_TOOLS) {
      expect(String(tools[name]?.description), `${name} must point at authoringGuide`).toContain("authoringGuide");
    }
  });

  it("should serve identical shared tools in p0b and cas.v2, with only documented v2 additions", () => {
    const [p0b, cas, v2] = PROFILES.map((profile) => catalogues.get(profile.revision)!);
    const shared = (catalogue: LoadedCatalogue) =>
      catalogue.tools.filter((tool) => !PART1_ONLY_TOOLS.includes(tool.name as string));
    const restOf = (tool: Record<string, unknown>) => {
      const copy = { ...tool };
      delete copy.inputSchema;
      return copy;
    };
    expect(shared(cas).map((tool) => tool.name).sort()).toEqual(shared(p0b).map((tool) => tool.name).sort());
    expect(shared(cas)).toEqual(shared(p0b));
    const v2Shared = shared(v2);
    expect(v2Shared.map((tool) => tool.name).sort()).toEqual(shared(p0b).map((tool) => tool.name).sort());
    for (const v2Tool of v2Shared) {
      const base = shared(p0b).find((tool) => tool.name === v2Tool.name)!;
      expect(restOf(v2Tool)).toEqual(restOf(base));
      // Upstream 0.2.9 is static: shared input schemas are byte-identical
      // across profiles, including requiredness (files|edits via oneOf, CAS
      // guard optional). No per-profile additions remain.
      const additions = new Set(PART1_SCHEMA_ADDITIONS[v2Tool.name as string] ?? []);
      const v2Schema = v2Tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
      const baseSchema = base.inputSchema as unknown as { properties: Record<string, unknown>; required: string[] };
      expect(Object.keys(v2Schema.properties).filter((key) => !additions.has(key)).sort())
        .toEqual(Object.keys(baseSchema.properties).sort());
      for (const key of Object.keys(baseSchema.properties)) {
        expect(v2Schema.properties[key]).toEqual(baseSchema.properties[key]);
      }
      expect([...v2Schema.required].sort()).toEqual([...baseSchema.required].sort());
    }
    expect(v2.tools.filter((tool) => PART1_ONLY_TOOLS.includes(tool.name as string))
      .map((tool) => tool.name).sort()).toEqual([...PART1_ONLY_TOOLS].sort());
  });

  it("should keep the non-artifact tools identical in every profile", () => {
    const [p0b, cas, v2] = PROFILES.map((profile) => catalogues.get(profile.revision)!.immoTools);
    expect(cas).toEqual(p0b);
    expect(v2).toEqual(p0b);
    expect(p0b.map((tool) => tool.name).sort()).toEqual([
      "get_grille_pdf", "get_lot_card", "get_lots_geojson", "get_opportunity_dossier", "get_pv_pdf",
      "get_reglement_provenance", "get_zones_geojson", "list_documents", "query_zoning_events",
      "read_document_excerpt", "search_lots", "search_signals",
    ]);
  });

  it.each(CAS_GUARDED_TOOLS)("should expose %s concurrency guard as optional in every profile", (name) => {
    for (const profile of PROFILES) {
      const tool = byName(catalogues.get(profile.revision)!)[name] as
        { inputSchema?: { properties?: Record<string, unknown>; required?: string[] } } | undefined;
      if (PART1_ONLY_TOOLS.includes(name) && tool === undefined) continue;
      expect(tool, `${name} in ${profile.revision}`).toBeDefined();
      expect(Object.keys(tool!.inputSchema?.properties ?? {})).toContain("expectedCurrentReleaseId");
      expect(tool!.inputSchema?.required ?? []).not.toContain("expectedCurrentReleaseId");
    }
  });

  it.each(PROFILES)("should snapshot the $revision catalogue", (profile) => {
    expect(catalogues.get(profile.revision)!.tools).toMatchSnapshot();
  });
});
