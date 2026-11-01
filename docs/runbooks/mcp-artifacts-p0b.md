# IMMO artifacts P0b preparation

The central dependency pin is `dependencies["@sentropic/artifacts"]` in the root `package.json`.
Workspace dependencies resolve through the root override. With 0.2.2 the existing four tools stay active;
with the qualified 0.3.0 package the host and MCP select exactly seven tools. No environment flag switches profiles.

| Added tool | Required scope | MCP annotations |
| --- | --- | --- |
| `artifacts_get_source` | `immo:artifacts:read` | `readOnlyHint: true` |
| `artifacts_set_access` | `immo:artifacts:write` | `readOnlyHint: false`, `destructiveHint: false` |
| `artifacts_delete` | `immo:artifacts:write` | `readOnlyHint: false`, `destructiveHint: true` |

The `immo:read` transition covers only get/list, never source or mutations.
Restore, fork, promote, renew and all part1 tools remain disabled.
The model sees `immo-artifacts.p0b.v1`, `requireExpectedCurrentReleaseId:false`,
`resultEnvelopeVersion:1` in discovery and the authoring guide. Results retain their business fields at the root.

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
   Upstream 0.3.0 needs a snapshot internally: IMMO resolves it on the server and retains it with the challenge.
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
make -f tools/mcp-p0b.mk registry ENV=test-mcp-p0b
make -f tools/mcp-p0b.mk verify ENV=test-mcp-p0b
make -f tools/mcp-p0b.mk candidate SOURCE=/absolute/sentropic/p0b/packages/artifacts ENV=test-mcp-p0b
make -f tools/mcp-p0b.mk down ENV=test-mcp-p0b
```

`candidate` mounts the upstream package read-only, copies only package inputs, compiles and packs that copy,
then extracts the tarball into disposable container dependencies. It leaves both repositories' dependency pins and
lockfiles unchanged and runs the real PostgreSQL lifecycle tests in the isolated `p0b` database.
External S3 is replaced by the existing in-memory publication port; SDK stall tests remain in the suite.

When npm publication is available:

1. Verify `registry` reports `0.3.0` and that the published API matches the qualified upstream candidate.
2. Change **one source line**: root `@sentropic/artifacts` from `0.2.2` to `0.3.0`.
3. Regenerate the lockfile with `make -f tools/mcp-p0b.mk lock ENV=test-mcp-p0b`.
4. Run `verify` and `integration` with the published package. Commit only the pin plus generated lockfile.
   No source, guide, scope, annotation, profile JSON or operation-selection edit should be necessary.

Deployment is a separate operator action and was not performed by this branch. Before starting a 0.3.0 host,
apply `0028_artifacts_p0b` through the normal migration journal. It includes the upstream terminal guards and the
shared confirmation table, without fabricating historical modification timestamps. Check that the restricted MCP
database role has SELECT/INSERT/UPDATE on `artifacts.delete_confirmations`, SELECT on `account_users` and the existing
artifact coordinator tables/permissions. API and MCP must use the same database and storage scope; the MCP
`IMMO_MCP_OAUTH_RESOURCE` origin must match the API application origin used for management links.
Refresh/reconnect the Claude tool catalogue, then qualify a pre-existing conversation, named sharing and human deletion.
Do not enable mandatory CAS or a new result envelope; those are separately qualified part1 switchovers.
