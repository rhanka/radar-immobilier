# Single-pass refresh — implementation and operations

## Design

`REFRESH_SINGLE_PASS=0` preserves the current extraction request, native validator, verification
and publication path. The repository CronJob explicitly defaults to zero; render mutation tests enforce it.
With `1`, one extraction response per chunk contains the native graph plus `annotations`, exactly one
class/reason for every Signal and DesignationEvent. Quality retries and Gemini fallback remain bounded
by the existing model policy; the separate verification call is disabled in this mode.

The single-pass main model uses `REFRESH_SINGLE_PASS_PROVIDER`, `REFRESH_SINGLE_PASS_MODEL`,
`REFRESH_SINGLE_PASS_REASONING_EFFORT`: `openai`, `gpt-6-astra`, `low`, per the owner's 16:00 decision.
Reannotation uses the same settings. Legacy `REFRESH_*` primary settings remain unchanged at flag zero.
Fallback uses `REFRESH_FALLBACK_*`: `gemini`, `gemini-3.8-flash`, `low`.
The application records the accepted receipt, including fallback, rather than trusting generated metadata.
The baseline already uses contract v10; its native validator and PDF grounding are unchanged.

`radar/prompts/refresh-single-pass-v1.md` extends C's P0 with extraction and annotation output rules.
The classification guide is retained; the product role replaces the historical personal name.
`radar/prompts/refresh-single-pass.json` pins its id and SHA-256. Deployment copies both into the image.
B+C can replace the prompt file and its manifest/hash without code changes. This extraction extension
has not itself been benchmarked; P0's classification result does not establish its detection recall.
The prompt SHA enters the durable refresh model-policy identity, preventing reuse across prompt versions.

Migration 0045 adds `facet_events.source`, default `manual`, and `signal_class_annotations` keyed by
city, node type and node id. AI annotations carry `source`, `model`, `effort`, `promptId`,
`promptSha256`, `pipelineRunId`, plus an input SHA. Every historical human event, including inactive
selection and archive history in any workspace, blocks AI writes. A short SHARE lock on human events
serializes the history check with human inserts. Human readers and UI always prioritize human history.
Explicitly confirming an AI class or selecting Non classé creates human history too.
API cards expose `classAnnotation` only for a real row in `signal_class_annotations` (AI or manual).
Facet history can redact an existing annotation, but never creates one. Without a stored annotation,
manual archive/selection keeps the main API payload byte-identical, including with flag zero.
UI classes, reasons, badges and city counters consume stored annotations.
The badge displays the exact accepted model identifier, or `modèle inconnu` when absent.
Every changed AI annotation increments the existing shared workspace projection revision for its city,
in the same transaction. Refresh, reannotation and purge use that same counter. No-op writes do not bump it.

## Recent reannotation

The versioned `reannotate-signals` entrypoint selects signals ingested in the preceding 30 days.
It uses the same checked prompt, current model pair and validation. Existing annotations are removed
from model evidence and the content hash. Dry-run performs classification but writes no annotations.
Apply skips all manual history. Stable input/prompt/model/effort identities skip successful prior work,
including accepted fallback results. A failed signal is reported and retried on the next invocation.
The JSON report includes classes, candidates, classified/written counts, manual/unchanged skips and failures.

```sh
make reannotate-signals-preprod SKIP_DOTENV=1 KUBECONFIG=/path/to/dedicated-preprod.kubeconfig ENV=preprod
make reannotate-signals-preprod SKIP_DOTENV=1 KUBECONFIG=/path/to/dedicated-preprod.kubeconfig REANNOTATION_MODE=apply ENV=preprod
```

The target clones the existing suspended-or-active CronJob template. It preserves its image, credentials,
resource limits and flock. It also acquires the existing namespace writer lock. It never unsuspends a
CronJob or enables restoration. A timeout retains the writer lock; inspect the operation and Job before
using the existing cutover resume flow. Reports remain in Job logs for the template's retention period.

## Activation and rollback

Prerequisite: migration 0045, API and UI images containing this PR deployed to preprod by the existing
main-only delivery workflow. This lane must not merge. The conductor owns that prerequisite.
Use an explicit dedicated preprod kubeconfig throughout.

```sh
kubectl --kubeconfig /path/to/dedicated-preprod.kubeconfig -n radar-immobilier-preprod set env cronjob/radar-refresh-pv -c refresh-pv REFRESH_SINGLE_PASS=1
gh workflow run bascule-refresh.yml --ref main -f RUN=true -f WAIT_COMPLETE=true
```

Inspect the manual run's model receipts, annotations and report. Keep schedules in their current state.
Rollback has two explicit steps, per i-cond's reversible decision:

1. Set `REFRESH_SINGLE_PASS=0` with the same set-env command. This restores legacy extraction and
   verification for future refreshes. The flag governs refresh writes only. Stored AI annotations are
   data and remain readable by cards, counters and UI. There is no flag-based read guard.
2. If the owner wants to roll back the data, run the explicit purge. Stop any active reannotation Job
   separately before purging. Keep the additive migration. Preserve schedule suspension states.

```sh
make purge-ai-annotations-preprod SKIP_DOTENV=1 KUBECONFIG=/path/to/dedicated-preprod.kubeconfig ENV=preprod
make purge-ai-annotations-preprod SKIP_DOTENV=1 KUBECONFIG=/path/to/dedicated-preprod.kubeconfig PURGE_MODE=apply PIPELINE_RUN_ID=run-id ENV=preprod
make purge-ai-annotations-preprod SKIP_DOTENV=1 KUBECONFIG=/path/to/dedicated-preprod.kubeconfig PURGE_MODE=apply PURGE_ALL=1 ENV=preprod
```

The default is dry-run. `PIPELINE_RUN_ID=<run>` and `PROMPT_SHA256=<sha256>` restrict the purge.
Both filters together use intersection. Apply requires a nonempty filter or explicit `PURGE_ALL=1`.
An empty run id without another filter is refused before cluster access. `PURGE_ALL=1` cannot be combined
with a filter. An unfiltered dry-run selects all `source=ai` rows without deleting them.
The command is `reannotate-signals --purge-ai-annotations [--dry-run | --apply]
[--all | --pipeline-run-id <run> | --prompt-sha256 <sha256>]`. Both filters may be combined; `--all`
is exclusive. The CLI forwards `all` to the service, which independently validates the same guard.
It needs no model call or model configuration.
The make target uses the reannotation Job template and writer lock. Its JSON report lists the selected
annotation identities, filters, matched count and deleted count. Repeated apply is a no-op.
Only the AI overlay is deleted. Manual annotations, human event history and underlying graph properties
remain intact. The prior human class is therefore retained; an untouched target has no annotation after purge.
Actual deletions bump the shared projection revision so an open UI can refetch the restored state.

## Risks and observations

- Graph publication and annotation persistence use separate transactions. A failed annotation leaves the
  refresh projection receipt incomplete; the next run resumes the published snapshot and retries annotations.
- The class-event SHARE lock is short but can briefly delay human writes. Reannotation processes one signal at a time.
- First reannotation can revisit a signal produced by single-pass because extraction and stored-card identities differ;
  subsequent unchanged reannotation is a no-op. Dry-run still consumes model quota.
- Multi-peer h2a consensus review is unavailable: no h2a MCP launch tool is exposed and exact author metadata
  cannot be attested. No consensus verdict is claimed. Native delegated design findings were reconciled.

## Resume verification — 2026-11-13

The owner's 16:00 amendment is implemented: single-pass and reannotation default to Astra low,
with P0 extraction extension v1 and Gemini 3.8 Flash low fallback. Dedicated single-pass variables
avoid changing the primary medium configuration of the disabled path.
Prompt SHA-256: `8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205`.

The inherited implementation's original author model/effort cannot be established. Review selection:

```yaml
status: selection-failed
target-ref: 9a58656bc6cac717658cee08492078634c05b80d
observed-failure: Original author exact model/effort unavailable; no h2a_run tool exposed.
```

Self-inspection and automated checks do not constitute independent consensus review.
No cluster mutation was performed during this resume. Current live suspension state was not rechecked.
Deployment requires integration by the conductor: `.github/workflows/build-push-images.yml`
restricts preprod deployment to `main`; this lane is forbidden to merge.

Passed locally: `make typecheck`, `make lint`, 150 targeted API tests, 7 PostgreSQL tests
with `LOT_MIGRATION_DB_TEST=1`, 1,905 UI tests (10 todo), and 55 offline render checks.
All make invocations used `SKIP_DOTENV=1`; Compose used `--env-file /dev/null`.
The quality targets reused the prepared test dependency volumes via `COMPOSE_RUN_API_NODEPS`.
The first UI run exposed an incomplete secondary-read DB fixture; mocking its annotation read port
restored all three population tests without changing their assertions.

Delivery: [PR #1099](https://github.com/rhanka/radar-immobilier/pull/1099), targeting `main`.

## Independent review corrections — 2026-11-13

The owner's reversible decision replaces B1's proposed read guard with explicit data rollback.
Readers continue consuming stored AI annotations with `REFRESH_SINGLE_PASS=0`.
The purge PostgreSQL tests cover dry-run without writes or revision changes, AI-only deletion,
run/prompt filters and their intersection, exact preservation of manual rows and human history,
restored city visibility, idempotence and projection-token invalidation.

Validation: typecheck and lint passed; 38 targeted API tests passed, including 14 PostgreSQL tests
with `LOT_MIGRATION_DB_TEST=1` and `REFRESH_SINGLE_PASS=0`. The 27 targeted UI tests and 55 render
checks passed. A first combined run exceeded the existing database-cleanup hook deadline despite
passing all assertions. The required suites passed with one worker and no concurrent static checks.
No timeout was increased. Every make invocation skipped dotenv; Compose used `--env-file /dev/null`.
