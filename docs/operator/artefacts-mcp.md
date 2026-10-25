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
