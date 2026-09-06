/**
 * job-health — does a worker-live run's OUTCOME mean the Job (process) failed,
 * and how loud should the run be about degradation?
 *
 * A per-city `status:"error"` in the recap is a SOURCE failure: the city is
 * unreachable, returns HTTP 4xx, or a fetch failed. That is a normal, expected
 * data-quality event (dozens of the ~528 config-only cities each run) and does
 * NOT by itself mean the run failed — the raw capture / PG feed still succeeded
 * and the upsert is idempotent. Exiting non-zero on it makes the nightly refresh
 * CronJob (backoffLimit:1 + restartPolicy:Never) FAIL every night and trigger a
 * wasteful full re-scrape retry that the 2h activeDeadlineSeconds then kills.
 *
 * So the verdict is TWO axes, not one:
 *   - `code` (0|1) — did the run's MACHINERY run? Exit 1 ONLY on a systemic
 *     failure, across two sub-axes:
 *       EXPLOITATION: exploitation was asked for but structurally cannot produce
 *         signal — `pdftotext` (poppler) is missing (every PV extracts to empty),
 *         or a PG feed was expected yet nothing was upserted despite cities being
 *         fetched (a broken exploitation / PG-write path).
 *       RECUEIL: the per-city fetch-error RATE reached `maxErrorRate` (the whole
 *         run erroring points at infra / network / a source-provider outage, not
 *         at individual unreachable cities).
 *   - `warn` ("none"|"normal"|"elevated") — the fetch-degradation TIER, reported
 *     truthfully regardless of `code`. "elevated" (rate ≥ `elevatedWarnRate`) is
 *     an alertable degradation that is not yet fatal; "normal" is the routine
 *     handful of per-city source errors; "none" is a clean fetch axis. The two
 *     axes are independent: a run can be `code:1` (exploitation broken) with
 *     `warn:"none"` (fetch axis clean), or `code:0` with `warn:"elevated"`.
 *
 * Logic order is first-match-wins for `code`; `warn` is the fetch tier and is
 * always the truthful degradation level for the given error rate.
 *
 * Pure/deterministic: the caller passes the thresholds and preflight facts
 * (parsed / probed at the edge), so this reads no environment and is
 * unit-testable without a process, a filesystem, or a database.
 */
export type JobHealth = {
  readonly code: 0 | 1;
  readonly warn: "none" | "normal" | "elevated";
  readonly reason: string;
};

export function assessJobHealth(input: {
  readonly errorCount: number;
  readonly cityCount: number;
  readonly maxErrorRate: number; // FATAL fetch-error rate (systemic RECUEIL failure).
  readonly elevatedWarnRate: number; // alertable degradation rate (< maxErrorRate).
  readonly exploitRequested: boolean; // exploit || reexploit.
  readonly feedExpected: boolean; // pgFeed.feed — a direct PG feed was wired.
  readonly upserted: number; // cities whose graph was upserted to PG.
  readonly pdftotextAvailable: boolean; // poppler present (exploitation can extract).
}): JobHealth {
  const {
    errorCount,
    cityCount,
    maxErrorRate,
    elevatedWarnRate,
    exploitRequested,
    feedExpected,
    upserted,
    pdftotextAvailable,
  } = input;

  if (cityCount === 0) {
    return { code: 0, warn: "none", reason: "no cities processed" };
  }

  const errorRate = errorCount / cityCount;
  const fetched = cityCount - errorCount;
  // Fetch-degradation tier — truthful for the given rate, independent of `code`.
  const warn: JobHealth["warn"] =
    errorRate >= elevatedWarnRate ? "elevated" : errorCount > 0 ? "normal" : "none";

  // EXPLOITATION axis (systemic, exit 1) — first match wins.
  if (exploitRequested && !pdftotextAvailable) {
    return {
      code: 1,
      warn,
      reason:
        "systemic: pdftotext (poppler) missing — exploitation yields 0 signal " +
        "for every city (misconfigured image)",
    };
  }
  if (feedExpected && fetched > 0 && upserted === 0) {
    return {
      code: 1,
      warn,
      reason: `systemic: exploitation produced nothing — ${fetched} cities fetched, 0 upserted (broken exploitation/PG-write path)`,
    };
  }

  // RECUEIL axis (systemic, exit 1).
  if (errorRate >= maxErrorRate) {
    return {
      code: 1,
      warn,
      reason: `systemic fetch failure: ${errorCount}/${cityCount} errored (rate ${errorRate} ≥ ${maxErrorRate})`,
    };
  }

  // Non-fatal (exit 0), by degradation tier.
  if (warn === "elevated") {
    return {
      code: 0,
      warn: "elevated",
      reason: `elevated fetch-error rate ${errorCount}/${cityCount} (rate ${errorRate} ≥ ${elevatedWarnRate}) — degradation, not fatal`,
    };
  }
  if (errorCount > 0) {
    return {
      code: 0,
      warn: "normal",
      reason: `${errorCount}/${cityCount} per-city source errors tolerated`,
    };
  }
  return { code: 0, warn: "none", reason: "clean run" };
}
