# IMMO artifacts P0b preparation

The central dependency pin is `dependencies["@sentropic/artifacts"]` in the root `package.json`.
Workspace dependencies resolve through the root override. With 0.2.2 the existing four tools stay active;
with either qualified P0b version (0.2.5 or 0.3.0) the host and MCP select exactly seven tools.
`ARTIFACT_P0B_VERSIONS` is the shared version list. No environment flag switches profiles.

| Added tool | Required scope | MCP annotations |
| --- | --- | --- |
| `artifacts_get_source` | `immo:artifacts:read` | `readOnlyHint: true` |
| `artifacts_set_access` | `immo:artifacts:write` | `readOnlyHint: false`, `destructiveHint: false` |
| `artifacts_delete` | `immo:artifacts:write` | `readOnlyHint: false`, `destructiveHint: true` |

The `immo:read` transition covers only get/list, never source or mutations.
Restore, fork, promote, renew and all part1 tools remain disabled.
The model sees `immo-artifacts.p0b.v1`, `requireExpectedCurrentReleaseId:false`,
`resultEnvelopeVersion:1` in discovery and the authoring guide. Results retain their business fields at the root.
The cookie-authenticated `GET /api/v1/artifacts/control/profile` returns the same descriptor and selected tool names.

## Find the latest artifact

Both `artifacts_list` items and `artifacts_get` expose `bindingName`, `stableUrl`, `pinnedUrl`,
`currentReleaseId`, `createdAt`, `updatedAt`, `state` and `published`, with either 0.2.2 or P0b.
Use `bindingName` as the display label until part1 title/description metadata is available.
`createdAt` is artifact creation; `updatedAt` is the current release publication time, not an ACL change
or an unpromoted release's timestamp. An unpublished artifact has null `updatedAt`, `currentReleaseId`
and `pinnedUrl`, but still has its stable URL. `state` is the lifecycle state; `published` means a current release exists.
List ordering is `updatedAt DESC NULLS LAST, createdAt DESC, artifactId ASC`, applied before pagination;
the final ID ordering resolves exact ties. This order is also documented in the tool description and output schema.
MCP read results carry the same root fields in text and `structuredContent`; list/get retain `readOnlyHint:true`.
The authoring guide revisions are `2026-11-01-r4` (legacy) and `2026-11-01-p0b-r2` (P0b).

## Edit an existing page

1. Call `artifacts_get({artifactId})` for the full summary, permissions and current release.
2. Call `artifacts_get_source({artifactId})`, optionally with `releaseId` and a nonempty bounded `paths` list.
   The result contains the manifest, digest-checked file bytes, provenance and stable/pinned URLs.
3. Decode UTF-8 bytes locally, edit using the existing DS starter/reader instructions, then publish the **complete**
   snapshot with `artifacts_publish({artifactId,files,idempotencyKey})`. Use a new nonblank key for new content;
   preserve the original key and identical content on retries. Publish does not require a release precondition.
4. On `release_unavailable`, choose another retained release or recover the original author files.
   Read-sharing does not grant source or editing permission.

## Share by name

Only the owner can call `artifacts_set_access({artifactId,action:"grant",principalId,grant:"read",idempotencyKey})`.
`principalId` is the exact IdP `sub` recorded on an approved IMMO `account_users` row, not the account UUID or an email lookup.
IMMO checks that subject at entry and again through its transaction-bound policy participant. It never creates an account.
The page remains `isPublic:false`; the recipient receives read access only. Revoke with `action:"revoke"`, omit `grant`,
and supply a fresh key. Revocation works even if the recipient is no longer approved.
Sharing and deletion do not consume publication quotas; their attempts still use the existing actor rate bound.

## Delete permanently

1. The owner calls `artifacts_delete({artifactId,idempotencyKey})`. The public release field is optional.
   Upstream P0b needs a snapshot internally: IMMO resolves it on the server and retains it with the challenge.
   An explicitly supplied snapshot is still checked. Omission does not become caller-visible CAS.
2. `confirmation_required` preserves `details.confirmationRef`, `details.managementUrl`, `details.expiresAt` through MCP/HTTP.
   Open the management URL on the normal IMMO origin. A valid application cookie, approved account, current activation,
   same-origin POST and explicit human action are required. MCP bearer credentials cannot approve.
3. Retry the same command/key with the returned `confirmationRef`. The port validates actor, scope, artifact, release,
   command hash, internal key, expiry and approval, then consumes the proof on the coordinator's leased transaction.
   A later denial rolls that consumption back. Receipt replay never charges quota or consumes the proof again.
4. Expired/invalid/stale challenges require rereading the target and starting with a fresh key. TTL is ten minutes;
   an expired challenge is not silently renewed. A successful deletion is terminal; physical purge is pending.

The host challenge table has no artifact FK: challenge creation uses a separate pool transaction while the rejected
deletion holds the artifact lock. Such an FK would block challenge creation. The table stores opaque references and
command identity, not publication contents. It is a confirmation store, not a second idempotency journal.

## Qualification and publication handoff

All commands below run in this worktree. The standalone runner never includes the root Makefile, uses
`--env-file /dev/null`, publishes no ports and always tears down with `down -v --remove-orphans`.

```sh
make -f tools/mcp-p0b.mk registry P0B_VERSION=0.2.5 ENV=test-mcp-p0b
make -f tools/mcp-p0b.mk verify ENV=test-mcp-p0b
make -f tools/mcp-p0b.mk verify CANDIDATE=1 P0B_VERSION=0.2.5 SOURCE=/absolute/sentropic/p0b/packages/artifacts ENV=test-mcp-p0b
make -f tools/mcp-p0b.mk down ENV=test-mcp-p0b
```

`candidate` mounts the upstream package read-only, copies only package inputs, compiles and packs that copy,
stamping both package metadata and the provider version with `P0B_VERSION` (default `0.2.5`; fallback `0.3.0`).
It resolves the complete IMMO workspace graph against that tarball in a disposable manifest/lock copy, without
`--force` or `--legacy-peer-deps`, then extracts the tarball into disposable container dependencies.
It leaves both repositories' dependency pins and lockfiles unchanged and runs the real PostgreSQL lifecycle
tests in the isolated `p0b` database.
`verify CANDIDATE=1` invokes that candidate qualification; plain `verify` checks the central 0.2.2 pin.
Both run the shared real PostgreSQL metadata/order/pagination scenario; the five P0b-only scenarios are skipped on 0.2.2.
External S3 is replaced by the existing in-memory publication port; SDK stall tests remain in the suite.

IMMO pins `@sentropic/cluster-mesh@0.22.1`, not `0.26.0-dev.3`. Its declared artifacts peer range is
`>=0.2.0 <0.3.0`, which accepts `0.2.5`. The root artifacts override is retained in the disposable graph;
the candidate's npm resolution checks the actual IMMO configuration rather than inferring sentropic's result.
Both local candidate graphs (0.2.5 and 0.3.0) resolve without ERESOLVE with that existing override.

When npm publication is available:

1. Prefer `0.2.5`. Run `make -f tools/mcp-p0b.mk registry P0B_VERSION=0.2.5 ENV=test-mcp-p0b`
   and confirm the published API matches PR #878, commit `8b5b1f7793e433938de64f068dc2116e6f084ff6` or later.
   If upstream publishes the fallback instead, use `P0B_VERSION=0.3.0` for registry/candidate;
   the remaining commands are unchanged.
2. Change **one source line**: root `dependencies["@sentropic/artifacts"]` from `0.2.2` to the selected version,
   `0.2.5` or `0.3.0`.
3. Regenerate the lockfile with `make -f tools/mcp-p0b.mk lock ENV=test-mcp-p0b`.
4. Run `make -f tools/mcp-p0b.mk verify ENV=test-mcp-p0b`, then
   `make -f tools/mcp-p0b.mk integration ENV=test-mcp-p0b` with the published package.
5. Run `make -f tools/mcp-p0b.mk down ENV=test-mcp-p0b`, then commit only the pin plus generated lockfile.
   No source, guide, scope, annotation, profile JSON or operation-selection edit should be necessary.

Deployment is a separate operator action and was not performed by this branch. Before starting a P0b host,
apply `0028_artifacts_p0b` through the normal migration journal. It includes the upstream terminal guards and the
shared confirmation table, without fabricating historical modification timestamps. Check that the restricted MCP
database role has SELECT/INSERT/UPDATE on `artifacts.delete_confirmations`, SELECT on `account_users` and the existing
artifact coordinator tables/permissions. API and MCP must use the same database and storage scope; the MCP
`IMMO_MCP_OAUTH_RESOURCE` origin must match the API application origin used for management links.
Refresh/reconnect the Claude tool catalogue, then qualify a pre-existing conversation, named sharing and human deletion.
Do not enable mandatory CAS or a new result envelope; those are separately qualified part1 switchovers.
