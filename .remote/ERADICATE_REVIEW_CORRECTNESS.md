---
status: completed
reviewer-host: claude
reviewer-model: claude-opus-4-8
reviewer-effort: xhigh
target-ref: 831cad2459b6a59fde790145af5c6cf9bb3f6b72..1e5b2dc739eb9de6fcb9e158ff586a6e25257ccb
lens: correctness-and-completeness
---

# Independent review — correctness & completeness

Target range: `831cad2..1e5b2dc` (14 commits) against
`.remote/ERADICATE_SCW_BRIEF.md`. Read-only review; only this artifact was
written. The safety leg was not read.

## Reasoning / method

Verified four dimensions the lens calls out: (1) inventory counts &
classification, (2) remaining active SCW/MinIO references, (3) GHCR workflow
correctness, (4) accidental code breakage.

**Inventory — independently reproduced and proven exact.**
Re-ran the brief's pattern scan over tracked, non-binary files at the reference
commit `831cad2`:
`git grep -I -n -i -E 'scw|scaleway|fr-par|kapsule|minio|-pocs|sbs-default|poc-979c11ad' 831cad2`
→ **885** unique `path:line` matches. This equals the inventory's headline
"885 lignes" (`.remote/ERADICATE_SCW_INVENTORY.md:14`). Parsed every
`file:line` token the inventory lists per section: **A=424, B1=43 B2=36 B3=91
(B=170), C1=141 C2=150 (C=291)** — matching each stated count
(`ERADICATE_SCW_INVENTORY.md:16-20`). Strongest check: the *set* of 885
inventory pairs is **identical** to the 885 grep pairs — `comm` shows zero
missing and zero phantom entries. The partition is therefore exact, complete,
and non-overlapping (the "sans double compte" claim holds). Binary hits are
correctly excluded and listed separately in C3.

**Classification spot-checks are sound.** Deleted A files
(`25-minio.yaml`, `32b-reproject-etape-job.yaml`,
`71/72-networkpolicy-*-minio-preprod.yaml`, `scripts/mount-scw.sh`,
`scripts/umount-scw.sh`, `.github/workflows/grounding-publish-prod.yml`) are all
gone at HEAD and no longer referenced by any kustomization `resources:`,
workflow, `Makefile`, or script. `deploy/k8s/kustomization.yaml` drops
`25-minio.yaml` cleanly.

**Code changes carry no logic breakage.** The only behavioural change is the TEM
(transactional email) removal: `SCW_TEM_*` env, `TemConfig`, `resolveTemConfig`,
the HTTP-API transport and HTML/text body builder are deleted; the mailer now
logs the enrolment link (existing degraded mode). Consumers are consistent —
`api/src/index.ts` and `api/src/app.ts` no longer pass `tem`;
`api/src/routes/admin.ts:365-367` still resolves an optional `MailerConfig`
(`deps.mailer ?? {}`) and calls `sendInvitationEmail`, which remains exported.
Grep confirms **no dangling references** to any removed symbol (`TemConfig`,
`resolveTemConfig`, `SCW_TEM*`, `buildEmailBody`, `TemSuccessResponse`) in
`api/`, including the rewritten `mailer.test.ts`. Every other source/test/spec
diff is comment/label-only (verified for `object-store.ts`, `s3-object-store.ts`,
`project-graph-from-s3.ts`, `config.ts` doc-comments). No static-analysis-visible
break. Note: `make`-gated tests were not executed in this read-only pass.

**GHCR cutover is correct on the served path but has one gap** — see findings.
`REGISTRY=ghcr.io`, `IMAGE_PREFIX=ghcr.io/rhanka`; `build-push` has
`packages: write` + a GHCR login; all runtime manifests now use
`image: ghcr.io/rhanka/radar-*` so the kustomize `name:`/`newName:` overrides
still match; the main `deploy` job sets images by tag (cluster pulls, no runner
push). B-category storage endpoints and the obscura image are left with explicit
`TODO(k8s)` rather than invented OVH values — exactly as the brief's hard rule
requires ("NE CASSE PAS → laisse un TODO tracé").

## Findings (severity-ranked)

### 1. [MEDIUM] `promote-prod` lacks `packages: write` — GHCR fallback push will 403
`.github/workflows/build-push-images.yml:1122-1124` grants the `promote-prod`
job only `contents: read` + `deployments: write`. Its fallback step
"Fallback — build at tag" runs
`docker buildx build --push ... -t ${IMAGE_PREFIX}/radar-api:${SHA}` and the same
for `radar-ui` (around `:1239-1240`), pushing to `ghcr.io/rhanka/*`. A push to
GHCR with `GITHUB_TOKEN` requires `packages: write` in the job `permissions:`
block; without it the push returns `denied: permission_denied` (403) precisely in
the aged-out-digest case the fallback exists to handle. The old SCW path worked
because it authenticated with `secrets.SCW_SECRET_KEY` (scope-independent of GH
`permissions:`); the GHCR/`GITHUB_TOKEN` swap did not carry the write scope over.
`build-push:129` and `deploy-preprod:588` both correctly set `packages: write`;
`promote-prod` is the only pushing job missing it. Fix: add `packages: write`
(and `packages: read`, see #2) to `promote-prod`. Impact is bounded: the primary
`build-push` → `deploy`/`deploy-preprod` path is unaffected, and the job is gated
to `refs/tags/v*` / post-cutover per its own comment (`:1113-1119`), so it does
not break the currently served prod.

### 2. [LOW] `promote-prod` digest resolution depends on GHCR packages being public
`promote-prod` resolves immutable digests via `docker buildx imagetools inspect`
(around `:1219`) with only the default token scope (no `packages: read`,
`:1122-1124`). This works today only because the packages are asserted public
(`ERADICATE_SCW_INVENTORY.md:148-149`). If any `radar-api`/`radar-ui` package is
or becomes private, both the digest read and the #1 fallback push fail. Adding
`packages: read`/`write` removes the hidden dependency.

### 3. [LOW / accepted per brief] Residual dead-registry reference for obscura
`deploy/k8s/35-obscura.yaml:44` retains
`rg.fr-par.scw.cloud/radar-immobilier/radar-obscura:latest`, with a TODO
(`:42-43`) stating no `ghcr.io/rhanka/radar-obscura` package exists as of
2026-09-11. This is brief-compliant (B item, no invented value) but is a live
residual SCW reference: since SCW is 100% decommissioned, the obscura workload
would hit `ImagePullBackOff` on any reschedule (it survives only while the image
is node-cached under `IfNotPresent`). Tracked correctly in the inventory's
"Valeurs B manquantes"; flagged for closure, not a diff defect.

### 4. [LOW / accepted per brief] Deleted MinIO service vs. retained default endpoint
`25-minio.yaml` (the `radar-minio` StatefulSet/Service) is deleted from the
bundle, yet `deploy/k8s/30-api.yaml:33` and `34-refresh-cronjob.yaml`
still default `S3_ENDPOINT`/`SCRAPE_S3_ENDPOINT` to `http://radar-minio:9000`
(and several jobs default to `https://s3.fr-par.scw.cloud`), each carrying a
`TODO(k8s)`. In production these inline values are overridden by optional
`secretKeyRef` (`radar-scrape-s3-credentials`, `optional: true`,
`34-refresh-cronjob.yaml:241-246`), so running prod is not broken; a standalone
`kustomize build | apply` of the bundle would create pods pointing at a
non-existent in-cluster service. Consistent with the brief (cluster MinIO is out
of scope; TODO over wrong-fix). Non-blocking.

### 5. [INFO] `S3_REGION` default changed `fr-par` → `us-east-1`
`api/src/config.ts:27` and `.env.example:9`. Affects only the unset-env case;
prod sets region explicitly and MinIO is region-agnostic. Benign
provider-neutral default.

## Verdict: GO

The eradication is complete and its inventory is provably accurate (exact
885-pair set match, exact A/B/C partition, no double-count). No accidental code
breakage: the TEM removal and all label rewrites are internally consistent with
no dangling symbols, and every deleted file is fully de-referenced. Remaining
SCW/MinIO references are intentional, TODO-tracked B/C items that honour the
brief's "leave a traced TODO rather than a wrong fix" rule and do not break the
served OVH prod. The GHCR cutover is correct on the primary build/deploy path.

Finding #1 is a genuine correctness gap in the tag-promotion fallback path and
should be fixed (one-line `packages: write` addition) before relying on
`promote-prod`, but it is conditional, gated to post-cutover, and does not affect
the currently served path — so it does not block this eradication PR.
