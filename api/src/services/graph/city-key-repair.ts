/**
 * GH #812 — repair of the graph rows contaminated by the old `graph_nodes` key `(id)`.
 *
 * Before migration 0013 a node id was a global key while graphify ids are unique
 * inside one city only, so the projection of city D overwrote the row of city C
 * holding the same id (`bylaw-242` of gore carried barkmere's evidence). After the
 * key change each city owns its id space, but the rows already contaminated stay
 * until the city is re-projected from its own S3 `graph/<city>/latest.json` — and
 * that projection is refused by the guards precisely because the foreign values
 * would "disappear".
 *
 * The repair is ONE standard projection per city (spec K10), whose guards are
 * evaluated against the city's current rows MINUS the rows proven to carry another
 * city's content. This module holds the pure classifier (spec K11) and the
 * per-city repair transaction; the CLI is `api/src/scripts/repair-graph-city-key.ts`.
 *
 * Classification of a PG row `P = (C, x)` against `S` = C's own row for `x`
 * (from `prepareCityProjection`, absent when `x` is not in C's file):
 *   - `lost` = every ref object of P absent from S (compared on all its fields) plus
 *     every projected field of P absent from or different in S (`label`, `type`,
 *     `source_ref`, root `props` keys, `props.properties` values).
 *   - `clean`   : `lost` is empty, OR nothing in `lost` is anchored to another city
 *     and P is not another city's row: the difference is the city's own evolution,
 *     handled by the standard guards exactly like a refresh projection.
 *   - `foreign` : `lost` is explained by the same-id row of ONE other city D (every
 *     lost ref is contained in a ref of D, every lost field has the same value in D),
 *     and the contamination is anchored: a lost ref carries a docSha that appears
 *     nowhere in C's file, or P equals D's row on every projected field (D's refs may
 *     carry fields added since, e.g. a recovered date).
 *   - `unknown` : a lost ref carries a docSha foreign to C's file but no single other
 *     city explains all of `lost` (mixed or changed content). A city with any
 *     `unknown` row is refused before any mutation.
 */
import { eq } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import { graphEdges, graphNodes } from "../../db/schema.js";
import {
  edgeKey,
  evaluateProjectionGuards,
  GraphCompletenessAbort,
  lockCityGraph,
  projectCityInTransaction,
  type CityProjection,
  type NodeRow,
  type ProjectionGuardVerdict,
  type UpsertAtomicResult,
} from "./graph-store.js";

/** The projected fields of a node row, as stored in PG and built from S3. */
export interface ComparableNodeRow {
  id: string;
  type: string;
  label: string;
  props: Record<string, unknown>;
  sourceRef: string | null;
}

export type LostElement =
  | { kind: "ref"; value: Record<string, unknown> }
  | { kind: "field"; path: string; value: unknown };

export type NodeClass = "clean" | "foreign" | "unknown";

export interface NodeClassification {
  id: string;
  class: NodeClass;
  lost: LostElement[];
  /** `foreign`: the cities whose same-id row explains every lost element. */
  explainedBy?: string[];
  reason?: string;
}

/** Same-id rows of OTHER cities, from their own S3 files: `id → [{ city, row }]`. */
export type ForeignRowIndex = ReadonlyMap<string, ReadonlyArray<{ city: string; row: ComparableNodeRow }>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Order-insensitive deep equality on JSON values (object keys unordered, arrays ordered). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => jsonEqual(a[k], b[k]));
  }
  return false;
}

function refsOf(props: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(props.refs) ? props.refs.filter(isPlainObject) : [];
}

/** `small` is contained in `big`: every field of `small` has the same value in `big`. */
function refContained(small: Record<string, unknown>, big: Record<string, unknown>): boolean {
  return Object.keys(small).every((k) => small[k] === undefined || jsonEqual(small[k], big[k]));
}

function propertiesOf(props: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(props.properties) ? props.properties : {};
}

/** Every projected element of a row, as `field` / `ref` elements. */
function elementsOf(row: ComparableNodeRow): LostElement[] {
  const out: LostElement[] = [
    { kind: "field", path: "label", value: row.label },
    { kind: "field", path: "type", value: row.type },
    { kind: "field", path: "source_ref", value: row.sourceRef },
  ];
  for (const [key, value] of Object.entries(row.props)) {
    if (key === "refs" || key === "properties" || value === undefined) continue;
    out.push({ kind: "field", path: `props.${key}`, value });
  }
  for (const [key, value] of Object.entries(propertiesOf(row.props))) {
    if (value === undefined) continue;
    out.push({ kind: "field", path: `props.properties.${key}`, value });
  }
  for (const ref of refsOf(row.props)) out.push({ kind: "ref", value: ref });
  return out;
}

function fieldValue(row: ComparableNodeRow, path: string): unknown {
  if (path === "label") return row.label;
  if (path === "type") return row.type;
  if (path === "source_ref") return row.sourceRef;
  if (path.startsWith("props.properties.")) return propertiesOf(row.props)[path.slice("props.properties.".length)];
  if (path.startsWith("props.")) return row.props[path.slice("props.".length)];
  return undefined;
}

/** `element` is present, with the same value, in `row`. */
function presentIn(element: LostElement, row: ComparableNodeRow): boolean {
  if (element.kind === "ref") return refsOf(row.props).some((ref) => refContained(element.value, ref));
  const value = fieldValue(row, element.path);
  if (element.value === null || element.value === undefined) return value === null || value === undefined;
  return jsonEqual(element.value, value);
}

/** Elements of the PG row `pg` that the projection of `s3` (C's own row, or absent) would lose. */
export function lostElements(pg: ComparableNodeRow, s3: ComparableNodeRow | undefined): LostElement[] {
  const elements = elementsOf(pg);
  if (!s3) return elements;
  return elements.filter((element) => {
    if (element.kind === "ref") return !refsOf(s3.props).some((ref) => jsonEqual(ref, element.value));
    return !presentIn(element, s3);
  });
}

const CAS_DOC_SHA = /\/cas\/([^/]+)\.[^/.]+$/;

/** docSha of a ref (its own field, else recovered from a CAS rawRef path). */
export function refDocSha(ref: Record<string, unknown>): string | null {
  if (typeof ref.docSha === "string" && ref.docSha.length > 0) return ref.docSha;
  if (typeof ref.rawRef === "string" && !ref.rawRef.startsWith("generated://")) {
    const match = ref.rawRef.match(CAS_DOC_SHA);
    if (match) return match[1]!;
  }
  return null;
}

/** Every docSha a city graph asserts, on its nodes and its edges. */
export function cityDocShas(projection: Pick<CityProjection, "nodeRows" | "edgeRows">): Set<string> {
  const out = new Set<string>();
  for (const row of [...projection.nodeRows, ...projection.edgeRows]) {
    for (const ref of refsOf(row.props)) {
      const sha = refDocSha(ref);
      if (sha) out.add(sha);
    }
  }
  return out;
}

/** Classify one PG row of city C (spec K11, see the module header). Pure. */
export function classifyNode(
  pg: ComparableNodeRow,
  s3: ComparableNodeRow | undefined,
  candidates: ReadonlyArray<{ city: string; row: ComparableNodeRow }>,
  ownDocShas: ReadonlySet<string>,
): NodeClassification {
  const lost = lostElements(pg, s3);
  if (lost.length === 0) return { id: pg.id, class: "clean", lost };

  const anchored = lost.some((element) => {
    if (element.kind !== "ref") return false;
    const sha = refDocSha(element.value);
    return sha !== null && !ownDocShas.has(sha);
  });
  const explaining = candidates.filter((candidate) => lost.every((element) => presentIn(element, candidate.row)));

  if (anchored) {
    if (explaining.length > 0) {
      return { id: pg.id, class: "foreign", lost, explainedBy: explaining.map((c) => c.city).sort() };
    }
    return {
      id: pg.id,
      class: "unknown",
      lost,
      reason: "carries a docSha foreign to the city's file, but no other city's same-id row explains every lost value",
    };
  }

  // Not anchored: foreign only when P IS the other city's row — every element of P is in D
  // and every field of D is in P (refs one way: D may have gained ref fields since, e.g. a
  // recovered date). A partial coincidence (a generic label shared by two cities) is the
  // city's own evolution, left to the standard guards.
  const wholeRow = elementsOf(pg);
  const sameRow = explaining.filter(
    (candidate) =>
      wholeRow.every((element) => presentIn(element, candidate.row)) &&
      elementsOf(candidate.row).every((element) => element.kind === "ref" || presentIn(element, pg)),
  );
  if (sameRow.length > 0) {
    return { id: pg.id, class: "foreign", lost, explainedBy: sameRow.map((c) => c.city).sort() };
  }
  return { id: pg.id, class: "clean", lost };
}

/** Ids of a city's PG rows whose content differs from the city's own S3 rows (phase 1 of the repair). */
export function idsWithLostContent(
  pgRows: readonly ComparableNodeRow[],
  projection: Pick<CityProjection, "nodeRows">,
): string[] {
  const s3ById = new Map(projection.nodeRows.map((row) => [row.id, row]));
  return pgRows.filter((row) => lostElements(row, s3ById.get(row.id)).length > 0).map((row) => row.id);
}

export function comparable(row: NodeRow | ComparableNodeRow): ComparableNodeRow {
  return { id: row.id, type: row.type, label: row.label, props: row.props ?? {}, sourceRef: row.sourceRef ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-city repair transaction
// ─────────────────────────────────────────────────────────────────────────────

export interface CityDrift {
  s3Nodes: number;
  pgNodes: number;
  idsMissingInPg: number;
  idsNotInS3: number;
  edgesMissingInPg: number;
  edgesNotInS3: number;
  /** Edges present on both sides whose props differ (evidence overwritten by another city). */
  edgesContentDiff: number;
}

export type RepairVerdict = "pass" | "refused-unknown" | "refused-guard" | "error";

export interface CityRepairReport {
  city: string;
  mode: "preview" | "apply";
  drift: CityDrift;
  classes: Record<NodeClass, number>;
  foreignNodes: Array<{ id: string; explainedBy: string[] }>;
  unknownNodes: Array<{ id: string; reason: string }>;
  /** The three guards against the FULL current rows (what a plain projection gets today). */
  before: ProjectionGuardVerdict;
  /** The repair projection against the baseline minus the `foreign` rows. */
  verdict: RepairVerdict;
  reason?: string | undefined;
  /** Committed (apply) or simulated then rolled back (preview). */
  applied: boolean;
  result?: Pick<UpsertAtomicResult, "nodeCount" | "edgeCount" | "deletedNodes" | "deletedEdges" | "deletedStaleEdges">;
  /** The repair would change nothing: no drift and no foreign row. */
  noop: boolean;
}

class RollbackPreview extends Error {
  constructor() {
    super("preview: rolled back");
  }
}

class RepairRefused extends Error {}

/**
 * Repair one city in ONE transaction, all or nothing (spec K10): per-city lock,
 * current rows read under the lock, classification, refusal before any mutation
 * if a row is `unknown`, then the standard projection with the `foreign` rows out
 * of the guard baseline. `preview` runs the same code path and always rolls back.
 */
export async function repairCity(
  db: Database,
  projection: CityProjection,
  foreignIndex: ForeignRowIndex,
  mode: "preview" | "apply",
): Promise<CityRepairReport> {
  const city = projection.citySlug;
  const report: CityRepairReport = {
    city,
    mode,
    drift: { s3Nodes: projection.nodeRows.length, pgNodes: 0, idsMissingInPg: 0, idsNotInS3: 0, edgesMissingInPg: 0, edgesNotInS3: 0, edgesContentDiff: 0 },
    classes: { clean: 0, foreign: 0, unknown: 0 },
    foreignNodes: [],
    unknownNodes: [],
    before: { verdict: "pass" },
    verdict: "pass",
    applied: false,
    noop: false,
  };
  const ownShas = cityDocShas(projection);
  const s3ById = new Map(projection.nodeRows.map((row) => [row.id, comparable(row)]));

  try {
    await db.transaction(async (tx) => {
      await lockCityGraph(tx, city);
      const pgRows = (
        await tx
          .select({ id: graphNodes.id, type: graphNodes.type, label: graphNodes.label, props: graphNodes.props, sourceRef: graphNodes.sourceRef })
          .from(graphNodes)
          .where(eq(graphNodes.citySlug, city))
      ).map((row) => comparable({ ...row, props: (row.props ?? {}) as Record<string, unknown> }));
      const pgEdges = await tx
        .select({ srcId: graphEdges.srcId, dstId: graphEdges.dstId, kind: graphEdges.kind, props: graphEdges.props })
        .from(graphEdges)
        .where(eq(graphEdges.citySlug, city));

      const pgIds = new Set(pgRows.map((row) => row.id));
      const s3EdgeProps = new Map(projection.edgeRows.map((edge) => [edgeKey(edge), edge.props]));
      const s3EdgeKeys = new Set(s3EdgeProps.keys());
      const pgEdgeKeys = new Set(pgEdges.map(edgeKey));
      report.drift = {
        s3Nodes: projection.nodeRows.length,
        pgNodes: pgRows.length,
        idsMissingInPg: [...s3ById.keys()].filter((id) => !pgIds.has(id)).length,
        idsNotInS3: pgRows.filter((row) => !s3ById.has(row.id)).length,
        edgesMissingInPg: [...s3EdgeKeys].filter((key) => !pgEdgeKeys.has(key)).length,
        edgesNotInS3: [...pgEdgeKeys].filter((key) => !s3EdgeKeys.has(key)).length,
        // A-R5-1: an edge triple shared by two cities had its props overwritten by the other city
        // while the nodes were protected; key presence alone does not see it.
        edgesContentDiff: pgEdges.filter((edge) => {
          const expected = s3EdgeProps.get(edgeKey(edge));
          return expected !== undefined && !jsonEqual(edge.props ?? {}, expected);
        }).length,
      };

      const foreignIds = new Set<string>();
      for (const row of pgRows) {
        const candidates = (foreignIndex.get(row.id) ?? []).filter((candidate) => candidate.city !== city);
        const classification = classifyNode(row, s3ById.get(row.id), candidates, ownShas);
        report.classes[classification.class] += 1;
        if (classification.class === "foreign") {
          foreignIds.add(row.id);
          report.foreignNodes.push({ id: row.id, explainedBy: classification.explainedBy ?? [] });
        } else if (classification.class === "unknown") {
          report.unknownNodes.push({ id: row.id, reason: classification.reason ?? "" });
        }
      }

      report.before = evaluateProjectionGuards(city, pgRows, projection.nodeRows);
      const d = report.drift;
      report.noop =
        foreignIds.size === 0 && report.unknownNodes.length === 0 && d.idsMissingInPg === 0 && d.idsNotInS3 === 0 &&
        d.edgesMissingInPg === 0 && d.edgesNotInS3 === 0 && d.edgesContentDiff === 0;

      if (report.unknownNodes.length > 0) {
        report.verdict = "refused-unknown";
        report.reason = `${report.unknownNodes.length} node(s) classified unknown; city refused before any mutation`;
        throw new RepairRefused(report.reason);
      }

      const result = await projectCityInTransaction(tx, projection, { baselineExcludeIds: foreignIds });
      if (result.aborted) {
        report.verdict = "refused-guard";
        report.reason = result.reason;
        throw new RepairRefused(result.reason);
      }
      report.result = {
        nodeCount: result.nodeCount,
        edgeCount: result.edgeCount,
        deletedNodes: result.deletedNodes,
        deletedEdges: result.deletedEdges,
        deletedStaleEdges: result.deletedStaleEdges,
      };
      if (mode === "preview") throw new RollbackPreview();
    });
    report.applied = mode === "apply";
  } catch (err) {
    if (err instanceof RollbackPreview || err instanceof RepairRefused) return report;
    if (err instanceof GraphCompletenessAbort) {
      report.verdict = "refused-guard";
      report.reason = err.result.reason;
      return report;
    }
    report.verdict = "error";
    report.reason = err instanceof Error ? err.message : String(err);
  }
  return report;
}
