/** Qualified 6K manifest expectations and persisted projection comparisons. */
import type { LotMigrationReport } from "../lot-migration-report/manifest.js";
import type { CutoverReadbackHead } from "./lot-cutover-readback.js";
import type { ExpectedCutoverHeadValue } from "./lot-cutover-types.js";
import { cutoverTargetKey, isProjectableHead } from "./lot-project.js";
import { normalizeAskingPrice } from "./lot-values.js";
import { ScopeError } from "../scope.js";
import type { LotEventSnapshot } from "./lot-response.js";

const READY_TARGET_PATTERN = /^dest:(.+)::(.+)::(real|simulation)$/;

interface ParsedReadyTarget {
  key: string;
  city: string;
  mode: "real" | "simulation";
}

/**
 * Parse every ready target key from the qualified manifest and D5
 * dispositions. Any unverifiable key fails closed: an expectation the
 * readback cannot verify never counts as verified.
 */
export function parseReadyTargetKeys(readyTargets: readonly string[]): ParsedReadyTarget[] {
  return readyTargets.map((key) => {
    const match = READY_TARGET_PATTERN.exec(key);
    const city = match?.[1] || undefined;
    const mode = match?.[3] === "real" ? "real"
      : match?.[3] === "simulation" ? "simulation" : undefined;
    if (!city || !mode) {
      throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
    }
    return { key, city, mode };
  });
}

/**
 * Expected persisted head values for every ready target: the terminal
 * mapped row, or the conflict row named by an `activate` D5 disposition.
 * Targets without a winning row carry no expectation and fail closed at
 * the coverage check.
 */
export function expectedCutoverHeadValues(
  report: LotMigrationReport, activatedSourceIds: readonly string[] = [],
): ExpectedCutoverHeadValue[] {
  const activated = new Set(activatedSourceIds);
  const expected: ExpectedCutoverHeadValue[] = [];
  for (const winner of report.rows) {
    if (!isProjectableHead(winner, report.destinationsQualified, activated) || !winner.destination) continue;
    expected.push({
      targetKey: cutoverTargetKey(winner),
      sourceId: winner.sourceId,
      facet: winner.destination.facet,
      statut: winner.observed.statut,
      prixDemande: winner.observed.prixDemande,
      lienAnnonce: winner.observed.lienAnnonce,
    });
  }
  return expected;
}

function sameAskingPrice(expected: string | null, observed: string | null): boolean {
  if (expected === null || observed === null) return expected === observed;
  try {
    return normalizeAskingPrice(expected) === normalizeAskingPrice(observed);
  } catch {
    return false;
  }
}

/** Pure per-target values comparison between one persisted head and its expectation. */
export function cutoverHeadMatchesExpected(
  head: CutoverReadbackHead, expected: ExpectedCutoverHeadValue,
): boolean {
  const matches = (slot: LotEventSnapshot | null) => slot !== null && slot.state === "active"
    && slot.facet === expected.facet && slot.source?.sourceRowId === expected.sourceId;
  switch (expected.facet) {
    case "selection":
      return head.selection.some((entry) => entry.scope === "workspace" && matches(entry));
    case "pipeline":
      return matches(head.pipeline) && head.pipeline !== null
        && (head.pipeline.pipelineStatus ?? null) === expected.statut;
    case "market":
      return matches(head.market) && head.market !== null
        && sameAskingPrice(expected.prixDemande, head.market.askingPrice)
        && (head.market.listingUrl ?? null) === (expected.lienAnnonce ?? null);
    case "archive": {
      return matches(head.archive.workspace);
    }
    default:
      return false;
  }
}

/**
 * Pure coverage and values gate: every ready target must resolve to a
 * persisted head, and every head must carry the values expected from the
 * qualified manifest. Reading projections without using them never
 * qualifies; any gap or divergence fails closed before opening.
 */
export function checkCutoverReadbackCoverage(
  readyTargetKeys: readonly string[],
  observed: ReadonlyMap<string, CutoverReadbackHead>,
  expectedHeads: readonly ExpectedCutoverHeadValue[],
): void {
  for (const key of readyTargetKeys) {
    if (!observed.has(key)) throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
  }
  for (const key of readyTargetKeys) {
    const expected = expectedHeads.filter((entry) => entry.targetKey === key);
    const head = observed.get(key);
    if (expected.length === 0 || !head || expected.some((entry) => !cutoverHeadMatchesExpected(head, entry))) {
      throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
    }
  }
}
