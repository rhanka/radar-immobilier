# Ops recipients port v1 — operator runbook

`GET /api/v1/ops/recipients?target=immo-prod|immo-preprod` (PR #1051)
answers the Sentropic L1 job-failure alert service (sentropic #984): the
live list of this product's admins. Code: `api/src/ops/recipients.ts`,
config in `api/src/config.ts` (`resolveOpsConfig`). This page owns the
deployment wiring: what to set per environment, which Secret holds the
L1 value, how rotation works, and how to verify without exposing
recipient addresses.

## Configuration the code reads

| Variable | Source | Preprod | Prod |
|---|---|---|---|
| `OPS_TARGET` | ConfigMap `radar-api` | `immo-preprod` | absent (inert) |
| `OPS_REFERENCE_WORKSPACE_SLUG` | ConfigMap `radar-api` | `agence-chaperon-immobilier` | absent (inert) |
| `OPS_RECIPIENTS_AUDIENCE` | Secret `radar-ops-recipients` | operator provisioned | not created |
| `SENTROPIC_IDP_ISSUER` | ConfigMap `radar-api` | `https://preprod.auth.sent-tech.ca` | `https://auth.sent-tech.ca` |

The JWKS URI derives from the issuer
(`${issuer}/.well-known/jwks.json`) unless `SENTROPIC_IDP_JWKS_URI` is
set. `OPS_TARGET` is also read by the `radar-refresh-pv` sweep (same
ConfigMap via `envFrom`) to stamp its systemic-failure emission.

Behaviour without a value (fail-closed, by design):

- audience or target missing → `503 ops_recipients_unconfigured`;
- audience equal to a user bearer audience (the app origin or
  `${origin}/mcp`) → dropped at startup wiring, route stays 503 and the
  api logs `ops_recipients_audience_overlap`;
- reference slug missing, or the workspace tables missing (SQLSTATE
  42P01) → 200 on app admins alone (`basis: ["app:is_admin"]`) plus the
  `ops_recipients_workspace_tier_unavailable` warning event;
- reference slug set but matching no workspace → 200 on app admins
  alone, with no warning. Verify the slug before the first apply.

## Accepted bearer (service-to-service)

The caller presents `Authorization: Bearer <JWT>`. The api verifies,
via the IdP JWKS: signature (EdDSA), `iss` exactly the environment
issuer above, `aud` exactly `OPS_RECIPIENTS_AUDIENCE`, `exp` in the
future, and a non-empty `sub`. No scope or client check exists: the
audience must therefore be a dedicated L1 service audience, distinct
from every user bearer audience (enforced by the overlap guard).
Missing or invalid bearer → 401, before any recipient lookup; a valid
bearer with a foreign or missing `target` → 404.

The bearer JWT itself is minted and held by Sentropic L1 (their
`OPS_JOB_FAILURE_RECIPIENTS_BEARER`, "rotated with the product's service
client"). It is never stored on the immo side; the only value immo
receives from L1 is the audience string.

## The Secret

- Name: `radar-ops-recipients`; key: `OPS_RECIPIENTS_AUDIENCE`.
- Namespaces: `radar-immobilier-preprod` (preprod); `radar-immobilier`
  (prod, only on an explicit activation decision).
- Referenced optionally by the `radar-api` Deployment (base
  `deploy/k8s/30-api.yaml`): an absent Secret keeps the process up and
  the route closed (503). The value never lands in git;
  `deploy/k8s/secrets.example.yaml` carries a placeholder only.
- Guard: `deploy/ci/check-ops-recipients-render.sh` (CI) renders both
  environments and refuses a literal audience, a wrong Secret, a wrong
  preprod target, or any `OPS_*` ConfigMap key in prod.

### Creation gesture (preprod) — described, executed by the operator

Prerequisites: the exact audience string communicated by the Sentropic
conductor (L1 contract), the preprod kubeconfig
`~/.kube/radar-preprod-tenant.kubeconfig` (never `~/.kube/config`), and
the slug check below already green.

```bash
# 1. Confirm the reference workspace exists in the preprod database
#    (operator DB path; read-only):
#    SELECT slug FROM workspaces WHERE slug = 'agence-chaperon-immobilier';

# 2. Stage the L1-provided audience outside the repo, owner-only:
install -m 0600 /dev/null /tmp/ops-audience.env
printf 'OPS_RECIPIENTS_AUDIENCE=%s\n' '<audience-from-L1>' >> /tmp/ops-audience.env

# 3. Create (first time) in the preprod tenant namespace:
kubectl --kubeconfig "$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  -n radar-immobilier-preprod create secret generic radar-ops-recipients \
  --from-env-file=/tmp/ops-audience.env

# 4. Roll the api so it picks up the Secret, then remove the staging file:
kubectl --kubeconfig "$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  -n radar-immobilier-preprod rollout restart deployment/radar-api
shred -u /tmp/ops-audience.env
```

Rotation replaces step 3 with an update (`create ... --dry-run=client
-o yaml | kubectl apply -f -` with the same kubeconfig/namespace), then
the same rollout. Never print the Secret
(`kubectl get secret ... -o yaml` shows base64, still the value).

## Rotation cycle (aligned with Sentropic)

Two independent rotations meet at the `aud` claim:

- Bearer rotation (L1-owned, frequent): L1 mints a new service JWT for
  the same audience and updates its side. Immo does nothing; the JWKS
  verification accepts the new token as soon as the IdP serves it.
- Audience rotation (rare, coordinated): agree the new audience with
  L1, update the immo Secret and roll `radar-api`, then L1 switches its
  bearer to the new `aud`. During the gap the endpoint answers 401;
  the L1 pull cache serves the stale list (10 min fresh, 24 h
  stale-while-error), so sequence immo first, L1 second, inside one
  window. Revert by restoring the previous Secret value and rolling
  again.

## Verification (no recipient address in output)

With a valid service bearer held in `$TOKEN` (operator shell only,
never logged, curl without `-v`):

```bash
curl -s -o /tmp/ops-recipients.json -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" \
  'https://preprod.immo.sent-tech.ca/api/v1/ops/recipients?target=immo-preprod'
jq '{v, target, asOf, admins: (.admins | length),
     bases: ([.admins[].basis[]] | unique)}' /tmp/ops-recipients.json
```

Expect 200, the count of expected admins, and
`workspace:manage_members` among the bases once the reference-workspace
grant exists. Negative checks: no bearer → 401; `target=immo-prod` on
preprod → 404; before the Secret exists → 503
`ops_recipients_unconfigured`. Delete `/tmp/ops-recipients.json`
afterwards; never paste the `admins` array (it carries email addresses)
into tickets, logs, or chat.

Granting the workspace tier: a current workspace manager adds the
recipient with `manage_members` (see the #1051 lane report), or the
operator script `init-workspace-authority.ts` bootstraps the first
manager inside the api pod. App admins are served either way.

## Prod

Inert today: the base ConfigMap carries no `OPS_*` key and no prod
Secret exists, so the route answers 503 whatever bearer is presented.
Activation is a separate decision and mirrors preprod: set
`OPS_TARGET=immo-prod` plus the prod reference slug on the prod
`radar-api` ConfigMap, create `radar-ops-recipients` in
`radar-immobilier` with the prod audience agreed with L1, roll, and run
the same verification against `https://immo.sent-tech.ca`.
