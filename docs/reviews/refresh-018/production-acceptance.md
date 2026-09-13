# Graphify 0.18 production promotion

Status: **planned — not executed**

## Immutable inputs

- Target namespace: `radar-immobilier`
- Accepted image: `ghcr.io/rhanka/radar-api@sha256:d4a46b5615a7510fd5bf3384f65dea8b881cb75ae3226a3dc3751a7f9271119e`
- Active causal schedule after promotion: `radar-refresh-pv`, `17 5 * * *`
- Suspended legacy schedules: `radar-refresh-scrape`, `radar-refresh-projection`
- LLM route: enrolled Codex account through llm-mesh, `openai/gpt-5.6-luna/high`; no per-token API key
- Storage: canonical OVH BHS DOCS store with dedicated DOCS, GRAPH, and SCRAPE Secret projections; no MinIO or separate PROD RAW identity

## Hard preconditions

1. T2 storage/SCW transition is merged to `main` with green policy and quality gates.
2. T1 has merged that `main` by a non-fast-forward merge and its exact resulting SHA is green.
3. Post-build reviews accept the exact T1 SHA with no open P0/P1.
4. Read-only inspection shows no active storage migration Job and no MinIO StatefulSet, Service, or PVC.
5. Server dry-run proves the exact image, canonical DOCS topology, dedicated credentials, keyring PVC, and PV-only activation.

## Make-only runbook

Set `KUBECONFIG_PATH` to the absolute OVH admin kubeconfig path without printing its contents.

```bash
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-render-prod ENV=test-refresh-prod-018
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk inspect-prod KUBECONFIG="$KUBECONFIG_PATH" ENV=prod
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk storage-ready-prod KUBECONFIG="$KUBECONFIG_PATH" ENV=prod
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk validate-prod KUBECONFIG="$KUBECONFIG_PATH" ENV=prod
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk seed-prod PROD_CONFIRM=1 KUBECONFIG="$KUBECONFIG_PATH" ENV=prod
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk apply-prod PROD_CONFIRM=1 KUBECONFIG="$KUBECONFIG_PATH" ENV=prod
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk live-ready-prod KUBECONFIG="$KUBECONFIG_PATH" ENV=prod
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk observe-scheduled-prod PROD_CONFIRM=1 KUBECONFIG="$KUBECONFIG_PATH" ENV=prod
```

`seed-prod` copies only the already accepted encrypted preproduction account route inside Kubernetes and gives it the production principal reference. `apply-prod` creates the keyring PVC and the three declarative CronJobs, activating only `radar-refresh-pv`. `observe-scheduled-prod` temporarily selects the next controller minute, restores the daily schedule immediately after scheduling, waits for a terminal Job, and prints only safe refresh receipts.

## Rollback

Suspend all three exact refresh CronJobs; retain the canonical OVH objects and Postgres state for diagnosis.

```bash
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk suspend-prod PROD_CONFIRM=1 KUBECONFIG="$KUBECONFIG_PATH" ENV=prod
```

## Acceptance receipt

- Integrated T2/main SHA: pending
- T1 promotion SHA: pending
- Review verdicts: pending
- Server dry-run: pending
- Applied at: pending
- Controller-created Job: pending
- Job owner: pending
- Image: pending
- Started/finished: pending
- Provider/model/effort: pending
- Model calls: pending
- Input/prompt/schema/candidate hashes: pending
- Final schedule and suspend states: pending
- Rollback used: no
