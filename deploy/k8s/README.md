# radar-immobilier on Kubernetes — deployed as a *sentropic app*

This directory holds the **tenant-owned** manifests that deploy
`radar-immobilier` on the shared Scaleway **poc-k8s** cluster *as a sentropic
app*: a tenant/workspace under the sentropic platform, with **human auth
delegated to the shared sentropic Identity Provider** and the **code managed in
a named sentropic workspace**.

> **PREPARED, NOT APPLIED.** Everything here is authored and validated offline.
> Nothing in this branch touches a live cluster. Applying to a real cluster is a
> deliberate human action with cluster credentials — see
> [Manual deploy (human, with cluster creds)](#manual-deploy-human-with-cluster-creds).

The pattern mirrors the **sentropic** tenant layout
(`~/src/sentropic/deploy/k8s/`): one Namespace per app, a namespace-scoped
ServiceAccount with an SCW registry pull secret, api + ui + datastore workloads
behind a public Traefik Ingress with cert-manager TLS, and OIDC auth delegation
to `auth.sent-tech.ca`. The base radar workloads were brought in from draft
**PR #8** (`feat/k8s-tenant-radar-and-infra`,
`deploy/k8s/{api,postgres-postgis,obscura,maildev,ingress,secrets.example}.yaml`)
and extended with the sentropic-app integration.

## What "sentropic app" means here

| Aspect | How radar does it | Source mirrored |
| --- | --- | --- |
| **Tenant / workspace** | dedicated `radar-immobilier` Namespace; every resource carries `app.kubernetes.io/part-of: sentropic` and `sentropic.dev/workspace: radar-immobilier` | sentropic per-tenant namespace + `app.kubernetes.io/*` labels (`10-rbac.yaml`, `30-api.yaml`) |
| **Registry pull** | `radar-app` ServiceAccount with `imagePullSecrets: [radar-registry-pull]` | sentropic `sentropic-app` SA + `sentropic-registry` (`10-rbac.yaml`) |
| **Auth** | OIDC **relying party** to the shared sentropic IdP (`auth.sent-tech.ca`) | sentropic `35-auth-idp.yaml`, `60-ingress.yaml`, and the RP recipe `apps/auth-idp/RP_SESSION_GLUE.md` |
| **Public ingress / TLS** | Traefik Ingress on `immo.sent-tech.ca`, cert-manager `letsencrypt-prod` (DNS-01) | sentropic `60-ingress.yaml` |
| **UI delivery** | nginx-served Svelte SPA that proxies `/api` → api (same-origin) | sentropic `40-ui.yaml` (nginx fans out `/api`) |

## Files

| File | Purpose |
| --- | --- |
| `00-namespace.yaml` | tenant Namespace + workspace/part-of labels (operator owns the live copy + RQ/LimitRange/NetPol) |
| `10-rbac.yaml` | `radar-app` ServiceAccount + registry pull secret reference |
| `20-postgres-postgis.yaml` | Postgres 16 + PostGIS StatefulSet + headless Service + 5Gi PVC |
| `25-minio.yaml` | in-cluster MinIO (S3) StatefulSet + Service for raw-document storage |
| `30-api.yaml` | radar API (Hono) Deployment + Service + non-secret ConfigMap (incl. OIDC RP env) |
| `35-obscura.yaml` | headless-browser CDP service for scraping |
| `40-maildev.yaml` | SMTP sink (POC) |
| `50-ui.yaml` | Svelte SPA via nginx + `/api` proxy (ConfigMap holds the nginx conf) |
| `60-ingress.yaml` | public Traefik Ingress for `immo.sent-tech.ca` + cert-manager TLS |
| `70-networkpolicy.yaml` | tenant-side additive NetworkPolicy: Traefik → `radar-ui`:8080 (see "Ingress reaches the UI pod, not the api") |
| `80-auth.yaml` | declarative record of the sentropic OIDC delegation (`radar-sentropic-auth` ConfigMap) |
| `kustomization.yaml` | bundles the resources; stamps the `sentropic` part-of + workspace labels |
| `secrets.example.yaml` | **EXAMPLE only**, no real values — DB / S3 / LLM / OIDC client-secret / registry pull |

## Auth delegation — radar as an OIDC relying party

radar does **not** run its own auth. Human login is delegated to the shared
**sentropic IdP** hosted by the sentropic tenant at **`https://auth.sent-tech.ca`**
(sentropic `deploy/k8s/35-auth-idp.yaml` + `60-ingress.yaml`: a standalone IdP
running the sentropic-api image as `node apps/auth-idp/dist/index.js`, exposing
`/.well-known/openid-configuration`, `/.well-known/jwks.json`, and
`/api/v1/auth/oauth/{authorize,token,userinfo,consent,revoke,introspect}`).

radar is the **relying party (RP)**. The flow is the sentropic copy-paste
recipe `apps/auth-idp/RP_SESSION_GLUE.md` (cite: that file, steps 1–5):

1. `/login` → `startAuthorization()` → 302 to the IdP authorize endpoint
   (`authorization_code` + PKCE, scopes `openid profile email`);
2. user logs in / consents at `auth.sent-tech.ca` (the IdP origin);
3. 302 back to radar's `redirect_uri` with `code` + `state`;
4. radar's api exchanges the code (`POST /oauth/token`), verifies the
   `id_token` signature against the IdP **JWKS** (EdDSA) and checks
   `iss`/`aud`/`exp`/`nonce`;
5. radar mints its **own** HttpOnly session cookie scoped to
   `immo.sent-tech.ca` (the id_token proves identity; the RP session is
   separate — recipe step 5).

There is **no ingress-level forward-auth / auth-proxy sidecar** — auth lives at
the application layer, exactly as the sentropic RPs (e.g. `design-system`)
consume the IdP. The runtime wiring is on the api:

- non-secret (`30-api.yaml` ConfigMap, also recorded in `80-auth.yaml`):
  `SENTROPIC_IDP_ISSUER=https://auth.sent-tech.ca`,
  `SENTROPIC_OAUTH_CLIENT_ID=radar-immobilier`,
  `SENTROPIC_OAUTH_REDIRECT_URI=https://immo.sent-tech.ca/api/v1/auth/oauth/callback`,
  `SENTROPIC_OAUTH_SCOPES=openid profile email`,
  `AUTH_CALLBACK_BASE_URL=https://immo.sent-tech.ca`;
- secret (`radar-sentropic-auth` Secret): `SENTROPIC_OAUTH_CLIENT_SECRET`
  (issued when the operator registers radar at the IdP) and `SESSION_SECRET`
  (signs radar's own RP session cookie).

> **Operator precondition on the sentropic side** (cite:
> `RP_SESSION_GLUE.md` "Preconditions" + sentropic
> `api/src/services/auth/oauth-client-seed.ts`, which seeds `design-system`):
> register an `oauth_clients` row at the IdP with
> `client_id = radar-immobilier`,
> `redirect_uris = [https://immo.sent-tech.ca/api/v1/auth/oauth/callback]`,
> `authorization_code` + PKCE, scopes `openid profile email`, and hand the
> resulting `client_secret` to the `radar-sentropic-auth` Secret.

> **Phase A0 claim caveat** (cite: `RP_SESSION_GLUE.md` §"Phase A0 claim set"):
> the id_token currently carries only `sub`/`name`/`email` — no `tenant`/`role`.
> That is sufficient for radar's single-tenant POC login. Do not hand-roll
> tenant/role from A0 claims; tenant-scoped claims arrive in IdP Phase A1.

## Ingress reaches the UI pod, not the api — NetworkPolicy dependency

The public host `immo.sent-tech.ca` is fronted by the **`radar-ui` (nginx)**
pod on port **8080** (`50-ui.yaml`), which serves the SPA and reverse-proxies
`/api` + `/health` to `radar-api:3000`. The api is JSON-only and does **not**
serve the SPA (`api/src/app.ts`: `GET /` → `{name,status}`), so the Ingress
**must** target the ui Service, as it does in `60-ingress.yaml`.

The cluster-operator baseline in **poc-k8s**
(`tenants/radar-immobilier/30-netpol.yaml`, policy `allow-traefik-to-api`)
only opens **Traefik → api:3000**. Under the namespace's default-deny ingress,
Traefik traffic to the ui pod on 8080 is **dropped** — so without an additional
policy the host resolves and the cert issues, but every request (including
`GET /health`) is blocked before reaching nginx.

This branch ships the tenant-side fix `70-networkpolicy.yaml`
(`allow-traefik-to-ui`, additive — NetworkPolicies are OR-combined), mirroring
the operator's selectors but targeting `{component: ui, port 8080}`.

> **Parent/operator decision** — pick one before the live deploy:
> - **(A)** apply `70-networkpolicy.yaml` from this repo (default; tenant-owned);
> - **(B)** instead extend poc-k8s `tenants/radar-immobilier/30-netpol.yaml`
>   with a Traefik → `{component: ui, port 8080}` rule (then drop
>   `70-networkpolicy.yaml` from `kustomization.yaml`);
> - **(C)** rejected: fronting the Ingress on the api — radar's api does not
>   serve the SPA.
>
> Note: the poc-k8s `requests/radar-immobilier.md` says "Ingress: host
> immo.sent-tech.ca, **API only**" and cites issuer `letsencrypt`. Both are
> stale vs. what radar actually deploys: the public surface is the **UI**
> (nginx → api same-origin), and the issuer that exists on the cluster is
> **`letsencrypt-prod`** (poc-k8s `platform/30-clusterissuer.yaml`), which is
> what `60-ingress.yaml` already references.

## Sentropic workspace for code management

radar's code is managed within a **named sentropic workspace**,
`radar-immobilier`, declared in two places so it is discoverable both in-cluster
and in the manifests:

- the Namespace and every resource carry
  `sentropic.dev/workspace: radar-immobilier` (and `app.kubernetes.io/part-of:
  sentropic`), stamped centrally by `kustomization.yaml`. This is the cluster-side
  workspace boundary — a single label selects everything the workspace owns:

  ```bash
  kubectl get all,ingress,cm -A -l sentropic.dev/workspace=radar-immobilier
  ```
- the workspace federates with the sentropic IdP `auth.sent-tech.ca`
  (`sentropic.dev/idp` label + `radar-sentropic-auth` ConfigMap in `80-auth.yaml`).

This mirrors how sentropic scopes a tenant's resources by `app.kubernetes.io/*`
labels in a dedicated namespace; radar adds the explicit `sentropic.dev/workspace`
tag so the radar codebase is unambiguously the code managed under that sentropic
workspace.

## Validation (offline, no cluster) — what CI runs

```bash
make k8s-validate ENV=<env>
```

This:
1. renders the bundle with `kubectl kustomize deploy/k8s` (kustomize v5,
   bundled in `kubectl`), failing on any kustomize error;
2. runs a structural check asserting **every** rendered document has both
   `apiVersion:` and `kind:`.

It needs **no cluster**. CI runs it in `.github/workflows/ci.yml` (step
"Validate K8s manifests …") after installing `kubectl`. With a real KUBECONFIG
you can additionally run a server-side dry-run:

```bash
make k8s-validate K8S_VALIDATE_WITH_CLUSTER=1 KUBECONFIG=<path> ENV=<env>
```

> `kubeconform`/`yamllint` are not installed in this environment, so validation
> uses the always-present `kubectl kustomize` render + the structural check. If
> `kubeconform` lands later, wire `kustomize build deploy/k8s | kubeconform`
> into `k8s-validate` for full schema validation.

## Manual deploy (human, with cluster creds)

`make deploy-k8s` is **prepare-only by default**: it validates and prints the
apply command but does **not** touch a cluster. To actually deploy you must
opt in explicitly with a KUBECONFIG and the confirm flag — this is the human's
trigger, not the agent's:

```bash
# 0. (operator, once) provision the tenant in poc-k8s: Namespace + ResourceQuota
#    + LimitRange + baseline NetworkPolicy, and register radar as an oauth_clients
#    row at the sentropic IdP (auth.sent-tech.ca); get the OIDC client_secret.

# 1. Create the real Secrets (never commit them). Either fill a private copy of
#    secrets.example.yaml and `kubectl apply -f`, or use SealedSecrets (the
#    sentropic tenant convention — see ~/src/sentropic/deploy/k8s/README.md).
kubectl -n radar-immobilier apply -f <private-secrets.yaml>

# 2. Build + push the api / obscura / ui images to the SCW registry (CI does
#    this on the live path; image build targets live in the Makefile).

# 3. Validate, then apply — explicit opt-in:
KUBECONFIG=<path> make deploy-k8s K8S_DEPLOY_CONFIRM=1 ENV=poc
#    (equivalently: KUBECONFIG=<path> kubectl apply -k deploy/k8s)

# 4. Smoke:
kubectl -n radar-immobilier get pods
curl https://immo.sent-tech.ca/health
```

A Cloudflare `A` record `immo.sent-tech.ca` → the Traefik LB IP must exist
(same LB as `sentropic.sent-tech.ca` / `auth.sent-tech.ca`) before cert-manager
can issue the TLS cert and before login redirects resolve.

## What's prepared vs. what the human runs

| Prepared in this branch (validated offline) | Human runs with cluster creds (NOT in this branch) |
| --- | --- |
| all `deploy/k8s/*.yaml` manifests + kustomization | `kubectl apply -k deploy/k8s` / `make deploy-k8s K8S_DEPLOY_CONFIRM=1` |
| `make k8s-validate` + CI render/structural check | `make k8s-validate K8S_VALIDATE_WITH_CLUSTER=1` (server dry-run) |
| OIDC RP env + auth-delegation record (`80-auth.yaml`) | register the `radar-immobilier` oauth client at the sentropic IdP |
| `secrets.example.yaml` (placeholders only) | create the real Secrets / SealedSecrets |
| Ingress for `immo.sent-tech.ca` | create the Cloudflare A record; operator applies NetPol/RQ |
