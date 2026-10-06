/**
 * residential-tristate-dry-run — data audit for the residential tri-state fix.
 *
 * WHAT IT ANSWERS. The `r` axis (Résidentiel) reads `isResidentialEligible`
 * (@radar/domain) on the `vivier_v2` classification. That classification is
 * DERIVED AT READ TIME from the projected graph row (label, description,
 * category, etape, instrument) by `classifyGraphNodeVivierV2` — the same call
 * `listCitiesWithSignalNodes` and `/api/graph-signals/:city` make. No persisted
 * field stores the residential verdict. This script replays, per city and per
 * Signal/DesignationEvent node, the classification with the PREVIOUS predicate
 * (`oui` ∪ unstated rezoning/reform) and the CURRENT one (tri-state: an
 * early-stage unknown is not non-residential), and reports every node whose
 * eligibility changes, plus the Graphify 3.4 persisted fields (`instrument`,
 * `etape`) that a re-enrichment would add.
 *
 * WHY THERE IS NO WRITE MODE. Re-tagging data cannot change the verdict: the
 * classifier reads text evidence, and the reclassification comes from the code
 * predicate alone, effective once the API is deployed. Persisting `instrument`
 * or `etape` is already done by the recurring refresh (`refresh-run.ts`,
 * `enrichGraphify34Snapshot`) and, for a backfill, by `graphify-34-enrich.ts`
 * (dry-run by default, archive + S3-first + projection). Writing PG alone would
 * diverge from `graph/<city>/latest.json` and be overwritten by the next
 * projection. `--apply` is therefore refused (exit 2). Idempotent by
 * construction: it only reads.
 *
 * SOURCES (read-only):
 *  - default: S3 canonical `graph/<city>/latest.json` (source of truth), one
 *    read per city through `readCanonicalCityGraph`; cities from argv.
 *  - `--from-ndjson=<file>`: a read-only dump of the PG projection, one JSON
 *    object per line `{id,type,label,city_slug,props,source_ref}` (as produced by
 *    `select row_to_json(t) from (select … from graph_nodes …) t` under
 *    `SET default_transaction_read_only=on`). Use it to measure the served set.
 *
 * Options: `--window=YYYY-MM-DD..YYYY-MM-DD` restricts the default-view count to
 * a document-date window; `--examples=N` (default 10); `--json` machine output.
 *
 * Usage:
 *   tsx src/scripts/residential-tristate-dry-run.ts <city…>
 *   tsx src/scripts/residential-tristate-dry-run.ts --from-ndjson=dump.ndjson --window=2026-07-05..2026-10-05
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isHiddenByVivierBExclusions,
  isResidentialEligible,
  matchesDocumentDateWindow,
  type VivierV2,
} from "@radar/domain";

import {
  buildNodeRow,
  classifyGraphNodeVivierV2,
  mergeNodeRows,
  type GraphifyNode,
} from "../services/graph/graph-store.js";

const SIGNAL_TYPES = new Set(["Signal", "DesignationEvent"]);
const PRECOCE = new Set(["avis_motion", "projet_reglement"]);

/** The predicate served before the tri-state fix (PR #423, 2026-07-25). */
export function previousResidentialEligible(c: VivierV2): boolean {
  if (c.residentiel.valeur === "oui") return true;
  if (c.residentiel.valeur === "non") return false;
  return c.instrument === "rezonage" || c.instrument === "refonte";
}

export interface ProjectedSignalRow {
  id: string;
  citySlug: string;
  type: string;
  label: string;
  props: unknown;
  sourceRef: string | null;
}

export interface NodeAudit {
  id: string;
  citySlug: string;
  label: string;
  instrument: string;
  etape: string;
  residentiel: VivierV2["residentiel"]["valeur"];
  before: boolean;
  after: boolean;
  /** In the default B view (window, PIIA/derogation exclusions, z ∩ r ∩ p). */
  defaultViewBefore: boolean;
  defaultViewAfter: boolean;
  missingPersistedFields: string[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Classify one projected row exactly as the served aggregate does. */
export function auditRow(
  row: ProjectedSignalRow,
  window?: { dateFrom: string; dateTo: string },
): NodeAudit {
  const properties = record(record(row.props).properties);
  const description = scalar(properties.description);
  const c = classifyGraphNodeVivierV2({
    id: row.id,
    type: row.type,
    category: scalar(properties.category),
    label: row.label,
    description,
    etapeAnnote: scalar(properties.etape),
    props: row.props,
    sourceRef: row.sourceRef,
  });
  const before = previousResidentialEligible(c);
  const after = isResidentialEligible(c);
  const hidden = isHiddenByVivierBExclusions(
    { label: row.label, description, props: record(row.props), classification: c },
    { piiaSansProjetResidentiel: true, derogationsMineures: true },
  );
  const inWindow = window === undefined ||
    matchesDocumentDateWindow(row.props, { ...window, dateBasis: "document" });
  const base = inWindow && !hidden && c.exclusion_reason === null &&
    c.zonage.valeur === "oui" && PRECOCE.has(c.etape);
  return {
    id: row.id,
    citySlug: row.citySlug,
    label: row.label,
    instrument: c.instrument,
    etape: c.etape,
    residentiel: c.residentiel.valeur,
    before,
    after,
    defaultViewBefore: base && before,
    defaultViewAfter: base && after,
    missingPersistedFields: ["instrument", "etape"].filter((key) => scalar(properties[key]) === null),
  };
}

export interface TriStateReport {
  nodes: number;
  cities: number;
  eligibilityChanged: { nodes: number; cities: number; toEligible: number; toIneligible: number };
  defaultView: { before: number; after: number; citiesAfter: number };
  missingPersistedFields: { nodes: number; cities: number };
  writesRequired: 0;
  examples: Array<Pick<NodeAudit, "id" | "citySlug" | "label" | "instrument" | "etape" | "residentiel">
    & { before: string; after: string }>;
}

export function summarize(audits: readonly NodeAudit[], exampleCount = 10): TriStateReport {
  const changed = audits.filter((a) => a.before !== a.after);
  const missing = audits.filter((a) => a.missingPersistedFields.length > 0);
  const viewAfter = audits.filter((a) => a.defaultViewAfter);
  const verdict = (eligible: boolean) => eligible ? "r=eligible" : "r=filtered";
  return {
    nodes: audits.length,
    cities: new Set(audits.map((a) => a.citySlug)).size,
    eligibilityChanged: {
      nodes: changed.length,
      cities: new Set(changed.map((a) => a.citySlug)).size,
      toEligible: changed.filter((a) => a.after).length,
      toIneligible: changed.filter((a) => !a.after).length,
    },
    defaultView: {
      before: audits.filter((a) => a.defaultViewBefore).length,
      after: viewAfter.length,
      citiesAfter: new Set(viewAfter.map((a) => a.citySlug)).size,
    },
    missingPersistedFields: { nodes: missing.length, cities: new Set(missing.map((a) => a.citySlug)).size },
    writesRequired: 0,
    examples: [...changed]
      .sort((x, y) => Number(y.defaultViewAfter) - Number(x.defaultViewAfter) || x.id.localeCompare(y.id))
      .slice(0, exampleCount)
      .map((a) => ({ id: a.id, citySlug: a.citySlug, label: a.label, instrument: a.instrument,
        etape: a.etape, residentiel: a.residentiel, before: verdict(a.before), after: verdict(a.after) })),
  };
}

/**
 * Rows of a canonical `latest.json`, projected with the writer's own row builder
 * and merged by id exactly as `upsertGraph` / `upsertGraphAtomic` do.
 */
export function rowsFromCanonicalGraph(citySlug: string, graph: { nodes?: GraphifyNode[] }): ProjectedSignalRow[] {
  return mergeNodeRows((graph.nodes ?? []).map((node) => buildNodeRow(node, citySlug)))
    .filter((row) => SIGNAL_TYPES.has(row.type))
    .map((row) => ({ id: row.id, citySlug, type: row.type, label: row.label, props: row.props,
      sourceRef: row.sourceRef ?? null }));
}

export function rowsFromNdjson(text: string): ProjectedSignalRow[] {
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => SIGNAL_TYPES.has(String(row.type)) && typeof row.city_slug === "string")
    .map((row) => ({ id: String(row.id), citySlug: String(row.city_slug), type: String(row.type),
      label: String(row.label ?? ""), props: row.props, sourceRef: scalar(row.source_ref) }));
}

function parseWindow(raw: string | undefined): { dateFrom: string; dateTo: string } | undefined {
  if (raw === undefined) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(raw);
  if (!match) throw new Error(`--window must be YYYY-MM-DD..YYYY-MM-DD, got ${raw}`);
  return { dateFrom: match[1]!, dateTo: match[2]! };
}

async function readS3Rows(cities: readonly string[]): Promise<ProjectedSignalRow[]> {
  const [{ loadConfig, resolveGraphS3Config }, { createScrapeS3Client, S3ObjectStore },
    { readCanonicalCityGraph }] = await Promise.all([
    import("../config.js"),
    import("../storage/s3-object-store.js"),
    import("../services/graph/canonical-graph-writer.js"),
  ]);
  const config = resolveGraphS3Config(loadConfig());
  const store = new S3ObjectStore(createScrapeS3Client(config), config.bucket);
  const rows: ProjectedSignalRow[] = [];
  for (const city of cities) {
    const read = await readCanonicalCityGraph(store, city);
    if (read === null) {
      console.warn(`[residential-tristate] ${city}: no graph/${city}/latest.json — skipped`);
      continue;
    }
    rows.push(...rowsFromCanonicalGraph(city, JSON.parse(Buffer.from(read.body).toString("utf8"))));
  }
  return rows;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--apply")) {
    console.error("[residential-tristate] --apply refused: the residential verdict is derived at read time; "
      + "no persisted field to write. Deploy the predicate fix. Missing Graphify 3.4 fields are backfilled "
      + "by graphify-34-enrich.ts (dry-run by default, S3-first).");
    process.exit(2);
  }
  const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const window = parseWindow(option("window"));
  const examples = Number(option("examples") ?? "10");
  const ndjson = option("from-ndjson");
  const cities = args.filter((arg) => !arg.startsWith("--"));
  if (ndjson === undefined && cities.length === 0) {
    throw new Error("give city slugs (S3 canonical source) or --from-ndjson=<pg dump>");
  }
  const rows = ndjson !== undefined
    ? rowsFromNdjson(readFileSync(ndjson, "utf8")).filter((row) => cities.length === 0 || cities.includes(row.citySlug))
    : await readS3Rows(cities);
  const report = summarize(rows.map((row) => auditRow(row, window)), examples);
  const output = { mode: "dry-run", source: ndjson !== undefined ? `ndjson:${ndjson}` : "s3:graph/<city>/latest.json",
    window: window ?? null, ...report };
  console.log(args.includes("--json") ? JSON.stringify(output) : JSON.stringify(output, null, 2));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
