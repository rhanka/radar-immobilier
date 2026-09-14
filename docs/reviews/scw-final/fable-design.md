---
status: completed
review-author:
  host: codex
  model: gpt-6-astra
  effort: xhigh
reviewer-host: claude
reviewer-model: claude-fable-5
reviewer-effort: high
target-ref: fdc7d5fc:docs/reviews/scw-final/build-design.md
lens: data safety, explicit bindings, immediate executable slice
verdict: GO_WITH_CHANGES
---

# Independent T2 design review

Owner-authorized Fable replacement for Gemini; one independent review, not a
two-peer consensus. Model metadata is requested, not upstream attestation.
Reviewed: the committed design, the audit (`docs/architecture/scw-final-sweep.md`),
every first-slice manifest, `api/src/config.ts` resolvers, CD/CI workflow wiring,
kustomization membership, and overlay bindings. No edits outside this file.

## Confirmed against source (design claims that hold)

- SCW literals (`https://s3.fr-par.scw.cloud`, bucket `radar-immobilier-docs-pocs`)
  present in 32/33/33b/37/38/39/40 job manifests; optional-fallback credentials
  (`secretKeyRef … optional: true` on `radar-scrape-s3-credentials`) in 31/32/37/38
  and `refresh-diag/diag-refresh-job.yaml` (also hardcodes MinIO `radar-minio:9000`).
- `36-db-migrate-job.yaml` mounts `radar-s3-credentials` for a PostgreSQL-only
  command (`node dist/db/migrate.js`) — the least-privilege removal is real.
- Jobs 31–40 are NOT in `deploy/k8s/kustomization.yaml` (manual apply per its
  comments), so neutralizing them does not alter the CD-applied base bundle.
- `scripts/mount-scw.sh`/`umount-scw.sh`: repo-wide search finds only docs/.track
  references, no executable caller. Retirement is safe.
- Preprod OVH graph is untouched: `34-refresh-cronjob.yaml` and both refresh
  overlays are outside the first-slice write paths; `refresh-cronjobs/kustomization.yaml`
  pins `https://s3.bhs.io.cloud.ovh.net` / `bhs` (PR #677). No regression path.
- Geo read contract isolated: `resolveGeoDocumentsS3Config` performs no fallback
  to Immo `S3_*`/`SCRAPE_S3_*` and fails on missing keys (config.ts:268-297). TEM
  untouched by the slice. `make k8s-validate` exists (Makefile:373).
- D6/D7 delete gating is sound: MinIO StatefulSet/PVC/policies and grounding stay;
  destruction is behind parity, writer fencing, read-only retention, paired DB/object
  recovery proof, preprod-before-prod. No data deletion occurs in the first slice.
- Slice is independent of T1: no image versions, refresh commands, app code, or
  refresh-018 worktree paths in the write list; D2 keeps `chore/eradicate-scw-refs`
  as patch source only. First slice can be BUILT now.

## Findings

### F1 — MAJOR (build-time design gap): literal removal alone does not fail closed

`api/src/config.ts` resolves `GRAPH_S3_*` → `SCRAPE_S3_*` → `S3_*` → hardcoded
defaults `http://minio:9000` / `minioadmin` (lines 26-30, 236-266), and every
first-slice Job inherits `envFrom: configMapRef radar-api`, whose preprod `S3_*`
is the in-cluster MinIO. D4 forbids app-code changes in this slice, so if the
builder merely deletes SCW literals and optional secret refs, a launched Job
silently routes to MinIO instead of failing closed — violating D3.
**Minimal fix (design amendment before build):** state that neutralization means
every storage variable the workload consumes (`GRAPH_S3_*` and/or `SCRAPE_S3_*`,
and `S3_*` where `envFrom` supplies it) is pinned via **non-optional**
`configMapKeyRef`/`secretKeyRef`, so a missing binding fails at container start
(`CreateContainerConfigError`). Extend `check-object-storage-bindings.sh` beyond
per-document literal scanning: assert required-ref shape for the whole fallback
chain and flag storage coordinates inherited solely from the `radar-api` envFrom.

### F2 — MAJOR (deployment/merge blocker, not a build blocker): armed CI applies two edited files at merge

`build-push-images.yml` with `PREPROD_CD_ENABLED` armed applies
`36-db-migrate-job.yaml` on every main push (lines ~730-770; prod promote path
~1375-1398), and with `REFRESH_DIAG_ENABLED` armed applies the refresh-diag Job
and **fails the pipeline** if the Job fails (lines ~985-1008). So "no deployment
in this slice" holds only until merge:
- 36 edit is safe to auto-deploy (S3 refs are unused; migration is PG-only).
- diag edit is NOT: neutralized per F1 it requires a not-yet-provisioned
  `PP_DOCS` binding → first post-merge main run fails and blocks the pipeline.
D5 rightly forbids the builder toggling CI variables, so the design must add an
explicit pre-merge conductor/owner gate: disarm `REFRESH_DIAG_ENABLED` (owner
action, recorded) or provision the diag binding before the diag edit merges —
otherwise move `refresh-diag/diag-refresh-job.yaml` to the later bound slice.

### F3 — MINOR: run-job routes and duplicate scrape route

`.github/workflows/run-job.yaml` still exposes routes to neutralized Jobs; they
will fail closed at dispatch, which is acceptable. Eliminating the duplicate
scrape route itself needs a `run-job.yaml` edit outside the declared write paths;
the design's scope-amendment clause covers this — no change needed now, but the
remaining-client list must carry it explicitly.

### F4 — NOTE: residual live risk is correctly out of scope, keep it visible

The armed production grounding publisher (manual SCW write, last run 2026-09-04)
survives the whole slice by design (T1-gated). Correct per owner instruction;
the design should keep it at the top of the remaining-client list so slice
acceptance is never misread as risk reduction on the one critical live writer.

## Verdict

**GO_WITH_CHANGES.**
- BUILD blockers: none once F1 is incorporated into the neutralization rule and
  checker spec (a wording/spec amendment, not a redesign).
- DEPLOYMENT blockers: F2 merge gate for the refresh-diag edit (owner-recorded
  variable disarm or binding provisioning before merge).
- DATA-DELETION blockers: unchanged and correctly gated by D6/D7; nothing in the
  first slice deletes data, credentials, or workloads.
First slice is safely buildable now, independent of T1; production/preprod
isolation, Geo/TEM contracts, and the preprod OVH graph path are preserved.
