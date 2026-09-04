/**
 * graph-candidate-check — read-only pre-flight predictor for a grounded graph
 * candidate BEFORE it is projected into Postgres.
 *
 * The §7 grounding pipeline publishes `graph/<city>/latest.json` (a candidate)
 * to MinIO, then `project-graph-from-s3` calls `upsertGraphAtomic`, which aborts
 * the whole city (0 data loss) if the candidate would REGRESS the city graph.
 * Two gates can abort:
 *   1. business-property regression — an existing key under `props.properties`
 *      (reglement_number, effet_densifiant, etape, instrument, …) disappears or
 *      degrades on a node (upsertGraphAtomic step 4);
 *   2. completeness regression — fewer "complete" Signal/DesignationEvent nodes
 *      (citation + rawRef) after than before (upsertGraphAtomic step 5).
 *
 * For a 98-city cohort, discovering an abort only when the projection runs is
 * expensive. `predictProjectionAbort` replays BOTH gates read-only against the
 * current PG snapshot, so an operator can validate every candidate before the
 * cohort writes anything. It is drift-proof by construction: it calls the SAME
 * exported guard functions upsertGraphAtomic uses — it does not reimplement them.
 *
 * REPLACE semantics make gate 2 computable without a write: the post-projection
 * city node set == the candidate node set, so `completeAfter` is counted directly
 * over the candidate.
 */
import {
  buildNodeRow,
  mergeNodeRows,
  findMissingBusinessProperties,
  findMissingSourceRefs,
  countCompleteSignals,
  graphifyGraphSchema,
  type BusinessPropertyRegression,
  type SourceRefRegression,
} from "./graph-store.js";

/** A single current-PG node snapshot row for the city under test. */
export interface CandidatePreflightSnapshotRow {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

export interface CandidatePreflightResult {
  citySlug: string;
  /** true if `upsertGraphAtomic` would abort this city (either gate fires). */
  wouldAbort: boolean;
  /** Gate 1 findings: nodes whose business-properties would disappear/degrade. */
  propertyRegressions: BusinessPropertyRegression[];
  /** Gate 3 findings: nodes whose source docSha (provenance) would disappear. */
  sourceRefRegressions: SourceRefRegression[];
  /** Gate 2: complete signals in the current PG snapshot. */
  completeBefore: number;
  /** Gate 2: complete signals the candidate would leave (REPLACE → == candidate). */
  completeAfter: number;
  /** Gate 2 verdict: completeAfter < completeBefore. */
  completenessRegression: boolean;
  /** Number of (merged) nodes in the candidate. */
  candidateNodeCount: number;
  /** Human-readable abort reasons (empty when wouldAbort is false). */
  reasons: string[];
}

/**
 * Predict whether `upsertGraphAtomic(db, citySlug, graphJson, intendedRemovals)`
 * would abort — read-only, no DB write. Mirrors the guard's two gates exactly by
 * reusing its exported functions.
 *
 * Throws (like upsertGraphAtomic) if the candidate fails `graphifyGraphSchema`:
 * a structurally invalid candidate would fail projection with an ERROR, not an
 * abort — the caller distinguishes the two.
 *
 * @param citySlug        City scope (injected on candidate nodes, as the projection does).
 * @param beforeRows      Current PG node snapshot for this city ({id, type, props}).
 * @param graphJson       The candidate (parsed graph/<city>/latest.json).
 * @param intendedRemovals Node ids removed ON PURPOSE (exempt from gate 1), as upsertGraphAtomic.
 */
export function predictProjectionAbort(
  citySlug: string,
  beforeRows: readonly CandidatePreflightSnapshotRow[],
  graphJson: unknown,
  intendedRemovals: ReadonlySet<string> = new Set(),
): CandidatePreflightResult {
  const parsed = graphifyGraphSchema.parse(graphJson);
  const nodeRows = mergeNodeRows(parsed.nodes.map((n) => buildNodeRow(n, citySlug)));

  // Gate 1 — business-property regression (upsertGraphAtomic step 4). Same call,
  // same args: current snapshot as "before", candidate node rows as "after".
  const propertyRegressions = findMissingBusinessProperties(
    beforeRows.map((row) => ({ id: row.id, props: row.props })),
    nodeRows,
    citySlug,
    intendedRemovals,
  );

  // Gate 3 — source-ref provenance regression (upsertGraphAtomic, after gate1).
  // Same call, same args: a node's existing source docSha must not disappear.
  const sourceRefRegressions = findMissingSourceRefs(
    beforeRows.map((row) => ({ id: row.id, props: row.props })),
    nodeRows,
    citySlug,
    intendedRemovals,
  );

  // Gate 2 — completeness regression (upsertGraphAtomic step 5). REPLACE makes
  // the post-projection city node set == the candidate, so completeAfter is
  // counted over the candidate directly. countCompleteSignals filters to
  // SIGNAL_NODE_TYPES internally, matching the guard's after-query filter.
  const completeBefore = countCompleteSignals(
    beforeRows.map((r) => ({ type: r.type, props: r.props })),
    { ignoreProvisional: true },
  );
  const completeAfter = countCompleteSignals(
    nodeRows.map((r) => ({ type: r.type, props: r.props })),
    { ignoreProvisional: true },
  );
  const completenessRegression = completeAfter < completeBefore;

  const reasons: string[] = [];
  if (propertyRegressions.length > 0) {
    const details = propertyRegressions
      .map(({ nodeId, missingKeys }) => `${nodeId}: ${missingKeys.join(", ")}`)
      .join("; ");
    reasons.push(
      `business-property regression for ${citySlug}: existing values would ` +
        `disappear or degrade (${details})`,
    );
  }
  if (sourceRefRegressions.length > 0) {
    const details = sourceRefRegressions
      .map(({ nodeId, missingDocShas }) => `${nodeId}: ${missingDocShas.join(", ")}`)
      .join("; ");
    reasons.push(
      `source-ref provenance regression for ${citySlug}: existing source ` +
        `docSha(s) would disappear (${details})`,
    );
  }
  if (completenessRegression) {
    reasons.push(
      `completeness regression for ${citySlug}: complete signals ` +
        `${completeBefore} → ${completeAfter}`,
    );
  }

  return {
    citySlug,
    wouldAbort:
      propertyRegressions.length > 0 ||
      sourceRefRegressions.length > 0 ||
      completenessRegression,
    propertyRegressions,
    sourceRefRegressions,
    completeBefore,
    completeAfter,
    completenessRegression,
    candidateNodeCount: nodeRows.length,
    reasons,
  };
}
