/**
 * I-0 golden capture: the full current UI filtering pipeline on fixed
 * fixtures. Real client code paths only (inventory S-01...T-01, C8):
 * filterNodesByDocumentDate / signalDocumentDateWindow,
 * projectComposedVivierB (+ keyForVivierB for the panel key),
 * applyVivierBExclusions, rankVivierBNodes, nodeMatchesSubset,
 * resultCivilDates, extractSignalZoneRefs / extractSignalLotRefs /
 * extractSignalEvidence.
 *
 * Server-only dimensions (instruments, stages, regulatoryStatus,
 * basket/archive/personalHistory, q, zoneCode resolution) and the v1
 * `excludeAutomaticallyExcluded: false` recomposition (union of the
 * server-projected set with excluded-but-axes-passing nodes) apply the
 * documented v1 predicate in this runner and are flagged as such: the UI
 * pipeline has no equivalent today (gap), I-2 implements them exactly.
 *
 * Owner decision D-A: the server classification is the reference. Every
 * projection-vs-panel divergence is recorded in
 * `signal-query-v1-divergences.json` as a visible gap, never averaged away.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

function readOrInit(path: string, bytes: string): string {
  try {
    return `${readFileSync(path, "utf8")}`;
  } catch {
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    writeFileSync(path, bytes);
    return bytes;
  }
}
import {
  applyVivierBExclusions,
  DEFAULT_VIVIER_B_EXCLUSIONS,
  isResidentialEligible,
  resultCivilDates,
  SignalFilterV1,
  type VivierV2,
} from "@radar/domain";
import { keyForVivierB, projectComposedVivierB, type BAxes } from "./vivier-view-mode.js";
import { nodeMatchesSubset } from "./graph-signal-filter.js";
import {
  dateRangeFromSignalTimeRange,
  filterNodesByDocumentDate,
  normalizeSignalTimeRange,
  signalDocumentDateWindow,
  type SignalTimeRange,
} from "./signal-date-filter.js";
import { rankVivierBNodes } from "./vivier-b-ranking.js";
import {
  extractSignalEvidence,
  type GraphSignalNode,
} from "./graph-signal-detail-client.js";
import {
  extractSignalLotRefs,
  extractSignalZoneRefs,
  zoneRefComparableKey,
} from "$lib/maps/signaux-map-geo.js";

/** Fixed anchor: relative presets resolve deterministically. */
const ANCHOR_NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

const lastWeek = normalizeSignalTimeRange(
  { mode: "relative", relative: "7d", from: 0, to: ANCHOR_NOW },
  ANCHOR_NOW,
);

const WIDE_RANGE: SignalTimeRange = {
  mode: "absolute",
  from: new Date(2026, 0, 31).getTime(),
  to: new Date(2026, 6, 31).getTime(),
};

const OPEN_RANGE: SignalTimeRange = {
  mode: "relative",
  relative: "all",
  from: 0,
  to: 0,
};

function vivierNode(
  id: string,
  citySlug: string,
  label: string,
  classification: GraphSignalNode["classification"],
  props: Record<string, unknown>,
  extra: Partial<GraphSignalNode> = {},
): GraphSignalNode {
  return {
    id, type: "Signal", label, citySlug, sourceRef: null,
    createdAt: "2026-09-01T00:00:00Z",
    publishedAt: "2026-09-28T00:00:00Z",
    props, classification,
    legacySubset: { version: "legacy-zmp-v1", signalId: id, flags: { z: true, m: true, p: true } },
    ...extra,
  };
}

const oui = (instrument = "rezonage", etape = "avis_motion") => ({
  zonage: { valeur: "oui" as const, source: "s", confiance: 0.9 },
  residentiel: { valeur: "oui" as const, source: "s", confiance: 0.9 },
  effet_densifiant: "densifie" as const,
  instrument: instrument as "rezonage",
  etape: etape as "avis_motion",
  etapes_historique: [],
  exclusion_reason: null,
  provenance: { extrait: "projet de 12 logements" },
  confiance: 0.9,
});

function docRefs(documentDate: string | null, fetchedAt: string, excerpt = "extrait") {
  return [{ documentDate: documentDate ? { status: "known", precision: "day", value: documentDate } : { status: "unknown" }, publishedAt: documentDate, fetchedAt, excerpt }];
}

/** Fixed fixture population: 14 signals across 3 cities (documented seeds). */
const NODES: GraphSignalNode[] = [
  vivierNode("sig-vf-01", "valleyfield", "Rezonage residentiel — 12 logements zone H-101",
    oui("rezonage", "avis_motion"),
    { category: null, etape: "avis_motion", instrument: "rezonage", description: "Rezonage pour 12 logements", zone_ref: "H-101", refs: docRefs("2026-10-02", "2026-10-03T10:00:00Z") },
    { publishedAt: "2026-10-05T00:00:00Z", description: "Rezonage pour 12 logements" }),
  vivierNode("sig-vf-02", "valleyfield", "PIIA secteur centre",
    { ...oui("piia", "projet_reglement"), instrument: "piia" as const },
    { category: null, etape: "projet_reglement", instrument: "piia", description: "PIIA sans projet", refs: docRefs("2026-10-01", "2026-10-02T10:00:00Z") }),
  vivierNode("sig-vf-03", "valleyfield", "PIIA 4 plex — quatre logements",
    { ...oui("piia", "projet_reglement"), instrument: "piia" as const },
    { category: null, etape: "projet_reglement", instrument: "piia", nb_unites_max: 4, description: "PIIA quatre logements", refs: docRefs("2026-10-05", "2026-10-06T10:00:00Z") }),
  vivierNode("sig-vf-04", "valleyfield", "Derogation mineure marge laterale",
    { ...oui("derogation", "projet_reglement"), instrument: "derogation" as const },
    { category: null, etape: "projet_reglement", instrument: "derogation", description: "Derogation mineure", refs: docRefs("2026-09-29", "2026-09-30T10:00:00Z") }),
  vivierNode("sig-vf-05", "valleyfield", "Entrepot industriel zone I-93",
    { zonage: { valeur: "oui" as const, source: "s", confiance: 0.9 }, residentiel: { valeur: "non" as const, source: "s", confiance: 0.9 }, effet_densifiant: "inconnu" as const, instrument: "derogation" as const, etape: "adoption" as const, etapes_historique: [], exclusion_reason: "non_residentiel_franc" as const, provenance: { extrait: "" }, confiance: 0.9 },
    { category: "industriel", description: "Entrepot industriel", refs: docRefs("2026-09-20", "2026-09-21T10:00:00Z") }),
  vivierNode("sig-vf-06", "valleyfield", "École primaire — usage mixte et habitation",
    oui("refonte", "projet_reglement"),
    { category: null, description: "Ecole et usage mixte", refs: docRefs("2026-10-03", "2026-10-04T10:00:00Z") },
    { publishedAt: "2026-05-01T00:00:00Z" }),
  vivierNode("sig-vf-07", "valleyfield", "Rezonage rang Saint-Joseph — 6 logements",
    oui("rezonage", "projet_reglement"),
    { category: null, etape: "projet_reglement", instrument: "rezonage", description: "Projet de 6 logements", refs: docRefs("2026-03-15", "2026-10-04T10:00:00Z") }),
  vivierNode("sig-vf-08", "valleyfield", "PPCMOI rue Saint-Laurent — 8 logements",
    oui("ppcmoi", "avis_motion"),
    { category: null, etape: "avis_motion", instrument: "ppcmoi", description: "Projet de 8 logements", refs: docRefs("2026-10-01", "2026-04-10T10:00:00Z") }),
  vivierNode("sig-vf-09", "valleyfield", "Rezonage boulevard Monseigneur-Langlois — 10 logements",
    oui("rezonage", "avis_motion"),
    { category: null, etape: "avis_motion", instrument: "rezonage", description: "Projet de 10 logements", refs: docRefs("2026-10-06", "2026-10-03T10:00:00Z") },
    { publishedAt: "2026-10-05T00:00:00Z" }),
  vivierNode("sig-vf-10", "valleyfield", "Rezonage chemin Larocque — 10 logements",
    oui("rezonage", "avis_motion"),
    { category: null, etape: "avis_motion", instrument: "rezonage", description: "Projet de 10 logements", refs: docRefs("2026-10-04", "2026-10-05T10:00:00Z") },
    { publishedAt: "2026-10-05T00:00:00Z" }),
  vivierNode("sig-sm-01", "sainte-martine", "Rezonage rue Principale",
    oui("rezonage", "projet_reglement"),
    { category: null, etape: "projet_reglement", instrument: "rezonage", zone_ref: "R-201", refs: docRefs("2026-10-03", "2026-10-04T10:00:00Z") },
    { publishedAt: "2026-05-02T00:00:00Z" }),
  vivierNode("sig-sm-02", "sainte-martine", "Consultation publique plan urbanisme",
    { ...oui("plan_urbanisme", "consultation_publique"), instrument: "plan_urbanisme" as const, etape: "consultation_publique" as const },
    { category: null, etape: "consultation_publique", instrument: "plan_urbanisme", refs: docRefs("2026-08-15", "2026-08-16T10:00:00Z") }),
  vivierNode("sig-sm-03", "sainte-martine", "Second projet partageant le PV pv-shared-1",
    oui("rezonage", "second_projet"),
    { category: null, etape: "second_projet", instrument: "rezonage", rawRef: "raw/shared/pv-1.pdf", refs: docRefs("2026-10-02", "2026-10-03T10:00:00Z") }),
  vivierNode("sig-ri-01", "richelieu", "Adoption zonage commercial C-8",
    { zonage: { valeur: "oui" as const, source: "s", confiance: 0.9 }, residentiel: { valeur: "non" as const, source: "s", confiance: 0.9 }, effet_densifiant: "inconnu" as const, instrument: "autre" as const, etape: "adoption" as const, etapes_historique: [], exclusion_reason: "non_residentiel_franc" as const, provenance: { extrait: "" }, confiance: 0.9 },
    { category: "commercial", description: "Usages commerciaux zone C-8", refs: docRefs("2026-07-01", "2026-07-02T10:00:00Z") }),
  vivierNode("sig-ri-02", "richelieu", "Projet residentiel partagé PV pv-shared-1",
    oui("ppcmoi", "avis_motion"),
    { category: null, etape: "avis_motion", instrument: "ppcmoi", rawRef: "raw/shared/pv-1.pdf", refs: docRefs("2026-10-04", "2026-10-05T10:00:00Z") },
    { publishedAt: "2026-10-06T00:00:00Z" }),
  vivierNode("sig-ri-03", "richelieu", "Refonte complete du reglement",
    { ...oui("refonte", "projet_reglement"), instrument: "refonte" as const, residentiel: { valeur: "indetermine" as const, source: "s", confiance: 0.5 } },
    { category: "refonte", description: "Refonte complete", refs: docRefs("2026-09-10", "2026-09-11T10:00:00Z") }),
];

/** Boundary node without any server classification (projection unavailable). */
const UNCLASSIFIED_NODE: GraphSignalNode = vivierNode("sig-vf-99", "valleyfield", "Avis public sans classification",
  undefined,
  { category: null, description: "Avis public sans classification", refs: docRefs("2026-10-05", "2026-10-06T10:00:00Z") });

/** Archived signals (server-side v1 `archive` predicate; the UI has no equivalent). */
const ARCHIVED_IDS = new Set(["sig-vf-03", "sig-sm-01"]);

const fold = (raw: string) =>
  raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export interface GoldenCase {
  name: string;
  citySlug?: string;
  axes: { z: boolean; r: boolean; p: boolean };
  exclusions: { piiaSansProjetResidentiel: boolean; derogationsMineures: boolean };
  range: SignalTimeRange;
  dateBasis: "document" | "scrap";
  zoneCode?: string;
  zoneMatch: "attached" | "attached-or-unattached";
  archive: "exclude" | "include" | "only";
  q?: string;
  sort: "vivier_rank" | "freshness_desc";
  excludeAutomaticallyExcluded: boolean;
  population?: "with-unclassified";
}

const BASE: Omit<GoldenCase, "name" | "citySlug">[] = [
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: false, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: false, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: false }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: false, r: false, p: false }, exclusions: { piiaSansProjetResidentiel: false, derogationsMineures: false }, range: OPEN_RANGE, dateBasis: "document", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: false },
  { axes: { z: false, r: false, p: false }, exclusions: { piiaSansProjetResidentiel: false, derogationsMineures: false }, range: OPEN_RANGE, dateBasis: "document", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneMatch: "attached", archive: "exclude", sort: "freshness_desc", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: WIDE_RANGE, dateBasis: "document", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: WIDE_RANGE, dateBasis: "scrap", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneCode: "H-101", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneCode: "H-101", zoneMatch: "attached-or-unattached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneMatch: "attached", archive: "exclude", q: "ecole", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneMatch: "attached", archive: "include", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneMatch: "attached", archive: "only", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "scrap", zoneMatch: "attached", archive: "exclude", sort: "freshness_desc", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, range: lastWeek, dateBasis: "document", zoneMatch: "attached", archive: "exclude", sort: "vivier_rank", excludeAutomaticallyExcluded: true, population: "with-unclassified" },
];

const MATRIX: GoldenCase[] = [
  ...BASE.map((base, index) => ({ ...base, name: `city-${String(index + 1).padStart(2, "0")}`, citySlug: "valleyfield" })),
  ...BASE.map((base, index) => ({ ...base, name: `all-${String(index + 1).padStart(2, "0")}` })),
];

/** The v1 axes gate without the automatic-exclusion gate (server reference). */
function passesVivierAxes(classification: VivierV2, axes: BAxes): boolean {
  if (axes.z && classification.zonage.valeur !== "oui") return false;
  if (axes.r && !isResidentialEligible(classification)) return false;
  if (axes.p && !(classification.etape === "avis_motion" || classification.etape === "projet_reglement")) return false;
  return true;
}

/** The frozen contract input for a golden case (refused when the filter is invalid). */
function contractInput(golden: GoldenCase): unknown {
  const window = signalDocumentDateWindow(dateRangeFromSignalTimeRange(golden.range), golden.dateBasis);
  return {
    ...(golden.citySlug ? { citySlug: golden.citySlug } : {}),
    requireZonage: golden.axes.z,
    requireResidentielEligible: golden.axes.r,
    requirePrecoce: golden.axes.p,
    excludeAutomaticallyExcluded: golden.excludeAutomaticallyExcluded,
    excludePiia: golden.exclusions.piiaSansProjetResidentiel,
    excludeDerogations: golden.exclusions.derogationsMineures,
    dateBasis: window.dateBasis,
    ...(window.dateFrom ? { dateFrom: window.dateFrom } : {}),
    ...(window.dateTo ? { dateTo: window.dateTo } : {}),
    ...(golden.zoneCode ? { zoneCode: golden.zoneCode } : {}),
    zoneMatch: golden.zoneMatch,
    basket: "all",
    archive: golden.archive,
    personalHistory: "any",
    ...(golden.q ? { q: golden.q } : {}),
    sort: golden.sort,
  };
}

interface PipelineResult {
  available: boolean;
  ordered: GraphSignalNode[];
}

function runPipeline(nodes: GraphSignalNode[], golden: GoldenCase): PipelineResult {
  const scoped = golden.citySlug ? nodes.filter((node) => node.citySlug === golden.citySlug) : nodes;
  // `archive` is a server-side v1 predicate (documented gap: the UI pipeline
  // has no archive dimension; I-2 implements it exactly).
  const retained = scoped.filter((node) => {
    if (golden.archive === "include") return true;
    if (golden.archive === "only") return ARCHIVED_IDS.has(node.id);
    return !ARCHIVED_IDS.has(node.id);
  });
  const projected = projectComposedVivierB(retained, golden.axes);
  if (!projected.available) return { available: false, ordered: [] };
  // `excludeAutomaticallyExcluded: false` recomposes the v1 population: the
  // server-projected set plus excluded-but-axes-passing nodes (documented v1
  // predicate; the UI projection alone can never produce them).
  const excludedButMatching = golden.excludeAutomaticallyExcluded
    ? []
    : retained.filter((node) => node.classification?.exclusion_reason !== null
      && node.classification && passesVivierAxes(node.classification, golden.axes));
  const base = [...projected.nodes, ...excludedButMatching];
  const dated = filterNodesByDocumentDate(base, dateRangeFromSignalTimeRange(golden.range), golden.dateBasis);
  const gated = applyVivierBExclusions(dated, golden.exclusions);
  const kept = golden.excludeAutomaticallyExcluded
    ? gated.filter((node) => node.classification?.exclusion_reason === null)
    : gated;
  const zoned = golden.zoneCode
    ? kept.filter((node) => {
      const refs = extractSignalZoneRefs(node);
      if (refs.length === 0) return golden.zoneMatch === "attached-or-unattached";
      const target = zoneRefComparableKey(golden.zoneCode!);
      return refs.some((ref) => zoneRefComparableKey(ref) === target);
    })
    : kept;
  const queried = golden.q
    ? zoned.filter((node) => {
      const haystack = fold(`${node.label ?? ""} ${(node.description ?? "") as string} ${extractSignalZoneRefs(node).join(" ")}`);
      return haystack.includes(fold(golden.q!));
    })
    : zoned;
  const ordered = golden.sort === "vivier_rank"
    ? rankVivierBNodes(queried)
    : [...queried].sort((a, b) => {
      const dayOf = (node: GraphSignalNode) =>
        resultCivilDates(node.props, golden.dateBasis).sort().at(-1) ?? null;
      const left = dayOf(a);
      const right = dayOf(b);
      if (left !== right) {
        if (left === null) return 1;
        if (right === null) return -1;
        return right < left ? -1 : 1;
      }
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
  return { available: true, ordered };
}

/** Panel-vs-server divergence on the pre-projection population (D-A visible gap). */
function panelDivergenceIds(
  scoped: GraphSignalNode[],
  golden: GoldenCase,
  orderedIds: readonly string[],
): string[] {
  const panelKey = keyForVivierB(golden.axes);
  const panel = new Set(scoped.filter((node) => nodeMatchesSubset(node, panelKey)).map((node) => node.id));
  const queried = new Set(orderedIds);
  return [...panel, ...queried]
    .filter((id) => panel.has(id) !== queried.has(id))
    .sort();
}

type CaseResult =
  | { name: string; citySlug: string | null; refused: true; issues: Array<{ path: string; message: string }> }
  | {
    name: string; citySlug: string | null; available: boolean; matched: number;
    orderedIds: string[]; byCity: Array<{ citySlug: string; matched: number }>;
    zoneCodes: string[]; lotNos: string[]; coPv: Record<string, number>; panelDivergence: string[];
  };

function runCase(population: GraphSignalNode[], golden: GoldenCase): CaseResult {
  const parsed = SignalFilterV1.safeParse(contractInput(golden));
  if (!parsed.success) {
    return {
      name: golden.name,
      citySlug: golden.citySlug ?? null,
      refused: true,
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    };
  }
  const scoped = golden.citySlug ? population.filter((node) => node.citySlug === golden.citySlug) : population;
  const listed = runPipeline(scoped, golden);
  // `byCity` is always counted on the same filter minus `citySlug` (owner T1).
  const faceted = runPipeline(population, { ...golden, citySlug: undefined });
  const byCity = new Map<string, number>();
  if (faceted.available) {
    for (const node of faceted.ordered) {
      byCity.set(node.citySlug ?? "unknown", (byCity.get(node.citySlug ?? "unknown") ?? 0) + 1);
    }
  }
  const coPv: Record<string, number> = {};
  for (const node of listed.ordered) {
    const rawRef = extractSignalEvidence(node).rawRef;
    if (!rawRef) {
      coPv[node.id] = 0;
      continue;
    }
    coPv[node.id] = listed.ordered.filter((other) => other.id !== node.id && extractSignalEvidence(other).rawRef === rawRef).length;
  }
  return {
    name: golden.name,
    citySlug: golden.citySlug ?? null,
    available: listed.available,
    matched: listed.ordered.length,
    orderedIds: listed.ordered.map((node) => node.id),
    byCity: [...byCity.entries()].map(([citySlug, matched]) => ({ citySlug, matched })).sort((a, b) => a.citySlug.localeCompare(b.citySlug)),
    zoneCodes: [...new Set(listed.ordered.flatMap((node) => extractSignalZoneRefs(node)))].sort(),
    lotNos: [...new Set(listed.ordered.flatMap((node) => extractSignalLotRefs(node)))].sort(),
    coPv,
    panelDivergence: panelDivergenceIds(scoped, golden, listed.ordered.map((node) => node.id)),
  };
}

function populationFor(golden: GoldenCase): GraphSignalNode[] {
  return golden.population === "with-unclassified" ? [...NODES, UNCLASSIFIED_NODE] : NODES;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, input: unknown) => {
    if (Array.isArray(input)) return input;
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    return input as unknown;
  }, 2);
}

const GOLDEN_PATH = "src/lib/signals/__golden__/signal-query-v1-golden.json";
const DIVERGENCE_PATH = "src/lib/signals/__golden__/signal-query-v1-divergences.json";
const FIXTURE_PATH = "src/lib/signals/__golden__/signal-query-v1-fixtures.json";

function okResults(): CaseResult[] {
  return MATRIX.map((golden) => runCase(populationFor(golden), golden));
}

type OkCaseResult = Extract<CaseResult, { available: boolean }>;

function okOf(results: CaseResult[], name: string): OkCaseResult {
  const result = results.find((row) => row.name === name);
  if (!result || "refused" in result) throw new Error(`expected an executed case for ${name}`);
  return result;
}

describe("signal-query-v1 golden capture", () => {
  it("should reproduce the frozen golden outputs byte-for-byte", () => {
    const results = okResults();
    const bytes = `${stableStringify({ cases: results })}\n`;
    const fixtureBytes = `${stableStringify({
      nodes: NODES,
      unclassified: UNCLASSIFIED_NODE,
      archived: [...ARCHIVED_IDS].sort(),
      matrix: MATRIX,
    })}\n`;
    readOrInit(FIXTURE_PATH, fixtureBytes);
    const expected = readOrInit(GOLDEN_PATH, bytes);
    expect(bytes).toBe(expected);
  });

  it("should regenerate the same bytes twice (deterministic fixtures)", () => {
    const first = `${stableStringify({ cases: okResults() })}\n`;
    const second = `${stableStringify({ cases: okResults() })}\n`;
    expect(second).toBe(first);
  });

  it("should keep the named projection-vs-panel divergences on record", () => {
    const divergences = okResults().map((result) => {
      if ("refused" in result) return { name: result.name, refused: true };
      return { name: result.name, divergence: result.panelDivergence };
    }).filter((row) => "refused" in row || row.divergence.length > 0);
    const bytes = `${stableStringify({ divergences })}\n`;
    expect(bytes).toBe(readOrInit(DIVERGENCE_PATH, bytes));
  });

  it("should exercise distinct real behaviour with excludeAutomaticallyExcluded: false", () => {
    const results = okResults();
    const city05 = okOf(results, "city-05");
    const city06 = okOf(results, "city-06");
    expect(city06.orderedIds).not.toContain("sig-vf-05");
    expect(city05.orderedIds).toContain("sig-vf-05");
    expect(new Set(city05.orderedIds)).toEqual(new Set([...city06.orderedIds, "sig-vf-05"]));
    const all05 = okOf(results, "all-05");
    const all06 = okOf(results, "all-06");
    expect(all05.matched).toBe(all06.matched + 2);
    expect(all05.orderedIds).toEqual(expect.arrayContaining(["sig-vf-05", "sig-ri-01"]));
    expect(all06.orderedIds).not.toContain("sig-vf-05");
    expect(all06.orderedIds).not.toContain("sig-ri-01");
  });

  it("should count byCity on the same filter minus citySlug", () => {
    const results = okResults();
    for (const result of results) {
      if ("refused" in result || !result.available) continue;
      if (!result.name.startsWith("all-")) continue;
      const sum = result.byCity.reduce((total, entry) => total + entry.matched, 0);
      expect(sum, result.name).toBe(result.matched);
      const city = okOf(results, result.name.replace("all-", "city-"));
      if (!city.available) continue;
      const entry = result.byCity.find((row) => row.citySlug === city.citySlug);
      // Zero-count cities are absent from byCity (villes présentes seulement).
      expect(entry?.matched ?? 0, `${result.name} vs ${city.name}`).toBe(city.matched);
    }
    // The open window sees every city with signals (archived excluded).
    const all05 = okOf(results, "all-05");
    expect(all05.byCity.map((row) => row.citySlug).sort()).toEqual(
      ["richelieu", "sainte-martine", "valleyfield"],
    );
  });

  it("should refuse zoneCode without citySlug with a typed refusal", () => {
    const results = okResults();
    for (const name of ["all-10", "all-11"]) {
      const result = results.find((row) => row.name === name);
      expect(result && "refused" in result && result.refused).toBe(true);
      if (result && "refused" in result) {
        expect(result.issues.map((issue) => issue.path)).toContain("zoneCode");
      }
    }
    expect(okOf(results, "city-10").matched).toBeGreaterThan(0);
    expect(okOf(results, "city-11").matched).toBeGreaterThan(0);
  });

  it("should split the wide window by civil clock (document vs scrap)", () => {
    const results = okResults();
    const doc = okOf(results, "city-08");
    const scrap = okOf(results, "city-09");
    expect(doc.matched).toBeGreaterThan(0);
    expect(scrap.matched).toBeGreaterThan(0);
    expect(doc.orderedIds).not.toEqual(scrap.orderedIds);
    expect(doc.orderedIds).toContain("sig-vf-07");
    expect(doc.orderedIds).not.toContain("sig-vf-08");
    expect(scrap.orderedIds).toContain("sig-vf-08");
    expect(scrap.orderedIds).not.toContain("sig-vf-07");
  });

  it("should fold diacritics on q and sort freshness by civil day with a stable tie-break", () => {
    const results = okResults();
    const ecole = okOf(results, "city-12");
    expect(ecole.orderedIds).toContain("sig-vf-06");
    const fresh = okOf(results, "city-07");
    expect(fresh.matched).toBeGreaterThan(1);
    // Same vivier rank (identical classification and node freshness, id
    // tie-break), divergent civil freshness: document clock ranks vf-09
    // first, scrap clock ranks vf-10 first (C8).
    expect(fresh.orderedIds.indexOf("sig-vf-09")).toBeLessThan(fresh.orderedIds.indexOf("sig-vf-10"));
    const scrapFresh = okOf(results, "city-15");
    expect(scrapFresh.orderedIds.indexOf("sig-vf-10")).toBeLessThan(scrapFresh.orderedIds.indexOf("sig-vf-09"));
    const ranked = okOf(results, "city-01");
    expect(ranked.orderedIds.indexOf("sig-vf-09")).toBeLessThan(ranked.orderedIds.indexOf("sig-vf-10"));
  });

  it("should apply the server archive predicate (include / only)", () => {
    const results = okResults();
    const excluded = okOf(results, "city-01");
    expect(excluded.orderedIds).not.toContain("sig-vf-03");
    expect(okOf(results, "city-13").orderedIds).toContain("sig-vf-03");
    expect(okOf(results, "city-14").orderedIds).toEqual(["sig-vf-03"]);
    expect(okOf(results, "all-14").matched).toBe(2);
  });

  it("should mark a classification-less population unavailable, never partial", () => {
    const results = okResults();
    for (const name of ["city-16", "all-16"]) {
      const result = okOf(results, name);
      expect(result.available).toBe(false);
      expect(result.matched).toBe(0);
    }
  });

  it("should list the D-A server-vs-panel gaps by name", () => {
    const results = okResults();
    // Display-hidden derogation: the panel refilter shows it, the governed
    // list does not (gap closed in I-6 when the refilter is removed).
    expect(okOf(results, "city-01").panelDivergence).toContain("sig-vf-04");
    // No false positive when `p` is relaxed: the late-stage signal is out of
    // both sets under the case-derived key.
    expect(okOf(results, "all-04").panelDivergence).not.toContain("sig-sm-03");
  });
});

export { FIXTURE_PATH, GOLDEN_PATH, MATRIX, NODES };
