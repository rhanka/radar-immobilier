# Preprod MCP delivery bindings

Scope: `radar-immobilier-preprod` only. This document prepares operator actions;
no cluster state, credentials or real deployment have been inspected here.
Do not release the new image until the prerequisites and digest-bound probe pass.

**Compatibility:** yes, deploying the new MCP image with the previous Deployment
and without the new objects breaks the current authenticated tools: the process
can start and OAuth discovery can stay ready while account authorization refuses
every call. Missing exchange authority also refuses `search_signals`. With the
new required `secretKeyRef`/`configMapKeyRef` bindings, missing objects or keys
instead prevent container startup (`CreateContainerConfigError`). Empty secrets
still require qualification; object existence is insufficient. No legacy route
or user-bearer forwarding is restored.

## Exact search delivery inventory

Names below are process variables, case-sensitive. ConfigMaps are non-secret.
All objects belong to `radar-immobilier-preprod`. Existing API infrastructure
bindings must remain present in addition to the two new MCP Secrets.

| Variable | Object/source | Expected preprod value or creation | If absent |
|---|---|---|---|
| `IMMO_MCP_ACCOUNT_DATABASE_URL` | Secret `immo-mcp-account-reader`, same key | PostgreSQL URL for the restricted role below, DB served by `radar-postgres:5432`; provision from a protected file | Bare image starts, all HTTP tools refuse; required manifest reference blocks startup |
| `IMMO_MCP_WORKLOAD_CLIENT_SECRET` | Secret `immo-mcp-workload`, same key | Confidential credential minted by the preprod IdP for the workload client | Bare image starts, search refuses; required manifest reference blocks startup |
| `IMMO_MCP_WORKLOAD_SUB` | CM `radar-mcp-receiver/STRICT_RECEIVER_WORKLOAD_SUB` | `immo-mcp-workload`, exact registered `act.sub` | No exchange; required manifest reference blocks startup |
| `IMMO_MCP_WORKLOAD_CLIENT_ID` | CM `radar-mcp-receiver/STRICT_RECEIVER_WORKLOAD_CLIENT_ID` | `immo-mcp-workload`, exact registered confidential client | Same |
| `IMMO_MCP_API_AUDIENCE` | CM `immo-mcp-config` | `https://preprod.immo.sent-tech.ca` (no `/mcp`, no trailing slash) | No exchange; search refuses |
| `IMMO_MCP_OAUTH_ISSUER` | CM `immo-mcp-config` | `https://preprod.auth.sent-tech.ca` | MCP startup throws |
| `IMMO_MCP_OAUTH_RESOURCE` | CM `immo-mcp-config` | `https://preprod.immo.sent-tech.ca/mcp` | MCP startup throws |
| `IMMO_MCP_EXCHANGE_ISSUER` | Optional override, deliberately unset | Falls back to the OAuth issuer above | Uses OAuth issuer |
| `IMMO_MCP_EXCHANGE_TOKEN_ENDPOINT` | Optional override, deliberately unset | Derived as `https://preprod.auth.sent-tech.ca/token`; IdP owner must confirm discovery matches | Uses issuer + `/token` |
| `IMMO_MCP_EXCHANGE_JWKS_URI` | Optional override, deliberately unset | Derived as `https://preprod.auth.sent-tech.ca/.well-known/jwks.json` | Uses exchange issuer + JWKS path |
| `IMMO_MCP_OAUTH_JWKS_URI` | Optional override, deliberately unset | Same preprod JWKS URI | Uses OAuth issuer + JWKS path |
| `IMMO_MCP_EXCHANGE_ENV` | CM `immo-mcp-config` | `preprod` | Falls back to `ENV`, then `unknown`; pin explicitly |
| `IMMO_MCP_EXCHANGE_POLICY_REV` | CM `immo-mcp-config` | `a2base-search-v1` | Same default; a different supplied revision aborts startup |
| `RADAR_API_BASE_URL` | CM `immo-mcp-config` | `http://radar-api:3000` | Fixture data source selected; unacceptable for this delivery |
| `RADAR_PUBLIC_BASE_URL` | CM `immo-mcp-config` | `https://preprod.immo.sent-tech.ca` | Raw URLs use internal API base; unacceptable |
| `IMMO_MCP_DATA_MODE` | CM `immo-mcp-config` | `http` | Simulation audit mode; source selection still depends on API base |
| `IMMO_MCP_HTTP_PORT` | CM `immo-mcp-config` | `8848` | Defaults to 8848 |
| `IMMO_MCP_OAUTH_REQUIRED_SCOPE` | Deliberately unset | Default `immo:read`; search also requires `immo:search` | Uses default |
| `IMMO_MCP_OAUTH_SCOPES_SUPPORTED` | CM `immo-mcp-config` | `immo:read immo:search immo:documents:read` | Same advertised defaults |
| `IMMO_MCP_SESSION_IDLE_TIMEOUT_MS` / `IMMO_MCP_SESSION_MAX_LIFETIME_MS` | Deliberately unset | Defaults 1800000 / 28800000 | Uses defaults |
| `MCP_SIGNAL_SEARCH_ENABLED` | API ref: CM `radar-mcp-receiver`, same key | Versioned `0`; operator sets `1` for qualification/serving | `0`, authenticated facade returns 503; values other than 0/1 abort API startup |
| `STRICT_RECEIVER_ARMED` | API ref: same CM, same key | Versioned `0`; `1` only after matching A2 qualification receipt | Disarmed; see receiver semantics below |
| `STRICT_RECEIVER_WORKLOAD_SUB` / `STRICT_RECEIVER_WORKLOAD_CLIENT_ID` | API refs: same CM, same keys | Both `immo-mcp-workload`, shared with MCP refs | Incomplete/disarmed wiring preserves pre-strict verification; never enable facade in this state |
| `STRICT_RECEIVER_ENVIRONMENT` | API ref: same CM, same key | `preprod` | Empty; arming fails |
| `STRICT_RECEIVER_API_IMAGE` / `STRICT_RECEIVER_MCP_IMAGE` | API refs: same CM, same keys | Actual approved API and MCP `sha256:<64 hex>` image digests | Arming fails |
| `STRICT_RECEIVER_RECEIPT_ISSUER` | API ref: same CM, same key | `https://preprod.auth.sent-tech.ca` | Arming fails |
| `STRICT_RECEIVER_RECEIPT_API_AUDIENCE` | API ref: same CM, same key | `https://preprod.immo.sent-tech.ca` | Arming fails |
| `STRICT_RECEIVER_RECEIPT_WORKLOAD_SUB` / `STRICT_RECEIVER_RECEIPT_WORKLOAD_CLIENT_ID` | API refs: same CM, same keys | Both exact workload references above | Arming fails |
| `STRICT_RECEIVER_RECEIPT_ENVIRONMENT` | API ref: same CM, same key | `preprod` | Arming fails |
| `STRICT_RECEIVER_RECEIPT_ROUTE_PROFILE` | API ref: same CM, same key | `mcp-signals-search.get.v1` | Arming fails |
| `STRICT_RECEIVER_RECEIPT_SCHEMA_REVISION` | API ref: same CM, same key | `scoped-signal-search.v1` | Arming fails |
| `STRICT_RECEIVER_RECEIPT_POLICY_REVISION` | API ref: same CM, same key | `a2base-search-v1` | Arming fails |
| `STRICT_RECEIVER_RECEIPT_API_IMAGE` / `STRICT_RECEIVER_RECEIPT_MCP_IMAGE` | API refs: same CM, same keys | Digests in the actual A2 receipt; must equal the target image fields | Arming fails |

The versioned receiver CM is deliberately closed and carries no receipt.
The CD reconciles `radar-api` and `immo-mcp-config`, but does **not** reconcile
the MCP Deployment, the receiver CM, Secrets or network policies. The operator
must apply those prerequisites before CD; an image change alone cannot do it.
Do not reapply the closed receiver template over an active receipt accidentally.

Receiver semantics: `ARMED=1` without a complete matching receipt aborts API
startup (`strict_receiver_receipt_invalid`); without API auth it aborts with
`strict_receiver_requires_auth`. Complete disarmed wiring verifies delegated
presentations strictly, but only arming closes the plain human-bearer path.
Qualification must end with `ARMED=1` and repeat the probes. The facade flag is
independent of arming: maintenance, current account approval, workspace access
and durable legacy retirement continue to govern each request.

## Existing infrastructure and disabled capabilities

| Variables | Object/source | Required state and missing behavior |
|---|---|---|
| `POSTGRES_HOST`, `POSTGRES_PORT` | CM `radar-api` | `radar-postgres`, `5432`; code defaults to `postgres`,5432, so pin the Service |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Secret `radar-db-credentials`, same keys | Existing migrated application database; mandatory refs block pod startup if missing; this is separate from the MCP read-only role |
| `SENTROPIC_IDP_ISSUER` | CM `radar-api` | `https://preprod.auth.sent-tech.ca`; absent can disable API auth |
| `SENTROPIC_OAUTH_CLIENT_ID` | CM `radar-api` | `radar-immobilier-preprod`; pre-existing confidential RP client |
| `SENTROPIC_OAUTH_CLIENT_SECRET`, `SESSION_SECRET` | Secret `radar-sentropic-auth`, same keys | RP credential and independent session-signing key; required refs block startup if absent; empty auth fields disable auth unless strict arming rejects startup |
| `SENTROPIC_OAUTH_REDIRECT_URI`, `AUTH_CALLBACK_BASE_URL` | CM `radar-api` | `https://preprod.immo.sent-tech.ca/api/v1/auth/oauth/callback`, `https://preprod.immo.sent-tech.ca`; never use the prod origin |
| `SENTROPIC_OAUTH_SCOPES`, `SESSION_TTL_SECONDS`, `SESSION_ABSOLUTE_TTL_SECONDS` | CM `radar-api` | `openid profile email`, `1296000`, `2592000`; defaults match |
| `SENTROPIC_IDP_JWKS_URI` | Deliberately unset | Defaults to preprod issuer + `/.well-known/jwks.json`; `SENTROPIC_IDP_JWKS_URL` and `...DISCOVERY_URL` are not consumed by the resolver |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Secret `radar-docs-s3-credentials`, respective `DOCS_S3_*` keys | Existing bucket-scoped OVH DOCS binding; required refs block startup if missing; unavailable store fails API health/document enrichment |
| `SCRAPE_S3_ENDPOINT`, `SCRAPE_S3_REGION`, `SCRAPE_S3_BUCKET`, `SCRAPE_S3_FORCE_PATH_STYLE` | CM `radar-api` | `https://s3.bhs.io.cloud.ovh.net`, `bhs`, `radar-immobilier-docs-preprod`, `false`; absent values fall back to S3 counterparts |
| `GRAPH_S3_ENDPOINT`, `GRAPH_S3_REGION`, `GRAPH_S3_BUCKET`, `GRAPH_S3_FORCE_PATH_STYLE` | CM `radar-api` | Same preprod DOCS coordinates; optional graph reader follows config fallbacks |
| `SCRAPE_S3_ACCESS_KEY`, `SCRAPE_S3_SECRET_KEY`, `GRAPH_S3_ACCESS_KEY`, `GRAPH_S3_SECRET_KEY` | Not separately injected into API | Fall back to primary bucket-scoped credentials; never add broad credentials |
| `NODE_ENV`, `PORT`, `NODE_OPTIONS` | CM `radar-api` / MCP CM | API `production`, `3000`, existing IPv4/memory options; MCP keeps IPv4-first DNS and port 8848 |
| `ARTIFACTS_CONTROL_MODE` | API CM `radar-api` | `off`; artifacts activation is outside this search delivery |
| `IMMO_MCP_ARTIFACT_DATABASE_URL`, `ARTIFACTS_CONTENT_BASE`, artifact S3/activation variables | Deliberately absent on MCP | Artifact tools stay closed; absent artifact storage/activation does not block search startup; activating storage plus admission without DB/content fails startup |

Optional LLM keys (`radar-llm-credentials/OPENAI_API_KEY`, `ANTHROPIC_API_KEY`),
TEM (`radar-tem-credentials/SCW_TEM_SECRET_KEY`) and Obscura are not prerequisites
for this read-search path. Keep existing bindings; no new credential is needed.
