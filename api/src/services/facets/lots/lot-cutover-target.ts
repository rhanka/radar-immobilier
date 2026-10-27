import { and, eq, or } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { lotVersions } from "../../../db/schema.js";
import { FacetError } from "../target.js";
import { readLotCutover, readCutoverTargets } from "./lot-cutover-status.js";
import type { LotTarget } from "./lot-target.js";

/** Destination key for a resolved lot target in one mode. */
export function destCutoverKeyFor(target: LotTarget, mode: string): string {
  return `dest:${target.citySlug}::${target.canonicalId}::${mode}`;
}

/**
 * Native key for the same canonical identity. Histories without a
 * qualified destination are stored under this form, so the guard must
 * consult it too: a target that qualifies after the cutover keeps the
 * canonical identity its pending history already names.
 */
export function nativeCanonicalCutoverKeyFor(target: LotTarget): string {
  return `native:canonical:${JSON.stringify([target.citySlug, target.canonicalId])}`;
}

/**
 * Every excluded cutover identity: unavailable plus pending target keys
 * in any stored key form.
 */
export async function readBlockedCutoverKeys(
  db: Database, workspaceId: string,
): Promise<Set<string>> {
  const targets = await readCutoverTargets(db, workspaceId);
  const blocked = new Set([
    ...targets.unavailable,
    ...targets.pending.map((entry) => entry.targetKey),
  ]);
  const fallbacks = [...blocked].filter((key) => key.startsWith("native:denormalized:"))
    .map((key) => JSON.parse(key.slice("native:denormalized:".length)) as [string, string]);
  if (fallbacks.length > 0) {
    const aliases = await db.select().from(lotVersions).where(or(...fallbacks.map(
      ([city, noLot]) => and(eq(lotVersions.citySlug, city), eq(lotVersions.noLot, noLot)))));
    for (const lot of aliases) blocked.add(nativeCanonicalCutoverKeyFor({
      type: "Lot", authority: "lot_versions", citySlug: lot.citySlug, canonicalId: lot.canonicalId,
    }));
  }
  return blocked;
}

/** True when the canonical target is excluded in any stored key form. */
export function isCutoverBlockedTarget(
  blocked: ReadonlySet<string>, target: LotTarget, mode: string,
): boolean {
  if (blocked.size === 0) return false;
  return blocked.has(destCutoverKeyFor(target, mode))
    || blocked.has(nativeCanonicalCutoverKeyFor(target));
}

/**
 * Pending targets never masquerade as unmarked and accept no commands.
 * The exclusion follows the canonical identity in every key form: the
 * destination key consulted by qualified readers and writers, the native
 * canonical key carried by unresolved histories, and the denormalized
 * fallback that resolves to this target once its version qualifies.
 */
export async function assertCutoverTargetReady(
  db: Database, workspaceId: string, mode: string, target: LotTarget,
): Promise<void> {
  if (!(await readLotCutover(db, workspaceId)).manifestSha) return;
  const targets = await readCutoverTargets(db, workspaceId);
  if (targets.unavailable.length === 0 && targets.pending.length === 0) return;
  const unavailable = new Set(targets.unavailable);
  const pending = new Set(targets.pending.map((entry) => entry.targetKey));
  const candidates = [destCutoverKeyFor(target, mode), nativeCanonicalCutoverKeyFor(target)];
  for (const noLot of await denormalizedNoLots(db, target)) {
    candidates.push(`native:denormalized:${JSON.stringify([target.citySlug, noLot])}`);
  }
  if (candidates.some((key) => unavailable.has(key))) {
    throw new FacetError(409, "lot_target_unavailable");
  }
  if (candidates.some((key) => pending.has(key))) {
    throw new FacetError(409, "lot_target_pending");
  }
}

/**
 * denormalized fallback spellings that resolve to this canonical target.
 * Only consulted when another cutover exclusion exists; targets without
 * any history stay available.
 */
async function denormalizedNoLots(db: Database, target: LotTarget): Promise<string[]> {
  const rows = await db.select({ noLot: lotVersions.noLot }).from(lotVersions).where(and(
    eq(lotVersions.citySlug, target.citySlug),
    eq(lotVersions.canonicalId, target.canonicalId)));
  return [...new Set(rows.map((row) => row.noLot))];
}
