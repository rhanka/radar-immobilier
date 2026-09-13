# Immo, Geo and Kubernetes architecture

Snapshot: **2026-09-13**, with read-only cluster checks at **11:38 UTC**. This describes the current system, including transitional wiring. The workstation is still required to produce/enrich LLM-derived graphs. A nightly scrape followed by a projection does not by itself create new LLM-derived signals.

Evidence labels: **LIVE** = observed during this inspection; **DECLARED** = repository configuration, not proof of deployment; **PLANNED** = documented evolution. Links and source revisions are collected at the end.

## 1. User access and environment boundaries

| Surface | Production | Preproduction | Evidence |
| --- | --- | --- | --- |
| Immo application | `https://immo.sent-tech.ca` | `https://preprod.immo.sent-tech.ca` | LIVE login redirects |
| Sent-tech SSO / OIDC issuer | `https://auth.sent-tech.ca` | `https://preprod.auth.sent-tech.ca` | LIVE discovery and redirects |
| OIDC client | `radar-immobilier` | `radar-immobilier-preprod` | LIVE redirect parameters |
| Geo OGC API | `https://api.geo.sent-tech.ca` | `https://api.preprod.geo.sent-tech.ca` | LIVE ingress / HTTP 200 conformance |
| Immo Kubernetes namespace | `radar-immobilier` | `radar-immobilier-preprod` | DECLARED / LIVE preprod |
| Geo Kubernetes namespace | `geo` | `geo-preprod` | LIVE prod / DECLARED preprod |
| SSO platform namespace | `sentropic` | `sentropic-preprod` | Platform records; not re-inventoried live |

The requested `preprod.sent-tech.ca` did **not resolve in DNS** during this inspection. It is not the observed Immo or SSO hostname. `sent-tech.ca` is the DNS domain; the actual identity-provider hosts include `auth` as shown above.

```mermaid
flowchart TB
  user["User / browser"]
  ppurl["preprod.immo.sent-tech.ca"]
  prurl["immo.sent-tech.ca"]
  user --> ppurl
  user --> prurl
  subgraph cloud["OVHcloud Canada · BHS · shared Kubernetes cluster poc-ca"]
    edge["Shared load balancer → Traefik<br/>TLS: cert-manager / Let's Encrypt"]
    subgraph preprod["PREPRODUCTION · separate namespaces and data"]
      pui["radar-immobilier-preprod<br/>radar-ui · Svelte + nginx :8080"]
      papi["radar-api · Hono / Node :3000"]
      pdb[("radar-postgres<br/>PostgreSQL 16 + PostGIS / PVC")]
      pidp["sentropic-preprod · auth-idp<br/>preprod.auth.sent-tech.ca"]
      pidb[("SSO platform PostgreSQL")]
      pgeo["geo-preprod · geo-api :8787<br/>api.preprod.geo.sent-tech.ca"]
      pui -->|"/api/*"| papi
      papi --> pdb
      pui -->|"/api/geo/collections*"| pgeo
      papi -->|"GEO_OGC_BASE_URL"| pgeo
      papi <-->|"OIDC token exchange / JWKS"| pidp
      pidp --> pidb
    end
    subgraph prod["PRODUCTION · separate namespaces and data"]
      ui["radar-immobilier<br/>radar-ui · Svelte + nginx :8080"]
      api["radar-api · Hono / Node :3000"]
      db[("radar-postgres<br/>PostgreSQL 16 + PostGIS / PVC")]
      idp["sentropic · auth-idp<br/>auth.sent-tech.ca"]
      idb[("SSO platform PostgreSQL")]
      geo["geo · geo-api :8787<br/>api.geo.sent-tech.ca"]
      geopg[("geo · postgis<br/>LIVE · not the OGC serving backend")]
      ui -->|"/api/*"| api
      api --> db
      ui -->|"/api/geo/collections*"| geo
      api -->|"Geographic queries"| geo
      api <-->|"OIDC token exchange / JWKS"| idp
      idp --> idb
    end
    edge --> pui
    edge --> ui
    edge --> pidp
    edge --> idp
    edge --> pgeo
    edge --> geo
  end
  ppurl --> edge
  prurl --> edge
  user <-->|"Login redirects, same environment"| pidp
  user <-->|"Login redirects, same environment"| idp
  pstore[("OVH S3 · sentropic-geo-preprod<br/>normalized/")]
  gstore[("OVH S3 · sentropic-geo<br/>normalized/")]
  pgeo -->|"Read collections"| pstore
  geo -->|"Read collections"| gstore
```

The cluster endpoint is `https://hlhedx.c1.bhs5.k8s.ovh.net`. `poc-k8s` owns the cluster, shared ingress/TLS, namespace quotas, RBAC, network policies and storage provisioning. Immo and Geo own their application workloads and images. Cloudflare provides DNS for `sent-tech.ca`; it is not the application host. The old Scaleway cluster description in `poc-k8s/README.md` is historical.

Authentication is application-level OIDC authorization code + PKCE. After the browser returns to `/api/v1/auth/oauth/callback`, `radar-api` verifies the identity and issues its own application session cookie. There is no ingress-level SSO enforcement on the Immo ingress. OGC collections are publicly readable; the Immo login boundary does not imply an OGC login boundary.
