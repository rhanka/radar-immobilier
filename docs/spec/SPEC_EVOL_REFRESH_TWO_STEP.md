# Refresh: detection B, then per-act P0 v2 classification

- Owner decision: 2026-11-13. Branch: `feat/refresh-two-step`, based on `feat/refresh-single-pass-v2` (#1102, itself based on #1099).
- Detection B remains authoritative. The measured single prompt loses acts; classification over one existing act has substantially better recall. This change does not claim new benchmark results.

## Decisions

- D1: `REFRESH_CLASSIFY_MODE=off|two-step|single-pass`, default `off`. Explicit mode wins. When mode is absent, deprecated `REFRESH_SINGLE_PASS=1` still selects single-pass; `0` or absent selects off. New deployments should use the mode. Single-pass remains experimental.
- D2: In off and two-step, detection uses precisely the existing prompt B, Astra medium, Gemini 3.8 Flash low fallback and verification. Classification never changes detection prompts, schemas, model receipts, coverage identity, extraction bytes or canonical graph bytes.
- D3: After S3 publication and PostgreSQL projection succeed, two-step reads the completed document chunks, including on projection resume. Only extracted `Signal` and `DesignationEvent` IDs are candidates. It reads their projected PostgreSQL representation. Baseline-only acts and excluded acts are not classified. This selection has no 30-day cutoff.
- D4: Reuse `runReannotation`, its versioned v2 manifest, classifier, recursive removal of prior AI answers, canonical input SHA and transactional writer. Automatic two-step skips identical inputs with an existing v2 annotation, regardless of model/prompt changes. New acts, changed inputs and acts missing v2 annotations remain eligible. The explicit 30-day reannotation command retains model/prompt-aware refresh semantics and defaults to v2.
- D5: All manual history, including an active thumbs-up and an inactive selection, blocks AI. The writer checks this again transactionally after the model call. Existing manual rows also remain authoritative. The operational refresh/reannotation scripts share the writer lock; do not launch concurrent graph writers outside that protocol.
- D6: Separate classification model policy and quota circuit. Defaults: GPT-6 Astra low, fallback Gemini 3.8 Flash low. Store actual accepted model/effort, `source=ai`, `promptId=v2`, prompt/input SHA-256, cycle ID as `pipelineRunId`, and `ambiguous`.
- D7: `REFRESH_CLASSIFY_PROVIDER`, `REFRESH_CLASSIFY_MODEL`, `REFRESH_CLASSIFY_REASONING_EFFORT` configure the primary. `REFRESH_CLASSIFY_FALLBACK_PROVIDER`, `REFRESH_CLASSIFY_FALLBACK_MODEL`, `REFRESH_CLASSIFY_FALLBACK_REASONING_EFFORT` configure fallback. These settings also serve explicit reannotation and single-pass. Legacy `REFRESH_SINGLE_PASS_*` model settings are superseded by these variables.
- D8: `REFRESH_CLASSIFY_CONCURRENCY` defaults to 2; accepts integers 1–16. All workers drain before returning. Per-act errors are counted in `classification-completed.failed` and its `failures` array. Selection, evidence-read and cancellation failures emit `classification-failed` with a failure count. Detection still succeeds. Covered documents are not redetected to retry classification; use explicit reannotation for failed annotations.
- D9: Repository CronJobs and offline render gates enforce mode off. No schema or UI changes.
- D10: Classification uses dedicated PostgreSQL sessions with `statement_timeout=5s` and `lock_timeout=1s`. Cancellation destroys the session. The default deadlines are 60 seconds per act and 300 seconds per classification run, including selection. Model calls receive the same cancellation signal; late results cannot reach the writer.
- D11: One run budget reserves every detection, verification and classification call before sending, including primary failures and fallbacks. Calls are capped by `REFRESH_SWEEP_MAX_SUBMISSIONS` when nonzero, otherwise `REFRESH_BUDGET_LIMIT`. `REFRESH_RUN_MAX_TOKENS` defaults to 100,000,000. Token accounting conservatively reserves UTF-8 prompt/schema bytes plus the full output cap; missing usage and failed calls never refund it. This is an admission allowance, not reported provider consumption. The shared sweep deadline also cancels in-flight work. Exhaustion stops classification and subsequent extraction while acquisition can continue.
- D12: Public API annotation overlays and AI-derived visibility/counts use the same mode parser. At off, stored AI history is ignored and manual-only cards preserve the main payload. Operational annotation reads remain available for resume and audit. Set the API deployment mode together with the refresh mode to display annotations.

## Preproduction activation (conductor runbook)

First promote an API image containing #1099, #1102 and this branch through the normal release process. This PR performs no deployment or merge. A CronJob environment change applies to future Jobs only. A later manifest release resets the mode to off.

```sh
rtk kubectl --kubeconfig "$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  -n radar-immobilier-preprod set env cronjob/radar-refresh-pv \
  --containers=refresh-pv REFRESH_CLASSIFY_MODE=two-step
rtk kubectl --kubeconfig "$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  -n radar-immobilier-preprod set env deployment/radar-api REFRESH_CLASSIFY_MODE=two-step
rtk gh workflow run bascule-refresh.yml --ref main -f RUN=true -f WAIT_COMPLETE=true
```

Inspect `classification-completed` logs for classified/written/skippedManual/skippedUnchanged/failed counts. Accepted AI rows must carry `promptId=v2` and the accepted Astra/Gemini identity. Verify detection outcomes separately. There are no live-provider measurements in the local tests.

For recent missing annotations, the existing 30-day command uses the same v2 classifier:

```sh
rtk make reannotate-signals-preprod SKIP_DOTENV=1 \
  KUBECONFIG="$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  REANNOTATION_MODE=dry-run ENV=preprod
# After reviewing the report, repeat with REANNOTATION_MODE=apply.
```

## Rollback

```sh
rtk kubectl --kubeconfig "$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  -n radar-immobilier-preprod set env cronjob/radar-refresh-pv \
  --containers=refresh-pv REFRESH_CLASSIFY_MODE=off REFRESH_SINGLE_PASS=0
rtk kubectl --kubeconfig "$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  -n radar-immobilier-preprod set env deployment/radar-api REFRESH_CLASSIFY_MODE=off REFRESH_SINGLE_PASS=0
```

This stops classification in future refresh Jobs and restores API-off behavior without deleting history. It preserves existing AI annotations and manual decisions. To remove a selected run's AI annotations, use the existing filtered purge, first dry-run, then apply. Do not use a global purge for a run rollback.

```sh
rtk make purge-ai-annotations-preprod SKIP_DOTENV=1 \
  KUBECONFIG="$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  PIPELINE_RUN_ID=<cycle-uuid> PURGE_MODE=dry-run ENV=preprod
# After reviewing the report, repeat with PURGE_MODE=apply.
```

## Validation

- Unit: mode precedence, legacy switch, model isolation, bounded workers, changed-input skip, per-act failures and manual races.
- PostgreSQL: real refresh publication/projection, identical B requests and persisted extraction/graph bytes, separate v2 annotations for both act types, failure isolation, manual thumbs-up, input changes and projection resume. Runtime model latency fields are excluded from byte comparisons.
- Static: workspace typecheck and lint. Rendering: released overlays plus mutation guards for off and classification model/concurrency defaults.
- Tests use a dedicated Compose project with no dotenv loading and synthetic databases. Always finish with `down -v`.
