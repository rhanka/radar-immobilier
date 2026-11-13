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
API cards expose `classAnnotation`; UI classes, reasons, badges and city counters consume it.

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
Rollback future extraction by setting `REFRESH_SINGLE_PASS=0` with the same set-env command. The existing
Gemini verification settings then take effect again. Keep the additive migration and annotation history;
flag rollback does not delete existing AI classes. Human overrides remain authoritative.

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
