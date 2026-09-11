---
status: completed
reviewer-host: claude
reviewer-model: claude-opus-4-8
reviewer-effort: xhigh
target-ref: 831cad2459b6a59fde790145af5c6cf9bb3f6b72..1e5b2dc739eb9de6fcb9e158ff586a6e25257ccb
lens: correctness-and-completeness
---

# Independent review — correctness & completeness

Range: `831cad2..1e5b2dc` (14 commits). Brief:
`.remote/ERADICATE_SCW_BRIEF.md`. Rules: `rules/MASTER.md`. This leg was run in
isolation; the parallel safety leg was not read.

## Method

- Read the brief and `rules/MASTER.md`, then walked all 14 commits
  (`git log --stat`) and the per-file diffs for every infra/code touch point.
- Re-derived the inventory headline count directly from the baseline commit
  (`git grep` union of the briefed patterns at `831cad2`).
- Verified the GHCR workflow end to end: job `permissions`, login steps, image
  references in manifests, and the kustomize image-transform `name:` match.
- Checked for accidental breakage: env-var name drift, dangling symbols after
  deletions, dangling `kustomization.yaml` `resources:` entries, breaking
  placeholder values in executable manifests, and orphaned service/network
  dependencies.
- Confirmed the brief's `poc-k8s` carve-out was respected.

## What is correct (verified)

1. **Inventory counting is accurate and reproducible.** The headline
   `885 lignes` (`.remote/ERADICATE_SCW_INVENTORY.md:14`) matches, to the line,
   `git grep -nIiE '<union of the briefed patterns>' 831cad2` = **885**. The
   class split reconciles: A 424 + B 170 + C 291 = 885
   (`ERADICATE_SCW_INVENTORY.md:16-20`); B1 43 + B2 36 + B3 91 = 170; C1 141 +
   C2 150 = 291. Line numbers are declared baseline-relative
   (`ERADICATE_SCW_INVENTORY.md:5,11`) and spot-checks held (e.g. obscura B1
   entry `35-obscura.yaml:42` at baseline is the `+2`-shifted `:44` at tip after
   the TODO insertion in `5669fa0`).

2. **GHCR workflow migration is correct.**
   - `.github/workflows/build-push-images.yml:114-116` sets
     `REGISTRY: ghcr.io`, `IMAGE_PREFIX: ghcr.io/rhanka`; `Makefile:34-36`
     matches (`REGISTRY ?= ghcr.io/rhanka`, `API_IMAGE`/`UI_IMAGE`).
   - Every job that authenticates to GHCR with `GITHUB_TOKEN` has the required
     scope: `build-push` (`push: true`, line 199) has `packages: write`
     (line 129); `promote-prod` (fallback `docker buildx build --push`,
     line 1239-1240; `imagetools inspect`, line 1217) has `packages: write`
     (line 1124). `deploy` (line 224) and `deploy-preprod` (line 564) perform no
     in-job GHCR login/push/inspect (grep for `Login to`/`--push`/`imagetools`
     in 564-1102 is empty), so their lack of `packages:` is correct, not a gap.
   - Login steps use `username: ${{ github.actor }}` /
     `password: ${{ secrets.GITHUB_TOKEN }}` (lines 158-163, 1201-1206). The old
     `SCW_SECRET_KEY` login and the best-effort GHCR mirror steps are removed,
     and no `secrets.SCW_SECRET_KEY` reference survives anywhere in the tree.
   - Manifests reference the GHCR images (`30-api.yaml:116`,
     `40-immo-mcp-http-deploy.yaml:146` = `ghcr.io/rhanka/radar-api:latest`) and
     the CI-generated kustomization uses `name: ghcr.io/rhanka/radar-api`
     (lines 755, 1368) — the image-transform key matches the manifest image, so
     the transform resolves.

3. **Auth-transport removal is clean.** `fee0550` drops `TemConfig`/`tem` from
   `api/src/app.ts` and `resolveTemConfig`/`tem` from `api/src/index.ts` with no
   dangling references; `make build`-relevant symbols stay consistent.

4. **Storage refactor is rename-safe.** `ebf43b3` changes only comments plus the
   local-emulator default `S3_REGION` (`fr-par` → `us-east-1`,
   `api/src/config.ts:27`). Env-var **names** are unchanged, so manifest/code
   coupling is intact, and no test asserts the old default (`grep 'fr-par'` over
   `api/src`, `ui/src`, `packages/` is empty).

5. **B-residuals are left with explicit TODOs, per the brief's "do not guess"
   rule.** Executable job manifests keep working values and gain a TODO
   (`34-refresh-cronjob.yaml:118-119` above `SCRAPE_S3_ENDPOINT`;
   `35-obscura.yaml:41-44` above the obscura image). No executable manifest
   received a breaking `replace-with-*` placeholder in a `value:` field
   (grep confined those to `secrets.example.yaml`).

6. **`poc-k8s` carve-out respected.** The legitimate lane/repo name is preserved
   (`github.com/rhanka/poc-k8s`, `../poc-k8s`); only the Scaleway/Kapsule
   *association* around it was neutralized. No dangling `kustomization.yaml`
   `resources:` entry points at a deleted file (kustomize build will not fail on
   a missing resource).

## Findings (severity-ranked)

### F1 — HIGH — In-cluster MinIO and its api NetworkPolicy deleted while the prod api still depends on them (internally inconsistent; violates two hard brief constraints)

The branch simultaneously **keeps** the prod api pointed at the in-cluster
MinIO and **deletes** that MinIO and the network rule the api needs to reach it:

- Kept (classified B2, "left unchanged + TODO"):
  `deploy/k8s/30-api.yaml:33` → `S3_ENDPOINT: "http://radar-minio:9000"`
  (the api's primary object store; `index.ts` calls `ensureBucket()` on it).
- Deleted (classified A): `deploy/k8s/25-minio.yaml` — the `radar-minio`
  `Service` + `StatefulSet` (`minio/minio:latest`, namespace
  `radar-immobilier`) — and its entry removed from
  `deploy/k8s/kustomization.yaml:45` (commit `4179cc8`).
- Deleted (same commit): the `allow-api-to-minio` NetworkPolicy in
  `deploy/k8s/70-networkpolicy.yaml`. Its own removed comment states the
  consequence precisely: "under default-deny, api -> minio:9000 is DROPPED, so
  the S3 SDK HANGS (silent — no error) and /health never returns ->
  readiness/liveness fail -> CrashLoop."
- Kept consumer still bundled: `deploy/k8s/41-grounding-citation-job.yaml:116`
  (`value: "http://radar-minio:9000"`), still referenced by
  `deploy/k8s/grounding-preprod/kustomization.yaml:31`; its comment at
  `41-grounding-citation-job.yaml:28` still cites the now-deleted
  `72-allow-grounding-to-minio` NetworkPolicy (file
  `72-networkpolicy-grounding-minio-preprod.yaml` deleted in `4179cc8`).

This directly contradicts the brief's explicit carve-out — "Le MinIO **sur le
cluster** N'EST PAS ton job (c'est k8s)" — and its hard rule "Ne casse pas la
prod OVH qui tourne (831cad2 servi)". `radar-minio` is a self-hosted k8s
workload (`minio/minio:latest`), not a Scaleway resource, and the inventory
itself flags it as live in category **C2** ("MinIO encore opéré par k8s …
explicitement hors périmètre", `ERADICATE_SCW_INVENTORY.md:262-266`, listing the
`41-grounding-citation-job.yaml` and `rebuild-from-s3` consumers) while listing
the same service's definition and its NetworkPolicies under **A — deleted**
(`ERADICATE_SCW_INVENTORY.md:37-38`). A resource cannot be both "still operated
by k8s, kept" and "pure residue, deleted"; the two classifications are mutually
inconsistent, and the code side implements the A side while leaving the
C-side consumers wired to it.

Failure scenario: the running cluster is likely spared **today** only because
`kubectl apply` without `--prune` does not delete objects merely dropped from a
manifest set. But the merged repo now declares a broken desired state — the api
Deployment targets a Service that no longer exists in the repo and has no
NetworkPolicy admitting its traffic. A clean re-provision from the repo, or any
prune-based reconcile, brings the api up with `S3_ENDPOINT=radar-minio:9000`,
no `radar-minio` Service, and no `allow-api-to-minio` rule → S3 SDK hangs →
`/health` fails → CrashLoopBackOff (exactly the incident the deleted comment
documents). Per `rules/MASTER.md:86-88` ("No Legacy Fallback — delete the old
code in the same change; no dual paths"), a half-migration that removes the
backing service while leaving every consumer pointed at it is not an acceptable
end state.

Required to clear: either (a) restore `25-minio.yaml` + `allow-api-to-minio`
(and `71/72` if preprod grounding needs them) and reclassify `radar-minio` from
A to C, matching the brief's carve-out and the inventory's own C2 stance; or
(b) migrate **all** `radar-minio` consumers (`30-api.yaml:33`,
`41-grounding-citation-job.yaml:116`, the `rebuild-from-s3` paths) off it in the
same change. Until one of these, the change is self-contradictory.

### F2 — LOW — "Éradication TOTALE" is partial by design (state it plainly)

The brief's title says *TOTALE*, but its category-B rule permits leaving
unverified targets as TODOs, and the branch does exactly that. As a result many
literal SCW strings persist at the tip, intentionally:

- `deploy/k8s/35-obscura.yaml:44` still pulls
  `rg.fr-par.scw.cloud/radar-immobilier/radar-obscura:latest` (B1/TODO; no
  `ghcr.io/rhanka/radar-obscura` package exists).
- ~10 executable job manifests keep
  `value: "https://s3.fr-par.scw.cloud"` + `radar-immobilier-docs-pocs` +
  `fr-par` (B2/TODO), e.g. `33-scrape-job.yaml:97`,
  `34-refresh-cronjob.yaml:121,228`, `39-export-graph-nodes-job.yaml:140`,
  `41-grounding-citation-job.yaml:104`.

This is consistent with the brief's B-handling and the "obtain from k8s" list
(`ERADICATE_SCW_INVENTORY.md:216-225`), so it is not a defect — but a reader
must not take the PR as achieving literal, total eradication. These are dead
SCW coordinates (the refresh CronJob comment records they already fail with
`ENOTFOUND` since 2026-08-03, `34-refresh-cronjob.yaml:116`), so leaving them
with a TODO neither fixes nor further breaks them.

### F3 — LOW — Cosmetic wording defect from a mechanical substitution

`api/src/storage/s3-object-store.ts:112` now reads "but managed object storage's
Object Storage support is not verified here" — a token-level `Scaleway` →
`managed object storage` replacement that produces the doubled "…object
storage's Object Storage…". Comment-only; no behavioral impact. Trivial to
reword.

## Reasoning / weighting

The mechanical parts of the mandate are done well: the count is exact and
reproducible, the GHCR cutover is internally consistent across workflow,
Makefile and manifests (with correct token scopes — a point I initially
mis-read and corrected against the file), the auth-transport excision is clean,
the storage refactor introduces no env-name drift, and the `poc-k8s`
disambiguation is careful. F2 and F3 are within-tolerance or cosmetic.

F1 is the deciding issue. It is not a stylistic inconsistency: the branch
deletes the definition and the network path of a service the brief explicitly
placed out of scope, while its own inventory records that service as live and
keeps every consumer wired to it. The live cluster is probably spared by
apply-without-prune, but the *repo* is merged into a state that cannot correctly
re-provision the prod api and that a prune-based reconcile would take down —
which is precisely the outcome the brief forbids.

## Verdict

**NO-GO** — blocked on F1. The GHCR migration, inventory accounting, auth
removal and storage refactor are correct and could ship; but the MinIO
service/NetworkPolicy deletion contradicts the retained `radar-minio` consumers
(`30-api.yaml:33`, `41-grounding-citation-job.yaml:116`), violates the brief's
"cluster MinIO is not your job" and "do not break running OVH prod" constraints,
and leaves the inventory self-contradictory (A-deleted vs C2-kept for the same
resource). Resolve F1 by restoring the MinIO resources (reclassify A→C) or by
migrating all consumers off `radar-minio` in the same change; F3 is a trivial
follow-up. F2 needs only an accurate scoping note in the PR body, not code.
