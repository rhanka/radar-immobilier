import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema } from "./common.js";

/**
 * Bitemporal span (SPEC_DESIGN_DATA_MODEL §1.0, SPEC_ONTOLOGY §4.4 D5).
 *
 * Two orthogonal time axes:
 * - validity-time  (`validFrom`/`validTo`): when the regulatory fact is TRUE in
 *   the world (adoption / entry into force). Comes from the source.
 * - knowledge-time (`knownFrom`/`knownTo`): when radar KNEW it. `knownFrom`
 *   equals the reconciliation `patch.created_at` (a DECISION date, not the
 *   document date). Closed by a compensating patch.
 *
 * `validTo` / `knownTo` = null  =>  open (current) version.
 */
export const TemporalSpan = z.object({
  /** Regulatory effect date (when the fact becomes true in the world). */
  validFrom: isoDateSchema,
  /** End of validity (exclusive). null = still valid / current. */
  validTo: isoDateSchema.nullable().default(null),
  /** First time radar knew this fact (= reconciliation patch.created_at). */
  knownFrom: isoDateTimeSchema,
  /** When this knowledge was superseded by a compensating patch. null = still believed. */
  knownTo: isoDateTimeSchema.nullable().default(null),
});
export type TemporalSpanT = z.infer<typeof TemporalSpan>;

/** Anything carrying a bitemporal span (a versioned projection row). */
export interface TemporallySpanned {
  temporal: TemporalSpanT;
}

const lte = (a: string, b: string): boolean => a <= b;
/** Strict "a < b" on ISO date OR datetime strings (lexicographic order is chronological for ISO-8601). */
const lt = (a: string, b: string): boolean => a < b;

/**
 * Is `span` the applicable validity-time version at instant `at`
 * (an ISO date `YYYY-MM-DD` or ISO datetime), ignoring knowledge-time?
 *
 * Window semantics: `[validFrom, validTo)` — inclusive start, exclusive end,
 * matching the SQL resolution in SPEC_DESIGN_DATA_MODEL §3.1.
 */
export const isValidAt = (span: TemporalSpanT, at: string): boolean =>
  lte(span.validFrom, at) && (span.validTo === null || lt(at, span.validTo));

/**
 * Is `span` known to radar at knowledge instant `knownAt` (ISO datetime)?
 * Window `[knownFrom, knownTo)`.
 */
export const isKnownAt = (span: TemporalSpanT, knownAt: string): boolean =>
  lte(span.knownFrom, knownAt) && (span.knownTo === null || lt(knownAt, span.knownTo));

/**
 * As-of-date resolution (SPEC_ONTOLOGY §3, SPEC_DESIGN_DATA_MODEL §3).
 *
 * Resolve, among the versions of a single entity, the one applicable at validity
 * instant `at`. Two variants, controlled by `knownAt`:
 * - validity-time only (`knownAt` omitted): take the most recently-known open
 *   version that is valid at `at` (`knownTo === null`). "Reality as radar
 *   currently believes it."
 * - bitemporal (`knownAt` provided): additionally restrict to versions known at
 *   `knownAt`. "What radar believed at knowledge-time K." Enables score freezing
 *   (§7.5) and audit replay.
 *
 * Returns the single applicable version, or `null` if none. When several versions
 * qualify, the one with the latest `validFrom`, then latest `knownFrom`, wins —
 * mirroring the `ORDER BY valid_from DESC, known_from DESC LIMIT 1` SQL contract.
 *
 * NOTE: this is the validity/bitemporal RESOLUTION over already-projected
 * versions. The projection job (`projectAsOf`, §4.4) that replays patches up to a
 * knowledge instant is a separate, later concern (radar projection layer), not
 * part of this pure helper.
 */
export const resolveAsOf = <T extends TemporallySpanned>(
  versions: readonly T[],
  at: string,
  knownAt?: string,
): T | null => {
  const candidates = versions.filter((v) => {
    if (!isValidAt(v.temporal, at)) return false;
    if (knownAt === undefined) return v.temporal.knownTo === null;
    return isKnownAt(v.temporal, knownAt);
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, v) => {
    if (lt(best.temporal.validFrom, v.temporal.validFrom)) return v;
    if (best.temporal.validFrom === v.temporal.validFrom && lt(best.temporal.knownFrom, v.temporal.knownFrom)) {
      return v;
    }
    return best;
  });
};

/**
 * Knowledge-time projection cut (SPEC_ONTOLOGY §4.4 `projectAsOf(knownAt)`).
 *
 * Restrict a set of versioned rows to the knowledge state radar had at `knownAt`:
 * keep versions whose knowledge window `[knownFrom, knownTo)` contains `knownAt`.
 * Combined with validity-time resolution this realises bitemporality
 * ("regulatory state at T, as known at K"). This is the pure, in-memory analogue
 * of replaying `applied-patches.jsonl` with `created_at <= knownAt`.
 */
export const projectAsOf = <T extends TemporallySpanned>(
  versions: readonly T[],
  knownAt: string,
): T[] => versions.filter((v) => isKnownAt(v.temporal, knownAt));
