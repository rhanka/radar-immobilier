# H4 P6 stateful composition

P6 keeps twelve tools on the existing OAuth-protected `/mcp` transport. The
process compiles one provider through `createMcpRegistry` and installs one
`createStatefulMcpNamespace` bridge. Artifact tools remain unselected.

The MCP workspace pins `@sentropic/artifacts@0.2.0` and
`@sentropic/cluster-mesh@0.22.0`. Mesh requires `mcp-auth@0.2.1` and
`mcp-platform@0.4.0`; its contracts/events/stablelib dependencies are necessary
transitives. `zod-to-json-schema@3.25.1` preserves the existing SDK descriptors.
The account port uses the existing pg dependency family. The API and artifact
host retain their existing 0.1.2 provider until the A5 transport migration.
P6 does not load that service or select an artifact capability. A5 must migrate
`composition.ts`/`facade.ts` to `handle(request, invocation)`, the guarded
coordinator and `artifacts.operation_receipts` before enabling four tools.

Each HTTP request supplies a new verified principal and immutable invocation.
The original MCP credential stays inside the A2 exchange boundary. Session
ownership binds both subject and optional client presence/value; refresh keeps
the session only when that identity is unchanged. Idle/absolute expiry, DELETE
and restart retain the existing transport rules. Failed bridge installation
leaves admission closed; configuration changes require a fresh process.

The canonical RFC 9728 metadata URL is advertised in 0.2 challenges. The
historical metadata URL continues serving the same public document. Stdio is
fixture-only: inherited real API/storage settings cannot enable real access.

## Trusted account binding

The MCP Deployment needs `IMMO_MCP_ACCOUNT_DATABASE_URL` from its own Secret
reference. Provision it through the existing operator credential procedure.
Do not copy API credentials or add their values to source, reports or commands.
The process opens at most two connections, with 2-second connection/query
deadlines and `default_transaction_read_only=on`. Missing configuration or a
lookup error denies real tool effects. Synthetic fixtures need no database.

Grant the MCP database role CONNECT on the target database, schema USAGE and
SELECT only on `account_users` (`id`, `sub`, `status`) and
`workspace_memberships` (`account_id`, `workspace_id`, `status`, `revoked_at`).
Allow network access only to that database and the existing issuer/API
destinations. Every tool call rereads approval and every explicitly asserted
workspace membership. The historical `default` placeholder supplies no
membership assertion; protected signal search still requires its own explicit
workspace resolution and delegated API checks.

Before activation, pin the qualified P6 image digest, apply only the reviewed
MCP Deployment/configuration, and verify actual pod image and Secret/key
references without values. Prove approved access, suspension refusal and
membership revocation on the receiving environment. A local image test does
not establish that deployment receipt. Preserve strict API and A2 exchange
configuration during recovery; keep artifact capability unselected.

## Isolated verification

Use `make -f tools/make/artefacts-a4.mk run CMD='<container command>'` with
`API_PORT=18923 UI_PORT=15923 MAILDEV_UI_PORT=11923 ENV=test-artefacts-a4`.
The runner archives source without environment files, serializes Docker through
the machine campaign lock, waits 60 seconds between occupied-machine checks,
stops below 8 GiB free and removes its Compose resources on exit.

`make -f tools/h4-mcp.mk image-smoke` with those arguments builds the actual
final `api/Dockerfile` runtime. The probe runs as its non-root user, verifies the
installed tuple and exercises live account/membership revocation against
synthetic PostgreSQL. Only the probe and evidence directory are mounted.

Run `node tools/make/artefacts-a4-mutations.mjs` inside the isolated runner after
`npm ci --ignore-scripts --strict-peer-deps`. It kills request-authority and
failed-binding mutants with named semantic failures and passing restoration
controls. Ordinary MCP targets continue excluding service E2E; A5 owns their
separate provider acceptance. A7 owns operational activation and recovery.
# A5 shared artifact production composition

API, artifacts-host and MCP use published artifacts `0.2.0`; the MCP tuple
also pins cluster-mesh `0.22.0`, mcp-auth `0.2.1` and resolves mcp-platform
`0.4.0`. HTTP and MCP execute the same compiled four-operation profile and
server scope. The caller key reaches the provider unchanged. A fresh immutable
invocation supplies actor, scope and authorization; the provider owns canonical
hashes, ordered command identity, finalization and guarded replay.

The production MCP entrypoint constructs the trusted shared host when storage
configuration and validation activation are complete. It then exposes twelve
Immo tools plus `artifacts_ensure`, `artifacts_publish`, `artifacts_list` and
`artifacts_get`. Without activation it preserves the twelve-tool recovery
composition. Malformed enabled bindings stop startup. Stdio remains synthetic.
The artifact wire envelope is 2 MiB, including JSON-RPC framing.

## Migration and admission

Stop legacy writers before enabling the new host. Run the normal API migrator:
`0024_artifacts_coordinator` is appended after the frozen journal prefix. It
starts with the exact published `0003_coordinator.sql` bytes and adds Radar
policy, quota and failure tables. It preserves historical records and supports
fresh installation, upgrade, ordinary replay and missing-journal-row repair.
Startup verifies the journal hashes for both lifecycle and coordinator SQL;
it performs no DDL. Legacy inventory is read through the public PostgreSQL
adapter; ambiguous legacy command codecs remain quarantined.

Configure `ARTIFACTS_*` storage, `ARTIFACTS_CONTENT_BASE`,
`ARTIFACTS_CONTROL_MODE=validation`, `ARTIFACTS_VALIDATION_SUBJECTS` and
`ARTIFACTS_VALIDATION_UNTIL`. MCP additionally requires
`IMMO_MCP_ARTIFACT_DATABASE_URL` for its write-capable host and
`IMMO_MCP_ACCOUNT_DATABASE_URL` for the existing account/membership binding.
A string setting alone never supplies a provider binding: construction must
verify the migrated shared service. No live deployment is performed here.

An operator must provision `artifacts.host_quotas` for the server scope with
explicit `operation_limit` and `byte_limit`; no row grants no write quota.
Limits are cumulative per storage scope. Each new ensure or publication
reserves one operation; publication additionally reserves decoded bytes.
Replays consume neither. Increase limits to add capacity; retain used counters.
`artifacts.host_policy.revision` fences policy changes: a value different from
the host's `POLICY_REVISION` refuses old hosts until matching code is deployed.
Account status, policy
revision and quota use the coordinator transaction; activation/cohort/expiry
are reread by the guard after waits. Locks remain held through COMMIT.

Success is finalized in `artifacts.operation_receipts`, atomically with the
domain writes and quota. Denial rolls them back. Failure accounting uses
`artifacts.host_failures` with invocation-ID deduplication. A database outage
can also prevent the failure insert; the host retains `accountingFailure` and
emits `artifacts.accounting_unavailable` with the invocation ID for operator
reconciliation. The public failure stays classified and redacted.

Prepared objects have a 30-second deadline. A serialized one-second scheduler
runs bounded durable-intent cleanup, retaining referenced blobs. Cleanup errors
remain observable as `cleanup.failure` and
`artifacts.preparation_cleanup_unavailable`; cleanup resumes after restart.
Unknown COMMIT outcomes require the same caller key and a fresh authorized
lookup. A 503 status alone never determines retryability.

## Reproducible qualification

Use `make -f tools/make/artefacts-a5.mk` with `verify`, `test-api-ci`,
`test-provider`, `migration-proof`, or `test-runtime`, followed by
`API_PORT=18924 UI_PORT=15924 MAILDEV_UI_PORT=11924 ENV=test-artefacts-a5`.
`tools/h4-mcp.mk test-composition-e2e` delegates to the enabled provider suite
with this same environment. `test-runtime` builds the exact committed source
and tests all sixteen tools, SQL/S3 effects, replay, ordered conflict, process
restart, and fresh account/membership refusals inside that image. Only probe
modules and evidence are mounted; product code comes from the image.

Campaigns serialize through the machine lock, wait for `radar-test-*` occupancy
and Docker builds, stop below 8 GiB free and remove their own volumes/orphans.
Evidence records the source SHA, clean status, source archive hash, installed
tuple, image ID and redacted runtime configuration. A7 retains responsibility
for applied production bindings and deployment receipts.
