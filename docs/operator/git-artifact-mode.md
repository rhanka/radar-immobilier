# Git-backed artifact mode (immo host)

Feature flag and configuration of the git-backed artifact mode (A-LIVE v2,
enablement plan r3.1, design D0: immo composes `@sentropic/artifacts` locally;
Sentropic provides the SG0-app lease broker, the builder service and the live
edge). Code: `packages/artifacts-host/src/git-mode/`.

## Flag

`IMMO_ARTIFACTS_GIT_MODE` — read by every process that composes the artifacts
host (radar-api and radar-immo-mcp). Both must carry the same value: the
compiled profile digest depends on it.

| Value | Tools selected (when routed by the pinned provider) |
|---|---|
| unset, empty, `off` (default) | none: catalogue, definitions, profile and guide unchanged |
| `bindings` (M2-I) | `artifacts_git_attach`, `artifacts_fetch_app_source` |
| `build` (M3-I) | the above + `artifacts_git_publish` |
| `live` (M4-I) | the above + `artifacts_git_commit`, `artifacts_live_{write,read,reset,status,control}` |

`artifacts_list_app_sources` is never selected: no provider routes it.

Boot refusals (fail-closed): any other value (`artifact_git_mode_invalid`);
a stage whose anchor tool the pinned provider does not route
(`artifact_git_mode_provider_unqualified`). On 0.2.18 every stage refuses;
the 0.2.20 pin adds `0.2.20` to `GIT_TOOL_PROVIDER_ROUTING` (`flag.ts`).
Do not set the flag before that pin is deployed.

Blast radius: the flag is read when `@radar/artifacts-host` is imported, so a
refusal stops the whole radar-api or radar-immo-mcp process, not only the git
mode. With the flag off (unset, empty or `off`) no `IMMO_ARTIFACTS_GIT_*` /
`IMMO_ARTIFACTS_BUILDER_*` value is read: a malformed one cannot stop the
process. With the flag on, a malformed value (half-set committer, invalid
cursor key, non-JSON humans list) refuses the start of the whole process.

## Configuration

All optional and read only when the flag is on. A missing value never
crashes the host: the matching port refuses at call time with a typed error.

| Variable | Kind | Effect when absent |
|---|---|---|
| `IMMO_ARTIFACTS_GIT_INSTALLATION_REF` | config | registry empty: `git_repo_not_registered` |
| `IMMO_ARTIFACTS_GIT_BROKER_ORIGIN` | config (https origin of the cluster-mesh router) | leases refuse: `provider_unavailable` |
| `IMMO_ARTIFACTS_GIT_BROKER_TOKEN` | secret (host service identity for `/github-app/broker/lease`) | leases refuse |
| `IMMO_ARTIFACTS_GIT_CURSOR_KEY` | secret (base64, 32 bytes, source cursor MAC) | GitPort refuses: `provider_unavailable` |
| `IMMO_ARTIFACTS_GIT_COMMITTER_NAME` / `_EMAIL` | config (GitHub noreply) | GitPort refuses |
| `IMMO_ARTIFACTS_GIT_CODE_READERS` | config (comma-separated OIDC subs) | nobody holds code rights |
| `IMMO_ARTIFACTS_GIT_HUMANS` | config (JSON `[{principalId,name,email}]`, noreply emails) | no human linkage: writes `access_denied` |
| `IMMO_ARTIFACTS_BUILDER_ORIGIN` / `IMMO_ARTIFACTS_BUILDER_TOKEN` | config / secret (host build API) | `git_publish` sandbox not admitted: `builder_unavailable` |

Secrets follow the documented rotation cycle: minted by the owner of the
service they authenticate to (Sentropic for the broker and builder tokens,
immo for the cursor key), stored in the deployment secret, recorded by name
only, rotated by minting a new value, rolling the workload and revoking the
old one. A cursor key rotation invalidates open source cursors only.

## Authorization (Δ4)

- Each user edits their own personal binding: current code rights, the host
  write scope (`immo:artifacts:write`) and a GitHub human linkage.
- Invited live readers: created, listed and revoked by the binding owner
  (`createLiveInvitationService`, table `artifacts.live_invitations`), bound to
  the binding, live session and generation, with an expiry (1 h default, 8 h
  max) and a revocation epoch; the invitee needs current code rights; read only.
- Anyone else is refused; a third party never writes to another user's binding.
- `git_attach` executor: default `sandbox`; `caller` and `ci` are refused.

## GB1 build qualification

Every sandbox build job request carries `buildQualification`:
`postinstallAllowlist: []` and one DISABLED row (package, version,
integrity) per lockfile install-script entry, generated from
`package-lock.json` by `make -f tools/make/git-artifact.mk gb1-rows`.
`gb1-qualification.test.ts` fails when the lock and the rows diverge:
regenerate after any lockfile change that touches an install-script entry.

## Not yet composed (fail-closed)

- `createGitToolService` and `deps.gitTools`: provider 0.2.20 (`provider-adapter.ts`).
- SG4b handoff verification, host receipt signing, live assertion and control
  signing, candidate digest: provider subpath `@sentropic/artifacts/live-host`
  (0.2.20, `live-host-adapter.ts`); immo implements none of this crypto.
- Live edge revocation: sockets held by the immo content host are closed first,
  then `POST /_live-control/v1` (`x-live-host-control`) is pushed with
  3 attempts; every response body is drained, a non-2xx answer is retried and
  the final failure is surfaced (`provider_unavailable`, last status). The
  control URL of the edge is not configured yet.
- SG4b commit port (release + git release index + receipt + baseline in one
  transaction, durable single-use authorization ledger): `FAIL_CLOSED_HANDOFF_COMMIT`.
- Live draft keys (KMS or sealed secret): `FAIL_CLOSED_LIVE_KEYS`; live worker
  (host build/live API client): absent; worker qualification: `false`.
- HTTP mounting of the handoff acceptance, of the invitation operations and of
  the content-host live gate forward to the live edge.
