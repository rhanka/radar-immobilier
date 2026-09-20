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
or signed URLs. Increase the 2000 ms interval if a source is known to need a longer crawl
delay. `robots.txt` is not consulted by the scrape either — owner decision of
2026-09-20, recorded in rules/MASTER.md §Scraping Policy and in
`PV_ROBOTS_TXT_CONSULTED`.

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

## Outcome (2026-09-20) — what this probe established, and what it did not

The probe did its job and the lead it was built to test is CLOSED. Both header
variants answered `200` on both cities' index pages, from the workstation, from
a preproduction pod (egress `148.113.137.230`, the exact IP named in the issue)
and from a residential IP. No `cf-mitigated` on any measurement. Header
negotiation is therefore NOT a remedy, and the `negotiateHeaders` option it was
written against has been removed rather than left dormant.

The index page was never what failed. **Drummondville's 404 is on a DOCUMENT**:
`…/wp-content/uploads/2015/10/Proces_verbal_2016_01_18.pdf`, one dead link out
of 491, reproducible in HEAD and in GET with the adapter's exact headers, whose
body is a WordPress "Page non trouvée". It was downloaded at all because its
date was unparseable (`\b` cannot match after the underscore in
`Proces_verbal_2016_01_18.pdf`) and an undated item escaped the 183-day window;
it cost the WHOLE city because RECUEIL wrapped listing and every document in a
single `try` and `live-scrape` then forced `count: 0`. All three are fixed on
the branch that carries this file.

For **saint-henri** the mechanism is consistent but NOT measured: its 397 PDFs
all live under a `/wp-content/uploads/` directory its `robots.txt` disallows,
and the investigation chose not to probe them. Read the instrumented worker's
per-document URL and status instead of re-probing that host.

Keep this probe. Its value is unchanged: it is the only tool that answers
"does this index answer, from THIS network path, with THESE headers", and it
answers it without downloading a single document body.

## Visibility, which was the real gap

PV adapters throw `PvSourceFetchError`, while RECUEIL previously recognized only
`SourceFetchError` and reduced PV failures to generic network errors.
RECUEIL now preserves PV diagnostics and increments separate `index404` and
`document404` counters. `worker-live` emits request telemetry and includes
failure diagnostics in `onCity`; `job-health` names lost indexes at the
elevated warning tier regardless of error-rate thresholds. Systemic failures
retain exit 1 and include the index warning. Without this, `docs=0` and
`[http] HTTP 404` were indistinguishable between an index failure and the
253ʳᵈ document — which is how the issue came to state the opposite of the facts.

Local verification uses the worktree's ignored `tmp/404-checks.mk`, Docker
Compose test volumes, and no exposed host ports:

```sh
make -f Makefile -f tmp/404-checks.mk setup404 ENV=test-fix-404
make -f Makefile -f tmp/404-checks.mk check404 CMD='node --test deploy/ci/probe-pv-index.test.mjs' ENV=test-fix-404
make test-api SCOPE='src/scripts/job-health.test.ts src/services/sources/live-scrape.test.ts src/services/sources/recueil.test.ts' API_PORT=8873 UI_PORT=5373 MAILDEV_UI_PORT=1173 ENV=test-fix-404
make -f Makefile -f tmp/404-checks.mk check404 CMD='npm run test --workspace=@radar/sources' ENV=test-fix-404
```
