/**
 * I-0 golden capture: the full current UI filtering pipeline on fixed
 * fixtures. Real client code paths only (inventory S-01...T-01, C8):
 * projectComposedVivierB, filterNodesByDocumentDate, applyVivierBExclusions,
 * rankVivierBNodes, nodeMatchesSubset, matchesDocumentDateWindow,
 * extractSignalZoneRefs / extractSignalLotRefs / extractSignalEvidence.
 *
 * Server-only dimensions (instruments, stages, regulatoryStatus,
 * basket/archive/personalHistory, q folding, zoneCode resolution) apply the
 * documented v1 predicate in this runner and are flagged as such: the UI
 * pipeline has no equivalent today (gap), I-2 implements them exactly.
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
} from "@radar/domain";
import { matchesDocumentDateWindow } from "@radar/domain";
import { projectComposedVivierB } from "./vivier-view-mode.js";
import { nodeMatchesSubset } from "./graph-signal-filter.js";
import {
  dateRangeFromSignalTimeRange,
  normalizeSignalTimeRange,
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

function rangeToWindow(range: SignalTimeRange, basis: "document" | "scrap") {
  const { start, end } = dateRangeFromSignalTimeRange(range);
  const civil = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    dateBasis: basis,
    ...(start ? { dateFrom: civil(start) } : {}),
    ...(end ? { dateTo: civil(end) } : {}),
  };
}

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

/** Fixed fixture population: 12 signals across 3 cities (documented seeds). */
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
    { category: null, etape: "projet_reglement", instrument: "piia", nb_unites_max: 4, description: "PIIA quatre logements", refs: docRefs("2026-10-01", "2026-10-02T10:00:00Z") }),
  vivierNode("sig-vf-04", "valleyfield", "Derogation mineure marge laterale",
    { ...oui("derogation", "projet_reglement"), instrument: "derogation" as const },
    { category: null, etape: "projet_reglement", instrument: "derogation", description: "Derogation mineure", refs: docRefs("2026-09-29", "2026-09-30T10:00:00Z") }),
  vivierNode("sig-vf-05", "valleyfield", "Entrepot industriel zone I-93",
    { zonage: { valeur: "oui" as const, source: "s", confiance: 0.9 }, residentiel: { valeur: "non" as const, source: "s", confiance: 0.9 }, effet_densifiant: "inconnu" as const, instrument: "derogation" as const, etape: "adoption" as const, etapes_historique: [], exclusion_reason: "non_residentiel_franc" as const, provenance: { extrait: "" }, confiance: 0.9 },
    { category: "industriel", description: "Entrepot industriel", refs: docRefs("2026-09-20", "2026-09-21T10:00:00Z") }),
  vivierNode("sig-vf-06", "valleyfield", "Ecole primaire — usage mixte et habitation",
    oui("refonte", "projet_reglement"),
    { category: null, description: "Ecole et usage mixte", refs: [] },
    { publishedAt: "2026-05-01T00:00:00Z" }),
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

const fold = (raw: string) =>
  raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export interface GoldenCase {
  name: string;
  citySlug?: string;
  axes: { z: boolean; r: boolean; p: boolean };
  exclusions: { piiaSansProjetResidentiel: boolean; derogationsMineures: boolean };
  window: ReturnType<typeof rangeToWindow>;
  zoneCode?: string;
  zoneMatch: "attached" | "attached-or-unattached";
  q?: string;
  sort: "vivier_rank" | "freshness_desc";
  excludeAutomaticallyExcluded: boolean;
}

const WINDOW_DEFAULT = rangeToWindow(lastWeek, "document");
const WINDOW_WIDE_DOC = { dateBasis: "document" as const, dateFrom: "2026-01-31", dateTo: "2026-07-31" };
const WINDOW_WIDE_SCRAP = { dateBasis: "scrap" as const, dateFrom: "2026-01-31", dateTo: "2026-07-31" };

const BASE: Omit<GoldenCase, "name" | "citySlug">[] = [
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_DEFAULT, zoneMatch: "attached", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: false, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_DEFAULT, zoneMatch: "attached", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: false, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_DEFAULT, zoneMatch: "attached", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: false }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_DEFAULT, zoneMatch: "attached", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: false, r: false, p: false }, exclusions: { piiaSansProjetResidentiel: false, derogationsMineures: false }, window: { dateBasis: "document" as const }, zoneMatch: "attached", sort: "vivier_rank", excludeAutomaticallyExcluded: false },
  { axes: { z: false, r: false, p: false }, exclusions: { piiaSansProjetResidentiel: false, derogationsMineures: false }, window: { dateBasis: "document" as const }, zoneMatch: "attached", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_DEFAULT, zoneMatch: "attached", sort: "freshness_desc", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_WIDE_DOC, zoneMatch: "attached", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_WIDE_SCRAP, zoneMatch: "attached", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_DEFAULT, zoneCode: "H-101", zoneMatch: "attached", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_DEFAULT, zoneCode: "H-101", zoneMatch: "attached-or-unattached", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
  { axes: { z: true, r: true, p: true }, exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS }, window: WINDOW_DEFAULT, zoneMatch: "attached", q: "ecole", sort: "vivier_rank", excludeAutomaticallyExcluded: true },
];

const MATRIX: GoldenCase[] = [
  ...BASE.map((base, index) => ({ ...base, name: `city-${String(index + 1).padStart(2, "0")}`, citySlug: "valleyfield" })),
  ...BASE.map((base, index) => ({ ...base, name: `all-${String(index + 1).padStart(2, "0")}` })),
];

function runCase(nodes: GraphSignalNode[], golden: GoldenCase) {
  const scoped = golden.citySlug ? nodes.filter((node) => node.citySlug === golden.citySlug) : nodes;
  const projected = projectComposedVivierB(scoped, golden.axes);
  const dated = projected.available
    ? projected.nodes.filter((node) => matchesDocumentDateWindow(node.props, golden.window))
    : [];
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
      const dayOf = (node: GraphSignalNode) => {
        const refs = (node.props.refs as Array<{ publishedAt?: string | null }>) ?? [];
        const days = refs.map((ref) => ref.publishedAt).filter((day): day is string => !!day).sort();
        return days.at(-1) ?? null;
      };
      const left = dayOf(a);
      const right = dayOf(b);
      if (left !== right) {
        if (left === null) return 1;
        if (right === null) return -1;
        return right < left ? -1 : 1;
      }
      return a.id < b.id ? -1 : 1;
    });
  const panelIds = queried.filter((node) => nodeMatchesSubset(node, "vivier-v2|p")).map((node) => node.id);
  const divergence = ordered.map((node) => node.id).filter((id) => !panelIds.includes(id));
  const byCity = new Map<string, number>();
  for (const node of ordered) {
    byCity.set(node.citySlug ?? "unknown", (byCity.get(node.citySlug ?? "unknown") ?? 0) + 1);
  }
  const coPv: Record<string, number> = {};
  for (const node of ordered) {
    const rawRef = extractSignalEvidence(node).rawRef;
    if (!rawRef) {
      coPv[node.id] = 0;
      continue;
    }
    coPv[node.id] = ordered.filter((other) => other.id !== node.id && extractSignalEvidence(other).rawRef === rawRef).length;
  }
  return {
    name: golden.name,
    citySlug: golden.citySlug ?? null,
    available: projected.available,
    matched: ordered.length,
    orderedIds: ordered.map((node) => node.id),
    byCity: [...byCity.entries()].map(([citySlug, matched]) => ({ citySlug, matched })).sort((a, b) => a.citySlug.localeCompare(b.citySlug)),
    zoneCodes: [...new Set(ordered.flatMap((node) => extractSignalZoneRefs(node)))].sort(),
    lotNos: [...new Set(ordered.flatMap((node) => extractSignalLotRefs(node)))].sort(),
    coPv,
    panelDivergence: divergence.sort(),
  };
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

describe("signal-query-v1 golden capture", () => {
  it("should reproduce the frozen golden outputs byte-for-byte", () => {
    const results = MATRIX.map((golden) => runCase(NODES, golden));
    const bytes = `${stableStringify({ cases: results })}\n`;
    readOrInit(FIXTURE_PATH, `${stableStringify({ nodes: NODES, matrix: MATRIX.map(({ name, citySlug }) => ({ name, citySlug })) })}\n`);
    const expected = readOrInit(GOLDEN_PATH, bytes);
    expect(bytes).toBe(expected);
  });

  it("should regenerate the same bytes twice (deterministic fixtures)", () => {
    const first = `${stableStringify({ cases: MATRIX.map((golden) => runCase(NODES, golden)) })}\n`;
    const second = `${stableStringify({ cases: MATRIX.map((golden) => runCase(NODES, golden)) })}\n`;
    expect(second).toBe(first);
  });

  it("should keep the named projection-vs-panel divergences on record", () => {
    const divergences = MATRIX.map((golden) => {
      const result = runCase(NODES, golden);
      return { name: result.name, divergence: result.panelDivergence };
    }).filter((row) => row.divergence.length > 0);
    const bytes = `${stableStringify({ divergences })}\n`;
    expect(bytes).toBe(readOrInit(DIVERGENCE_PATH, bytes));
  });
});

export { FIXTURE_PATH, GOLDEN_PATH, MATRIX, NODES };


