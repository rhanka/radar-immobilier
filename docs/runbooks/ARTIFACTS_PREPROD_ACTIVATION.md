# Artifact publication and basket-reader activation in preprod

L4 enables the L1/L2 publication tools and L3 reader from PRs #930/#931.
All commands run from the repository root through the standalone Makefile below;
it never loads `.env`. Only the cluster operator executes the live targets.
Set an explicit preprod `KUBECONFIG` in the operator session. Rollback needs
pod-list and pod-exec permissions to verify only `ARTIFACTS_CONTROL_MODE` in
each API/MCP pod; it never retrieves Secret data. The namespace is
hardcoded to `radar-immobilier-preprod`; live targets also require `ENV=preprod`.
Pause preprod CD during controlled activation: its reconcile reapplies the modes
committed in Git, currently `off` for both API and MCP.

## Runtime and coordinates

The reader runs **inside `radar-api`**, on its existing port 3000. Route content
directly to Service `radar-api:http`, preserving the original Host. Do not use
the standalone `content-reader` entrypoint: it lacks the production DB/S3 wiring.
The API host gate rejects app/API paths before app authentication or SPA routing.
The overlay renders with plain `kubectl kustomize deploy/overlays/preprod`.
MCP's shared directory base retains the production 40/41 paths as symlinks to
unchanged manifests; the production base render remains byte-identical.

| Concern | Required configuration |
| --- | --- |
| Admission | API and MCP `ARTIFACTS_CONTROL_MODE=general`; current account must be `approved`, including commit/replay checks; no subjects list or expiration |
| Storage namespace | API/MCP `ARTIFACTS_STORAGE_SCOPE=radar-immobilier-preprod`, `ARTIFACTS_ORG_ID=radar-immobilier-preprod`; not a workspace ID |
| Private bucket | `radar-immobilier-artifacts-preprod`, endpoint `https://s3.bhs.io.cloud.ovh.net`, region `bhs` |
| Object prefix | `artifacts/radar-immobilier-preprod/`; blob suffix `blobs/sha256/<digest>`; fixed by code, no prefix environment variable |
| Content base | Bare hostname `preprod.immo-pages.sent-tech.ca`, identical on API and MCP |
| Stable / pinned origins | `<artifact-uuid>.preprod.immo-pages.sent-tech.ca` / `<release-uuid>.pinned.preprod.immo-pages.sent-tech.ca` |
| Reader approval | Existing app login, review and POST confirmation at `https://preprod.immo.sent-tech.ca`; issuer that origin, audience that origin plus `/reader`, tier `preprod` |
| Reader DB/S3 | Existing API DB credentials, artifact authority/ACL/releases/tickets in PostgreSQL, artifact S3 bindings, existing application object store for basket reads |
| MCP DB | Secret `immo-mcp-artifact-writer`, key `IMMO_MCP_ARTIFACT_DATABASE_URL`; retain separate `immo-mcp-account-reader` binding |
| Publication S3 | Secret `radar-artifacts-preprod`, keys `ARTIFACTS_S3_ACCESS_KEY`, `ARTIFACTS_S3_SECRET_KEY`, shared by API/MCP |
| S3 time budget | Optional, API/MCP: `ARTIFACTS_S3_ATTEMPT_TIMEOUT_MS` (default 4000, one HTTP attempt), `ARTIFACTS_S3_MAX_ATTEMPTS` (default 3; timeouts, network errors, 5xx, throttling such as 429/SlowDown and S3 RequestTimeout are retried on a new connection, other 4xx are not), `ARTIFACTS_S3_OPERATION_TIMEOUT_MS` (default attempts x attempt + 1000 = 13000, at most 120000, explicit or derived). Every blob operation of one publish also shares a 20 s deadline, 10 s inside the 30 s preparation window; an exhausted budget or deadline returns a retriable 503 |
| Reader signing | Secret `radar-artifacts-reader-preprod`, keys `ARTIFACTS_READER_GRANT_SECRET`, `ARTIFACTS_READER_SESSION_SECRET`, shared by every API instance |
| Basket cursors | Secret `radar-classification-cursor-preprod`, key `CLASSIFICATION_CURSOR_SECRET`; ConfigMap key `CLASSIFICATION_CURSOR_KEY_ID=preprod-v1`, shared by API routes and reader |

DNS, certificate, bucket existence, IAM and live database state are **unverified**
by offline delivery. These are requested provisioning coordinates. If the operator
needs different names, change both API/MCP patches, Ingress and render guard
together through review before activation; do not substitute only live values.

## Operator prerequisites

1. Record context, namespace, source commit and approved API image digest containing
   both merged lots and the wildcard-host gate correction delivered with this
   runbook. Back up the preprod database and apply the normal migration
   chain through **0026**, including 0015/0016, 0024, 0025 actor quotas and 0026
   reader tickets. Record migration journal hashes. No destructive migration/reset.
2. Create the private bucket and bucket-scoped read/write credentials restricted
   to the prefix above. Deny public object access. The reader fetches verified
   blobs through the API; browsers never receive S3 credentials or signed S3 URLs.
3. Provision the distinct MCP publication role/URL for the same preprod DB.
   It needs artifacts-schema usage/DML, migration-journal reads, account/membership
   reads and the row-lock privileges used by `SELECT ... FOR SHARE` (for example,
   column UPDATE on account ID and membership workspace ID). Keep the existing
   account-reader role read-only. Verify the role with real publication before GO.
   Privileges of `immo_mcp_artifact_writer` and `immo_mcp_account_reader` are
   re-asserted by the migrator (`api/src/db/service-role-grants.ts`) after every
   migration run, including the cutover `ddl` step on the prepared database:
   restores use `--no-privileges` and drop every GRANT. Both role URLs follow
   `radar-db-credentials.POSTGRES_DB` through `IMMO_MCP_DATABASE_NAME`; the
   database name stored in the URL is ignored once that binding is present.
4. Provision `artifacts.storage_scopes` with the scope/org above and a matching
   `artifacts.host_quotas` row. Set explicit nonzero `operation_limit` and
   `byte_limit` for this preprod campaign, record them and verify remaining budget.
   Missing quotas block commits. Actor ceilings auto-provision from the global
   row, without per-user approval; ten new mutation attempts/minute/account is
   enforced in PostgreSQL. Replays keep their receipt without double charging.
5. Confirm network paths: Traefik → API:3000; API/MCP → PostgreSQL:5432;
   API/MCP → S3:443 and DNS; API → IdP and its existing basket/object-store
   dependencies; MCP → preprod IdP/JWKS. The MCP PostgreSQL ingress policy is
   already in the base. Ask the cluster operator to verify/extend its baseline
   API ingress and API/MCP egress policies for these destinations. The isolated
   rollback-denial pods retain zero egress and receive no credentials.

## Persistent keys and credentials

Run once; these targets retain existing Secrets using metadata only. A failed
metadata lookup stops the target. Never enable shell tracing. New keys are
generated in mode-0700 temporary directories with mode-0600 files, passed by file
to Kubernetes, then removed; their values are never printed or stored in Git.

```sh
make -f deploy/overlays/preprod/artifacts-activation.mk cursor-secret ENV=preprod
make -f deploy/overlays/preprod/artifacts-activation.mk reader-secrets ENV=preprod
make -f deploy/overlays/preprod/artifacts-activation.mk credentials ARTIFACT_S3_ACCESS_KEY_FILE=/secure/artifacts/access-key ARTIFACT_S3_SECRET_KEY_FILE=/secure/artifacts/secret-key ARTIFACT_DATABASE_URL_FILE=/secure/artifacts/writer-url ENV=preprod
```

The credential files come from the operator's secret manager, with private file
permissions. Existing Secrets are retained, so separately verify their keys and
IAM scope without logging values. Persist/back up all three signing keys in the
secret manager. Every API replica must load the **same cursor key and key ID**.
Do not generate keys at pod startup or recreate these Secrets on rollout.
Rotation requires coordinated replacement and API restart; current cursor loading
supports one key, so outstanding continuations will be invalidated by rotation.

## DNS, TLS and ingress request

Ask the DNS/cluster operator for records routing both
`*.preprod.immo-pages.sent-tech.ca` and
`*.pinned.preprod.immo-pages.sent-tech.ca` to the preprod Traefik ingress.
Provision TLS Secret `radar-artifact-content-preprod-tls` in the preprod namespace
with **both wildcard SANs**. One wildcard does not cover the deeper pinned hosts.
Use DNS-01 issuance or import a certificate; this overlay requests no automatic
wildcard issuance. Confirm certificate chain/SANs and DNS from outside the cluster.
Do not route these hosts to `radar-ui` or rewrite Host to the application host.
Verify no parent-domain application cookie is sent to either content hostname.

## Ordered activation

Keep CD paused until provisioning and checks are complete. Replace `<digest>`
below with the approved 64-character API image digest; never apply `:latest`.

When resuming from Git **off**, retain `off` in both
`patch-artifacts-control.yaml` and `patch-immo-mcp-config.yaml` until deliberate
activation. Verify effective `off` in every API/MCP pod before installing S3
publication credentials. The standalone `render` target explicitly converts
either Git mode (`off` or `general`) to the requested `MODE` and checks each
rendered ConfigMap. Thus step 4 works directly from Git off; no preliminary Git
edit is needed to render or apply `general` while CD is paused. Rendering only
writes `OUT/render.yaml` and never changes Git or the cluster. Pause the CD
workflow through the operator procedure; never set `PREPROD_CD_ENABLED=false`,
which would route delivery to production.

1. Complete backup/migrations, scope/quotas, bucket/IAM, secrets and DNS/TLS.
2. Render **off**, retain its SHA-256, review its selected resources and image:

   ```sh
   make -f deploy/overlays/preprod/artifacts-activation.mk render ARTIFACT_API_IMAGE=ghcr.io/rhanka/radar-api@sha256:<digest> ENV=preprod
   make -f deploy/overlays/preprod/artifacts-activation.mk apply-runtime ENV=preprod
   ```

   `apply-runtime` applies the rendered API/MCP ConfigMaps, denial Service and
   policies, then the denial, API **and MCP Deployments**, restarting and awaiting
   each rollout. It uses field manager `cd-preprod` so the next reconcile agrees.
   Existing MCP OAuth, account-reader and workload-secret bindings remain.
   Missing optional artifact secrets keep the app alive but close the capability;
   pod readiness alone therefore does not prove artifact availability.
   `apply-runtime` and `route` independently reject mutable or divergent
   API/MCP/denial images, including a render supplied directly in `OUT`.
3. Check rollout/image digests, DB schema/remaining quotas and secret metadata.
   The API log must report the mounted reader and configured cursor keyring.
   Route content only after the API is ready with its content-host gate mounted.
4. Render **general**, review and retain this new render/hash, then apply it:

   ```sh
   make -f deploy/overlays/preprod/artifacts-activation.mk render MODE=general ARTIFACT_API_IMAGE=ghcr.io/rhanka/radar-api@sha256:<digest> ENV=preprod
   make -f deploy/overlays/preprod/artifacts-activation.mk apply-runtime ENV=preprod
   make -f deploy/overlays/preprod/artifacts-activation.mk route ENV=preprod
   ```

   `route` applies only Ingress `radar-artifact-content`, both wildcards to the
   API. Do not apply the entire overlay or change production resources. The CD
   applies both ConfigMaps and the API Deployment, but **not the MCP Deployment,
   content Ingress, denial resources or network policies**. Those operator steps
   are necessary even when a subsequent CD sets the correct MCP image.
5. Run the checks below and record receipts. Before resuming CD, deliver
   `ARTIFACTS_CONTROL_MODE: general` in **both** Git patches through normal
   review/commit delivery; otherwise the next reconcile restores `off/off`.
   Resume CD and check that a subsequent
   preprod reconcile retains both `general` values and the injected references;
   no cluster-side check or reconcile receipt is supplied by offline delivery.

## Acceptance before GO

Use two separate browser profiles and two current approved accounts, A and B.
Record source/image/render hashes, account aliases, status codes and observations;
never log bearers, grants, tickets, cookie values or secret data.

- Connect each account to preprod MCP with `immo:read`. `tools/list` must expose
  `artifacts_ensure`, `artifacts_publish`, `artifacts_list`, `artifacts_get`.
  Both accounts publish real HTML/CSS/JS using the same binding name and distinct
  operation keys. Confirm distinct artifacts and no private cross-account access.
- Give the readers authorized access to a shared test artifact using existing
  artifact ACLs. Open its stable URL as each reader, complete app review/approval,
  then follow the pinned release. Confirm actual HTML/CSS/JS execution and H5
  context/search/state responses showing each reader's own authorized baskets.
  An approved account without workspace membership may publish; basket reads
  require an explicit authorized workspace, with no implicit `default`.
- Use enough fixture results to obtain a search continuation. Read page one,
  restart the API with the **same Secret and key ID**, then successfully read
  the continuation; repeat across API instances if multiple replicas are used.
  Confirm workspace revocation, foreign workspace and unapproved account fail.
- On both stable and pinned hosts, GET/POST `/admin`, `/login`, `/auth/login`
  and `/api/v1/workspaces` must never reach the app, admin or login UI;
  `/api/*` must return 401 and app/admin paths a reader refusal, without an app
  cookie or app redirect. Test without a grant and with a valid reader session.
  `/health` and `/livez` are deliberately probe exceptions.
- Repeat the isolation checks with nonexistent UUIDs and malformed labels,
  including `not-a-uuid.preprod.immo-pages.sent-tech.ca` and
  `nope.pinned.preprod.immo-pages.sent-tech.ca`. Check `/api/v1/auth/enroll`,
  `/api/v1/auth/login`, `/api/geo/collections` and `/admin`: no app handler,
  app cookie or redirect; isolation headers must remain present.
- Inspect HTML, subresources, H5 and denial responses: private/no-store cache,
  `nosniff`, no-referrer, COOP/CORP `same-origin`, `X-Frame-Options: DENY`,
  restrictive CSP, including denied workers/frames/objects/forms.
  Confirm release-script hashes match the interpreted code and H5 succeeds.
- In browser network/cookie storage, confirm app session cookies stay on the
  app host; content cookies are host-only `__Host-` Secure/HttpOnly with no Domain.
  No app cookie is exposed to published JavaScript or sent to content hosts;
  no backend credential or S3 URL appears in served files or reader responses.

## Rollback

Pause preprod CD immediately, then execute:

```sh
make -f deploy/overlays/preprod/artifacts-activation.mk rollback ENV=preprod
```

This attempts **both** live control modes at `off`, sends both wildcard routes
to the retained isolated denial Service when the Ingress exists, and requests
both API/MCP restarts before waiting for either rollout. An absent Ingress is
accepted; lookup/patch/RBAC/transport failures are reported. Every closure step
is attempted even after another fails. Success requires both rollouts, both
ConfigMaps at `off`, and `ARTIFACTS_CONTROL_MODE=off` verified in every selected
API/MCP pod, including old replicas. Any failure returns nonzero; a ConfigMap
write alone never counts as a successful rollback. Resolve the reported failure
and rerun rollback before declaring closure.
Retest publication denial and refusal of existing content URLs on both host
families. Route cutoff matters: mode `off` alone does not revoke existing reader
grants. Already loaded files or committed publications cannot be recalled.
Keep the bucket, DB rows, receipts, quota counters and persistent keys.

Before resuming CD, change `ARTIFACTS_CONTROL_MODE` to `off` in **both**
`patch-artifacts-control.yaml` and `patch-immo-mcp-config.yaml` through the normal
review/commit delivery. The offline general gate accepts this paired closure.
Otherwise the next reconcile reapplies `general`. Keep the content Ingress on
denial until deliberate reactivation; CD does not reconcile that Ingress.
