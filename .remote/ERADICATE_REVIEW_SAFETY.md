---
status: completed
reviewer-host: claude
reviewer-model: claude-sonnet-4-6
reviewer-effort: xhigh
target-ref: 831cad2459b6a59fde790145af5c6cf9bb3f6b72..1e5b2dc739eb9de6fcb9e158ff586a6e25257ccb
lens: deployment-safety-and-no-invented-values
---

# Independent review — deployment safety & no-invented-values

Reviewed: diff of 5 commits (831cad2..1e5b2dc), 118 files changed.
Rules loaded: `rules/MASTER.md`. Brief loaded: `ERADICATE_SCW_BRIEF.md`.

---

## Reasoning

The branch eradicates SCW/MinIO references across docs, manifests, scripts, code, and CI.
The overall approach is sound: doc-only changes rename terminology; deleted one-shot jobs
(`32b-reproject-etape-job.yaml`) and SCW-specific scripts (`mount-scw.sh`, `umount-scw.sh`)
are correct clean-ups. Registry migration from `rg.fr-par.scw.cloud` to `ghcr.io/rhanka` is
mechanically consistent across the build workflow and all k8s `image:` fields.

However, the diff introduces **one unverified assumption** that becomes a hard blocker for
deployment safety, and three lower-severity gaps that are either already tracked (TODO) or
pre-existing failures.

---

## Findings — severity-ranked

### F1 — BLOCKING: `imagePullSecrets` removed without confirmed GHCR package visibility

**File/line:** `deploy/k8s/10-rbac.yaml` (removal of `imagePullSecrets` block) ·
`deploy/k8s/00-namespace.yaml` (comment update)

**Evidence:**
```yaml
# Before (831cad2):
imagePullSecrets:
  - name: radar-registry-pull
automountServiceAccountToken: false

# After (1e5b2dc): imagePullSecrets block entirely absent
automountServiceAccountToken: false
```
Comment in `10-rbac.yaml` asserts: *"Production images are public GHCR packages, so no
registry pull secret is required."*

The old workflow's deleted "Mirror to GHCR (best-effort)" step contained an explicit warning:
> *"GHCR packages don't exist yet (first push creates them, default-private) and visibility
> isn't confirmed"*

GHCR packages are **private by default** on first push. Nothing in this diff confirms that
`ghcr.io/rhanka/radar-api`, `ghcr.io/rhanka/radar-ui`, and `ghcr.io/rhanka/radar-grounding`
have been set to public visibility. If they remain private, every pod scheduling after the next
`kubectl apply` that updates the ServiceAccount will fail with `ImagePullBackOff`.

**Failure scenario:** Operator applies the updated `10-rbac.yaml` (or a kustomize bundle that
includes it) while packages are still private → all new pods for `radar-api`, `radar-ui`,
`radar-immo-mcp`, and `radar-grounding` fail with `ErrImagePull`. Current running pods keep
their cached image; any rollout, restart, or CronJob trigger surfaces the failure.

**No-invented-values angle:** Removing the pull secret and asserting "public packages" is
exactly the pattern the brief forbids — replacing a known-working mechanism with an
unverified assumption rather than a TODO. The correct form would be: leave the
`imagePullSecrets` stub with a TODO, or supply a GHCR robot credential.

**Resolution before merge:** Confirm (with a verifiable reference — e.g., `gh api
/user/packages?package_type=container` output, or package settings proof) that each of the
three packages is `public`. If they cannot be confirmed public, re-add `imagePullSecrets`
pointing at a GHCR-backed dockerconfigjson secret.

---

### F2 — HIGH: `allow-api-to-minio` NetworkPolicy removed while `S3_ENDPOINT` still targets MinIO

**File/line:** `deploy/k8s/70-networkpolicy.yaml` (deletion of `allow-api-to-minio` policy
block) · `deploy/k8s/30-api.yaml:30` (ConfigMap retains `S3_ENDPOINT: "http://radar-minio:9000"`)

**Evidence:**
```yaml
# 30-api.yaml ConfigMap (unchanged in this diff):
S3_ENDPOINT: "http://radar-minio:9000"
# TODO(k8s): replace endpoint… Retained to avoid breaking the service behind 831cad2.
```
```yaml
# 70-networkpolicy.yaml — allow-api-to-minio block DELETED in this diff.
# Original comment warned: "under default-deny, api -> minio:9000 is DROPPED,
# S3 SDK HANGS (silent) and /health never returns -> CrashLoop."
```

The CI/CD path uses `kubectl set image` and does not apply NP manifests, so the in-cluster
`allow-api-to-minio` NetworkPolicy object remains as a ghost resource and the live service is
safe today. However: any operator who runs `kubectl apply -f deploy/k8s/70-networkpolicy.yaml`
(a normal step when updating NPs) applies the new file, which no longer contains
`allow-api-to-minio`, but does not delete it from the cluster. The ghost resource remains
until explicitly deleted. The real danger is `kubectl delete -f <old-70-file>` or
`kubectl apply -k --prune`.

**Failure scenario:** Operator applies or prunes NP manifests after merge → `allow-api-to-minio`
is deleted from cluster → api pods enter CrashLoop (`S3_ENDPOINT=http://radar-minio:9000`
unreachable under default-deny).

**Acceptable remediation (does not block merge alone):** Add an explicit warning comment inside
the updated `70-networkpolicy.yaml` that the removed policy must not be applied/pruned until
`S3_ENDPOINT` is migrated away from minio. On its own this is HIGH but not BLOCKING because the
CD pipeline is safe; it becomes BLOCKING if an operator independently applies the NP file.

---

### F3 — HIGH: Refresh CronJobs still hardcode decommissioned SCW S3 endpoint

**File/line:** `deploy/k8s/34-refresh-cronjob.yaml` lines ~121 and ~228

**Evidence:**
```yaml
- name: SCRAPE_S3_ENDPOINT
  value: "https://s3.fr-par.scw.cloud"
# TODO(k8s): replace this endpoint/bucket/region tuple … before enabling this CronJob.
- name: GRAPH_S3_ENDPOINT
  value: "https://s3.fr-par.scw.cloud"
# TODO(k8s): replace this endpoint/bucket/region tuple …
```
Also: `deploy/k8s/41-grounding-citation-job.yaml` has
`SRC_S3_ENDPOINT: "https://s3.fr-par.scw.cloud"` with a parallel TODO.

The TODO comments are correctly placed and follow the brief's rule (leave a TODO rather than
inventing an OVH value). The values are preserved exactly from 831cad2 — no regression
introduced, and the hazard is now explicitly flagged. CronJobs will fail when they fire against
the decommissioned endpoint, but they were failing before too. Not BLOCKING per brief rules.

---

### F4 — MEDIUM: Mailer permanently demoted to log-only with no replacement toggle

**File/line:** `api/src/services/auth/mailer.ts` (TEM implementation removed entirely) ·
`api/src/config.ts` (`SCW_TEM_*` schema vars + `resolveTemConfig` removed) ·
`deploy/k8s/30-api.yaml` (ConfigMap + `SCW_TEM_SECRET_KEY` secretKeyRef deleted)

**Evidence:**
```typescript
// mailer.ts after change — always returns sent:false, no delivery path:
console.info(`[invitation] Lien d'invitation pour ${params.to} : ${link}`);
return { sent: false, link };
```

At 831cad2, the live ConfigMap and `radar-tem-credentials` secret wired up the SCW TEM HTTP
API. If `SCW_TEM_SECRET_KEY` was present and valid, invitation emails were sent. After this
PR they are permanently not sent — the code path is deleted, not gated by an env var. There
is no replacement provider and no TODO for one. The `{ sent: false }` return propagates to
any caller checking it.

This is consistent with the brief (SCW 100% decommissioned) and the brief allows removing the
old integration. Classified MEDIUM: accepted decommission consequence, but the absence of any
forward path or tracking TODO is a gap. Not BLOCKING.

---

### F5 — LOW: `packages: write` added to preprod-deploy job unnecessarily

**File/line:** `.github/workflows/build-push-images.yml:587`

```yaml
    permissions:
      contents: read
      deployments: write
+     packages: write
    env:
      NAMESPACE: radar-immobilier-preprod
```

The preprod deploy job runs `kubectl` commands against the cluster — it does not push to GHCR.
`packages: write` gives that job's `GITHUB_TOKEN` permission to modify GHCR package metadata
(including publishing packages). Not a correctness issue — the job does not misuse it — but it
is unnecessary scope. Minor least-privilege violation.

---

### F6 — INFO: `grounding-publish-prod.yml` deleted with no replacement

**File:** `.github/workflows/grounding-publish-prod.yml` (deleted, 166 lines)

This workflow published grounded candidates within SCW docs-pocs (SRC and DST the same SCW
bucket, different prefix). Its deletion is correct: the bucket is gone, the workflow would fail
anyway, and the brief classified this as category A. No safety regression relative to
decommissioned state. Noted: the prod grounding publish path has no documented replacement.

---

## Summary table

| #  | Severity  | File                                           | Topic                                              | Blocks merge? |
|----|-----------|------------------------------------------------|----------------------------------------------------|---------------|
| F1 | BLOCKING  | `deploy/k8s/10-rbac.yaml`                      | GHCR package visibility unconfirmed                | **YES**       |
| F2 | HIGH      | `deploy/k8s/70-networkpolicy.yaml` + `30-api.yaml` | allow-api-to-minio removed, minio still configured | Conditional   |
| F3 | HIGH      | `deploy/k8s/34-refresh-cronjob.yaml`           | CronJobs hardcode decommissioned SCW endpoint      | No (TODO)     |
| F4 | MEDIUM    | `api/src/services/auth/mailer.ts`              | Mailer log-only, no replacement                    | No            |
| F5 | LOW       | `.github/workflows/build-push-images.yml:587`  | packages:write on preprod-deploy job               | No            |
| F6 | INFO      | `.github/workflows/grounding-publish-prod.yml` | No replacement for prod grounding publish          | No            |

---

## Verdict

**NO-GO**

Single blocker: **F1** — removing `imagePullSecrets` while asserting public GHCR packages is an
unverified replacement, not a tracked TODO. This is the exact anti-pattern the brief forbids:
*"Aucun remplacement inventé. Une valeur OVH non sûre → TODO tracé, pas un mauvais fix."*
Confirm GHCR package visibility (or restore a pull secret with a TODO) and this review can be
re-run as GO.

F2 is a latent hazard that warrants a protective comment in `70-networkpolicy.yaml` before
operators touch it. F3–F6 are acceptable gaps under the brief's TODO policy.
