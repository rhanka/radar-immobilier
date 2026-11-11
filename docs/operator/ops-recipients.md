# Ops recipients port v1 — operator runbook

`GET /api/v1/ops/recipients?target=immo-prod|immo-preprod` answers the
Sentropic job-failure alert service: the live list of this product's
admins. Code: `api/src/ops/recipients.ts`, config in
`api/src/config.ts` (`resolveOpsConfig`). This page owns the deployment
wiring: what to set per environment, which Secret holds the bearer,
how rotation works, and how to verify without exposing recipient
addresses.

## Configuration the code reads

| Variable | Source | Preprod | Prod |
|---|---|---|---|
| `OPS_TARGET` | ConfigMap `radar-api` | `immo-preprod` | absent (inert) |
| `OPS_REFERENCE_WORKSPACE_SLUG` | ConfigMap `radar-api` | `agence-chaperon-immobilier` | absent (inert) |
| `OPS_RECIPIENTS_BEARER` | Secret `radar-ops-recipients`, key `OPS_RECIPIENTS_BEARER` | operator provisioned | not created |

Behaviour without a value (fail-closed, by design):

- bearer or target missing → `503 ops_recipients_unconfigured`;
- reference slug missing, or the workspace tables missing (SQLSTATE
  42P01) → 200 on app admins alone (`basis: ["app:is_admin"]`) plus the
  `ops_recipients_workspace_tier_unavailable` warning event;
- reference slug set but matching no workspace → 200 on app admins
  alone, with no warning. Verify the slug before the first apply
  (see § Verification of the recipient set).

## Accepted bearer (service-to-service, static opaque)

Settled contract (Sentropic written evidence,
`api/src/services/notifications/ops-recipients.ts:249-254` on
sentropic `origin/main`): the bearer is a **static opaque** string —
64 hex characters from `openssl rand -hex 32` — presented as
`Authorization: Bearer <string>` on
`GET <url>?target=immo-preprod`. No JWT, no IdP, no
`iss`/`aud`/`sub`/`exp`. The previous JWT/JWKS/audience path is
removed; it no longer serves.

Immo side: the api compares the presented value with the configured
`OPS_RECIPIENTS_BEARER` by constant-time comparison
(`timingSafeEqual` over SHA-256 hashes, always equal length, so no
length leak). Absent or wrong bearer → `401 unauthenticated`, before
any recipient lookup and before the target check; a valid bearer with
a foreign or missing `target` → `404 target_not_found`. The value is
never logged, never echoed in errors, and never rendered.

Trust boundary (B4 decision): the static bearer is the sole trust
boundary. There is no subject, client, or scope to pin — the value is
a dedicated, non-user shared secret held only by the Sentropic caller
and this Secret. Any holder of the exact value is the caller.

Sentropic-side custody:

- `.env` name: `OPS_JOB_FAILURE_RECIPIENTS_BEARER_PREPROD`;
- Secret: `sentropic-api`, key `OPS_JOB_FAILURE_RECIPIENTS_BEARER`;
- rotation: every 90 days, next due **2027-02-09** (their runbook
  `docs/runbooks/ops-job-failure-notify.md` §4);
- their caching: 10 min fresh, 24 h stale-while-error.

## The Secret

- Name: `radar-ops-recipients`; key: `OPS_RECIPIENTS_BEARER`.
- Namespaces: `radar-immobilier-preprod` (preprod);
  `radar-immobilier` (prod, only on an explicit activation decision).
- Referenced optionally by the `radar-api` Deployment (base
  `deploy/k8s/30-api.yaml`): an absent Secret keeps the process up and
  the route closed (503). The value never lands in git;
  `deploy/k8s/secrets.example.yaml` carries a placeholder only, in the
  preprod namespace (change the namespace for a prod activation).
- Guard: `deploy/ci/check-ops-recipients-render.sh` (CI) renders both
  environments and refuses a literal bearer, a wrong Secret/key, a
  missing bearer env entry, a wrong preprod target, or any `OPS_*`
  ConfigMap key in prod.

### Creation gesture (preprod) — described, executed by the operator

Prerequisites: the exact bearer value communicated by the Sentropic
conductor through a channel that does not display it in tickets or
chat, the preprod kubeconfig
`~/.kube/radar-preprod-tenant.kubeconfig` (never `~/.kube/config`),
and the slug check below already green. Pipe the value without
displaying it: read it into the shell from the operator's password
store or sealed file, never type or echo it.

```bash
# 1. Confirm the reference workspace exists in the preprod database
#    (operator DB path; read-only, counts only):
#    SELECT count(*) FROM workspaces
#    WHERE slug = 'agence-chaperon-immobilier';   -- expect 1

# 2. Stage the bearer outside the repo, owner-only, without printing it:
install -m 0600 /dev/null /tmp/ops-bearer.env
printf 'OPS_RECIPIENTS_BEARER=%s\n' "$OPS_BEARER_FROM_OPERATOR_STORE" \
  >> /tmp/ops-bearer.env

# 3. Create (first time) in the preprod tenant namespace:
kubectl --kubeconfig "$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  -n radar-immobilier-preprod create secret generic radar-ops-recipients \
  --from-env-file=/tmp/ops-bearer.env

# 4. Roll the api so it picks up the Secret, then remove the staging file:
kubectl --kubeconfig "$HOME/.kube/radar-preprod-tenant.kubeconfig" \
  -n radar-immobilier-preprod rollout restart deployment/radar-api
shred -u /tmp/ops-bearer.env
unset OPS_BEARER_FROM_OPERATOR_STORE
```

Rotation replaces step 3 with an update (`create ... --dry-run=client
-o yaml | kubectl apply -f -` with the same kubeconfig/namespace),
then the same rollout. Never print the Secret
(`kubectl get secret ... -o yaml` shows base64, still the value).

## Rotation cycle (aligned with Sentropic)

Single rotation, both sides, every 90 days (next due 2027-02-09):

1. Sentropic generates the new 64-hex value and updates its side
   (`.env` `OPS_JOB_FAILURE_RECIPIENTS_BEARER_PREPROD` / Secret
   `sentropic-api` key `OPS_JOB_FAILURE_RECIPIENTS_BEARER`).
2. The immo operator updates Secret `radar-ops-recipients` key
   `OPS_RECIPIENTS_BEARER` in `radar-immobilier-preprod` with the same
   value (gesture above) and rolls `radar-api`.
3. During the gap the endpoint answers 401 to the side not yet
   updated; the Sentropic pull cache serves the stale list (10 min
   fresh, 24 h stale-while-error), so sequence both updates inside
   one window. Revert by restoring the previous Secret value and
   rolling again.

## Verification (counts only, no recipient address in output)

With the valid bearer held in `$TOKEN` (operator shell only, never
logged, curl without `-v`), pipe the response directly into the
counting `jq` expression — no payload file on disk:

```bash
curl -s -w '\n%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" \
  'https://preprod.immo.sent-tech.ca/api/v1/ops/recipients?target=immo-preprod' \
  | jq '{v, target, asOf, admins: (.admins | length),
         bases: ([.admins[].basis[]] | unique)}'
```

Expect 200, the count of expected admins, and
`workspace:manage_members` among the bases once the reference-workspace
grant exists. Negative checks: no bearer → 401; wrong bearer → 401;
`target=immo-prod` on preprod → 404; before the Secret exists → 503
`ops_recipients_unconfigured`. Never paste the `admins` array (it
carries email addresses) into tickets, logs, or chat.

### Verification of the recipient set (preprod, read-only)

Before the first apply, confirm in the preprod database (read-only,
counts only, no email copied out): the workspace slug exists, the
`manage_members` holders with `status='approved'` exist, and the app
admins exist. The endpoint recipient set is the deduplicated union of
both tiers, email-less rows dropped.

Recorded 2026-11-10 (namespace `radar-immobilier-preprod`, database
used by `radar-api`): workspace with slug
`agence-chaperon-immobilier` = 1; `manage_members` managers = 1 (1
with email); approved app admins = 1 (1 with email); deduplicated
union = 2. The set is non-empty and complete under the code filters.

Granting the workspace tier: a current workspace manager adds the
recipient with `manage_members`, or the operator script
`init-workspace-authority.ts` bootstraps the first manager inside the
api pod. App admins are served either way.

## Prod

Inert today: the base ConfigMap carries no `OPS_*` key and no prod
Secret exists, so the route answers 503 whatever bearer is presented.
Activation is a separate decision and mirrors preprod: set
`OPS_TARGET=immo-prod` plus the prod reference slug on the prod
`radar-api` ConfigMap, create `radar-ops-recipients` in
`radar-immobilier` with the prod bearer agreed with Sentropic, roll,
and run the same verification against `https://immo.sent-tech.ca`.
