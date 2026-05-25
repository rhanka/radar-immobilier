# SPEC_EVOL — INFRA `radar-immobilier`

> **Status**: EVOL, opened for BR04 `feat/k8s-tenant-radar-and-infra`.
> **Predecessor**: `SPEC_EVOL_SCAFFOLDING.md` §9.
> **Initial date**: 2026-05-25

## Status Updates

- **2026-05-25**: BR04 started. The scaffolding spec initially placed all K8s
  manifests under `../poc-k8s/tenants/radar-immobilier/`; the active
  `poc-k8s` contract keeps cluster-owner resources in `poc-k8s` and
  tenant-owned workloads in the application repo. BR04 follows that split.
- **2026-05-25**: local `poc-k8s` branch `feat/radar-immobilier-tenant`
  created in `tmp/feat-poc-k8s-radar-tenant/` with tenant contract commits
  `bbfe899` and `c58aa53`.

## 1. Goal

Deploy the demo backend on the shared Scaleway Kapsule POC cluster. The API
must answer `GET /health` through `https://immo.sent-tech.ca/health` and verify
both Postgres and Scaleway Object Storage.

## 2. Ownership Split

`../poc-k8s` (`rhanka/k8s-ops`) owns:

- `Namespace`
- `ResourceQuota`
- `LimitRange`
- default-deny ingress `NetworkPolicy`
- tenant ServiceAccount and RoleBinding
- tenant README and capacity table entry

This repo owns:

- `deploy/k8s/api.yaml`
- `deploy/k8s/postgres-postgis.yaml`
- `deploy/k8s/obscura.yaml`
- `deploy/k8s/maildev.yaml`
- `deploy/k8s/ingress.yaml`
- `deploy/k8s/kustomization.yaml`
- `deploy/k8s/secrets.example.yaml`

The existing `/home/antoinefa/src/poc-k8s` checkout has uncommitted user
changes. BR04 uses a separate `poc-k8s` worktree under this repo's ignored
`tmp/feat-poc-k8s-radar-tenant/`.

## 3. Namespace Contract

Namespace: `radar-immobilier`

| Resource | Quota |
| -------- | ----- |
| `requests.cpu` | `500m` |
| `requests.memory` | `1Gi` |
| `limits.cpu` | `1500m` |
| `limits.memory` | `2Gi` |
| `pods` | `8` |
| `persistentvolumeclaims` | `2` |
| `secrets` | `10` |

If the cluster-owner capacity table rejects this envelope, reduce Obscura or
Maildev to scale-to-zero until needed.

## 4. Workloads

| Component | Kind | Image source | Replicas | CPU req/limit | RAM req/limit |
| --------- | ---- | ------------ | -------- | ------------- | ------------- |
| API | Deployment | Scaleway Container Registry | 1 | `75m` / `300m` | `160Mi` / `384Mi` |
| Postgres/PostGIS | StatefulSet | `postgis/postgis:16-3.4` | 1 | `150m` / `600m` | `384Mi` / `768Mi` |
| Obscura | Deployment | Scaleway Container Registry | 1 | `100m` / `400m` | `256Mi` / `512Mi` |
| Maildev | Deployment | `maildev/maildev:latest` | 1 | `25m` / `100m` | `64Mi` / `128Mi` |

Total target request: `350m` CPU and `864Mi` RAM. Total target limit:
`1400m` CPU and `1792Mi` RAM.

## 5. Secrets and S3

No secret values are committed.

| Secret | Keys | Created by |
| ------ | ---- | ---------- |
| `radar-db-credentials` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `make k8s-create-secrets ENV=poc` |
| `radar-s3-credentials` | `S3_ACCESS_KEY`, `S3_SECRET_KEY` | `make k8s-create-secrets ENV=poc` |
| `radar-llm-credentials` | provider keys, initially optional | `make k8s-create-secrets ENV=poc` |

Scaleway Object Storage:

- Project: `PoCs`
- Project ID: `09ac728a-e3b9-4a5b-9749-664b0f147c70`
- Region: `fr-par`
- Bucket: `radar-immobilier-raw`
- API env: `S3_ENDPOINT=https://s3.fr-par.scw.cloud`,
  `S3_REGION=fr-par`, `S3_BUCKET=radar-immobilier-raw`,
  `S3_FORCE_PATH_STYLE=false`

## 6. DNS, Ingress, and Network Policy

Canonical host: `immo.sent-tech.ca`.

Ingress routes only API traffic to Hono. Maildev is internal-only. TLS uses
the POC cluster's existing Traefik/cert-manager setup when available; if the
wildcard/cert is unavailable, BR04 records the blocker and smokes through a
temporary route or port-forward.

Network policy baseline:

- default-deny ingress for the namespace.
- allow Traefik namespace to API port `3000`.
- allow API Pods to reach Postgres `5432`, Obscura `9222`, and Maildev
  `1025`/`1080`.
- egress remains allowed by default per the current `poc-k8s` contract.

## 7. Validation

Non-secret gates:

```bash
make k8s-validate ENV=test-k8s-tenant
make typecheck ENV=test-k8s-tenant
make lint ENV=test-k8s-tenant
make build ENV=test-k8s-tenant
```

Deployment gates:

```bash
make k8s-create-secrets ENV=poc
make deploy-k8s ENV=poc
make test-smoke ENV=poc
```

Manual deployment requires GitHub Secrets for `KUBE_CONFIG_DATA`, Scaleway
credentials, DB password, and S3 IAM credentials scoped to the raw bucket.

## 8. Open Risks

| Risk | Mitigation |
| ---- | ---------- |
| Dirty `poc-k8s` checkout | Use a separate worktree under ignored `tmp/`. |
| DEV1-M capacity pressure | Start under `500m` / `1Gi`; scale optional services down if needed. |
| Obscura runtime mismatch | Keep Obscura independently deployable and internal-only. |
| `immo.sent-tech.ca` TLS unavailable | Record blocker and smoke by temporary route or port-forward. |
| S3 credential leak | Create Secrets out-of-band; scan staged diffs before push. |
