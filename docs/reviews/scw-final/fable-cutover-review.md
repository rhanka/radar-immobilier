---
status: completed
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
reviewer-host: claude
reviewer-model: claude-fable-5
reviewer-effort: high
target-ref: 671380f473d98e76be3b53831b286564a4fdd0c5
lens: migration safety and executable first-slice correctness
---

# Independent T2 implementation and cutover review

The owner authorized Fable as the unavailable Gemini review replacement.
This is one independent leg, not two-peer consensus. Requested model metadata
is not proof of the effective upstream model or reasoning effort.

## Exact targets

- First implementation slice: `95b3e451..332af1e80504bd8010cf9c3304fbaaa7b3c1b095`.
- Cutover design: `671380f473d98e76be3b53831b286564a4fdd0c5`,
  `docs/reviews/scw-final/minio-cutover-design.md` and its branch-plan amendment.
- Read underlying configuration, callers, workflows and tests as needed.
- No implementation, live operations, credentials, agent launches, or Git writes.

## Required independent assessment

Give separate verdicts for first-slice implementation and the second-slice
tool/binding design. Separate build blockers from live migration prerequisites.
Inspect the changed source rather than relying on prior reviewer conclusions.
Check actual API/job fallback resolution, complete required bindings, armed CI,
the untouched preprod GRAPH plane, TEM and the separate Geo contract.
For migration, assess key-set completeness, metadata/content proof, copy races,
mutable objects between bulk copy and final delta, retries, source fencing,
multiple DOCS sources, paired DB/object recovery and zero-consumer deletion gates.
Name the smallest safe correction with file/line evidence for each finding.
Do not invent bucket coordinates, live permissions, or verification results.

## Result

Completed 2026-09-13. Method: read the full range diff, the resulting manifests,
`api/src/config.ts` resolver source, CI workflows, base/overlay kustomizations,
and `docs/architecture/scw-final-sweep.md`; ran the checker's hermetic test and
`make k8s-validate ENV=test-scw-final` offline. No prior reviewer findings were
read. No source, plan, Git, cluster, secret, or data mutation was performed.

### Verdict A — first implementation slice `95b3e451..332af1e8`

**PASS — no build blocker found; one enforcement gap (A1) should be fixed
before the second slice relies on the checker as a gate.**

Verified correct:

- Binding correctness is real, not cosmetic. `api/src/config.ts:236-265`
  resolves per-field: `GRAPH_S3_* ?? SCRAPE_S3_* ?? S3_*`. Each of the eight
  reworked Jobs now binds all six family variables via non-optional
  `configMapKeyRef`/`secretKeyRef` (e.g. `deploy/k8s/32-graph-projection-only-job.yaml:80-95`,
  `33-scrape-job.yaml:85-97`), so the fallback chain is fully bypassed, and a
  missing ConfigMap/Secret key fails pod creation before any code runs.
  Fail-closed direction confirmed; no job can silently select MinIO or an
  inherited bucket anymore.
- Credential separation is coherent: graph Jobs use `radar-graph-s3-credentials`
  with `GRAPH_S3_ACCESS_KEY`/`GRAPH_S3_SECRET_KEY` — the same Secret/key names the
  already-deployed refresh overlay uses (`deploy/k8s/refresh-cronjobs/kustomization.yaml:83-92`);
  scrape Jobs use `radar-scrape-s3-credentials` with `SCRAPE_S3_*` keys matching
  `deploy/k8s/secrets.example.yaml:60-69`. The generic `radar-s3-credentials` is
  gone from all nine covered files (checker-enforced).
- Dropping S3 credentials from `36-db-migrate-job.yaml` and from Job 31's DB
  init containers is safe: the migrate/backfill steps are PostgreSQL-only, and
  `config.ts:26-30` keeps zod parsing valid without S3 env (local defaults).
- Removing the inline `|| 'fr-par'` region defaults in
  `39-export-graph-nodes-job.yaml:118` and `40-…-job.yaml:87` is consistent:
  the region now comes from a required reference, so no silent region drift.
- Retained contracts hold: TEM config and `radar-tem-credentials` untouched
  (`deploy/k8s/30-api.yaml:50-54,172-173`) and now guarded; the armed refresh
  diagnostic keeps its explicit MinIO binding (`refresh-diag/diag-refresh-job.yaml:81-84`)
  and is guarded as unchanged; the preprod GRAPH plane
  (`refresh-cronjobs/kustomization.yaml`, bucket `radar-immobilier-graph-preprod`)
  is not modified by the range; Geo (`GEO_DOCUMENTS_S3_*`, no-fallback resolver
  at `config.ts:282-305`) is untouched. `.env.example` keeps only local MinIO
  values and no longer prescribes deployed coordinates.
- `deploy/ci/check-object-storage-bindings.test.sh` passes 7/7 here (run
  offline, temp dirs only), and `make k8s-validate ENV=test-scw-final` renders
  clean.

Findings:

- **A1 — the new checker is inert: nothing runs it.** No workflow in
  `.github/workflows/` and no Makefile target invokes
  `deploy/ci/check-object-storage-bindings.sh` or its test (verified by
  repo-wide search; `ci.yml:14-53` runs k8s-validate/typecheck/lint/build/test
  only). Worse, the base kustomization deliberately excludes the manual Jobs
  31–40 (`deploy/k8s/kustomization.yaml:47-49`, applied "à la main"), so
  `make k8s-validate` never renders the very manifests this slice changed.
  Net effect: a regression (re-adding an SCW literal or an `optional: true`
  fallback) would merge green. Not a build blocker — a missing gate.
  Smallest fix: add one step to the `Quality gates` job in
  `.github/workflows/ci.yml` (after "Validate K8s manifests"):
  `run: bash deploy/ci/check-object-storage-bindings.sh` — precedent for
  direct `bash deploy/ci/*.sh` steps exists at `build-push-images.yml:727`.
- **A2 — observation, in scope for later, not a slice defect.** The
  forbidden-literal scan covers only the nine listed files;
  `deploy/k8s/32b-reproject-etape-job.yaml:98-109` (SCW endpoint, bucket
  `radar-immobilier-docs-pocs`, generic `radar-s3-credentials`) and the base
  `34-refresh-cronjob.yaml` remain SCW-capable. Both are recorded as remaining
  clients in `docs/architecture/scw-final-sweep.md:133-147`, so this is a
  tracked residue — but see B4: the design's checker extension must widen the
  file set or these survive the cutover.
- **A3 — sequencing note for the conductor.** The API Deployment consumes the
  same `radar-api` ConfigMap via `envFrom` (`deploy/k8s/30-api.yaml:138-139`).
  Creating the `GRAPH_S3_*`/`SCRAPE_S3_*` keys to enable the manual Jobs will
  also inject them into the API on its next restart, and the resolver prefers
  them (`config.ts:238-244`). The Jobs therefore cannot be rebound
  independently of the live API: the ConfigMap patch is a single switch for
  both. The design's fence-before-bind ordering covers this, but it should be
  stated explicitly in the cutover record.

Build blockers: none. Runtime gates before any dispatch: the preprod
`radar-api` ConfigMap lacks both key families and the scrape Secret is absent
(recorded at `scw-final-sweep.md:130-131`); production is RBAC-unproved. The
Jobs now fail closed until the conductor provisions and validates those keys —
values must also be proven non-empty (see B5).

Second-slice findings are preserved in [fable-cutover-design-review.md](fable-cutover-design-review.md).
