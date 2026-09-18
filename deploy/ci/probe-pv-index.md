# PV HTTP 404 investigation (#723)

The conductor runs this dependency-free Node 24 script **inside an approved
preproduction pod**. No cluster action is performed by this change. Copy
`deploy/ci/probe-pv-index.mjs` to `/tmp/probe-pv-index.mjs` in that pod through
the cluster lane's approved execution workflow, then execute:

```sh
node /tmp/probe-pv-index.mjs drummondville saint-henri
```

More cities can be supplied as `CITY=PV_INDEX_URL` arguments (quote each whole
argument); copy the exact public `pvIndexUrl` from
`packages/radar-sources/src/sources/proces-verbaux-generic.ts`.
Only Drummondville and Saint-Henri have built-in shortcuts. Do not pass private
or signed URLs. Check the target's robots policy before running; increase the
2000 ms interval if a source requires a longer crawl delay.

Each city receives two GET variants: the adapter's exact index headers
(`User-Agent: radar-immobilier/0.1 (+https://github.com/rhanka/radar-immobilier)`,
`Accept: text/html`), then the same identifiable agent with
`Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8` and
`Accept-Language: fr-CA,fr;q=0.9`. The actual adapter uses `text/html` for the
index; the `*/*` helper default mentioned in the issue is not this call's value.

Output is JSONL: city, variant, exact URL, phase, redirect hop, HTTP status,
duration to response headers in milliseconds, and only `server`, `cf-ray`,
`cf-mitigated`, `location`, `content-type`. Transport failures have a null status.
Bodies, cookies and authorization headers are never logged. Bodies are canceled
without downloading them. Redirects are followed manually (maximum ten) so
each hop is recorded and paced. All requests are sequential with at least two
seconds **after the previous response**; timeout is 15 seconds per request.
HTTP failures remain data (exit 0); inspect every JSON line, not just the exit
code. Invalid arguments or excessive redirects exit 1.

Interpretation: a repeatable baseline 404 / negotiation 200 on Drummondville
would support enabling the negotiation option. Both 200 would leave the
original incident unexplained; both 404 would show that this change is
insufficient. Cloudflare response headers alone do not establish the cause.
Saint-Henri's known failure is on a document: a successful index probe does not
resolve it. Use the instrumented worker's document URL/status before deciding
on that case. No municipality was fetched while implementing this patch.

The candidate remedy is already available through
`new ProcesVerbauxGenericAdapter(config, { negotiateHeaders: true })` or
`runLiveScrape(slugs, { store, negotiateHeaders: true })`. It is **false by
default**, and `worker-live` does not activate it. The conductor can wire it
after measurements. It changes negotiation headers only; no agent spoofing,
proxy, additional retries or pacing change. If insufficient, evaluate Obscura
with the same identifiable agent or contact the city about allowlisting;
neither alternative is implemented here.

The observation gap is reproduced locally: PV adapters throw
`PvSourceFetchError`, while RECUEIL previously recognized only
`SourceFetchError` and reduced PV failures to generic network errors.
RECUEIL now preserves PV diagnostics and increments separate `index404` and
`document404` counters. `worker-live` emits request telemetry and includes
failure diagnostics in `onCity`; `job-health` names lost indexes at the
elevated warning tier regardless of error-rate thresholds. Systemic failures
retain exit 1 and include the index warning. These changes establish visibility,
not the remote cause of Drummondville's 404.

Local verification uses the worktree's ignored `tmp/404-checks.mk`, Docker
Compose test volumes, and no exposed host ports:

```sh
make -f Makefile -f tmp/404-checks.mk setup404 ENV=test-fix-404
make -f Makefile -f tmp/404-checks.mk check404 CMD='node --test deploy/ci/probe-pv-index.test.mjs' ENV=test-fix-404
make test-api SCOPE='src/scripts/job-health.test.ts src/services/sources/live-scrape.test.ts src/services/sources/recueil.test.ts' API_PORT=8873 UI_PORT=5373 MAILDEV_UI_PORT=1173 ENV=test-fix-404
make -f Makefile -f tmp/404-checks.mk check404 CMD='npm run test --workspace=@radar/sources' ENV=test-fix-404
```
