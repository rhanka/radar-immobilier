# Feature: CD pre-flight — refuse to deploy to any cluster but the expected one

## Objective
Make the deployment pipeline FAIL BEFORE touching a cluster when the kubeconfig
does not point at the expected Kubernetes apiserver, so a stale
`KUBE_CONFIG_DATA` secret can never roll (or silently "succeed" against) the
decommissioned Scaleway tenant now that the OVH cutover has no rollback.

## Context (measured 2026-07-28)
- `immo.sent-tech.ca` is served by OVH: TLS cert serial `06BF9290DAEF16750B36D7A98E6199AC4DCA`,
  which matches the OVH LB serial announced by `claude:poc-k8s` (Scaleway LB serial `058B67DC9FCB`).
- OVH apiserver: `https://hlhedx.c1.bhs5.k8s.ovh.net` (OVH MKS BHS5, k8s v1.31.13).
- The Scaleway 2c/8g node pool that hosted this tenant has been DELETED — no rollback target.
- `gh secret list` → `KUBE_CONFIG_DATA` last updated **2026-06-22T14:03:10Z**, i.e. ~4 weeks
  before the first OVH-readiness commit in this repo (`ca56c40`, 2026-07-19) and ~5 weeks
  before the cutover. No `OVH_*` secret exists on this repo.
- Last CD run on `main` (run 30203582960, 2026-07-26 13:15Z) reported
  `deployment "radar-api" successfully rolled out` — on whichever cluster that
  secret targets. Nothing in the repo proves which one.
- Failure mode that motivates a BLOCKING check: on a stale cluster whose
  Deployments still exist but are scaled to 0, `kubectl set image` and
  `kubectl rollout status` both succeed instantly → green pipeline, untouched
  production. Detection after the fact is not enough.

## Scope / Guardrails
- Scope limited to `.github/workflows/**` + this plan file.
- No k8s action, no Docker stack, no `make test` / `make lint` (shared box, OOM risk).
- No secret is created, modified or read. No kubeconfig content is ever printed.
- Nothing is merged by this branch's agent.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/build-push-images.yml`
  - `.github/workflows/k8s-apply-mcp.yaml`
  - `.github/workflows/run-job.yaml`
  - `plan/CDGUARD-BRANCH_ci-preflight-target-cluster.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, `.track/**`, `deploy/k8s/**`
  - `api/src/services/graph/vivier-v2.ts`, `packages/immo-mcp/src/raw-data.ts`,
    `api/src/services/geo/provenance.ts`, `ui/src/lib/maps/geo-provenance.ts`,
    `ui/src/lib/components/maps/**` (owned by three concurrent agents)
  - `plan/*-BRANCH_*.md` other than this branch file
- **Exception process**: `.github/workflows/**` is a conditional path in the
  template; exception **CDGUARD-EX1** is declared below.

## Lots
### Lot 1 — Pre-flight in the CD job (`build-push-images.yml`)
- Split `Configure kubeconfig` (writes the file only) from a new blocking step
  `Pre-flight — assert target cluster`, placed BEFORE the first mutating
  kubectl (`apply`, `set image`, `rollout`).
- POSITIVE check: the apiserver host read from the kubeconfig must EQUAL the
  expected host. No blacklist — anything unforeseen is refused by construction.
- Expected host from the non-secret repo variable `EXPECTED_KUBE_APISERVER_HOST`;
  if unset, falls back to the documented OVH host and emits a `::warning`, so the
  guard is armed by default and cannot be disabled by forgetting a config step.
- Positive liveness proof on the expected cluster
  (`kubectl -n radar-immobilier get deploy radar-api radar-ui -o name`), moved
  here from `Configure kubeconfig` so identity is asserted before we talk to it.

### Lot 2 — Same pre-flight in the two manual mutating workflows
- `k8s-apply-mcp.yaml` (apply + rollout restart) and `run-job.yaml`
  (delete/apply Jobs) use the SAME `KUBE_CONFIG_DATA` secret against the live
  cluster and get the same blocking step.

### Lot 3 — Verification (offline)
Shell logic exercised against fixture kubeconfigs, no cluster contacted:
| case | expected | result |
| --- | --- | --- |
| OVH kubeconfig | pass | `pre-flight OK`, exit 0 |
| Scaleway kubeconfig | refuse | `::error … Wrong cluster`, exit 1 |
| empty kubeconfig (secret missing) | refuse | `current-context must exist`, exit 1 |
| repo variable overriding the default | refuse mismatch | exit 1 |

`kubectl config view` (without `--raw`) prints `token: REDACTED` and
`certificate-authority-data: DATA+OMITTED` — only the apiserver host, a cluster
identifier, is extracted and logged.

## Post-merge action required (human / infra owner)
Set the repo variable so the expected cluster is configuration, not code:

```
gh variable set EXPECTED_KUBE_APISERVER_HOST --body 'hlhedx.c1.bhs5.k8s.ovh.net'
```

Independently, `KUBE_CONFIG_DATA` must hold the OVH tenant-scoped kubeconfig
(`OVH_KUBECONFIG_B64_RADAR_IMMOBILIER`, held by `poc-k8s`). This branch does NOT
touch secrets: if the secret is still Scaleway, the next deploy now fails loudly
at the pre-flight instead of half-succeeding somewhere else.

## Feedback Loop
- `CDGUARD-EX1` — `.github/workflows/**` is a conditional path. Reason: the
  guard has to live in the deploy job itself to be blocking. Impact: CD/manual
  k8s workflows only; no application code. Rollback: revert the commit — the
  workflows return to their previous, unguarded behaviour.
- `attention` — the pre-flight is fail-closed. If the OVH apiserver hostname
  ever changes (cluster rebuild), every deploy reds until
  `EXPECTED_KUBE_APISERVER_HOST` is updated. This is deliberate given that no
  rollback target exists any more.
