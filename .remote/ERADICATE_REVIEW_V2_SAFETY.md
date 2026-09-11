---
status: completed
reviewer-host: claude
reviewer-model: claude-sonnet-4-6
reviewer-effort: xhigh
target-ref: 831cad2459b6a59fde790145af5c6cf9bb3f6b72..1e5b2dc739eb9de6fcb9e158ff586a6e25257ccb
lens: deployment-safety-and-no-invented-values
---

# Independent safety review — eradicate-scw-refs

## Scope

Reviewed all 14 commits in the range. Lens: production deployment safety at
`831cad2`, correctness of registry/workflow permission migrations, object-storage
TODOs vs invented values, mail/auth behavior after SCW TEM removal, and deleted
manifest safety.

Evidence base: full `git diff` of all changed files, final-state reads of
`35-obscura.yaml`, `11-ci-deployer-preprod-rbac.yaml`, `34-refresh-cronjob.yaml`,
`kustomization.yaml`, and the full `build-push-images.yml` job-by-job.

---

## Findings (severity-ranked)

---

### F1 — HIGH · Regression introduced by this PR

**`promote-prod` job missing `packages: write` — fallback build cannot push to GHCR**

File: `.github/workflows/build-push-images.yml:1122–1126`

```yaml
    permissions:
      contents: read
      deployments: write          # ← packages: write absent
```

The `promote-prod` job contains two paths for resolving the production image:

1. **Primary path** — `Resolve image digests` reads already-built GHCR images
   via `docker buildx imagetools inspect`. Public packages: no push, no write
   permission needed. **Works.**
2. **Fallback path** — `Fallback — build at tag (only if digest aged out)` runs
   `docker buildx build --push … "${IMAGE_PREFIX}/radar-api:${SHA}"`. This
   write to GHCR requires `packages: write`. **Fails with 403.**

The prior SCW path used `secrets.SCW_SECRET_KEY` (an external secret, not
GITHUB_TOKEN), so it was never subject to the job-permissions gate. Migrating
to GHCR required adding `packages: write` to this job; it was added to
`build-push` (line 129) and `deploy-preprod` (line 588) but **not** to
`promote-prod`.

**Failure scenario**: An operator arms the cutover (`PREPROD_CD_ENABLED=true`),
pushes a version tag, and the primary digest path returns `resolved=false`
(SHA aged out of GHCR or was never built for that commit). The fallback step
runs, attempts `--push`, receives HTTP 403, and the job fails. Production is
left at the previous release with no automated promotion path.

**Current impact on 831cad2 production**: None — the legacy `deploy` job
(active while `PREPROD_CD_ENABLED` is unset) does only `kubectl set image` and
never touches GHCR. The risk materialises at cutover.

**Fix** (one line): add `packages: write` to the `promote-prod` job's
`permissions` block.

---

### F2 — MEDIUM · Pre-existing, documented with TODO

**`deploy/k8s/35-obscura.yaml` retains dead SCW registry image reference**

File: `deploy/k8s/35-obscura.yaml:44`

```yaml
          # TODO(k8s): replace with the verified OVH/GHCR obscura image. No
          # ghcr.io/rhanka/radar-obscura package exists as of 2026-09-11.
          image: rg.fr-par.scw.cloud/radar-immobilier/radar-obscura:latest
          imagePullPolicy: IfNotPresent
```

The manifest is listed in `kustomization.yaml:55` as a permanent cluster
resource. The image reference was **already present at 831cad2**; this PR adds
only the TODO comment — it does not introduce the broken reference.

`imagePullPolicy: IfNotPresent` prevents an immediate failure: nodes with the
image already cached survive. However, any pod eviction to a new node, rolling
restart triggered by a subsequent `kubectl apply -k deploy/k8s`, or node pool
rotation will attempt a pull from the dead SCW registry and enter
`ImagePullBackOff`.

Per the brief's explicit guidance ("En cas de doute entre casser et laisser un
TODO tracé → laisse le TODO"), this handling is correct. Flagged for operator
awareness only.

---

### F3 — MEDIUM · Intentional functional regression

**Transactional email permanently disabled — invitation links log-only**

Files:
- `api/src/services/auth/mailer.ts` (full rewrite)
- `api/src/config.ts` (`resolveTemConfig`, `TemConfig`, `SCW_TEM_*` schema removed)
- `deploy/k8s/30-api.yaml` (ConfigMap `SCW_TEM_*` keys and `SCW_TEM_SECRET_KEY`
  secretKeyRef removed)
- `deploy/k8s/secrets.example.yaml` (`radar-tem-credentials` Secret removed)

`sendInvitationEmail` now unconditionally logs the invitation link to stdout
(`console.info`) and returns `{ sent: false }`. The SCW TEM HTTP API path
(POST `.../transactional-email/v1alpha1/regions/…/emails`) is fully removed.

No replacement delivery provider is introduced. Admin workflow: retrieve
invitation links from pod logs.

The log/degraded mode was always the fallback when `SCW_TEM_SECRET_KEY` was
absent. This change makes it permanent. Intentional per the brief (SCW
decommissioned). No deployment safety risk. Flagged because it is a permanent
user-facing regression with no replacement path in scope.

---

### F4 — LOW · Pre-existing, gated

**SCW endpoint literals remain in suspended CronJobs and one-shot Jobs**

Files with `value: "https://s3.fr-par.scw.cloud"` in final state:
- `deploy/k8s/34-refresh-cronjob.yaml:121,228` (both CronJobs `suspend: true`)
- `deploy/k8s/32-graph-projection-only-job.yaml`
- `deploy/k8s/33-scrape-job.yaml`
- `deploy/k8s/33b-scrape-cities-job.yaml`
- `deploy/k8s/37-graphify34-apply-job.yaml`
- `deploy/k8s/38-graphify34-emit-candidates-job.yaml`
- `deploy/k8s/39-export-graph-nodes-job.yaml`
- `deploy/k8s/40-export-gt-designation-events-job.yaml`
- `deploy/k8s/41-grounding-citation-job.yaml`

All CronJobs are `suspend: true`. TODO(k8s) comments were added to
`34-refresh-cronjob.yaml` (the primary refresh paths). The brief's rule "Une
valeur OVH non sûre → TODO tracé, pas un mauvais fix" is correctly applied.
No execution risk while suspended. No invented values.

---

### F5 — LOW · Safe

**`S3_REGION` default changed from `fr-par` to `us-east-1`**

Files: `api/src/config.ts:26`, `docker-compose.yml:92`

Production is unaffected: `deploy/k8s/30-api.yaml:34` explicitly sets
`S3_REGION: "fr-par"` in the ConfigMap, overriding the code default. Local
MinIO with path-style addressing accepts any region value. Tests updated
consistently (`scrape-store.test.ts`). No production or functional impact.

---

## Verified-clean items

| Area | Verdict |
|---|---|
| `grounding-publish-prod.yml` deletion | Safe — workflow was disarmed (`GROUNDING_PUBLISH_PROD_ENABLED` gate) and depended on never-provisioned SCW secrets |
| `25-minio.yaml` + `71/72-networkpolicy-*-minio-preprod.yaml` deletion | Safe — SCW/MinIO-specific resources; `kustomization.yaml` updated; no surviving pod targets the deleted NetworkPolicies |
| `10-rbac.yaml` — `imagePullSecrets` removal | Safe — comment in final state says GHCR images are public; no secret needed |
| `deploy/k8s/30-api.yaml` image → `ghcr.io/rhanka/radar-api:latest` | Safe |
| `secrets.example.yaml` — SCW TEM + registry-pull entries removed | Safe — no real secrets committed; replacements use explicit `replace-with-verified-ovh-*` placeholders |
| `11-ci-deployer-preprod-rbac.yaml` `radar-registry-pull` ref | Pre-existing (diff: no changes to this file); stale but Kubernetes tolerates a missing pull secret for public images |
| No invented OVH values | Confirmed — all replacements use explicit TODO markers or `replace-with-verified-*` placeholders; no fabricated endpoints or credentials |

---

## Verdict

**NO-GO**

One regression was introduced by this PR:

**F1 — `promote-prod` job is missing `packages: write`** (`.github/workflows/
build-push-images.yml:1122`). The fallback `build-at-tag` step pushes to GHCR
and will fail with HTTP 403 when the primary digest path cannot resolve the
image. The current 831cad2 production path (legacy `deploy` job) is unaffected
today, but this becomes the only production promotion mechanism at cutover.

**Minimum fix to reach GO**: add `packages: write` to the `promote-prod` job's
`permissions` block (one line). All other findings are pre-existing conditions
documented with TODO markers, intentional decommission changes, or
non-production-impacting defaults.
