/**
 * WP A.3.1 — Graph store unit tests.
 *
 * Tests are split into two tiers:
 *
 *  1. PURE (always run): row builders, Zod parsing, idempotency logic.
 *     No DB required.
 *
 *  2. DB-BOUND (skipped when POSTGRES_HOST is unset): upsert idempotency,
 *     queryNeighbors, subgraphForCity. The orchestrator runs these in series
 *     after the Postgres stack is up (ENV=test-graphdb).
 */

import { describe, it, expect } from "vitest";
import {
  buildNodeRow,
  buildEdgeRow,
  materializeSeveredSources,
  mergeEdgeRows,
  graphifyGraphSchema,
  upsertGraph,
  upsertGraphAtomic,
  findMissingBusinessProperties,
  findMissingSourceRefs,
  countCompleteSignals,
  isCompleteSignalProps,
  queryNeighbors,
  subgraphForCity,
  subgraphForMrc,
  listMrcs,
  isZonageSignal,
  ZONAGE_CATEGORIES,
  deriveEtape,
  isMulti4Plus,
  isPrecoceSignal,
  buildSubsetKey,
  aggregateGraphSignalProjectionRows,
  classifyGraphNodeLegacyZmp,
  classifyResidentielPertinence,
  isResidentielPertinent,
  ETAPE_ORDER,
  ETAPES_PRECOCES,
  type GraphifyNode,
  type GraphifyLink,
} from "./graph-store.js";
import {
  SUTTON_A_IDS,
  SUTTON_LEGACY_GRAPH_NODES,
  SUTTON_TRANSITION_IDS,
} from "./sutton-legacy.fixture.js";
import {
  COATICOOK_A_IDS,
  COATICOOK_LEGACY_GRAPH_NODES,
} from "./coaticook-legacy.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_GRAPH = {
  directed: false,
  multigraph: false,
  nodes: [
    { id: "zone_a", label: "Zone A", file_type: "concept", source_file: "test.md", community: 0 },
    { id: "bylaw_1", label: "Bylaw 1", file_type: "document", source_file: "test.md", community: 1 },
    { id: "lot_x", label: "Lot X", file_type: "concept", source_file: "test.md", community: 0 },
  ],
  links: [
    {
      source: "zone_a",
      target: "bylaw_1",
      relation: "régi_par",
      confidence: "EXTRACTED",
      confidence_score: 1,
      source_file: "test.md",
    },
    {
      source: "lot_x",
      target: "zone_a",
      relation: "dans",
      confidence: "EXTRACTED",
      confidence_score: 0.9,
      source_file: "test.md",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pure tests — always run
// ─────────────────────────────────────────────────────────────────────────────

describe("buildNodeRow", () => {
  it("maps graphify node to DB row", () => {
    const node: GraphifyNode = {
      id: "zone_a",
      label: "Zone A",
      file_type: "concept",
      source_file: "test.md",
      community: 0,
    };
    const row = buildNodeRow(node, "valleyfield");
    expect(row.id).toBe("zone_a");
    expect(row.label).toBe("Zone A");
    expect(row.type).toBe("concept");
    expect(row.citySlug).toBe("valleyfield");
    expect(row.sourceRef).toBe("test.md");
    expect(row.props).toMatchObject({ community: 0, source_file: "test.md" });
  });

  it("defaults type to 'concept' when file_type is absent", () => {
    const node: GraphifyNode = { id: "x", label: "X" };
    const row = buildNodeRow(node, null);
    expect(row.type).toBe("concept");
    expect(row.citySlug).toBeNull();
  });

  // LOT 1 serving (A.2) — persist the DERIVED regulatoryStatus at materialisation (props.properties,
  // recomputed here = single source of truth). firm iff statut/etape adopté/en-vigueur ; sinon
  // anticipation ; aucune preuve → anticipation FAIL-SAFE ; nœud non-règlement → ABSENT (gate).
  const props = (row: ReturnType<typeof buildNodeRow>) =>
    ((row.props as Record<string, unknown>).properties ?? {}) as Record<string, unknown>;
  it("LOT 1 serving — a lifecycle node with etape adoption/entree_vigueur → regulatoryStatus=firm", () => {
    expect(props(buildNodeRow({ id: "b1", label: "R", type: "Bylaw", properties: { etape: "adoption" } } as GraphifyNode, "x")).regulatoryStatus).toBe("firm");
    expect(props(buildNodeRow({ id: "b2", label: "R", type: "Bylaw", properties: { etape: "entree_vigueur" } } as GraphifyNode, "x")).regulatoryStatus).toBe("firm");
  });
  it("LOT 1 serving — an avis/projet lifecycle node → regulatoryStatus=anticipation", () => {
    expect(props(buildNodeRow({ id: "e1", label: "A", type: "DesignationEvent", properties: { etape: "avis_motion" } } as GraphifyNode, "x")).regulatoryStatus).toBe("anticipation");
    expect(props(buildNodeRow({ id: "e2", label: "P", type: "Signal", properties: { etape: "projet_reglement" } } as GraphifyNode, "x")).regulatoryStatus).toBe("anticipation");
  });
  it("LOT 1 serving — a node WITHOUT a stage (no etape/statut) → NO regulatoryStatus persisted (fail-safe = anticipation applied at consumer READ of an absent field)", () => {
    expect(props(buildNodeRow({ id: "b3", label: "R", type: "Bylaw" } as GraphifyNode, "x")).regulatoryStatus).toBeUndefined();
  });
  it("LOT 1 serving — a NON-lifecycle node (concept/zone, no etape) gets NO regulatoryStatus (anti-invention gate)", () => {
    expect(props(buildNodeRow({ id: "z1", label: "Zone", file_type: "concept", properties: { code_zone: "H-1" } } as GraphifyNode, "x")).regulatoryStatus).toBeUndefined();
    expect(props(buildNodeRow({ id: "z2", label: "Zone" } as GraphifyNode, "x")).regulatoryStatus).toBeUndefined();
  });
});

describe("business-property preservation gate", () => {
  const sutton39Keys = [
    "code_zone",
    "usage_permis",
    "densite_max",
    "hauteur_max",
    "lotissement",
    "frontage_min",
    "profondeur_min",
    "superficie_min",
    "marges",
    "reglement_url",
    "reglement_numero",
    "normes_pliees",
    "usage_dominant",
    "effet_densifiant",
    "categorie_zone",
    "classe_zone",
    "affectation",
    "sous_affectation",
    "densite_min",
    "unites_max",
    "unites_min",
    "etages_max",
    "etages_min",
    "stationnement_min",
    "stationnement_max",
    "emprise_max",
    "verdissement_min",
    "marge_avant",
    "marge_arriere",
    "marge_laterale",
    "aire_verte",
    "lotissement_permis",
    "notes",
    "source",
    "source_url",
    "snapshot",
    "feature_id",
    "municipalite",
    "version",
  ];
  const baseline = {
    id: "qc-zonage-saint-gervais:zone:1",
    props: { properties: Object.fromEntries(sutton39Keys.map((key) => [key, `${key}-value`])) },
  };
  const reAcquired = {
    id: baseline.id,
    props: { properties: Object.fromEntries(sutton39Keys.slice(0, 9).map((key) => [key, `${key}-value`])) },
  };

  it("rejects the exact 39-property to 9-property regression", () => {
    const missing = findMissingBusinessProperties([baseline], [reAcquired], "saint-gervais");

    expect(Object.keys(baseline.props.properties)).toHaveLength(39);
    expect(Object.keys(reAcquired.props.properties)).toHaveLength(9);
    expect(missing).toEqual([
      {
        citySlug: "saint-gervais",
        nodeId: baseline.id,
        missingKeys: sutton39Keys.slice(9).sort(),
      },
    ]);
    expect(missing[0]?.missingKeys).toEqual(expect.arrayContaining([
      "reglement_url",
      "reglement_numero",
      "normes_pliees",
      "usage_dominant",
      "effet_densifiant",
    ]));
  });

  it("allows additions and preserves keys whose values are false or zero", () => {
    const before = [{ id: "signal:1", props: { properties: { keep: false, count: 0 } } }];
    const after = [{ id: "signal:1", props: { properties: { keep: false, count: 0, added: "yes" } } }];

    expect(findMissingBusinessProperties(before, after, "testville")).toEqual([]);
  });

  it("rejects a classified value degraded to autre or an empty string", () => {
    const before = [{
      id: "signal:instrument",
      props: { properties: { instrument: "reglement_zonage" } },
    }];

    expect(findMissingBusinessProperties(before, [{
      id: "signal:instrument",
      props: { properties: { instrument: "autre" } },
    }], "testville")).toEqual([{
      citySlug: "testville",
      nodeId: "signal:instrument",
      missingKeys: ["instrument"],
    }]);
    expect(findMissingBusinessProperties(before, [{
      id: "signal:instrument",
      props: { properties: { instrument: "" } },
    }], "testville")).toHaveLength(1);
    expect(findMissingBusinessProperties(before, [{
      id: "signal:instrument",
      props: { properties: { etape: "adoption", effet_densifiant: "autre" } },
    }], "testville")[0]?.missingKeys).toEqual(["instrument"]);
  });

  it("rejects an etape collapsed to the classifier's own fallback", () => {
    // `deriveEtape()` returns "inconnu" when it recognises nothing — never
    // "autre", never "". A sentinel listing only "" and "autre" therefore
    // guarded nothing at all on this key: this exact before/after used to
    // return [].
    const before = [{
      id: "signal:etape",
      props: { properties: { etape: "adoption" } },
    }];
    const after = [{
      id: "signal:etape",
      props: { properties: { etape: "inconnu" } },
    }];

    expect(findMissingBusinessProperties(before, after, "testville")).toEqual([{
      citySlug: "testville",
      nodeId: "signal:etape",
      missingKeys: ["etape"],
    }]);
  });

  it("rejects an effet_densifiant collapsed to the classifier's own fallback", () => {
    // `effectFromSignal()` returns "inconnu"; its only legitimate values are
    // densifie | reduit | stable | inconnu. "autre" is not one of them, so the
    // former sentinel could never fire here either.
    const before = [{
      id: "signal:effet",
      props: { properties: { etape: "adoption", effet_densifiant: "densifie" } },
    }];
    const after = [{
      id: "signal:effet",
      props: { properties: { etape: "inconnu", effet_densifiant: "inconnu" } },
    }];

    expect(findMissingBusinessProperties(before, after, "testville")).toEqual([{
      citySlug: "testville",
      nodeId: "signal:effet",
      missingKeys: ["effet_densifiant", "etape"],
    }]);
  });

  it("stays silent when a classified key was already uninformative", () => {
    // The false-positive check on adding "inconnu": a node that is already
    // unclassified reads as absent on BOTH sides, so re-projecting it — or
    // finally classifying it — reports nothing. Only informative → fallback is
    // a regression.
    const unclassified = [{
      id: "signal:1",
      props: { properties: { etape: "inconnu", effet_densifiant: "inconnu", instrument: "autre" } },
    }];
    const stillUnclassified = [{
      id: "signal:1",
      props: { properties: { etape: "inconnu", effet_densifiant: "inconnu", instrument: "autre" } },
    }];
    const nowClassified = [{
      id: "signal:1",
      props: {
        properties: { etape: "adoption", effet_densifiant: "densifie", instrument: "rezonage" },
      },
    }];

    expect(findMissingBusinessProperties(unclassified, stillUnclassified, "testville")).toEqual([]);
    expect(findMissingBusinessProperties(unclassified, nowClassified, "testville")).toEqual([]);
    // An uninformative value that disappears altogether is not a loss either —
    // there was nothing to lose. The node is exempt on both counts.
    expect(findMissingBusinessProperties(unclassified, [{ id: "signal:1", props: {} }], "testville"))
      .toEqual([]);
  });

  it("leaves the literal value inconnu alone outside the three classified keys", () => {
    // The fallback list is the union of three classifiers' sentinels; it must
    // not become a global blacklist of words. On any other key, "inconnu" is an
    // ordinary string and only its disappearance is a regression.
    const before = [{
      id: "zone:1",
      props: { properties: { statut: "actif", notes: "à vérifier" } },
    }];
    const after = [{
      id: "zone:1",
      props: { properties: { statut: "inconnu", notes: "inconnu" } },
    }];

    expect(findMissingBusinessProperties(before, after, "testville")).toEqual([]);
    expect(findMissingBusinessProperties(before, [{
      id: "zone:1",
      props: { properties: { statut: "inconnu" } },
    }], "testville")).toEqual([{
      citySlug: "testville",
      nodeId: "zone:1",
      missingKeys: ["notes"],
    }]);
  });

  // Counter-examples: the degradation rule must NOT fire outside the three
  // classified keys, or a legitimate re-projection of a whole city is refused.
  it("accepts a zone whose kind legitimately becomes autre (REC-137)", () => {
    // `zoneKindOf("REC-137")` returns "autre" on purpose: REC is a real
    // multi-letter family, and "autre" is a member of the ZoneKind enum. A
    // re-acquisition that re-classifies H → autre loses no business value.
    const before = [{
      id: "qc-zonage-testville:zone:rec-137",
      props: { properties: { code_affiche: "REC-137", kind: "H" } },
    }];
    const after = [{
      id: "qc-zonage-testville:zone:rec-137",
      props: { properties: { code_affiche: "REC-137", kind: "autre" } },
    }];

    expect(findMissingBusinessProperties(before, after, "testville")).toEqual([]);
  });

  it("accepts an intentional textual deletion outside the classified keys", () => {
    const before = [{ id: "zone:1", props: { properties: { notes: "obsolète" } } }];
    const after = [{ id: "zone:1", props: { properties: { notes: "" } } }];

    expect(findMissingBusinessProperties(before, after, "testville")).toEqual([]);
  });

  it("still rejects any key that disappears entirely, classified or not", () => {
    const before = [{ id: "zone:1", props: { properties: { notes: "obsolète", kind: "H" } } }];
    const after = [{ id: "zone:1", props: { properties: { kind: "autre" } } }];

    expect(findMissingBusinessProperties(before, after, "testville")).toEqual([{
      citySlug: "testville",
      nodeId: "zone:1",
      missingKeys: ["notes"],
    }]);
  });

  // ── intendedRemovals — removal-only reprojections (purge-avis-bylaws) ─────────
  // The anti-silent-deletion rule treats a whole node absent from `after` as an
  // empty prop map → all its business keys read as missing → regression. That is
  // correct for an ACCIDENTAL drop, but a removal-only tool deletes nodes ON
  // PURPOSE. `intendedRemovals` exempts exactly those nodeIds; the guard stays
  // armed for every other node.
  it("flags a business-bearing node that disappears entirely (anti-silent-deletion base case)", () => {
    // saint-ours reproduction: deleting a Bylaw with business props aborts by
    // default (no intendedRemovals) — its numero/stage/municipality vanish.
    const before = [{
      id: "bylaw-x-326-2026",
      props: { properties: { numero: "326-2026", stage: "avis", municipality: "x" } },
    }];
    const after: { id: string; props: Record<string, unknown> }[] = [];
    expect(findMissingBusinessProperties(before, after, "x")).toEqual([{
      citySlug: "x",
      nodeId: "bylaw-x-326-2026",
      missingKeys: ["municipality", "numero", "stage"],
    }]);
  });

  it("exempts a node listed in intendedRemovals from the disappearance check", () => {
    const before = [{
      id: "bylaw-x-326-2026",
      props: { properties: { numero: "326-2026", stage: "avis", municipality: "x" } },
    }];
    const after: { id: string; props: Record<string, unknown> }[] = [];
    expect(
      findMissingBusinessProperties(before, after, "x", new Set(["bylaw-x-326-2026"])),
    ).toEqual([]);
  });

  it("keeps the guard armed for a disappearing node NOT in intendedRemovals", () => {
    // Only the explicitly-intended node is exempt; a different node dropping its
    // business props is still a regression (accidental-drop / drift protection).
    const before = [
      { id: "bylaw-x-326-2026", props: { properties: { numero: "326-2026", stage: "avis" } } },
      { id: "bylaw-x-999-2020", props: { properties: { numero: "999-2020", stage: "adopte" } } },
    ];
    const after: { id: string; props: Record<string, unknown> }[] = [];
    expect(
      findMissingBusinessProperties(before, after, "x", new Set(["bylaw-x-326-2026"])),
    ).toEqual([{
      citySlug: "x",
      nodeId: "bylaw-x-999-2020",
      missingKeys: ["numero", "stage"],
    }]);
  });
});

describe("source-ref provenance gate (gate3) — findMissingSourceRefs", () => {
  const withRefs = (id: string, refs: unknown[]) => ({ id, props: { refs } });

  it("no regression when the candidate preserves the node's source docSha", () => {
    const before = [withRefs("sig:1", [{ docSha: "SHA_PV" }])];
    const after = [withRefs("sig:1", [{ docSha: "SHA_PV" }])];
    expect(findMissingSourceRefs(before, after, "x")).toEqual([]);
  });

  it("flags a node whose source docSha would DISAPPEAR (the PV-ref loss)", () => {
    const before = [withRefs("sig:1", [{ docSha: "SHA_PV" }])];
    const after = [withRefs("sig:1", [])];
    expect(findMissingSourceRefs(before, after, "ste-martine")).toEqual([
      { citySlug: "ste-martine", nodeId: "sig:1", missingDocShas: ["SHA_PV"] },
    ]);
  });

  it("flags a count-preserving SWAP that gate2 misses (PV docSha replaced by another complete ref)", () => {
    const before = [withRefs("sig:1", [{ docSha: "SHA_PV", excerpt: "x" }])];
    // same node, ref swapped to a DIFFERENT docSha — the "complete" count is
    // preserved (gate2 blind), but the PV provenance is lost.
    const after = [withRefs("sig:1", [{ docSha: "SHA_OTHER", excerpt: "y" }])];
    expect(findMissingSourceRefs(before, after, "x")).toEqual([
      { citySlug: "x", nodeId: "sig:1", missingDocShas: ["SHA_PV"] },
    ]);
  });

  it("allows ADDITIONS — keeping the source and adding a grounding ref does not regress", () => {
    const before = [withRefs("sig:1", [{ docSha: "SHA_PV" }])];
    const after = [withRefs("sig:1", [{ docSha: "SHA_PV" }, { docSha: "SHA_GROUNDING", excerpt: "cited" }])];
    expect(findMissingSourceRefs(before, after, "x")).toEqual([]);
  });

  it("exempts a node listed in intendedRemovals", () => {
    const before = [withRefs("sig:1", [{ docSha: "SHA_PV" }])];
    const after = [withRefs("sig:1", [])];
    expect(findMissingSourceRefs(before, after, "x", new Set(["sig:1"]))).toEqual([]);
  });

  it("recovers the docSha from the CAS rawRef path when the docSha field is absent", () => {
    const before = [withRefs("sig:1", [{ rawRef: "raw/proces-verbaux-x/cas/SHA_FROM_PATH.pdf" }])];
    const after = [withRefs("sig:1", [])];
    expect(findMissingSourceRefs(before, after, "x")).toEqual([
      { citySlug: "x", nodeId: "sig:1", missingDocShas: ["SHA_FROM_PATH"] },
    ]);
  });

  it("excludes generated:// placeholder refs (gen_refs are not real provenance)", () => {
    const before = [withRefs("sig:1", [{ rawRef: "generated://gen_refs/whatever" }])];
    const after = [withRefs("sig:1", [])];
    expect(findMissingSourceRefs(before, after, "x")).toEqual([]);
  });

  it("keys on docSha ALONE, not (docSha, page) — a page refinement for the same doc is not a regression", () => {
    const before = [withRefs("sig:1", [{ docSha: "SHA_PV", page: 1 }])];
    const after = [withRefs("sig:1", [{ docSha: "SHA_PV", page: 10 }])];
    expect(findMissingSourceRefs(before, after, "x")).toEqual([]);
  });

  it("ignores nodes that carried no source ref before (nothing to protect)", () => {
    const before = [withRefs("sig:1", [])];
    const after = [withRefs("sig:1", [])];
    expect(findMissingSourceRefs(before, after, "x")).toEqual([]);
  });
});

describe("Sutton immutable legacy projection", () => {
  it("keeps normalized aggregate counts and detail IDs identical", () => {
    const rows = SUTTON_LEGACY_GRAPH_NODES.map((node) => buildNodeRow(node, "sutton"));
    const aggregate = aggregateGraphSignalProjectionRows(rows)[0]!;
    const memberships = rows.map(classifyGraphNodeLegacyZmp);
    const aIds = memberships.filter(({ flags }) => flags.z && flags.m && flags.p).map(({ signalId }) => signalId);
    const transitionIds = memberships.filter(({ flags }) => flags.z && flags.p).map(({ signalId }) => signalId);

    expect(rows).toHaveLength(5);
    expect(aIds).toEqual(SUTTON_A_IDS);
    expect(transitionIds).toEqual(SUTTON_TRANSITION_IDS);
    expect(aggregate.subsetCounts["z|m|p"]).toBe(aIds.length);
    expect(aggregate.subsetCounts["z|p"]).toBe(transitionIds.length);
  });
});

describe("Coaticook immutable legacy projection", () => {
  it("keeps numeric nb_unites_max from the real snapshot in A", () => {
    const rows = COATICOOK_LEGACY_GRAPH_NODES.map((node) => buildNodeRow(node, "coaticook"));
    const aggregate = aggregateGraphSignalProjectionRows(rows)[0]!;
    const membership = classifyGraphNodeLegacyZmp(rows[0]!);

    expect(membership.flags).toEqual({ z: true, m: true, p: true });
    expect(aggregate.subsetCounts["z|m|p"]).toBe(1);
    expect([membership.signalId]).toEqual(COATICOOK_A_IDS);
  });
});

describe("B-prime residential-axis counts", () => {
  it("preserves legacy z|m|p counts while excluding commercial noise only from r", () => {
    const rows = [
      {
        id: "early",
        citySlug: "bprime",
        type: "Signal",
        category: "rezonage",
        label: "Avis de motion — projet résidentiel",
        etapeAnnote: "avis_motion",
        props: { properties: { category: "rezonage", etape: "avis_motion" } },
        sourceRef: null,
      },
      {
        id: "invalid-annotation",
        citySlug: "bprime",
        type: "Signal",
        category: "rezonage",
        label: "Avis de motion — annotation invalide",
        etapeAnnote: "",
        props: { properties: { category: "rezonage", etape: "" } },
        sourceRef: null,
      },
      {
        id: "industrial",
        citySlug: "bprime",
        type: "Signal",
        category: "rezonage",
        label: "Densification du parc industriel",
        etapeAnnote: "avis_motion",
        props: { properties: { category: "rezonage", etape: "avis_motion" } },
        sourceRef: null,
      },
      {
        id: "regional-pole",
        citySlug: "bprime",
        type: "Signal",
        category: "rezonage",
        label: "Pôle commercial régional — projet résidentiel",
        etapeAnnote: "avis_motion",
        props: {
          properties: { category: "rezonage", etape: "avis_motion" },
          extrait: "Pôle commercial régional",
        },
        sourceRef: "pv-42",
      },
    ];

    const aggregate = aggregateGraphSignalProjectionRows(rows)[0]!;

    expect(aggregate.signalCount).toBe(4);
    // Legacy A is immutable: commercial/industrial records stay in z|m|p.
    expect(aggregate.subsetCounts[""]).toBe(4);
    expect(aggregate.subsetCounts["z"]).toBe(4);
    expect(aggregate.subsetCounts["p"]).toBe(4);
    expect(aggregate.subsetCounts["z|p"]).toBe(4);
    // B′ exclusion applies to B's shared classification and to r intersections.
    expect(aggregate.subsetCounts["r"]).toBe(2);
    expect(aggregate.subsetCounts["z|r"]).toBe(2);
    expect(aggregate.subsetCounts["p|r"]).toBe(2);
    expect(aggregate.subsetCounts["z|p|r"]).toBe(2);
    expect(aggregate.vivierV2Counts).toMatchObject({
      qualified: 1,
      excludedByReason: { non_residentiel_franc: 2 },
      total: 4,
    });
    // Empty annotations keep A's historic fallback to label-derived precocity.
    expect(isPrecoceSignal("", "Avis de motion — annotation invalide", null)).toBe(true);
  });
});

describe("server-side signal date windows", () => {
  const datedSignal = (id: string, props: Record<string, unknown>) => ({
    id,
    citySlug: "date-city",
    type: "Signal",
    category: "rezonage",
    label: "Avis de motion — projet résidentiel",
    nbUnitesMax: "8",
    intensite: null,
    description: null,
    etapeAnnote: "avis_motion",
    props: {
      ...props,
      properties: {
        category: "rezonage",
        etape: "avis_motion",
        nb_unites_max: "8",
        ...(typeof props.properties === "object" && props.properties !== null
          ? props.properties
          : {}),
      },
    },
    sourceRef: null,
  });

  it("filters every projection rail using the JSONB date-key precedence", () => {
    const rows = [
      datedSignal("nested-camel-in", { properties: { etapeDate: "2026-01-10" } }),
      datedSignal("nested-snake-in", { properties: { etape_date: "2026-02-10" } }),
      datedSignal("nested-meeting-in", {
        properties: { meetingDate: "2026-03-31T23:59:59.999Z" },
      }),
      datedSignal("published-fallback-in", { publishedAt: "2026-02-20" }),
      datedSignal("root-date-in", { meeting_date: "2026-03-01" }),
      datedSignal("nested-out", { properties: { meeting_date: "2026-04-10" } }),
      datedSignal("nested-document-out", { properties: { documentDate: "2026-04-10" } }),
      datedSignal("nested-date-out", { properties: { date: "2026-04-10" } }),
      datedSignal("no-date", {}),
      datedSignal("invalid-date", { properties: { date: "not-a-date" } }),
      datedSignal("nested-wins", {
        properties: { etapeDate: "2025-12-01", date: "2026-02-01" },
        date: "2026-02-01",
      }),
    ];

    const aggregate = aggregateGraphSignalProjectionRows(rows, {
      dateFrom: "2026-01-01",
      dateTo: "2026-03-31",
    })[0]!;

    expect(aggregate.signalCount).toBe(5);
    expect(aggregate.subsetCounts["z|m|p"]).toBe(5);
    expect(aggregate.vivierV2Counts).toMatchObject({ total: 5, qualified: 5 });
  });

  it("keeps all rows when no date window is supplied", () => {
    const rows = [
      datedSignal("dated", { properties: { date: "2025-01-01" } }),
      datedSignal("undated", {}),
    ];

    const aggregate = aggregateGraphSignalProjectionRows(rows)[0]!;

    expect(aggregate.signalCount).toBe(2);
    expect(aggregate.subsetCounts["z|m|p"]).toBe(2);
    expect(aggregate.vivierV2Counts.total).toBe(2);
  });
});

describe("buildEdgeRow", () => {
  it("maps graphify link to DB edge row", () => {
    const link: GraphifyLink = {
      source: "zone_a",
      target: "bylaw_1",
      relation: "régi_par",
      confidence: "EXTRACTED",
      confidence_score: 1,
    };
    const row = buildEdgeRow(link);
    expect(row.srcId).toBe("zone_a");
    expect(row.dstId).toBe("bylaw_1");
    expect(row.kind).toBe("régi_par");
    expect(row.props).toMatchObject({ confidence: "EXTRACTED", confidence_score: 1 });
  });
});

describe("graphifyGraphSchema", () => {
  it("parses a valid graph.json", () => {
    const result = graphifyGraphSchema.safeParse(FIXTURE_GRAPH);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.nodes).toHaveLength(3);
    expect(result.data.links).toHaveLength(2);
  });

  it("accepts `edges` key in place of `links`", () => {
    const g = { nodes: FIXTURE_GRAPH.nodes, edges: FIXTURE_GRAPH.links };
    const result = graphifyGraphSchema.safeParse(g);
    expect(result.success).toBe(true);
  });

  it("rejects input without nodes", () => {
    const result = graphifyGraphSchema.safeParse({ links: [] });
    expect(result.success).toBe(false);
  });

  it("accepts graph with no links/edges (nodes-only snapshot)", () => {
    const result = graphifyGraphSchema.safeParse({ nodes: [] });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// graphify v2 (SCW) format tests — `type` instead of `file_type`, `type` on
// edges, `status`/`description`/`refs` on nodes.
// ─────────────────────────────────────────────────────────────────────────────

/** Fixture: real-world shape from graph/drummondville/latest.json (SCW). */
const FIXTURE_GRAPH_V2 = {
  ville: "drummondville",
  generatedAt: "2026-06-12",
  nodes: [
    {
      id: "drummondville:ppcmoi:0349-04-26",
      type: "DesignationEvent",
      label: "PPCMOI 0349/04/26 — 2130 bd Lemire (15 logements)",
      status: "candidate",
      description: "PPCMOI résolution 0349/04/26 : autorisation habitation multifamiliale H-6.",
      refs: [{ file: "abc123.pdf", page: 1 }],
    },
    {
      id: "drummondville:signal:densification-logement-2026",
      type: "Signal",
      label: "Signal densification résidentielle Drummondville 2026",
      status: "candidate",
    },
    {
      id: "drummondville:bylaw:4300",
      type: "Bylaw",
      label: "Règlement 4300",
      status: "candidate",
    },
  ],
  edges: [
    {
      source: "drummondville:ppcmoi:0349-04-26",
      type: "concerns",
      target: "drummondville:bylaw:4300",
    },
  ],
};

/** Fixture: abercorn edge format (type-keyed edges, no relation). */
const FIXTURE_GRAPH_V2_ABERCORN = {
  nodes: [
    { id: "mun:abercorn", type: "Municipality", label: "Village d'Abercorn", status: "candidate" },
    { id: "bylaw:abercorn:398-2026", type: "Bylaw", label: "Règlement 398-2026", status: "candidate" },
  ],
  edges: [
    { type: "located_in", source: "adresse:abercorn:33-rue-thibault-sud", target: "mun:abercorn" },
  ],
};

/** Fixture: manual extraction shape produced by graphify fan-out agents. */
const FIXTURE_GRAPH_MANUAL = {
  nodes: [
    {
      id: "src:proces-verbaux-pincourt",
      type: "Source",
      label: "Proces-verbaux Pincourt",
      properties: { slug: "proces-verbaux-pincourt" },
    },
    {
      id: "bylaw:pincourt:943-01",
      type: "Bylaw",
      label: "Reglement no 943-01",
      status: "candidate",
      properties: { number: "943-01", parentBylaw: "943" },
    },
  ],
  edges: [
    {
      from: "src:proces-verbaux-pincourt",
      to: "bylaw:pincourt:943-01",
      relation: "located_in",
      properties: { evidence: "index municipal" },
    },
    {
      from: "src:proces-verbaux-pincourt",
      to: "bylaw:pincourt:943-01",
      type: "mentions",
      refs: [{ excerpt: "ADOPTION DU REGLEMENT NO 943-01" }],
    },
  ],
};

describe("graphify v2 — node schema with `type` field", () => {
  it("parses a v2 node using `type` instead of `file_type`", () => {
    const result = graphifyGraphSchema.safeParse(FIXTURE_GRAPH_V2);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.nodes).toHaveLength(3);
    const de = result.data.nodes[0]!;
    expect(de.type).toBe("DesignationEvent");
    expect(de.status).toBe("candidate");
    expect(de.description).toBeDefined();
    expect(de.refs).toHaveLength(1);
  });

  it("buildNodeRow maps `type` field when `file_type` is absent", () => {
    const node = FIXTURE_GRAPH_V2.nodes[0]!;
    const row = buildNodeRow(node, "drummondville");
    expect(row.type).toBe("DesignationEvent");
    expect(row.label).toBe("PPCMOI 0349/04/26 — 2130 bd Lemire (15 logements)");
    expect(row.citySlug).toBe("drummondville");
    expect(row.props).toMatchObject({ status: "candidate", description: expect.any(String) });
  });

  it("buildNodeRow prefers `file_type` over `type` when both present (v1 wins)", () => {
    const node = { id: "x", label: "X", file_type: "document", type: "Signal" };
    const row = buildNodeRow(node, "testville");
    expect(row.type).toBe("document"); // file_type takes priority
  });

  it("buildNodeRow defaults to 'concept' when neither file_type nor type present", () => {
    const node = { id: "x", label: "X" };
    const row = buildNodeRow(node, null);
    expect(row.type).toBe("concept");
  });

  it("buildNodeRow accepts node without label (Source nodes in v2)", () => {
    // graphify v2 Source nodes sometimes omit label entirely.
    const node = { id: "src:abc123", type: "Source", label: "" };
    const row = buildNodeRow(node, "kazabazua");
    expect(row.label).toBe(""); // default from Zod schema
    expect(row.type).toBe("Source");
    expect(row.citySlug).toBe("kazabazua");
  });
});

describe("graphify v2 — edge schema with `type` field", () => {
  it("parses edges using `type` as relation (abercorn format)", () => {
    const result = graphifyGraphSchema.safeParse(FIXTURE_GRAPH_V2_ABERCORN);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.edges).toHaveLength(1);
    const e = result.data.edges![0]!;
    expect(e.type).toBe("located_in");
    expect(e.relation).toBeUndefined();
  });

  it("buildEdgeRow uses `type` as kind when `relation` is absent (v2)", () => {
    const link = { source: "a", target: "b", type: "located_in" };
    const row = buildEdgeRow(link);
    expect(row.kind).toBe("located_in");
    expect(row.srcId).toBe("a");
    expect(row.dstId).toBe("b");
  });

  it("buildEdgeRow prefers `relation` over `type` when both present (v1 wins)", () => {
    const link = { source: "a", target: "b", relation: "régi_par", type: "something_else" };
    const row = buildEdgeRow(link);
    expect(row.kind).toBe("régi_par");
  });

  it("rejects edge with neither `relation` nor `type`", () => {
    const bad = { nodes: [], edges: [{ source: "a", target: "b" }] };
    const result = graphifyGraphSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("manual graphify fan-out compatibility", () => {
  it("normalizes `from`/`to` edges into source/target", () => {
    const result = graphifyGraphSchema.safeParse(FIXTURE_GRAPH_MANUAL);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.edges).toHaveLength(2);
    expect(result.data.edges![0]).toMatchObject({
      source: "src:proces-verbaux-pincourt",
      target: "bylaw:pincourt:943-01",
      relation: "located_in",
    });
  });

  it("preserves node and edge properties in DB props", () => {
    const parsed = graphifyGraphSchema.parse(FIXTURE_GRAPH_MANUAL);
    const nodeRow = buildNodeRow(parsed.nodes[1]!, "pincourt");
    const edgeRow = buildEdgeRow(parsed.edges![0]!);

    expect(nodeRow.props).toMatchObject({
      status: "candidate",
      properties: {
        number: "943-01",
        parentBylaw: "943",
      },
    });
    expect(edgeRow.props).toMatchObject({
      properties: { evidence: "index municipal" },
    });
  });

  it("parses graphs that include both `links` and `edges`", () => {
    const result = graphifyGraphSchema.safeParse({
      nodes: FIXTURE_GRAPH_MANUAL.nodes,
      links: [
        {
          source: "mun:pincourt",
          target: "bylaw:pincourt:943-01",
          relation: "governed_by",
        },
      ],
      edges: FIXTURE_GRAPH_MANUAL.edges,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.links).toHaveLength(1);
    expect(result.data.edges).toHaveLength(2);
  });
});

describe("graphify v2 — full graph upsert mapping (no DB)", () => {
  it("buildNodeRow and buildEdgeRow process a full v2 graph without throwing", () => {
    const parsed = graphifyGraphSchema.parse(FIXTURE_GRAPH_V2);
    const edges = parsed.links ?? parsed.edges ?? [];
    const nodeRows = parsed.nodes.map((n) => buildNodeRow(n, "drummondville"));
    const edgeRows = edges.map(buildEdgeRow);
    expect(nodeRows).toHaveLength(3);
    expect(edgeRows).toHaveLength(1);
    expect(nodeRows.map((r) => r.type)).toContain("Signal");
    expect(nodeRows.map((r) => r.type)).toContain("DesignationEvent");
    expect(edgeRows[0]!.kind).toBe("concerns");
  });

  it("skips graphs without a valid `nodes` array (résumé format)", () => {
    const summary = {
      city: "blue-sea",
      generatedAt: "2026-06-12",
      pvCount: 11,
      stats: { nodes: 12 },
      signalsByKind: {},
    };
    const result = graphifyGraphSchema.safeParse(summary);
    // Must fail because `nodes` is missing.
    expect(result.success).toBe(false);
  });
});

describe("buildNodeRow — idempotency key", () => {
  it("produces same id for same node regardless of citySlug", () => {
    const node: GraphifyNode = { id: "zone_a", label: "Zone A" };
    const r1 = buildNodeRow(node, "valleyfield");
    const r2 = buildNodeRow(node, "valleyfield");
    expect(r1.id).toBe(r2.id);
    expect(r1.label).toBe(r2.label);
  });
});

describe("buildEdgeRow — idempotency key", () => {
  it("produces same (srcId, dstId, kind) for same link", () => {
    const link: GraphifyLink = { source: "a", target: "b", relation: "r" };
    const r1 = buildEdgeRow(link);
    const r2 = buildEdgeRow(link);
    expect(`${r1.srcId}|${r1.dstId}|${r1.kind}`).toBe(`${r2.srcId}|${r2.dstId}|${r2.kind}`);
  });
});

describe("materializeSeveredSources — re-attach the source dropped by projection", () => {
  const bylawLink: GraphifyLink = {
    source: "event-x-adoption-026-511",
    target: "bylaw-x-026-511",
    type: "derived_from",
    refs: [{ docSha: "SHA_PV" }],
  };

  it("copies the derived_from edge docSha onto a phantom Signal (sourceRef + props.refs)", () => {
    const rows = [buildNodeRow({ id: "event-x-adoption-026-511", label: "Adoption 026-511", type: "Signal" })];
    const { materialized } = materializeSeveredSources(rows, [bylawLink], []);
    expect(materialized).toBe(1);
    expect(rows[0]!.sourceRef).toBe("SHA_PV");
    expect(rows[0]!.props.refs).toEqual([
      { docSha: "SHA_PV", linkSource: "projection-materialize-severed" },
    ]);
  });

  it("is idempotent — a node that already carries a source is left untouched", () => {
    const rows = [
      buildNodeRow({
        id: "event-x-adoption-026-511",
        label: "Adoption 026-511",
        type: "Signal",
        source_file: "PRE_EXISTING",
      }),
    ];
    const { materialized } = materializeSeveredSources(rows, [bylawLink], []);
    expect(materialized).toBe(0);
    expect(rows[0]!.sourceRef).toBe("PRE_EXISTING");
  });

  it("only touches Signal|DesignationEvent — never a Bylaw/Source node", () => {
    const rows = [buildNodeRow({ id: "bylaw-x-026-511", label: "Règlement 026-511", type: "Bylaw" })];
    const { materialized } = materializeSeveredSources(
      rows,
      [{ source: "bylaw-x-026-511", target: "source-x", type: "cites", refs: [{ docSha: "SHA_PV" }] }],
      [],
    );
    expect(materialized).toBe(0);
    expect(rows[0]!.sourceRef).toBeNull();
  });

  it("leaves a phantom untouched when no edge carries a docSha (data-side remediation, not invented)", () => {
    const rows = [buildNodeRow({ id: "event-x-piia-0007", label: "PIIA — 853 chemin Rhéaume", type: "DesignationEvent" })];
    const { materialized } = materializeSeveredSources(
      rows,
      [{ source: "event-x-piia-0007", target: "bylaw-x", type: "derived_from" }],
      [],
    );
    expect(materialized).toBe(0);
    expect(rows[0]!.sourceRef).toBeNull();
    expect(rows[0]!.props.refs).toBeUndefined();
  });
});

describe("mergeEdgeRows", () => {
  it("merges duplicate natural keys and preserves distinct refs", () => {
    const rows = [
      buildEdgeRow({
        source: "muni-grenville-grenville",
        target: "bylaw-grenville-255-2007",
        type: "governed_by",
        refs: [{ docSha: "a", page: 1 }],
      }),
      buildEdgeRow({
        source: "muni-grenville-grenville",
        target: "bylaw-grenville-255-2007",
        type: "governed_by",
        refs: [{ docSha: "b", page: 2 }],
      }),
      buildEdgeRow({
        source: "muni-grenville-grenville",
        target: "bylaw-grenville-255-2007",
        type: "governed_by",
        refs: [{ docSha: "a", page: 1 }],
      }),
    ];

    const merged = mergeEdgeRows(rows);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.props.refs).toEqual([
      { docSha: "a", page: 1 },
      { docSha: "b", page: 2 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2bis. Completeness gate — pure (no DB)
// ─────────────────────────────────────────────────────────────────────────────

describe("isCompleteSignalProps", () => {
  it("true quand une ref porte citation/excerpt ET rawRef", () => {
    expect(
      isCompleteSignalProps({ refs: [{ excerpt: "ADOPTION 943-01", rawRef: "abc.pdf" }] }),
    ).toBe(true);
    expect(
      isCompleteSignalProps({ refs: [{ citation: "extrait", file: "doc.pdf" }] }),
    ).toBe(true);
  });

  it("false quand une ref n'a que la citation (pas de preuve PDF)", () => {
    expect(isCompleteSignalProps({ refs: [{ excerpt: "ADOPTION 943-01" }] })).toBe(false);
  });

  it("false quand une ref n'a que le rawRef (pas de citation)", () => {
    expect(isCompleteSignalProps({ refs: [{ rawRef: "abc.pdf" }] })).toBe(false);
    // ref string nue = rawRef seul → insuffisant
    expect(isCompleteSignalProps({ refs: ["abc.pdf"] })).toBe(false);
  });

  it("false quand pas de refs du tout", () => {
    expect(isCompleteSignalProps({})).toBe(false);
    expect(isCompleteSignalProps({ refs: [] })).toBe(false);
  });

  it("true quand citation+rawRef portés au niveau racine des props (repli)", () => {
    expect(isCompleteSignalProps({ excerpt: "extrait", rawRef: "x.pdf" })).toBe(true);
  });

  it("vrai dès qu'AU MOINS une ref est complète parmi plusieurs", () => {
    expect(
      isCompleteSignalProps({
        refs: [{ rawRef: "a.pdf" }, { excerpt: "ok", file: "b.pdf" }],
      }),
    ).toBe(true);
  });
});

describe("countCompleteSignals", () => {
  it("ne compte que les Signal/DesignationEvent complets", () => {
    const rows = [
      { type: "Signal", props: { refs: [{ excerpt: "c", rawRef: "a.pdf" }] } }, // complet
      { type: "DesignationEvent", props: { refs: [{ citation: "c", file: "b.pdf" }] } }, // complet
      { type: "Signal", props: { refs: [{ rawRef: "x.pdf" }] } }, // incomplet (pas de citation)
      { type: "Bylaw", props: { refs: [{ excerpt: "c", rawRef: "z.pdf" }] } }, // pas un signal
    ];
    expect(countCompleteSignals(rows)).toBe(2);
  });

  it("retourne 0 pour une liste vide", () => {
    expect(countCompleteSignals([])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. MRC aggregation — pure (mock DB, no Postgres)
// ─────────────────────────────────────────────────────────────────────────────
// These tests stub the Database at the Drizzle builder level using simple
// inline mocks. They exercise QC_MUNICIPALITIES look-up logic and routing
// without requiring Postgres.

describe("subgraphForMrc — unknown MRC returns empty", () => {
  it("returns empty when MRC not in QC_MUNICIPALITIES", async () => {
    // We need a db that will never be queried for the empty-cities path.
    // Build a minimal db mock that returns empty arrays unconditionally.
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
      selectDistinct: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await subgraphForMrc(db as any, "__mrc_that_does_not_exist__");
    expect(result.citySlugs).toHaveLength(0);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});

describe("subgraphForMrc — known MRC with no ingested data returns empty", () => {
  it("returns empty nodes array when DB has no rows for MRC cities", async () => {
    // "Beauharnois-Salaberry" is a real MRC in QC_MUNICIPALITIES.
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await subgraphForMrc(db as any, "Beauharnois-Salaberry");
    // citySlugs should be populated (cities exist in QC_MUNICIPALITIES).
    expect(result.citySlugs.length).toBeGreaterThan(0);
    // But nodes should be empty (nothing in DB).
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.mrc).toBe("Beauharnois-Salaberry");
  });
});

describe("listMrcs — pure: returns empty when DB has no nodes", () => {
  it("returns empty array when no graph nodes exist", async () => {
    const db = {
      selectDistinct: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listMrcs(db as any);
    expect(result).toEqual([]);
  });
});

describe("subgraphForMrc — QC_MUNICIPALITIES MRC membership", () => {
  it("Beauharnois-Salaberry contains salaberry-de-valleyfield and beauharnois", async () => {
    const { QC_MUNICIPALITIES } = await import("@radar/sources");
    const cities = QC_MUNICIPALITIES.filter((m) => m.mrc === "Beauharnois-Salaberry");
    const slugs = cities.map((c) => c.slug);
    expect(slugs).toContain("salaberry-de-valleyfield");
    expect(slugs).toContain("beauharnois");
  });

  it("Roussillon contains sainte-catherine and saint-constant", async () => {
    const { QC_MUNICIPALITIES } = await import("@radar/sources");
    const cities = QC_MUNICIPALITIES.filter((m) => m.mrc === "Roussillon");
    const slugs = cities.map((c) => c.slug);
    expect(slugs).toContain("sainte-catherine");
    expect(slugs).toContain("saint-constant");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. queryNeighbors — pure mock (N+1 fix)
//
// Vérifie que queryNeighbors charge les nœuds voisins en UNE seule requête
// inArray, et non par un SELECT par arête (ancien comportement N+1).
// Le mock compte les appels .where() sur graphNodes pour détecter la régression.
// ─────────────────────────────────────────────────────────────────────────────

describe("queryNeighbors — fix N+1 : un seul inArray pour les nœuds voisins", () => {
  it("retourne les voisins out/in avec un seul SELECT sur graphNodes", async () => {
    // Arêtes renvoyées par les deux premiers SELECT (outEdges + inEdges)
    const outEdgesFixture = [
      { srcId: "zone_a", dstId: "bylaw_1", kind: "régi_par", id: "e1", props: {}, createdAt: new Date() },
    ];
    const inEdgesFixture = [
      { srcId: "lot_x", dstId: "zone_a", kind: "dans", id: "e2", props: {}, createdAt: new Date() },
    ];
    // Nœuds renvoyés par le SELECT inArray (un seul appel attendu)
    const nodesFixture = [
      { id: "bylaw_1", label: "Bylaw 1", type: "document", citySlug: "valleyfield", props: {}, sourceRef: null, createdAt: new Date() },
      { id: "lot_x",   label: "Lot X",   type: "concept",  citySlug: "valleyfield", props: {}, sourceRef: null, createdAt: new Date() },
    ];

    let nodeSelectCount = 0;
    let callIdx = 0;
    // Séquence d'appels db.select() :
    //   0 → outEdges (where srcId = nodeId)
    //   1 → inEdges  (where dstId = nodeId)
    //   2 → inArray  (unique SELECT des nœuds voisins)
    const responses = [outEdgesFixture, inEdgesFixture, nodesFixture];

    const db = {
      select: () => {
        const idx = callIdx++;
        const isNodeSelect = idx === 2;
        if (isNodeSelect) nodeSelectCount++;
        return {
          from: () => ({
            where: () => Promise.resolve(responses[idx] ?? []),
          }),
        };
      },
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await queryNeighbors(db as any, "zone_a");

    // Un seul SELECT sur graphNodes pour tous les voisins
    expect(nodeSelectCount).toBe(1);

    // Résultats corrects
    const outNeighbors = result.filter((n) => n.direction === "out");
    const inNeighbors  = result.filter((n) => n.direction === "in");
    expect(outNeighbors).toHaveLength(1);
    expect(inNeighbors).toHaveLength(1);
    expect(outNeighbors[0]!.node.id).toBe("bylaw_1");
    expect(inNeighbors[0]!.node.id).toBe("lot_x");
  });

  it("retourne un tableau vide quand il n'y a aucune arête", async () => {
    let callIdx = 0;
    const db = {
      select: () => {
        callIdx++;
        return {
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        };
      },
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await queryNeighbors(db as any, "node_orphelin");
    // Aucune arête → pas de SELECT sur graphNodes (court-circuit)
    expect(callIdx).toBe(2); // seulement outEdges + inEdges
    expect(result).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. isZonageSignal — pure logic tests (no DB required)
// ─────────────────────────────────────────────────────────────────────────────

describe("isZonageSignal", () => {
  it("DesignationEvent est toujours zonage (quelle que soit la catégorie)", () => {
    expect(isZonageSignal("DesignationEvent", null)).toBe(true);
    expect(isZonageSignal("DesignationEvent", undefined)).toBe(true);
    expect(isZonageSignal("DesignationEvent", "acquisition_fonciere")).toBe(true);
    expect(isZonageSignal("DesignationEvent", "rezonage")).toBe(true);
  });

  it("Signal avec catégorie ZONAGE → true", () => {
    for (const cat of ZONAGE_CATEGORIES) {
      expect(isZonageSignal("Signal", cat)).toBe(true);
    }
  });

  it("Signal sans catégorie → false", () => {
    expect(isZonageSignal("Signal", null)).toBe(false);
    expect(isZonageSignal("Signal", undefined)).toBe(false);
    expect(isZonageSignal("Signal", "")).toBe(false);
  });

  it("Signal avec catégorie NON-zonage → false", () => {
    expect(isZonageSignal("Signal", "acquisition_fonciere")).toBe(false);
    expect(isZonageSignal("Signal", "infrastructure")).toBe(false);
    expect(isZonageSignal("Signal", "vente_terrain")).toBe(false);
    expect(isZonageSignal("Signal", "vente_institutionnelle")).toBe(false);
  });

  it("#4 — Signal category=NULL mais etape de zonage → true (repli etape)", () => {
    expect(isZonageSignal("Signal", null, "derogation_mineure")).toBe(true);
    expect(isZonageSignal("Signal", undefined, "rezonage")).toBe(true);
    expect(isZonageSignal("Signal", "", "cptaq")).toBe(true);
  });

  it("#4 — Signal sans category ni etape de zonage → false", () => {
    expect(isZonageSignal("Signal", null, null)).toBe(false);
    expect(isZonageSignal("Signal", null, "vente_terrain")).toBe(false);
    expect(isZonageSignal("Signal", "acquisition_fonciere", "infrastructure")).toBe(false);
  });

  it("#4 — category de zonage suffit même si etape hors-zonage", () => {
    expect(isZonageSignal("Signal", "rezonage", "vente_terrain")).toBe(true);
  });

  it("ZONAGE_CATEGORIES contient exactement les 15 catégories attendues", () => {
    expect(ZONAGE_CATEGORIES).toHaveLength(15);
    expect(ZONAGE_CATEGORIES).toContain("rezonage");
    expect(ZONAGE_CATEGORIES).toContain("derogation");
    expect(ZONAGE_CATEGORIES).toContain("cptaq");
    expect(ZONAGE_CATEGORIES).toContain("patrimoine");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. deriveEtape — pure mots-clés tests (no DB required)
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveEtape — mots-clés label/description", () => {
  // Cas avis_motion
  it("retourne avis_motion pour 'avis de motion'", () => {
    expect(deriveEtape("Avis de motion programme d'habitation", null)).toBe("avis_motion");
  });
  it("retourne avis_motion insensible à la casse et aux accents", () => {
    expect(deriveEtape("AVIS DE MOTION — règlement 536-26", null)).toBe("avis_motion");
    expect(deriveEtape("Avis de motion rezonage zone REC-3", "description plus longue")).toBe("avis_motion");
  });
  it("retourne avis_motion depuis la description seule", () => {
    expect(deriveEtape("Signal : rezonage zone H-1", "Avis de motion du règlement 536-26")).toBe("avis_motion");
  });

  // Cas projet_reglement
  it("retourne projet_reglement pour 'projet de règlement'", () => {
    expect(deriveEtape("1er projet du règlement 2026-300", null)).toBe("projet_reglement");
    expect(deriveEtape("Premier projet du règlement", null)).toBe("projet_reglement");
    expect(deriveEtape("projet de règlement no 4500", null)).toBe("projet_reglement");
  });

  // second_projet doit être matché AVANT projet_reglement
  it("retourne second_projet pour '2e projet' et 'second projet'", () => {
    expect(deriveEtape("2e projet du règlement 2026-300", null)).toBe("second_projet");
    expect(deriveEtape("Second projet du règlement", null)).toBe("second_projet");
    expect(deriveEtape("Deuxième projet de règlement", null)).toBe("second_projet");
  });

  // Cas consultation
  it("retourne consultation pour 'consultation publique'", () => {
    expect(deriveEtape("Consultation publique — modification zonage", null)).toBe("consultation");
  });

  // Cas entree_vigueur
  it("retourne entree_vigueur pour 'en vigueur'", () => {
    expect(deriveEtape("Règlement entré en vigueur", null)).toBe("entree_vigueur");
    expect(deriveEtape("Modification de zonage en vigueur", null)).toBe("entree_vigueur");
  });

  // Cas adoption
  it("retourne adoption pour 'adopté' et 'adoption'", () => {
    expect(deriveEtape("Règlement adopté au conseil", null)).toBe("adoption");
    expect(deriveEtape("Adoption du règlement 2026-300", null)).toBe("adoption");
  });

  // Cas accorde
  it("retourne accorde pour 'accordé' et 'autorisé'", () => {
    expect(deriveEtape("PIIA accordé — 15 logements rue Principale", null)).toBe("accorde");
    expect(deriveEtape("PPCMOI autorisé résolution 0349/04/26", null)).toBe("accorde");
  });

  // Cas refuse
  it("retourne refuse pour 'refusé' et 'rejeté'", () => {
    expect(deriveEtape("PIIA refusé — Île-Bellevue zone H-12", null)).toBe("refuse");
    expect(deriveEtape("Dérogation rejetée par le conseil", null)).toBe("refuse");
  });

  // Défaut inconnu
  it("retourne inconnu quand aucun mot-clé n'est trouvé", () => {
    expect(deriveEtape("Signal : modification zonage en cours", "description neutre")).toBe("inconnu");
    expect(deriveEtape(null, null)).toBe("inconnu");
    expect(deriveEtape("", "")).toBe("inconnu");
  });

  // Ordre ETAPE_ORDER
  it("ETAPE_ORDER : avis_motion (0) < projet_reglement (1) < entree_vigueur (5)", () => {
    expect(ETAPE_ORDER["avis_motion"]).toBe(0);
    expect(ETAPE_ORDER["projet_reglement"]).toBe(1);
    expect(ETAPE_ORDER["entree_vigueur"]).toBe(5);
    expect(ETAPE_ORDER["inconnu"]).toBe(99);
  });

  // ETAPES_PRECOCES
  it("ETAPES_PRECOCES contient avis_motion et projet_reglement", () => {
    expect(ETAPES_PRECOCES).toContain("avis_motion");
    expect(ETAPES_PRECOCES).toContain("projet_reglement");
    expect(ETAPES_PRECOCES).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. isMulti4Plus — pure logic tests (no DB required)
// ─────────────────────────────────────────────────────────────────────────────

describe("isMulti4Plus — dimension 4+ détection", () => {
  it("Signal avec intensite=haute → true", () => {
    expect(isMulti4Plus("Signal", null, "haute")).toBe(true);
    expect(isMulti4Plus("Signal", "", "haute")).toBe(true);
  });

  it("Signal avec nb_unites_max ≥ 4 → true", () => {
    expect(isMulti4Plus("Signal", "4", null)).toBe(true);
    expect(isMulti4Plus("Signal", "12", null)).toBe(true);
    expect(isMulti4Plus("Signal", "30", "moyenne")).toBe(true);
  });

  it("Signal avec nb_unites_max < 4 → false", () => {
    expect(isMulti4Plus("Signal", "3", null)).toBe(false);
    expect(isMulti4Plus("Signal", "1", null)).toBe(false);
    expect(isMulti4Plus("Signal", "0", null)).toBe(false);
  });

  it("Signal sans intensite ni nb_unites_max → false", () => {
    expect(isMulti4Plus("Signal", null, null)).toBe(false);
    expect(isMulti4Plus("Signal", undefined, undefined)).toBe(false);
    expect(isMulti4Plus("Signal", "", "")).toBe(false);
    expect(isMulti4Plus("Signal", "", "moyenne")).toBe(false);
  });

  it("DesignationEvent → toujours false (pas de champ dimension)", () => {
    expect(isMulti4Plus("DesignationEvent", "10", "haute")).toBe(false);
    expect(isMulti4Plus("DesignationEvent", null, null)).toBe(false);
  });

  it("nb_unites_max non-numérique → false (valeur invalide)", () => {
    expect(isMulti4Plus("Signal", "inconnu", null)).toBe(false);
    expect(isMulti4Plus("Signal", "N/A", null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DB-bound tests — skipped when no POSTGRES_HOST env var
// ─────────────────────────────────────────────────────────────────────────────

// The explicit flag remains available for targeted integration runs. The
// Make-driven test stack already starts Postgres and sets NODE_ENV=test, so
// enable the DB tier there instead of silently skipping the atomic gate proof.
const DB_AVAILABLE = process.env.GRAPH_DB_TESTS === "1" || process.env.NODE_ENV === "test";

describe.skipIf(!DB_AVAILABLE)("DB-bound: upsertGraph (integration)", () => {
  // These tests require a live Postgres with the graph_store migration applied.
  // The orchestrator runs them serially with ENV=test-graphdb.

  async function getDb() {
    const { createDb } = await import("../../db/client.js");
    const { loadConfig } = await import("../../config.js");
    // Pass only DB-relevant env vars to avoid Zod failures on optional fields
    // (e.g. RADAR_ONTOLOGY_WRITE_TOKEN) that are not needed for graph tests.
    const config = loadConfig({
      POSTGRES_HOST: process.env.POSTGRES_HOST ?? "postgres",
      POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
      POSTGRES_USER: process.env.POSTGRES_USER ?? "radar",
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "changeme-dev-only",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "radar",
    });
    return createDb(config).db;
  }

  it("upserts without error and returns correct counts", async () => {
    const db = await getDb();
    const result = await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    expect(result.nodeCount).toBe(3);
    expect(result.edgeCount).toBe(2);
  });

  it("is idempotent — second upsert returns same counts, no duplicates", async () => {
    const db = await getDb();
    await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    const result = await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    expect(result.nodeCount).toBe(3);
    expect(result.edgeCount).toBe(2);

    // Verify no duplicate edges in the DB for the fixture graph
    const { graphEdges } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const edges = await db.select().from(graphEdges).where(eq(graphEdges.srcId, "zone_a"));
    const fromZoneA = edges.filter((e) => e.dstId === "bylaw_1" && e.kind === "régi_par");
    expect(fromZoneA).toHaveLength(1);
  });

  it("queryNeighbors returns outgoing and incoming edges for a node", async () => {
    const db = await getDb();
    await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    const neighbors = await queryNeighbors(db, "zone_a");
    const outgoing = neighbors.filter((n) => n.direction === "out");
    const incoming = neighbors.filter((n) => n.direction === "in");
    expect(outgoing.length).toBeGreaterThan(0);
    expect(incoming.length).toBeGreaterThan(0);
    const bylaw = outgoing.find((n) => n.node.id === "bylaw_1");
    expect(bylaw).toBeDefined();
    const lotX = incoming.find((n) => n.node.id === "lot_x");
    expect(lotX).toBeDefined();
  });

  it("subgraphForCity returns nodes and intra-city edges", async () => {
    const db = await getDb();
    await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    const subgraph = await subgraphForCity(db, "valleyfield");
    expect(subgraph.nodes.length).toBe(3);
    expect(subgraph.edges.length).toBe(2);
    expect(subgraph.citySlug).toBe("valleyfield");
  });

  it("subgraphForCity returns empty for unknown city", async () => {
    const db = await getDb();
    const subgraph = await subgraphForCity(db, "__city_that_does_not_exist__");
    expect(subgraph.nodes).toHaveLength(0);
    expect(subgraph.edges).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2bis. DB-bound — upsertGraphAtomic : suppression orphelins + gate régression
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!DB_AVAILABLE)("DB-bound: upsertGraphAtomic (atomique + gate)", () => {
  async function getDb() {
    const { createDb } = await import("../../db/client.js");
    const { loadConfig } = await import("../../config.js");
    const config = loadConfig({
      POSTGRES_HOST: process.env.POSTGRES_HOST ?? "postgres",
      POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
      POSTGRES_USER: process.env.POSTGRES_USER ?? "radar",
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "changeme-dev-only",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "radar",
    });
    return createDb(config).db;
  }

  /** Purge tous les nœuds + arêtes d'une ville de test (état déterministe). */
  async function cleanCity(db: Awaited<ReturnType<typeof getDb>>, city: string) {
    const { graphNodes, graphEdges } = await import("../../db/schema.js");
    const { eq, inArray } = await import("drizzle-orm");
    const ids = (
      await db.select({ id: graphNodes.id }).from(graphNodes).where(eq(graphNodes.citySlug, city))
    ).map((r) => r.id);
    if (ids.length > 0) {
      const { or } = await import("drizzle-orm");
      await db
        .delete(graphEdges)
        .where(or(inArray(graphEdges.srcId, ids), inArray(graphEdges.dstId, ids)));
    }
    await db.delete(graphNodes).where(eq(graphNodes.citySlug, city));
  }

  it("(a) re-projeter sans un nœud → le nœud orphelin ET son arête pendante sont supprimés", async () => {
    const db = await getDb();
    const city = "__test_atomic_orphan__";
    await cleanCity(db, city);

    const { graphNodes, graphEdges } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");

    // Graphe initial : nœuds A et B, arête A→B.
    const graphAB = {
      nodes: [
        { id: `${city}:A`, type: "Bylaw", label: "Node A" },
        { id: `${city}:B`, type: "Bylaw", label: "Node B" },
      ],
      edges: [{ source: `${city}:A`, target: `${city}:B`, type: "concerns" }],
    };
    const r1 = await upsertGraphAtomic(db, city, graphAB);
    expect(r1.aborted).toBe(false);
    expect(r1.nodeCount).toBe(2);

    let nodes = await db.select().from(graphNodes).where(eq(graphNodes.citySlug, city));
    expect(nodes.map((n) => n.id).sort()).toEqual([`${city}:A`, `${city}:B`]);

    // Re-projection SANS B (et sans l'arête A→B).
    const graphA = { nodes: [{ id: `${city}:A`, type: "Bylaw", label: "Node A" }] };
    const r2 = await upsertGraphAtomic(db, city, graphA);
    expect(r2.aborted).toBe(false);
    expect(r2.deletedNodes).toBe(1);
    expect(r2.deletedEdges).toBe(1);

    nodes = await db.select().from(graphNodes).where(eq(graphNodes.citySlug, city));
    expect(nodes.map((n) => n.id)).toEqual([`${city}:A`]); // B supprimé

    const edges = await db.select().from(graphEdges).where(eq(graphEdges.srcId, `${city}:A`));
    expect(edges.filter((e) => e.dstId === `${city}:B`)).toHaveLength(0); // arête pendante supprimée

    await cleanCity(db, city);
  });

  it("(b) signal régressé (refs citation+rawRef → vide) → ville ABORTÉE, refs conservées (rollback)", async () => {
    const db = await getDb();
    const city = "__test_atomic_regression__";
    await cleanCity(db, city);

    const { graphNodes } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");

    // État initial : un Signal complet (ref citation+rawRef).
    const graphComplete = {
      nodes: [
        {
          id: `${city}:sig`,
          type: "Signal",
          label: "Signal complet",
          refs: [{ excerpt: "ADOPTION REGLEMENT 943-01", rawRef: "preuve.pdf" }],
        },
      ],
    };
    const r1 = await upsertGraphAtomic(db, city, graphComplete);
    expect(r1.aborted).toBe(false);

    // Nouveau graphe : même id, SANS refs (régression de preuves).
    const graphRegressed = {
      nodes: [{ id: `${city}:sig`, type: "Signal", label: "Signal complet" }],
    };
    const r2 = await upsertGraphAtomic(db, city, graphRegressed);
    expect(r2.aborted).toBe(true);
    expect(r2.reason).toBeDefined();

    // Rollback : l'ancien nœud conserve ses refs.
    const [node] = await db.select().from(graphNodes).where(eq(graphNodes.id, `${city}:sig`));
    expect(node).toBeDefined();
    const props = (node!.props ?? {}) as Record<string, unknown>;
    expect(Array.isArray(props.refs)).toBe(true);
    expect(props.refs).toHaveLength(1);
    expect(isCompleteSignalProps(props)).toBe(true); // toujours complet

    await cleanCity(db, city);
  });

  it("(c) exact 39→9 business-property regression → projection refused", async () => {
    const db = await getDb();
    const city = "__test_atomic_business_properties__";
    await cleanCity(db, city);

    const businessKeys = [
      "code_zone", "usage_permis", "densite_max", "hauteur_max", "lotissement",
      "frontage_min", "profondeur_min", "superficie_min", "marges", "reglement_url",
      "reglement_numero", "normes_pliees", "usage_dominant", "effet_densifiant",
      "categorie_zone", "classe_zone", "affectation", "sous_affectation", "densite_min",
      "unites_max", "unites_min", "etages_max", "etages_min", "stationnement_min",
      "stationnement_max", "emprise_max", "verdissement_min", "marge_avant", "marge_arriere",
      "marge_laterale", "aire_verte", "lotissement_permis", "notes", "source", "source_url",
      "snapshot", "feature_id", "municipalite", "version",
    ];
    const baselineProperties = Object.fromEntries(
      businessKeys.map((key) => [key, `${key}-value`]),
    );
    const reducedProperties = Object.fromEntries(
      businessKeys.slice(0, 9).map((key) => [key, `${key}-value`]),
    );
    const nodeId = `${city}:zone:1`;

    const first = await upsertGraphAtomic(db, city, {
      nodes: [{ id: nodeId, type: "Signal", label: "Zone", properties: baselineProperties }],
    });
    expect(first.aborted).toBe(false);

    const reduced = await upsertGraphAtomic(db, city, {
      nodes: [{ id: nodeId, type: "Signal", label: "Zone", properties: reducedProperties }],
    });
    expect(reduced.aborted).toBe(true);
    expect(reduced.reason).toContain("business-property regression");
    expect(reduced.reason).toContain("reglement_url");

    const { graphNodes } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const [persisted] = await db.select().from(graphNodes).where(eq(graphNodes.id, nodeId));
    const persistedProperties = ((persisted?.props ?? {}) as Record<string, unknown>).properties;
    expect(Object.keys((persistedProperties ?? {}) as Record<string, unknown>)).toHaveLength(39);

    await cleanCity(db, city);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 5. Signal flag helpers — isPrecoceSignal, buildSubsetKey — pure tests
// ─────────────────────────────────────────────────────────────────────────────

describe("isPrecoceSignal", () => {
  it("retourne true quand etapeAnnote = avis_motion", () => {
    expect(isPrecoceSignal("avis_motion", null, null)).toBe(true);
  });
  it("retourne true quand etapeAnnote = projet_reglement", () => {
    expect(isPrecoceSignal("projet_reglement", null, null)).toBe(true);
  });
  it("retourne false quand etapeAnnote = adoption", () => {
    expect(isPrecoceSignal("adoption", "avis de motion dans le texte", null)).toBe(false);
  });
  it("fallback sur deriveEtape quand etapeAnnote est null", () => {
    expect(isPrecoceSignal(null, "avis de motion séance du 5 mars", null)).toBe(true);
  });
  it("falls back to label-derived precocity for an empty annotation (legacy A contract)", () => {
    expect(isPrecoceSignal("", "projet de règlement 2025", null)).toBe(true);
  });
  it("retourne false si ni annotation ni mots-clés précoces", () => {
    expect(isPrecoceSignal(null, "adoption du règlement 456", null)).toBe(false);
  });
});

describe("buildSubsetKey", () => {
  it('retourne "" quand aucun flag', () => {
    expect(buildSubsetKey(false, false, false)).toBe("");
  });
  it('retourne "z" quand z seul', () => {
    expect(buildSubsetKey(true, false, false)).toBe("z");
  });
  it('retourne "z|m|p" quand tous les flags {z,m,p}', () => {
    expect(buildSubsetKey(true, true, true)).toBe("z|m|p");
  });
  it('retourne "m|p" quand m et p', () => {
    expect(buildSubsetKey(false, true, true)).toBe("m|p");
  });
  // Axe `r` (4e flag optionnel — rétro-compat : r=false ≡ modèle {z,m,p}).
  it('r=false (par défaut) ≡ clé {z,m,p} historique', () => {
    expect(buildSubsetKey(true, true, true, false)).toBe("z|m|p");
    expect(buildSubsetKey(false, false, false, false)).toBe("");
  });
  it('retourne "r" quand r seul', () => {
    expect(buildSubsetKey(false, false, false, true)).toBe("r");
  });
  it('retourne "z|r" quand z et r', () => {
    expect(buildSubsetKey(true, false, false, true)).toBe("z|r");
  });
  it('retourne "z|m|p|r" quand tous les 4 flags (ordre canonique z<m<p<r)', () => {
    expect(buildSubsetKey(true, true, true, true)).toBe("z|m|p|r");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Pertinence résidentielle — classifyResidentielPertinence / isResidentielPertinent
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyResidentielPertinence", () => {
  it("catégorie résidentielle → residentiel", () => {
    expect(classifyResidentielPertinence("densification", null, null)).toBe("residentiel");
    expect(classifyResidentielPertinence("logement_abordable", null, null)).toBe("residentiel");
  });

  it("marqueur texte résidentiel (label ou description) → residentiel", () => {
    expect(classifyResidentielPertinence(null, "Rezonage résidentiel", null)).toBe("residentiel");
    expect(classifyResidentielPertinence(null, null, "Projet d'habitation multifamiliale")).toBe("residentiel");
    expect(classifyResidentielPertinence(null, "Densification du secteur", null)).toBe("residentiel");
    expect(classifyResidentielPertinence(null, "Immeuble à logements de 12 unités", null)).toBe("residentiel");
  });

  it("marqueur non résidentiel explicite (industriel/commercial/camping/enviro) → non_residentiel", () => {
    expect(classifyResidentielPertinence(null, "Agrandissement du parc industriel", null)).toBe("non_residentiel");
    expect(classifyResidentielPertinence(null, "Nouvelle zone commerciale", null)).toBe("non_residentiel");
    expect(classifyResidentielPertinence(null, "Projet de camping municipal", null)).toBe("non_residentiel");
    expect(classifyResidentielPertinence(null, null, "Protection des milieux humides et zone inondable")).toBe("non_residentiel");
    expect(classifyResidentielPertinence(null, "Exploitation agricole", null)).toBe("non_residentiel");
  });

  it("mixte (résidentiel ET non résidentiel) → residentiel (opportunité)", () => {
    // Conversion « de commercial à résidentiel » ou usage mixte : reste pertinent.
    expect(
      classifyResidentielPertinence(null, "Rezonage de commercial à résidentiel", null),
    ).toBe("residentiel");
    expect(
      classifyResidentielPertinence(null, "Zone d'usage mixte commercial et habitation", null),
    ).toBe("residentiel");
  });

  it("aucun marqueur reconnu → indetermine (anti-invention, pas de faux négatif)", () => {
    expect(classifyResidentielPertinence(null, "Avis de motion 2025-11", null)).toBe("indetermine");
    expect(classifyResidentielPertinence(null, null, null)).toBe("indetermine");
    expect(classifyResidentielPertinence("rezonage", "Modification du règlement", null)).toBe("indetermine");
  });

  it("« plex » borné : « complexe » ne matche PAS résidentiel", () => {
    // \bplex\b protège contre « complexe sportif ».
    expect(classifyResidentielPertinence(null, "Complexe sportif municipal", null)).toBe("indetermine");
    expect(classifyResidentielPertinence(null, "Construction d'un triplex", null)).toBe("residentiel");
  });

  it("GOLDEN — invariance A : classifyResidentielPertinence INCHANGÉE (le durcissement R3 vit UNIQUEMENT en B′)", () => {
    // Ce golden PIN la frontière exacte du lexique SERVEUR (axe A / `r`) : il ne
    // porte PAS le durcissement B′ (« commerciaux » pluriel, enseigne/affichage).
    // Si un jour on refusionnait la source B′ dans ce chemin, ce golden casserait.
    const golden: ReadonlyArray<[string | null, string | null, string | null, string]> = [
      ["densification", null, null, "residentiel"],
      ["logement_abordable", null, null, "residentiel"],
      [null, "Rezonage résidentiel", null, "residentiel"],
      [null, null, "Projet d'habitation multifamiliale", "residentiel"],
      [null, "Immeuble à logements de 12 unités", null, "residentiel"],
      [null, "Rezonage de commercial à résidentiel", null, "residentiel"],
      [null, "Zone d'usage mixte commercial et habitation", null, "residentiel"],
      [null, "Nouvelle zone commerciale", null, "non_residentiel"],
      [null, "Agrandissement du parc industriel", null, "non_residentiel"],
      [null, "Projet de camping municipal", null, "non_residentiel"],
      [null, "Exploitation agricole", null, "non_residentiel"],
      // FRONTIÈRE A : le pluriel « commerciaux » N'EST PAS matché par le lexique
      // serveur (contrairement à B′) → reste `indetermine`. C'est l'invariance
      // exacte exigée : R3 (« commerciaux ») ne fuit JAMAIS dans l'axe A.
      [null, "Autoriser certains usages commerciaux zone C-8", null, "indetermine"],
      [null, "Règlement sur les enseignes", null, "indetermine"],
      [null, "Avis de motion 2025-11", null, "indetermine"],
      [null, null, null, "indetermine"],
      [null, "Complexe sportif municipal", null, "indetermine"],
    ];
    for (const [category, label, description, expected] of golden) {
      expect(
        classifyResidentielPertinence(category, label, description),
        `golden A: category=${category} label=${label} desc=${description}`,
      ).toBe(expected);
    }
  });
});

describe("isResidentielPertinent — prédicat de filtre (axe r)", () => {
  it("résidentiel → true", () => {
    expect(isResidentielPertinent("densification", null, null)).toBe(true);
    expect(isResidentielPertinent(null, "Habitation multifamiliale", null)).toBe(true);
  });

  it("non résidentiel explicite → false", () => {
    expect(isResidentielPertinent(null, "Parc industriel", null)).toBe(false);
    expect(isResidentielPertinent(null, "Zone commerciale", null)).toBe(false);
    expect(isResidentielPertinent(null, null, "Camping et milieux humides")).toBe(false);
  });

  it("indéterminé → true (conservé, anti-faux-négatif)", () => {
    expect(isResidentielPertinent(null, "Avis de motion 2025-11", null)).toBe(true);
    expect(isResidentielPertinent(null, null, null)).toBe(true);
  });
});
