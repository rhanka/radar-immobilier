/**
 * pg-feed-decision — should worker-live feed Postgres directly during
 * EXPLOITATION, and (by building a handle) is an unreachable DB fatal?
 *
 * `POSTGRES_*` all carry schema defaults (host `postgres`, password
 * `changeme-dev-only`; see `api/src/config.ts`), so the PARSED config cannot tell
 * "a real DB was wired" from "defaults were used". The honest signal that a job
 * actually wired Postgres is the explicit presence of the credential the DB
 * secret injects — `POSTGRES_PASSWORD` (from `radar-db-credentials`).
 *
 *   - No exploitation requested      → no feed.
 *   - `--reexploit`                  → feed. Reexploit exists ONLY to (re)project
 *                                      stored raw into PG, so it always builds a
 *                                      handle and is fail-loud downstream (incl.
 *                                      when creds are absent → the default
 *                                      password fails the ping → exit(1)).
 *   - plain exploit + creds present  → feed (fail-loud if the DB is unreachable).
 *   - plain exploit + NO creds       → NO feed: run S3-only and log "PG feed: OFF"
 *                                      + a warning. The boot/OOM pinned-image diag
 *                                      and the 33/33b/34 scrape jobs take this
 *                                      path — PG is fed by the dedicated S3→PG
 *                                      projection step, not by worker-live, so
 *                                      those jobs must not be forced to reach a DB
 *                                      they were never given credentials for.
 *
 * Pure (the environment is injected) so it is unit-testable without a process,
 * argv, or a database.
 */
export type PgFeedDecision =
  | { readonly feed: false; readonly reason: string }
  | { readonly feed: true };

export function decidePgFeed(input: {
  readonly exploit: boolean;
  readonly reexploit: boolean;
  // Just the credential we key on; optional so `process.env` (a string Dict) and
  // a bare `{}` in tests both satisfy it.
  readonly env: { readonly POSTGRES_PASSWORD?: string | undefined };
}): PgFeedDecision {
  if (!input.exploit && !input.reexploit) {
    return { feed: false, reason: "no exploitation requested" };
  }
  // Reexploit's whole purpose is the PG feed → always feed (fail-loud downstream).
  if (input.reexploit) return { feed: true };
  const password = input.env.POSTGRES_PASSWORD;
  if (password !== undefined && password !== "") return { feed: true };
  return {
    feed: false,
    reason:
      "POSTGRES_PASSWORD not set — no DB credentials wired; exploitation runs " +
      "S3-only and the dedicated S3→PG projection step feeds Postgres",
  };
}
