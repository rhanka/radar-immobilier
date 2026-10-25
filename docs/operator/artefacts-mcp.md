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
# A5 guarded artifact composition

The published MCP tuple is artifacts `0.2.0`, cluster-mesh `0.22.0`,
mcp-auth `0.2.1` and resolved mcp-platform `0.4.0`. The complete Radar
profile is compiled by the published provider before registry admission.
Its immutable manifest binds all four selected schemas, caller keys,
semantic rules and `immo:read`; the registry also binds the storage scope.
The artifact wire envelope is 2 MiB, including JSON-RPC framing.

`bindArtifactProvider` accepts the trusted shared application and a
request-bound finalization authority factory. The stateful namespace then
lists exactly twelve Immo tools plus the four artifact tools. Each call
uses a fresh frozen invocation. Lower adapter dispatch stays closed;
unselected operations fail before authority creation. Invalid bindings
close the namespace before effects. Stdio remains fixture-only.

**Activation remains unavailable in this delivery.** The production HTTP
entrypoint has no artifact binding and exposes the preserved twelve tools.
No environment value substitutes for that binding. The sixteen-tool tests
use a contract double and qualify composition, not durable finalization.
API/artifacts-host retain their existing artifacts `0.1.2` dependency
until the coherent A1 migration is available.

Before activation, the A1 integrator must deliver and qualify:

- `composition.ts` and `facade.ts` using the guarded `0.2.0` application,
  `handle(request, invocation)` and typed outcomes before projection.
- A transaction-bound admission/quota participant, persistent failure
  accounting and `artifacts.operation_receipts`, with registered technical
  migrations under a conductor-recorded CT-1/CT-2 lease.
- Identical HTTP/MCP scope and policy revision; replay authorization,
  ordered-content conflicts, last-reservation races, restart and cleanup.
- Enabled Q1/Q2/provider acceptance after PR #918, real-service H4 E2E,
  then exact SHA/image/configuration and A7 applied-binding receipts.

The isolated A5 entrypoint is `tools/make/artefacts-a5.mk`, with
`API_PORT=18924 UI_PORT=15924 MAILDEV_UI_PORT=11924 ENV=test-artefacts-a5`
as the final arguments. Its `run` target installs and executes `CMD` only
inside the source archive container. `A5_SERVICES=1` requests synthetic
PostgreSQL/S3; `A5_IMAGE=1 A5_SERVICES=1` exercises the actual runtime.
Campaigns wait in 60-second intervals for every `radar-test-*` container,
hold the machine lock, stop below 8 GiB and remove their own resources.
