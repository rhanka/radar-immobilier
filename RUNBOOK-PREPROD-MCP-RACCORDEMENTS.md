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
| `IMMO_MCP_EXCHANGE_TOKEN_ENDPOINT` | CM `immo-mcp-config` | `https://preprod.auth.sent-tech.ca/api/v1/auth/oauth/token`; pinned to the IdP route, operator confirms against discovery | Code falls back to issuer + `/token`, which does not match the available IdP sources |
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

## Operator preparation, before CD changes the image

1. Hold the main deployment/CD until this checklist is signed off. Export
   `OP_CONTEXT` (the approved preprod kube context), `OP_POSTGRES_POD`,
   `OP_ADMIN_USER`, `OP_DATABASE`, `OP_RENDER` (non-secret render path),
   `OP_OLD_API_IMAGE`, `OP_OLD_MCP_IMAGE` (currently served immutable images).
   Never use shell tracing. Every command below is routed through Make and
   pins `radar-immobilier-preprod`; no command targets prod or dev.

   ```sh
   rtk make -f tools/make/artefacts-delivery.mk manifests ENV=preprod
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod get deployment radar-api radar-immo-mcp -o custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image' ENV=preprod
   ```

   Set `OP_RENDER=tmp/delivery-evidence/manifests/preprod.yaml`. Record the
   current image references before proceeding; resolve mutable tags to their
   currently running digest first. Keep the hold until the final probes pass.

2. Create the dedicated DB role, once. The SQL grants column-scoped SELECT
   only on `account_users` and `workspace_memberships`, no application writes,
   migration rights or artifact access. It sets a 2s statement timeout and
   read-only transactions. Inspect existing roles instead of recreating them.

   ```sh
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod exec -i "$OP_POSTGRES_POD" -- psql -X -U "$OP_ADMIN_USER" -d "$OP_DATABASE" -v ON_ERROR_STOP=1 -v reader=immo_mcp_account_reader -v database="$OP_DATABASE" < tools/make/artefacts-delivery-account.sql' ENV=preprod
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod exec -it "$OP_POSTGRES_POD" -- psql -X -U "$OP_ADMIN_USER" -d "$OP_DATABASE" -c "\password immo_mcp_account_reader"' ENV=preprod
   ```

   Enter a newly generated password at the protected prompt. Store the URL
   using this credential in the approved secret manager, then materialize a
   mode-0600 file outside the repository at `OP_ACCOUNT_URL_FILE`. Do not print
   it. Use `radar-postgres:5432` and the exact database; percent-encode URL
   credentials. Both write-privilege query results must be false; audit PUBLIC
   grants and role memberships if they are not. Use this role to verify both
   SELECT queries from `packages/immo-mcp/src/account-binding.ts` succeed and
   writes fail. The MCP pool also sets read-only mode and uses at most 2 clients.

3. Have the preprod IdP owner register/verify the confidential workload client
   `immo-mcp-workload`, distinct from the human connector and the API RP client.
   Use the IdP's supported administration interface, not guessed schema SQL.
   Enable RFC 8693 token exchange with client-secret-basic, only from an
   approved human token for `https://preprod.immo.sent-tech.ca/mcp`, narrowing
   to scope `immo:search` and API audience `https://preprod.immo.sent-tech.ca`.
   The issued signed access JWT must have the same human `sub`, exact `iss`,
   singleton API `aud`, `client_id=immo-mcp-workload`,
   `act={"sub":"immo-mcp-workload"}`, no nested actor or `cnf`, and lifetime
   at most 300 seconds, bounded by the human token's expiry. Confirm the pinned token
   and JWKS endpoints from discovery. An unsupported exchange is a delivery
   blocker; the local synthetic issuer is never a deployment substitute.
   The available sentropic source (`packages/auth-hono/src/oauth/wellknown-handler.ts`)
   advertises only `authorization_code` and `client_credentials`; RFC 8693 was
   not found in that OAuth implementation. The public discovery probe from this
   workstation failed at TLS, so the running IdP's revision/capability remains
   unverified. The IdP owner must deploy a qualified exchange-capable revision
   if missing; registering a client alone cannot add this grant. Do not release
   the image against an IdP that lacks it.
   Store its new confidential credential in a mode-0600 file outside the repo
   at `OP_WORKLOAD_SECRET_FILE`. Create both opaque Kubernetes objects:

   ```sh
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='set -o pipefail; kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod create secret generic immo-mcp-account-reader --from-file=IMMO_MCP_ACCOUNT_DATABASE_URL="$OP_ACCOUNT_URL_FILE" --dry-run=client -o yaml | kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod apply --server-side --field-manager=mcp-operator -f -' ENV=preprod
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='set -o pipefail; kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod create secret generic immo-mcp-workload --from-file=IMMO_MCP_WORKLOAD_CLIENT_SECRET="$OP_WORKLOAD_SECRET_FILE" --dry-run=client -o yaml | kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod apply --server-side --field-manager=mcp-operator -f -' ENV=preprod
   ```

   These pipes transmit secrets without displaying them. Do not tee them or
   use `kubectl get secret -o yaml/json`. Delete local credential material using
   the secret manager's cleanup procedure after provisioning.

4. Apply the closed receiver CM, account network policy and preprod MCP CM
   from the validated render, selecting exactly one object per operation:

   ```sh
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='set -o pipefail; awk -v target_kind=ConfigMap -v target_name=radar-mcp-receiver -f tools/make/artefacts-delivery-select.awk "$OP_RENDER" | kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod apply --server-side --field-manager=mcp-operator -f -' ENV=preprod
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='set -o pipefail; awk -v target_kind=NetworkPolicy -v target_name=allow-immo-mcp-to-postgres -f tools/make/artefacts-delivery-select.awk "$OP_RENDER" | kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod apply --server-side --field-manager=mcp-operator -f -' ENV=preprod
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='set -o pipefail; awk -v target_kind=ConfigMap -v target_name=immo-mcp-config -f tools/make/artefacts-delivery-select.awk "$OP_RENDER" | kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod apply --server-side --field-manager=mcp-operator -f -' ENV=preprod
   ```

   Existing `allow-immo-mcp-to-api` must allow MCP to API TCP/3000; the new
   policy allows same-namespace MCP to PostgreSQL TCP/5432. Confirm DNS and
   HTTPS/443 egress to the preprod IdP/JWKS/token endpoint under the cluster's
   egress policies. No public PostgreSQL port or broad DB credential is needed.

5. Reconcile BOTH Deployments' new bindings while retaining their current
   images, before CD rolls the new image. The MCP Deployment is absent from
   CD's reconcile whitelist, so skipping this step repeats the delivery defect.

   ```sh
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='set -o pipefail; test -n "$OP_OLD_API_IMAGE"; awk -v target_kind=Deployment -v target_name=radar-api -f tools/make/artefacts-delivery-select.awk "$OP_RENDER" | kubectl set image --local -f - "api=$OP_OLD_API_IMAGE" -o yaml | kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod apply --server-side --field-manager=mcp-operator --force-conflicts -f -' ENV=preprod
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='set -o pipefail; test -n "$OP_OLD_MCP_IMAGE"; awk -v target_kind=Deployment -v target_name=radar-immo-mcp -f tools/make/artefacts-delivery-select.awk "$OP_RENDER" | kubectl set image --local -f - "mcp=$OP_OLD_MCP_IMAGE" -o yaml | kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod apply --server-side --field-manager=mcp-operator --force-conflicts -f -' ENV=preprod
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod rollout status deploy/radar-api; kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod rollout status deploy/radar-immo-mcp' ENV=preprod
   ```

   Verify Secret references by inspecting the Deployment spec, and Secret
   existence using `kubectl get secret <name> -o name` only. Check the database
   connection from the MCP pod using the configured reader, without printing
   its URL. Metadata/readiness alone does not establish functional delivery.

## Controlled rollout, A2 qualification and receipt

6. After prerequisites, run the normal supervised preprod CD (including backup
   and migrations) for the approved candidate. Keep the release acceptance
   pending. Record `OP_API_IMAGE` and `OP_MCP_IMAGE` as the actual immutable
   `sha256:<64 hex>` digests, not tags or Git SHAs. Verify the served pods:

   ```sh
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod get pods -l app.kubernetes.io/name=radar-immobilier -o custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[0].ready,IMAGE:.status.containerStatuses[0].imageID' ENV=preprod
   ```

   Compare the API and MCP imageIDs to the selected digests. A readiness pass
   only checks API dependencies or MCP discovery; it does not qualify search.

7. Build a non-secret `OP_RECEIVER_FILE` (outside the repo, suffix `.conf`) with
   the exact receiver keys in the inventory: `MCP_SIGNAL_SEARCH_ENABLED=1`,
   `STRICT_RECEIVER_ARMED=0`, workload pair, `STRICT_RECEIVER_ENVIRONMENT=preprod`,
   and target `STRICT_RECEIVER_API_IMAGE`/`STRICT_RECEIVER_MCP_IMAGE` digests.
   Do not copy credentials into it. Apply it, restart API (env is startup-only),
   then perform the controlled A2 probe below. Keep the validation window
   restricted to designated approved test users while the receiver is disarmed.

   ```sh
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='set -o pipefail; kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod create configmap radar-mcp-receiver --from-env-file="$OP_RECEIVER_FILE" --dry-run=client -o yaml | kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod apply --server-side --field-manager=mcp-operator -f -; kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod rollout restart deployment/radar-api; kubectl --context "$OP_CONTEXT" -n radar-immobilier-preprod rollout status deployment/radar-api' ENV=preprod
   ```

8. Provision a short-lived human token through the existing preprod OAuth/PKCE
   connector flow, audience ending `/mcp`, scopes `immo:read immo:search`.
   Put the entire `Authorization: Bearer ...` header in a protected file outside
   the repository (`OP_AUTH_HEADER_FILE`); never put the token on the command
   line. Export `OP_CITY`, `OP_WORKSPACE` and `OP_EXPECTED_SIGNAL` for a known
   signal visible to that approved account. `OP_EVIDENCE_DIR` is a private
   directory per probe. Run the exact Streamable HTTP initialize + tools/call:

   ```sh
   rtk make -f tools/make/artefacts-delivery.mk inspect CMD='bash tools/make/artefacts-delivery-probe.sh' ENV=preprod
   ```

   It checks both unauthenticated endpoints return 401 and verifies the actual
   known signal and workspace in `search_signals`, rather than accepting an
   empty success or discovery response. Repeat for designated legacy/missing
   and BASE-open workspaces when those states exist in this deployment.
   Correlate the request with the API access trace: only
   `GET /api/v1/mcp/facets/signals/search` may serve search, with delegated
   authority, not a cookie or the original human bearer. The local regression
   suite covers all three epochs; it does not prove the real IdP was provisioned.

9. Retain a digest-bound A2 receipt: time, target SHA, both served image digests,
   issuer, API audience, workload pair, environment, route/schema/policy
   revisions, expected signal/workspace and probe verdicts. After observing
   exchange success, append ALL `STRICT_RECEIVER_RECEIPT_*` keys from the
   inventory to `OP_RECEIVER_FILE`, matching that receipt exactly, and change
   `STRICT_RECEIVER_ARMED=1`. Reapply with step 7's command and repeat step 8.
   Merely copying target digests into receipt fields is not qualification.
   A missing/mismatched field must stop API startup, not disable enforcement.

10. Before releasing the hold, use the approved admin workflow to suspend the
    designated test account. Reuse its still-valid token, set
    `OP_EXPECTED_ERROR=composition_account` and use a fresh evidence directory;
    repeat the probe and require denial with no signal payload. Restore approval.
    Revoke its test workspace membership, set
    `OP_EXPECTED_ERROR=workspace_not_authorized`, repeat and require denial.
    If the human token itself asserts that workspace, account composition can
    refuse earlier with `composition_account`; document the actual boundary.
    Restore membership, unset `OP_EXPECTED_ERROR` and require success again.
    Perform changes only on the designated test identity/workspace, recording
    their prior state. Keep the recorded receipt and all post-arming results
    with the target digests. Only then accept delivery and release the hold.

## Closed recovery

On any failed prerequisite or probe, stop delivery and keep/restore
`MCP_SIGNAL_SEARCH_ENABLED=0` in the operator receiver CM; restart API to apply.
Preserve an already armed receiver and its matching receipt. Do not unset its
workload pair, disable enforcement, forward human bearers, or reopen legacy
routes as recovery. A replacement target must preserve strict enforcement,
exchange capability and stored data; qualify a matching digest-bound receipt.
Do not delete volumes or application data. Missing credentials must be repaired
out-of-band and MCP restarted, with the same probes repeated before acceptance.
