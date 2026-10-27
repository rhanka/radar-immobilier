/**
 * 6J lot target identity and displayed source version.
 *
 * The stable target is the qualified native identity (city + canonical
 * id), never the version UUID. `citySlug` and `canonicalId` are accepted
 * only after resolution against `lot_versions`: exactly one current
 * validated row must exist. A matching lot number, similar geometry, or a
 * near-identical canonical spelling never merges identities.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { lotVersions } from "../../../db/schema.js";
import { canonicalJson, digest, FacetError } from "../target.js";

export interface LotTarget {
  type: "Lot";
  authority: "lot_versions";
  citySlug: string;
  canonicalId: string;
}

export interface DisplayedLotVersion {
  lot_version_id: string;
  fingerprint: string;
}

export type LotMode = "real" | "simulation";

export class LotHeadConflictError extends FacetError {
  readonly current: {
    target: LotTarget;
    version: DisplayedLotVersion | null;
    heads: unknown[];
  };
  constructor(current: {
    target: LotTarget;
    version: DisplayedLotVersion | null;
    heads: unknown[];
  }) {
    super(409, "facet_head_conflict");
    this.name = "LotHeadConflictError";
    this.current = current;
  }
}

export class LotVersionConflictError extends FacetError {
  readonly current: {
    target: LotTarget;
    version: DisplayedLotVersion | null;
    heads: unknown[];
  };
  constructor(current: {
    target: LotTarget;
    version: DisplayedLotVersion | null;
    heads: unknown[];
  }) {
    super(409, "target_version_conflict");
    this.name = "LotVersionConflictError";
    this.current = current;
  }
}

export class LotIdentityError extends FacetError {
  constructor() {
    super(409, "lot_identity_unresolved");
    this.name = "LotIdentityError";
  }
}

type LotVersionRow = typeof lotVersions.$inferSelect;

function isCurrent(row: LotVersionRow): boolean {
  return row.validTo === null && row.knownTo === null;
}

/**
 * Fingerprint of the stored source fields used by the lot response:
 * identity, reconciliation/temporal fields, geometry and source evidence.
 * Business facet heads are outside this fingerprint.
 */
export function lotFingerprint(row: LotVersionRow): string {
  return digest({
    authority: "lot_versions",
    canonical_id: row.canonicalId,
    city_slug: row.citySlug,
    no_lot: row.noLot,
    no_lot_norm: row.noLotNorm ?? null,
    recon_status: row.reconStatus,
    recon_patch_id: row.reconPatchId ?? null,
    valid_from: row.validFrom,
    valid_to: row.validTo,
    known_from: row.knownFrom instanceof Date ? row.knownFrom.toISOString() : row.knownFrom,
    known_to: row.knownTo instanceof Date ? row.knownTo?.toISOString() ?? null : row.knownTo,
    geom: row.geom ?? null,
    geom_source: row.geomSource,
    geom_fetched_at: row.geomFetchedAt instanceof Date
      ? row.geomFetchedAt.toISOString()
      : row.geomFetchedAt,
    raw_ref: row.rawRef,
    evidence: row.evidence ?? null,
  });
}

export interface ResolvedLotSource {
  row: LotVersionRow;
  fingerprint: string;
  displayed: DisplayedLotVersion;
}

/**
 * Resolve the stable target to its single current qualified source row.
 * Missing, ambiguous, or no-longer-qualified identities fail explicitly;
 * no newest-row shortcut ever selects a version.
 */
export async function resolveLotSource(
  db: Pick<Database, "select">,
  target: Pick<LotTarget, "citySlug" | "canonicalId">,
): Promise<ResolvedLotSource> {
  const rows = await db.select().from(lotVersions).where(and(
    eq(lotVersions.citySlug, target.citySlug),
    eq(lotVersions.canonicalId, target.canonicalId),
  ));
  const current = rows.filter(isCurrent);
  if (current.length !== 1 || current[0]!.reconStatus !== "validated") {
    throw new LotIdentityError();
  }
  const row = current[0]!;
  const fingerprint = lotFingerprint(row);
  return { row, fingerprint, displayed: { lot_version_id: row.id, fingerprint } };
}

/** Compare the displayed version: UUID replacement and same-UUID content changes both conflict. */
export function assertDisplayedLotVersion(
  resolved: ResolvedLotSource, displayed: DisplayedLotVersion,
): void {
  if (resolved.row.id !== displayed.lot_version_id || resolved.fingerprint !== displayed.fingerprint) {
    throw new LotVersionConflictError({ target: toLotTarget(resolved.row), version: resolved.displayed, heads: [] });
  }
}

export function toLotTarget(row: Pick<LotVersionRow, "citySlug" | "canonicalId">): LotTarget {
  return { type: "Lot", authority: "lot_versions", citySlug: row.citySlug, canonicalId: row.canonicalId };
}

export function canonicalLotTarget(target: LotTarget): string {
  return canonicalJson([[target.citySlug, target.canonicalId]]);
}
