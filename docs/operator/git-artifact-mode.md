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
(`artifact_git_mode_provider_unqualified`). The pinned provider is 0.2.20,
which routes every git tool (`GIT_TOOL_PROVIDER_ROUTING`, `flag.ts`); on any
other version (0.2.18 included) every stage refuses. Do not set the flag on an
environment that still runs an image pinned to 0.2.18, and apply migration
`0040_artifacts_git_attach_intents` first (`db-migrate` Job of the train).

Blast radius: the flag is read when `@radar/artifacts-host` is imported, so a
refusal stops the whole radar-api or radar-immo-mcp process, not only the git
mode. With the flag off (unset, empty or `off`) no other `IMMO_ARTIFACTS_*`
value of this page is read: a malformed one cannot stop the process. With the flag on, a malformed value (half-set committer, invalid
cursor key, non-JSON humans list) refuses the start of the whole process.

## Configuration

All optional and read only when the flag is on. A missing value never
crashes the host: the matching port refuses at call time with a typed error.

Every variable below is immo-owned and read by radar-api and radar-immo-mcp
(same values on both). Preprod values are given where they are fixed.

| Variable | Kind | Format | Effect when absent |
|---|---|---|---|
| `IMMO_ARTIFACTS_GIT_MODE` | config | `off` \| `bindings` \| `build` \| `live` | off |
| `IMMO_ARTIFACTS_SERVICE_OAUTH_TOKEN_ENDPOINT` | config | https URL; preprod `https://preprod.auth.sent-tech.ca/api/v1/auth/oauth/token` | broker and builder calls refuse |
| `IMMO_ARTIFACTS_SERVICE_OAUTH_CLIENT_ID` | config | OAuth client id registered by Sentropic in the IdP | broker and builder calls refuse |
| `IMMO_ARTIFACTS_SERVICE_OAUTH_CLIENT_SECRET` | **secret** | client secret (client_credentials, HTTP Basic); scopes `github-app:broker` and `artifacts:builder` | broker and builder calls refuse |
| `IMMO_ARTIFACTS_SERVICE_OAUTH_RESOURCE` | config, optional | RFC 8707 resource URI (Sentropic `OAUTH_SERVICE_RESOURCE_URI`) | omitted from the token request |
| `IMMO_ARTIFACTS_GIT_BROKER_ORIGIN` | config | https origin; preprod `https://preprod.sentropic.sent-tech.ca` (path `/api/v1/github-app/broker/lease` is fixed) | leases refuse: `provider_unavailable` |
| `IMMO_ARTIFACTS_GIT_INSTALLATION_REF` | config | `enroll_<uuid>` from the owner enrollment (status `ready`) | registry empty: `git_repo_not_registered` |
| `IMMO_ARTIFACTS_GIT_CURSOR_KEY` | **secret** | base64, at least 32 bytes (source cursor MAC) | GitPort refuses: `provider_unavailable` |
| `IMMO_ARTIFACTS_GIT_COMMITTER_NAME` | config | committer display name | GitPort refuses |
| `IMMO_ARTIFACTS_GIT_COMMITTER_EMAIL` | config | GitHub noreply address `<id>+<login>@users.noreply.github.com` | GitPort refuses |
| `IMMO_ARTIFACTS_GIT_CODE_READERS` | config | comma-separated OIDC subs holding code rights | nobody holds code rights |
| `IMMO_ARTIFACTS_GIT_HUMANS` | config | JSON `[{"principalId","name","email"}]`, one entry per editing user, noreply emails | no human linkage: writes `access_denied` |
| `IMMO_ARTIFACTS_BUILDER_URL` | config | https base; preprod `https://preprod.sentropic.sent-tech.ca/api/v1/artifacts/builder` | `git_publish` sandbox not admitted: `builder_unavailable` |
| `IMMO_ARTIFACTS_BUILDER_HANDOFF_PUBLIC_KEYS` | config (public) | `kid=base64(SPKI DER)` Ed25519, comma-separated during a rotation; provided by Sentropic | `/live-host/v1/*` refuse |
| `IMMO_ARTIFACTS_RECEIPT_SIGNING_KEY` | **secret** | base64 PKCS#8 DER, Ed25519 private key (public key + kid handed to Sentropic) | handoff answers 503 |
| `IMMO_ARTIFACTS_RECEIPT_KEY_ID` | config | kid of the receipt key, e.g. `immo-preprod-receipt-1` | handoff answers 503 |
| `IMMO_ARTIFACTS_BUILDER_IMAGE_ALLOWLIST` | config | exact builder image digests admitted, comma-separated (`<image>@sha256:<64 hex>`, given by Sentropic per builder release) | empty: every handoff refused `handoff_mismatch` / `image_not_allowed` (fail-closed) |
| `IMMO_ARTIFACTS_SANDBOX_PUBLICATION_PAUSED` | config | `true` pauses every sandbox publication (operator kill switch); any other value or unset: not paused | not paused |
| `IMMO_ARTIFACTS_LIVE_HOST_KEYS` | **secret** | HMAC keyring `kid=base64url[,kid=base64url]`, each at least 32 bytes; same value in Sentropic `APP_ARTIFACT_LIVE_HOST_KEYS` | no live signer: pushes refuse |
| `IMMO_ARTIFACTS_LIVE_HOST_KID` | config | signing kid; preprod `immo-preprod-live-1` | no live signer |
| `IMMO_ARTIFACTS_LIVE_HOST` | config | pages domain; preprod `pages.preprod.immo.sent-tech.ca` | pushes refuse |
| `IMMO_ARTIFACTS_LIVE_EDGE_ENABLED` | config | `1` enables the W9 live edge on top of stage `live` (anything else: off) | off: no forward, no controller worker, no upgrade listener |
| `IMMO_ARTIFACTS_LIVE_EDGE_URL` | config | internal artifact-content origin (http, no path); preprod `http://artifact-content.sentropic-preprod.svc.cluster.local:8791` | forward unavailable (release kept), pushes refuse |
| `IMMO_ARTIFACTS_LIVE_QUALIFIED` | config | `true` qualifies the live worker (any other value: false) | `live_write` / `live_control(start)` answer `builder_unavailable` |
| `IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED` | config | `true` sets `invitations.qualified` of the generic package host port (0.2.22; any other value: false) | every invitation tool answers `builder_unavailable`; live stays owner-only |
| `IMMO_ARTIFACTS_LIVE_CONTROL_URL` | config, superseded | https URL ending `/_live-control/v1`; validated only, never used (the control push goes to `IMMO_ARTIFACTS_LIVE_EDGE_URL`) | none |
| `IMMO_ARTIFACTS_LIVE_DRAFT_KEYS` | **secret** | sealed keyring `version=base64url(32 raw bytes)[,...]` | draft keys refuse: `provider_unavailable` |
| `IMMO_ARTIFACTS_LIVE_DRAFT_KEY_CURRENT` | config | the version used for new drafts (must be listed) | start refuses when the keyring is set |

Inbound host base given to Sentropic: `https://preprod.immo.sent-tech.ca/api/v1/artifacts`
(radar-api public origin; `POST .../live-host/v1/job` and `.../live-host/v1/handoff`,
mounted only from the `build` stage on).

Secrets follow the documented rotation cycle: minted by the owner of the
service they authenticate to (Sentropic for the broker and builder tokens,
immo for the cursor key), stored in the deployment secret, recorded by name
only, rotated by minting a new value, rolling the workload and revoking the
old one. A cursor key rotation invalidates open source cursors only.

The builder image allowlist rotates with the builder: Sentropic announces the
new digest, immo adds it next to the current one (both admitted during the
overlap), rolls radar-api, then removes the old digest once no job of the old
image is pending. Setting `IMMO_ARTIFACTS_SANDBOX_PUBLICATION_PAUSED=true` and
rolling radar-api stops every handoff (`publication_paused`) without touching
the bindings; builds already started are refused at handoff, not lost.

## Known limitation: object-store orphans of a refused handoff

The handoff publication writes the candidate blobs to S3 and re-reads them
INSIDE the Postgres transaction (`host-ledger.ts` `publish`), so the advisory
lock and the `FOR UPDATE` rows of the binding and the job are held for the S3
round trips (up to 64 MiB). S3 is not transactional: when the transaction rolls
back (release conflict, failed recheck, stored-bytes mismatch), the blobs
already written stay in the bucket as digest-addressed objects with no release
reference. They are never served and are reclaimed by the same orphan sweep as
the provider's own publications. Accepted for the preprod qualification; the
lock time grows with S3 latency.

The handoff route authenticates the builder signature and evidence before it
decodes any candidate file (probe on the provider `acceptHandoff`, which reads
the ledger only after authentication); the JSON body itself stays capped at
96 MiB (`HOST_HANDOFF_BODY_MAX_BYTES`).

## Authorization (Δ4)

- Each user edits their own personal binding: current code rights, the host
  write scope (`immo:artifacts:write`) and a GitHub human linkage.
- Live is OWNER-ONLY unless the generic invitations of @sentropic/artifacts
  0.2.22 are qualified (`IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED=true`). Tools
  `artifacts_live_invite` (scope `immo:artifacts:write`),
  `artifacts_live_accept_invitation`, `artifacts_live_revoke_invitation` and
  `artifacts_live_invitations` (scope `immo:artifacts:read`): the scopes come
  from the package `LIVE_INVITATION_TOOL_CLASSES`, never from tool mutability.
  People resolve through the existing directory (`resolvePrincipal` /
  `describePrincipal`, fail closed). The immo invitation store of #1030 was
  removed and its empty table `artifacts.live_invitations` (0038) is dropped by
  `0041_drop_artifacts_live_invitations` (refused if any row exists); package
  migration `0013_live_invitations` is carried as
  `api/drizzle/0042_artifacts_live_invitations.sql` AFTER 0041 (lock-timeout
  prefix, pinned by `artifacts-provenance.spec.ts`), and its column guard refuses
  any foreign table of the same name.
- Anyone else is refused; a third party never writes to another user's binding.
- `git_attach` executor: default `sandbox`; `caller` and `ci` are refused.

## GB1 build qualification

`artifact-build/gb1-qualification.json` (Sentropic decision 2026-11-07) has
exactly the keys `{ "v": 1, "lockSha256", "postinstallAllowlist": [],
"scriptQualification": [ { "package", "version", "integrity" } ] }`:
`lockSha256` is the sha256 hex of the `package-lock.json` bytes of the same
commit, and the rows are the lockfile install-script entries (19 today, the 15
`allowScripts` packages) with their literal SRI, sorted by package then
version, at most 64 KiB. Regenerate after any lockfile change:

    make -f tools/make/git-artifact.mk gb1-rows ENV=test-<slug>

`gb1-qualification.test.ts` fails when the file and the lock diverge. The path
is an A1 refused write path: a branch can never change it.

## Provider pieces (0.2.20)

- `createGitToolService` and `deps.gitTools`: statically imported from
  `@sentropic/artifacts` (`provider-adapter.ts`).
- SG4b handoff acceptance and receipt signing, live assertion and control
  signing, candidate digest, host build API: statically imported from
  `@sentropic/artifacts/live-host` (`live-host-adapter.ts`); immo implements
  none of this crypto.
- Package migration `0012_git_attach_intents` is carried as
  `api/drizzle/0040_artifacts_git_attach_intents.sql` (lock-timeout prefix and
  idempotence rewrite, pinned by `artifacts-provenance.spec.ts`).

- Host job and publication ledger (`HostBuildJobStore`, `HostBuildLedger`):
  no live reconcile before a build (`@sentropic/artifacts` 0.2.27): the builder
  admits a never-reconciled binding from the admitted host job, whose
  `ownerId` the host ledger view supplies (personal owner, `attachedBy`
  fallback). A pre-build reconcile used to wake a REVIVING live session, which
  then refused the build with `pending_publication`. While a live session is
  LIVE or REVIVING the builder answers `409 live_session_active`: the host
  closes the job it persisted (`build_failed`, code `live_session_active`,
  reason `active_session`; a retry of the same command re-arms it), logs
  `artifacts.build_refused`, and answers `git_live_conflict` (reason
  `active_session`, 409, not retriable) with a message to stop the live
  session (`artifacts_live_control`, action `stop`) before publishing. Then
  job persistence before `POST /v1/builds` (body exactly `{artifactId, jobId, binding}`, `binding = {repoId, branch, subPath}` read from the package git binding of that artifact and job generation, `git_not_attached` before any call when absent), attempt fence, receipt ledger and
  the publish step in one transaction; composed by radar-api from the `build`
  stage on. Without the receipt key or the builder keys, `git_publish` and the
  inbound `/live-host/v1/*` routes answer `provider_unavailable` / 503.
- Live edge revocation: sockets held by the immo content host are closed first
  (and cached grants dropped), then `POST /_live-control/v1` is pushed with
  node:http to the INTERNAL artifact-content Service (`IMMO_ARTIFACTS_LIVE_EDGE_URL`)
  with `Host: <artifactId>.<pages domain>` and the same per-artifact host in the
  `x-live-host-control` claim (the 10 provider control fields: `op`,
  `sessionId`, `invitationId`, `epoch`, no generation or route epoch), with 3
  attempts; every response body is drained, a non-2xx answer is retried and the
  final failure is surfaced (`provider_unavailable`, last status).

## Live qualification flags (rule)

`IMMO_ARTIFACTS_LIVE_QUALIFIED` and `IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED`
are two independent flags, both `false` by default. Each is turned on by an
ops change (manifest PR) ONLY after an owner-recorded « GB4 GO preprod », never
automatically, never by code, never by a test. The invitations flag is
the `invitations.qualified` field of the generic package host port (0.2.22);
false: every invitation tool answers `builder_unavailable` (owner-only).

## Live edge (W9, `IMMO_ARTIFACTS_LIVE_EDGE_ENABLED=1` on top of stage `live`)

Contract: `tmp/conductor/concertation-git-artifact/sentropic-live-edge-contract-2026-11-07.md`
(its CORRECTIF supersedes the claim sources). Off by default; with the flag
off nothing below is composed and the tool catalogue and profile digests are
unchanged.

- Controller clients on the builder mount (`IMMO_ARTIFACTS_BUILDER_URL`, S2S
  token scope `artifacts:builder`): `POST v1/live/grant` (route grant, cached
  at most 30 s per artifact, principal and invitation; dropped on a 409, an
  edge 404 on a live path or a revocation), `POST v1/live/reconcile` (BridgeAck; body carries `binding: {repoId, branch, subPath}` of the package git binding of that generation, `git_not_attached` before any call when absent)
  and `POST v1/live/stop` (204) as the package LiveService `worker`.
- Content host (radar-api, `*.<pages domain>`): the principal is the release
  reader verified by the same code path as the release (sealed host, issuer,
  audience, tier, session revocation). Gate: (a) the
  `baskets.read` reader consent not revoked, (b) current code rights, (c)+(d)
  the binding owner, also the runtime owner of the live record, OR, only when
  the invitations are qualified, an invitee with an ACTIVE accepted invitation
  reported by the package `liveViewer(identity, principalId)` (owner-only,
  `liveViewer` never consulted, when not qualified). LIVE is served only when the package live record is ready for the
  current revision AND the grant answers 200 with `grant.sourceRevision` =
  that revision; otherwise the release. `grant.sessionId` is the CONTROLLER
  session (new on every revive and crash restore): carried as is in the
  assertion and the HMR path, never compared with the package session. Grant
  freshness: 200 only, current revision, 30 s cache, invalidated on a 409 or
  an edge 404. Grant and reconcile bodies carry `invitation: {epoch, expiresAt}`
  from the package `liveInvitationState(identity)` (`{epoch: 0, expiresAt: null}`
  when not qualified). An invitee websocket assertion expires at the invitation expiry.
- Socket closure and control push (`revocation.invitation({artifactId,
  invitationId, epoch})`, `revocation.session(artifactId, liveSessionId)`):
  proxied sockets closed first, cached grants dropped, then `revoke_invitation`
  (with the given NEW epoch) or `revoke_session` (for each controller session
  seen on the sockets of the package session) pushed to the internal Service.
  Called by the generic host port `invitations.onRevoked(e)` (live-invitations.ts): sockets of the invitation closed first, then `revoke_invitation` carrying `e.epoch`, retried (5 x the pusher 3 attempts) until 204, else the failure is thrown and a replayed revoke re-invokes it. immo-mcp has its own socket registry (empty): the radar-api sockets of a revoked invitee close on the next recheck.
  Sockets are tracked per radar-api replica: on another replica a revoked
  principal is closed by its shared recheck (2 s) and by the edge itself.
- Forward: node:http to `IMMO_ARTIFACTS_LIVE_EDGE_URL`, GET/HEAD only, path and
  query unchanged, Host = the browser host without port, Origin passed as is,
  cookies, Authorization, service-worker and forwarding headers stripped,
  `x-live-host-assertion` = the grant unchanged plus v, kid, host, iat, exp
  (exp = iat + 60 s); host subtrees (every `__` first segment: reader, app, tile
  relay, design kit; and `/api`) are never forwarded, and the `grant` query
  parameter (immo reader grant) is never relayed. HMR websocket `GET /_live/<sessionId>/hmr[?token=]`
  (only `token`, Origin required, `Sec-WebSocket-Protocol: vite-hmr`): exp =
  iat + 3600 s capped at the invitation expiry; at most 4 sockets per
  principal and 32 per session; sockets are tracked per session/invitation,
  closed on revocation, at exp, and when the shared 2 s recheck (one
  admission per artifact and principal) no longer admits the principal.
  Response headers by allowlist; socket errors handled from the first line of
  the upgrade handler.
- Any non-2xx (non-101) edge answer, timeout or connection failure: « live
  indisponible » (503, `x-live-state`).
- Network: Sentropic policy `allow-immo-content-host-to-artifact-content`
  admits pods labelled `app.kubernetes.io/name: radar-immobilier` and
  `app.kubernetes.io/component: api`.

## Live re-drive and worker logs (0.2.27)

With the edge worker composed AND `IMMO_ARTIFACTS_LIVE_REDRIVE_ENABLED=true`
(literal `true` only), the host runs the package re-drive
(`LiveSessionService.redrive`) once at boot and every 15 s
(`packages/artifacts-host/src/live-redrive.ts`). Each pass settles again every
runtime of the scope that still waits for the builder (REVIVING, LIVE behind
its draft, a stop not DORMANT yet): at most 4 items in flight, 35 s each, so a
start waits under 60 s for its next settle, also after a pod restart.

The package overlap guards are process-local, so the flag is set in exactly
one workload per storage scope. Preprod: `radar-immo-mcp` only
(`deploy/overlays/preprod/patch-immo-mcp-config.yaml`), never `radar-api`
(1 to 2 replicas). `radar-immo-mcp` carries the MCP live flow and runs one
replica with a `Recreate` strategy, so a rollout never runs two loops.

SIGTERM stops the timer and drains the pass in flight (25 s at most); the
unsettled intents stay durable for the next pod. Node runs as PID 1 in the
pod, where SIGTERM has no default action: after the drain the process exits
with code 0 when no other SIGTERM listener is installed. The workload needs
`terminationGracePeriodSeconds` of at least 30 s (`radar-immo-mcp`:
Kubernetes default, 30 s).

Structured log lines (stderr, one JSON object per line):

| `kind` | Meaning |
| --- | --- |
| `artifacts.live_worker_failed` | A settle refused, timed out or ended by a builder failure: `operation`, identity, typed `code`, builder `reason` |
| `artifacts.live_worker_pending` | The builder is still reviving (`ready: false`) |
| `artifacts.live_redrive` | A non-empty pass: `items`, `settled`, `pending`, `failed`, `skipped` |
| `artifacts.live_redrive_unavailable` | A pass that could not list or settle (store failure) |
| `artifacts.live_redrive_draining` | SIGTERM received, the pass in flight is drained |
| `artifacts.live_redrive_exit` | Drain over, no other SIGTERM listener: the process exits 0 |
| `artifacts.build_refused` | The builder refused a build with `409 live_session_active`; the job is closed |

## Not yet composed (fail-closed)

- Live edge: composed only with `IMMO_ARTIFACTS_LIVE_EDGE_ENABLED=1`; nothing
  answers on the Sentropic side before the M4-R wagon (grant, reconcile,
  stop, draft staging), GB4-P and `APP_ARTIFACT_LIVE_ENABLED`.
- Live draft keys (KMS or sealed secret): `FAIL_CLOSED_LIVE_KEYS` unless the
  sealed keyring is set; worker and invitations qualification: `false` until
  the owner-recorded « GB4 GO preprod » (see the rule above).
- Draft staging pushed by the host: format pending (Sentropic M4-R).
- Live invitations: generic in @sentropic/artifacts 0.2.22, composed (off until qualified).
