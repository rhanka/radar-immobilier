# Artifact publication and basket-reader activation in preprod

L4 enables the L1/L2 publication tools and L3 reader from PRs #930/#931.
All commands run from the repository root through the standalone Makefile below;
it never loads `.env`. Only the cluster operator executes the live targets.
Set an explicit preprod `KUBECONFIG` in the operator session. The namespace is
hardcoded to `radar-immobilier-preprod`; live targets also require `ENV=preprod`.
Pause preprod CD during preparation: its reconcile will apply `general` from Git.

## Runtime and coordinates

The reader runs **inside `radar-api`**, on its existing port 3000. Route content
directly to Service `radar-api:http`, preserving the original Host. Do not use
the standalone `content-reader` entrypoint: it lacks the production DB/S3 wiring.
The API host gate rejects app/API paths before app authentication or SPA routing.

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
| Reader signing | Secret `radar-artifacts-reader-preprod`, keys `ARTIFACTS_READER_GRANT_SECRET`, `ARTIFACTS_READER_SESSION_SECRET`, shared by every API instance |
| Basket cursors | Secret `radar-classification-cursor-preprod`, key `CLASSIFICATION_CURSOR_SECRET`; ConfigMap key `CLASSIFICATION_CURSOR_KEY_ID=preprod-v1`, shared by API routes and reader |

DNS, certificate, bucket existence, IAM and live database state are **unverified**
by offline delivery. These are requested provisioning coordinates. If the operator
needs different names, change both API/MCP patches, Ingress and render guard
together through review before activation; do not substitute only live values.

## Operator prerequisites

1. Record context, namespace, source commit and approved API image digest containing
   both merged lots. Back up the preprod database and apply the normal migration
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
