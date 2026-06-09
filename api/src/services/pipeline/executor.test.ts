import { describe, expect, it } from "vitest";

import {
  AVIS_PUBLICS_FIXTURE_HTML,
  AVIS_PUBLICS_SOURCE_ID,
  ROLE_EVALUATION_MAMH_VALLEYFIELD_XML,
  SourceFetchError,
  createAvisPublicsValleyfieldAdapter,
  createRoleEvaluationMamhAdapter,
  roleSourceId,
  type FetchLike,
} from "@radar/sources";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { createCiblageStore } from "../ciblage/ciblage-store.js";
import { buildAdapterRegistry, type AdapterEntry } from "./adapter-registry.js";
import { createJobsStore } from "./jobs-store.js";
import { runCiblagePlan } from "./executor.js";

const CITY = "salaberry-de-valleyfield";
const ROLE_VF = roleSourceId("70052");

/** In-memory ObjectStore (no MinIO): carries ciblage, raw, project-state, jobs. */
class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    _contentType?: string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string"
        ? new TextEncoder().encode(body)
        : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }
  async get(key: string): Promise<Uint8Array> {
    const v = this.objects.get(key);
    if (!v) throw new Error(`missing ${key}`);
    return v;
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }
}

/** FetchLike returning the COMMITTED real rôle XML fixture (NO network). */
function fixtureRoleFetch(xml: string): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (n: string) =>
        n.toLowerCase() === "content-type" ? "application/xml" : null,
    },
    arrayBuffer: async () =>
      new TextEncoder().encode(xml).buffer as ArrayBuffer,
  });
}

/** FetchLike returning the COMMITTED real avis-publics HTML fixture (NO network). */
function fixtureAvisFetch(html: string): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (n: string) =>
        n.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
    },
    arrayBuffer: async () =>
      new TextEncoder().encode(html).buffer as ArrayBuffer,
  });
}

/** A fixture-backed registry entry: real rôle adapter wired to the committed XML. */
function roleEntry(): AdapterEntry {
  return {
    sourceId: ROLE_VF,
    city: CITY,
    build: () =>
      createRoleEvaluationMamhAdapter({
        codeMamh: "70052",
        city: CITY,
        fetchImpl: fixtureRoleFetch(ROLE_EVALUATION_MAMH_VALLEYFIELD_XML),
      }),
  };
}

/** A fixture-backed registry entry: real avis-publics adapter wired to the HTML. */
function avisEntry(): AdapterEntry {
  return {
    sourceId: AVIS_PUBLICS_SOURCE_ID,
    city: CITY,
    build: () =>
      createAvisPublicsValleyfieldAdapter({
        fetchImpl: fixtureAvisFetch(AVIS_PUBLICS_FIXTURE_HTML),
      }),
  };
}

/** A deliberately failing source (typed SourceFetchError) → step failed. */
function failingEntry(): AdapterEntry {
  return {
    sourceId: "avis-publics-valleyfield",
    city: CITY,
    build: () =>
      createRoleEvaluationMamhAdapter({
        codeMamh: "70052",
        city: CITY,
        // Adapter never throws raw; it raises a typed SourceFetchError on a 503.
        fetchImpl: async () => {
          throw new SourceFetchError(
            "network",
            "simulated upstream outage",
            "https://example.invalid/role.xml",
          );
        },
      }),
  };
}

async function seedPlan(
  store: MemoryStore,
  sourceBindingIds: string[],
  enabled = true,
) {
  const ciblage = createCiblageStore(store);
  return ciblage.create({
    label: "Veille Valleyfield",
    citySlugs: [CITY],
    sourceBindingIds,
    cadence: "initial",
    enabled,
  });
}

describe("runCiblagePlan (executor over fixture adapters — REAL entities)", () => {
  it("ACCUMULATES every plan source into ONE per-city project state (rôle + avis coexist)", async () => {
    // A 2-source plan for ONE city. The rôle XML yields Lot/Valuation canonicals;
    // the avis HTML yields Bylaw canonicals. Before the fix, the second source's
    // exploitation OVERWROTE the first's project state — only the LAST survived.
    const store = new MemoryStore();
    const plan = await seedPlan(store, [ROLE_VF, AVIS_PUBLICS_SOURCE_ID]);
    const registry = buildAdapterRegistry([roleEntry(), avisEntry()]);
    const jobsStore = createJobsStore(store);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore,
      objectStore: store,
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => new Date("2026-06-08T08:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const job = result.job;
    expect(job.status).toBe("succeeded");
    // Two real sources collected; both recorded a succeeded step.
    expect(job.steps).toHaveLength(2);
    expect(job.steps.every((s) => s.status === "succeeded")).toBe(true);

    // The persisted project state holds canonicals from BOTH sources, proving the
    // single per-city exploitation accumulated rather than overwrote.
    const stateKey = `ontology/${CITY}/project-state.json`;
    const stateBytes = await store.get(stateKey);
    const state = JSON.parse(new TextDecoder().decode(stateBytes)) as {
      canonicals: { type: string; label: string; evidenceRefs: string[] }[];
      candidates: unknown[];
      mentions: unknown[];
      rawRefs: string[];
    };
    const types = new Set(state.canonicals.map((c) => c.type));
    // From the rôle XML:
    expect(types.has("Lot")).toBe(true);
    expect(
      state.canonicals.some(
        (c) => c.type === "Lot" && c.label.includes("4193751"),
      ),
    ).toBe(true);
    // From the avis HTML — would be ABSENT under the overwrite bug:
    expect(types.has("Bylaw")).toBe(true);

    // The project state evidences BOTH raw sources (role XML + avis HTML).
    expect(state.rawRefs.length).toBeGreaterThanOrEqual(2);

    // Cross-source candidate report on the accumulated REAL corpus: graphify's
    // entity_match now sees both sources together. Honest count (may be 0 if the
    // committed fixtures share no same-type normalized identifier).
    console.log(
      `[accumulation] city=${CITY} canonicals=${state.canonicals.length} ` +
        `candidates=${state.candidates.length} mentions=${state.mentions.length} ` +
        `types=${[...types].sort().join(",")}`,
    );

    // Each city source's step surfaces the SAME accumulated per-city totals.
    const roleStep = job.steps.find((s) => s.sourceId === ROLE_VF)!;
    const avisStep = job.steps.find((s) => s.sourceId === AVIS_PUBLICS_SOURCE_ID)!;
    expect(roleStep.canonicalCount).toBe(state.canonicals.length);
    expect(avisStep.canonicalCount).toBe(state.canonicals.length);
    expect(roleStep.candidateCount).toBe(state.candidates.length);
    // Mentions are summed ONCE per city (not double-counted across siblings).
    expect(job.totals.mentions).toBe(state.mentions.length);
  });

  it("runs recueil→exploitation and flows the REAL lot 4193751 into the project state", async () => {
    const store = new MemoryStore();
    const plan = await seedPlan(store, [ROLE_VF]);
    const registry = buildAdapterRegistry([roleEntry()]);
    const jobsStore = createJobsStore(store);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore,
      objectStore: store,
      registry,
      planId: plan.id,
      mode: "simulation", // fixture-backed run
      now: () => new Date("2026-06-08T08:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const job = result.job;

    // Job rollup is succeeded with one real step.
    expect(job.status).toBe("succeeded");
    expect(job.planId).toBe(plan.id);
    expect(job.steps).toHaveLength(1);
    const step = job.steps[0]!;
    expect(step.status).toBe("succeeded");
    expect(step.sourceId).toBe(ROLE_VF);
    expect(step.city).toBe(CITY);
    expect(step.rawDocIds.length).toBeGreaterThan(0);
    expect(step.mentionCount).toBeGreaterThan(0);
    expect(job.totals.rawDocs).toBe(step.rawDocIds.length);

    // The plan id is stamped on the collected RawDocument (ciblagePlanId).
    const rawKeys = [...store.objects.keys()].filter((k) =>
      k.startsWith("raw/"),
    );
    expect(rawKeys.length).toBeGreaterThan(0);

    // REAL entity: lot 4193751 reconciled into a canonical in the project state.
    const stateKey = `ontology/${CITY}/project-state.json`;
    const stateBytes = await store.get(stateKey);
    const state = JSON.parse(new TextDecoder().decode(stateBytes)) as {
      canonicals: { type: string; label: string }[];
    };
    const lot = state.canonicals.find(
      (c) => c.type === "Lot" && c.label.includes("4193751"),
    );
    expect(lot).toBeDefined();

    // The job is persisted and listable.
    const listed = await jobsStore.list();
    expect(listed.map((j) => j.id)).toContain(job.id);
    const fetched = await jobsStore.get(job.id);
    expect(fetched?.status).toBe("succeeded");
  });

  it("marks the run PARTIAL when one source fails and another succeeds", async () => {
    const store = new MemoryStore();
    const plan = await seedPlan(store, [ROLE_VF, "avis-publics-valleyfield"]);
    const registry = buildAdapterRegistry([roleEntry(), failingEntry()]);
    const jobsStore = createJobsStore(store);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore,
      objectStore: store,
      registry,
      planId: plan.id,
      now: () => new Date("2026-06-08T08:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const job = result.job;
    expect(job.status).toBe("partial");
    expect(job.totals.succeeded).toBe(1);
    expect(job.totals.failed).toBe(1);
    const failed = job.steps.find((s) => s.status === "failed");
    expect(failed?.error).toBe("network");
  });

  it("records an honest SKIPPED step when a binding has no adapter", async () => {
    const store = new MemoryStore();
    const plan = await seedPlan(store, ["cptaq-zone-agricole"]);
    const registry = buildAdapterRegistry([roleEntry()]);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore: createJobsStore(store),
      objectStore: store,
      registry,
      planId: plan.id,
      now: () => new Date("2026-06-08T08:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nothing actually ran → vacuously succeeded, with one skipped step.
    expect(result.job.totals.skipped).toBe(1);
    expect(result.job.steps[0]?.status).toBe("skipped");
  });

  it("refuses to run a disabled plan", async () => {
    const store = new MemoryStore();
    const plan = await seedPlan(store, [ROLE_VF], false);
    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore: createJobsStore(store),
      objectStore: store,
      registry: buildAdapterRegistry([roleEntry()]),
      planId: plan.id,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("plan-disabled");
  });

  it("returns plan-not-found for an unknown plan id", async () => {
    const store = new MemoryStore();
    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore: createJobsStore(store),
      objectStore: store,
      registry: buildAdapterRegistry([roleEntry()]),
      planId: "nope",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("plan-not-found");
  });
});
