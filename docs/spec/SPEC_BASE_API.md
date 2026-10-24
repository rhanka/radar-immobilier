# SPEC_BASE_API — Independent BASE API contract

Status: finalized contract, preserving the complete B0 contract and the
implemented B1–B4 composition received at `bf84974e78c6251cb9e1737a30a68c3e14af59e1`.
B5 qualifies that implementation without changing its functional scope.
Operational values and deployed state remain `unverified`.

Binding: B0_SHA (final audited B0 commit, named in the delivery report) is the frozen
contract baseline. B1 starts from B0_SHA. B2 starts from K_SHA, released by
the BASE integrator after the CT-7 migration qualification in B2.1. Packet
clauses CT-1 through CT-9 (§11) govern both tracks verbatim.

## 1. Existing route inventory (read from code)

All scoped routers below are mounted by `createApp` and enforce their
destination/epoch gates. Public lot operations remain closed until the
explicit protected 6K cutover opens their destination. Legacy routers stay
mounted behind the explicit 503/410 retirement fence (§7).

### 1.1 `api/src/routes/workspaces.ts` — `workspacesRoute`

- `GET /api/v1/workspaces` → `{ ok: true, workspaces: WorkspaceRef[] }`.
  Lists the caller account workspaces.
- `POST /api/v1/workspaces/:workspaceId/memberships` → `{ ok: true, membership: MembershipRecord }`.
  Request fields (strict): `accountId` (uuid), `status` (`active` | `revoked`,
  optional), `moderateArchive` (boolean, optional), `manageMembers` (boolean,
  optional), `expectedRevision` (int >= 1 | null | undefined). A `revoked`
  status rejects capability fields. Errors: `invalid_workspace_command` (400),
  `workspace_revision_conflict` + `current` (409), other `WorkspaceError`
  codes (400/401/403/404/409).
- Workspace id path param must be a uuid, else `invalid_scoped_identity`
  (400) on scoped routers and `invalid_workspace_command` (400) here.

### 1.2 `api/src/routes/scoped-signal-facets.ts` — `scopedSignalFacetsRoute`

Personal commands, one explicit workspace in the path:

- `POST /api/v1/workspaces/:workspaceId/signal-facets/personal/{select,deselect,discard,restore}`
  → `{ ok: true, event: FacetEventResponse | null }`.
- Request fields (strict). `target`: `{ citySlug, type: Signal|DesignationEvent, id }`.
  `basket`: `pertinent` | `a_surveiller`. `reasonCode`: optional code
  `[A-Z0-9]+(-[A-Z0-9]+)*` (max 128). Signal wire carries `expectedHeadId`
  (uuid | null) and `displayedFingerprint` (64 lowercase hex). `discard` also
  carries optional `deselect` (max 2 baskets) plus `expectedSelectionHeads`.
- Pre-6B payloads without fingerprint and with only `expectedHeadId` are
  accepted as head-shape and recovered (never a new command); older payloads
  without either are recovered as historical only.
- `Idempotency-Key` header: required uuid (lowercased server-side).
- `GET /api/v1/workspaces/:workspaceId/signal-facets/personal/cities/:city`
  → `{ ok: true, heads }` via `readScopedPersonalHeads`.
- Error mapping: `FacetHeadConflictError` → 409 + `current`;
  `FacetTargetVersionConflictError` → 409 + `current`;
  `WorkspaceRevisionConflictError` → 409 + `current`;
  `FacetError`/`WorkspaceError`/`ScopeError` → their status codes.

### 1.3 `api/src/routes/scoped-workspace-archive.ts` — `scopedWorkspaceArchiveRoute`

Moderator-only common archive, same path family as personal facets:

- `POST /api/v1/workspaces/:workspaceId/signal-facets/workspace/{discard,restore}`
  → `{ ok: true, event }`. `discard` requires `reasonCode` (optional in the
  route schema; the writer requires it with `reason_code_required`, 422), `expectedHeadId`,
  `displayedFingerprint`. `restore` requires `expectedHeadId`,
  `displayedFingerprint`.
- `GET /api/v1/workspaces/:workspaceId/signal-facets/archive/cities/:city`
  → `{ ok: true, heads: [{ target, personal, workspace, effectiveDiscarded, capabilities }] }`.

### 1.4 `api/src/routes/scoped-projection-revisions.ts`

- `GET /api/v1/workspaces/:workspaceId/signal-facets/projection-revisions?citySlug&mode=signal`
  → `{ ok, workspaceId, citySlug, mode, token, revisions: { personal, workspace, source, sourceDigest }, membership: { revision, moderateArchive, manageMembers } }`.
- `GET /api/v1/workspaces/:workspaceId/signal-facets/coherent-city?citySlug&mode=signal`
  → `{ ok, workspaceId, citySlug, mode, token, revisions, heads, selection, signals, counts: { total, hidden, visible, selected } }`.
  Archived targets (effectiveDiscarded) are hidden from `signals`; each
  served node carries `facetFingerprint` computed exactly like the command
  `displayedFingerprint` so the snapshot supports a follow-up command.

### 1.5 `api/src/routes/scoped-projection-events.ts` — session-only SSE

- `GET /api/v1/workspaces/:workspaceId/signal-facets/projection-events?citySlug&mode=signal&cursor?`
  opens a `text/event-stream`. Initial connection, restart and incompatible
  cursor always open with a `resync` frame. Frames carry the latest 6L1
  scope token; invalidations coalesce; an idle stream that stops draining is
  dropped after a bounded number of saturated cycles. Denials (401/403/404)
  close the stream; other failures stay open with a retry frame.
- Browser session only (see §6); Bearer [REDACTED] rejected even for reads.

### 1.6 `api/src/routes/scoped-lot-facets*.ts`, `scoped-lot-reads.ts`, `scoped-lot-commands.ts`

- Reads (no mutation):
  - `GET /api/v1/workspaces/:workspaceId/lot-facets?citySlug&canonicalId&mode=real|simulation`
    → `{ ok: true, ...state }`.
  - `GET .../lot-facets/heads?citySlug&mode` → `{ ok: true, ...projection }`.
  - `GET .../lot-facets/history?citySlug&canonicalId&mode&offset&limit` (limit max 100).
  - `GET .../lot-facets/source-history?chainId&offset&limit`.
- Commands (single and atomic batch, per scope `workspace` | `personal`):
  - `POST .../lot-facets/{workspace,personal}/commands` with
    `{ target, displayed_version, expected_head_id, mutation, mode }`.
  - `POST .../lot-facets/{workspace,personal}/commands/batch` with
    `{ mode, items: [1..500] }` (same item shape, no per-item mode).
- `target`: `{ type: "Lot", authority: "lot_versions", citySlug, canonicalId }`.
  `displayed_version`: `{ lot_version_id: uuid, fingerprint: 64 hex }`.
  `mutation` (discriminated union): `select` | `deselect` (basket_id),
  `discard` (optional reasonCode + deselect entries max 8),
  `restore`, `set_pipeline` (`sollicite` | `lettre_envoyee`),
  `clear_pipeline`, `set_market` (`en_vente` + nullable asking_price /
  listing_url), `clear_market`.
- Error mapping mirrors signals: head/version conflicts → 409 + `current`;
  revision conflicts → 409 + `current`; scope/workspace/facet errors → status.

### 1.7 Legacy mounted routers (unchanged in B0)

- `signal-facets.ts`: `POST /api/v1/signal-facets/{select,deselect,discard,restore}`,
  `GET /api/v1/signal-facets/reason-codes` → `{ ok, profileId, codes }`,
  `GET /api/v1/signal-facets/cities/:city`. Same basket/reason/fingerprint
  conventions as §1.2, unscoped (session account only).
- `graph-signals.ts`: `GET /api/graph-signals/by-city` (aggregate counts,
  optional inclusive `dateFrom`/`dateTo`), `GET /api/graph-signals/:city`
  (nodes; 404 when the city has no signal nodes; `showDiscarded=1` reveals
  the full population). Port failure or missing session under auth → 503
  `discarded_signals_unavailable`.

## 2. Preserved wire conventions

- Signals: `expectedHeadId` (uuid | null, null = no head expected) and
  `displayedFingerprint` (sha256 hex of the displayed target version).
  A mismatch on the target version → `FacetTargetVersionConflictError`
  (409 + `current`); a mismatch on the stream head → `FacetHeadConflictError`
  (409 + `current`).
- Lots: `expected_head_id` and `displayed_version.{lot_version_id, fingerprint}`
  with identical conflict semantics (`LotHeadConflictError`,
  `LotVersionConflictError`, 409 + `current`).
- No silent coercion: unknown fields rejected (strict schemas); malformed
  commands → `invalid_facet_command` (400); missing/invalid idempotency key
  → `invalid_facet_command` (400).

## 3. Authority matrix (existing behavior, frozen)

- Account approval precedes every scoped write (`approvedAccountId`); the
  server derives actor and personal owner — client-supplied actor/owner/
  tenant/scope fields are rejected.
- Personal scope: selection baskets (`pertinent`, `a_surveiller`), personal
  discard/restore. Personal restoration never lifts common hiding and never
  recreates a removed selection. Personal lot scope supports archive and
  restoration only and can never remove a workspace basket membership.
- Common scope: moderator-only discard/restore (`moderateArchive`
  capability); a contributor is never silently redirected from a forbidden
  common archive to a personal action.
- Membership management: `manageMembers` capability; revocation closes
  affected reads/writes; revision conflicts surface `current` for retry.
- Lot capabilities are distinct per mutation family: selection right for
  select/deselect in the configured basket, `moderateArchive` for workspace
  discard, plus distinct pipeline (`sollicite`, `lettre_envoyee`) and market
  (`en_vente`) rights. `lettre_envoyee` keeps its existing meaning; no
  `a_lettre` state exists. Lot discard keeps its mandatory reason
  (`reason_code_required`, 422); the legacy-import reason is rejected
  (`invalid_reason_code`).

## 4. Idempotency, replay, conflicts, batches

- `Idempotency-Key` (uuid) is required on every command and lowercased
  server-side inside an advisory transaction lock.
- Exact replay: same key + same command digest + resolved context returns the
  original receipt byte-identically, including its original event when present;
  no new mutation occurs. Only an originally null receipt replays as null.
- Same key with a different command digest, or a key bound to another
  workspace → `idempotency_key_conflict` (409).
- Receipt with an unresolved command context → `command_context_unresolved`
  (409); the context must resolve before the receipt is returned.
- Owner history with events lacking stream bindings →
  `personal_history_unresolved` (409); legacy payloads use recovery-only
  paths and never create new commands.
- Source-version conflicts (changed content under the same head, including
  unchanged-UUID content changes) → 409 + `current` carrying the live
  version; the client re-reads and retries with the fresh displayed version.
- Head conflicts → 409 + `current` carrying the live head; retry with the
  fresh `expectedHeadId`.
- Lot batch: all-or-nothing atomic append, 1–500 items, one shared
  idempotency key and one contract version (`lot-facets-v1`).
- Configured-destination checks and durable opening (`lot_cutover_closed`,
  503) precede business reads and receipt returns, including exact replay.

## 5. Reveal and reason catalog (implemented in B1)

- New router file `api/src/routes/scoped-signal-reveal.ts` (exact name) exposing,
  under the same session guard and fingerprint semantics as §1.2:
  - `GET /api/v1/workspaces/:workspaceId/signal-facets/reveal?citySlug&type&id` — authorized
    read of one archived signal with current content, its fingerprint and its
    personal/workspace heads, so a restore can present the actually re-read
    version. Query fields use the existing target validators. Response:
    `{ ok: true, target, signal, displayedFingerprint, heads: { personal, workspace }, effectiveDiscarded, capabilities }`.
    Require approved membership and an open scoped epoch before fetching content;
    reject missing rights and stale context without revealing hidden content.
  - `GET /api/v1/workspaces/:workspaceId/signal-facets/reason-codes` —
    workspace-scoped reason catalog (same entry shape as the legacy
    `reason-codes` read), served without legacy readers.
- Mount order in `app.ts` (B1.1): content-host isolation first, control
  cookie guard, then the scoped routers with the existing session guard;
  `privateSignalResponse` cache headers preserved on every scoped path.
- Focused tests (B1.4/B1.5): reveal → restore with the re-read version,
  concurrent source change between reveal and restore (409 + `current`),
  independent archive scopes per workspace.

## 6. Session, Bearer [REDACTED] SSE rules

- Writes: browser session only. Any non-GET with `via === "bearer"` →
  `browser_session_required` (403) on all scoped routers.
- Reads: the same session guard fronts scoped GETs (`unauthenticated`, 401
  when auth is enabled and no session). A supported Bearer [REDACTED] read does not
  confer write rights.
- SSE (`projection-events`): browser session only for both the initial
  request and every re-poll; expiry mid-stream closes the stream; Bearer is
  rejected before any frame.
- Cookie/session mechanics and OIDC behavior are unchanged in B0; `auth.ts`
  is conditional scope (only for evidenced BASE composition defects, and
  then under CT-1 if both tracks touch it).

## 7. Legacy retirement responses

- During cutover (old paths closed, new paths not yet serving): explicit
  `503` with a stable machine-readable error (never a silent empty set).
- After retirement: explicit `410` with the successor operation named in the
  body. No replacement `404`: the `search_signals` MCP consumer
  (`packages/immo-mcp/src/data-source.ts:307-350`, call at :316) maps 404
  to an empty list, so a retired route answering 404 would read as "no
  signals". BASE supplies this contract; the adapter requalification is
  owned by ARTEFACTS under CT-3/CT-9. No MCP implementation enters BASE.
- Applies to `GET /api/graph-signals/:city`, the legacy signal-facet writes,
  and the legacy mark/prospect paths retired in B1.6/B4.

## 8. API authority independence

- The API is the permanent contract. MCP, artifacts, H5 and any new
  Sentropic package are consumers, never prerequisites: BASE qualifies and
  delivers with artifact configuration absent and artifact services unused.
- No business delivery or activation prerequisite is created between the
  tracks in either direction (CT-8/CT-9). Schema coordination never
  requires 6K business activation and never makes MCP/H5 a BASE prerequisite.

## 9. Acceptance cases and file ownership

HTTP/PostgreSQL cases (artifacts disabled; B5 executes, B0 only records):

- A1 authority: personal/common separation, moderation-gated archive,
  revocation closing reads/writes, membership revision conflicts.
- A2 transitions: select/deselect/discard/restore per basket, pipeline and
  market mutations with distinct rights, mandatory discard reason.
- A3 history: receipt recovery, unresolved contexts preserved, history and
  source-history pagination.
- A4 concurrency: head conflicts, changed content under unchanged UUID,
  exact replay without mutation, atomic batch through 500 targets.
- A5 bootstrap: truly empty history → opening → first mark without
  artificial events; unresolved-only history stays closed.
- A6 cutover: closed destination refuses business reads and receipts (503);
  interrupted cutover resumes under the durable barrier; fresh install,
  migrated install and rerun qualify under CT-8.

B1/B2 file ownership map:

- B1 (chain A): `api/src/routes/workspaces.ts`,
  `api/src/routes/scoped-signal-facets*`,
  `api/src/routes/scoped-workspace-archive*`,
  `api/src/routes/scoped-projection-*`,
  `api/src/routes/signal-facets*`, `api/src/routes/graph-signals*`,
  new `api/src/routes/scoped-signal-reveal.ts`, synthetic tests
  `api/tests/integration/base-api-*`.
- B2 (chain B): `api/src/routes/scoped-lot-*`,
  `api/src/services/facets/lots/**`, 6K import under CT-1–CT-8.
- BASE Sol A-owned: `api/src/db/schema.ts` and shared BASE verification files.
  Cross-track CT-1 lease only: `api/src/app.ts`,
  `api/src/index.ts`, `api/drizzle/**`; `api/src/routes/auth.ts` joins this
  set if both tracks touch it. Muse never writes these files. BASE-local ownership
  never grants a concurrent cross-track shared-file write right.
- `tools/make/paniers-lot6.mk` and `tools/make/paniers-lot6-verify.sh`
  remain BASE Sol A-owned; CT-1's shared cross-track set is defined above.

## 10. B4 entry points (implemented)

Protected operator entry points owned and implemented in B4:

- Make: `base-api-activate-personal`, `base-api-resume-personal` in
  `tools/make/base-api.mk`, dispatched by
  `tools/make/base-api-activation.sh` (Sol A owns both tooling paths).
- Script: `api/src/scripts/base-api-personal-activation.ts` (Muse A).
  Requires workspace, actor, reason and qualified maintenance evidence;
  runs in the API container without environment-file discovery.
- Composition: `runPersonalAttachmentActivation` from `activation-run.ts`
  performs activation; `attach-personal-history.ts` only attaches histories.
  Resume inspects durable state: legacy/closed retries protected activation,
  scoped/closed calls `resumePersonalAttachmentReadback` from
  `activation-open.ts`, already-open returns status after authorization
  without mutation.
- Safety: `api/src/services/facets/activation-maintenance-safety.ts`
  implements `ActivationSafety` with injected drain/shutdown evidence and
  the internal reader — never successful empty callbacks.
- Readback: `api/src/services/facets/activation-readback.ts` validates real
  PostgreSQL bindings, heads and scoped projections under the still-closed
  barrier; `scopedEpochFor`/public readers stay closed with no public bypass.
- Suites: `api/tests/integration/base-api-activation.spec.ts` and
  `base-api-activation-resume.spec.ts`. Public reads return 503 while
  closed; readback validates seeded heads/projections; opening then enables
  public reads. Interrupted activation keeps the durable barrier.

## 11. Cross-track rules CT-1–CT-9 (verbatim, binding on both packets)

- [ ] CT-1 — BASE/ARTEFACTS shared-write rule: one conductor-recorded lease holder at a time edits `api/src/app.ts`, `api/src/index.ts` and `api/drizzle/**` across both tracks; include `auth.ts` if both tracks touch it. Neither lane's integrator has an independent concurrent write right.
- [ ] CT-2 — Each lease records holder, receiving branch/HEAD, both input SHAs, exact hunks, migration reservations, tests and resulting commit. The next holder acknowledges that receipt. Nonshared work continues; joining the histories uses merge commits, never whole-file ours/theirs or copied commits.
- [ ] CT-3 — Preserve both sets of mounts/startup dependencies and middleware order: content-host isolation first, control cookie guard, then authenticated business routes; keep H4 and H5 identities distinct. Requalify the named signals API adapter if BASE retires its route; do not reopen a retired route.
- [ ] CT-4 — Reserve `0022_facet_lot_cutover.sql` and `0023_facet_lot_versions_fence.sql` for BASE's pinned 6K import. Allocate artifact technical files from the next globally unreserved number, at least 0024; reservation alone is not migration-order proof. Preserve inherited SQL bytes and hashes.
- [ ] CT-5 — Use the existing common Drizzle journal/migrator. The lease holder assigns each unreleased suffix entry a unique tag and sequential idx, with when greater than the maximum existing journal/applied timestamp. Preserve the applied prefix; never renumber, retime or replace an applied/released entry or edit database migration history.
- [ ] CT-6 — BASE-first is permitted: append artifact entries after the fixed BASE prefix. ARTEFACTS-first is permitted without importing or applying 6K: release its technical suffix on the current baseline, then register still-unreleased BASE entries after that suffix, retaining 0022/0023 SQL bytes and their relative order. Their original lower timestamps must not be inserted behind an already-applied artifact suffix.
- [ ] CT-7 — Freeze one journal order before first persistent use across the target release chain. Reindex/retime only unpublished, unapplied suffix metadata, with provenance; a branch commit or disposable test DB is not a deployment release; BASE owns qualifying its migration assertions by relative prerequisite order rather than obsolete adjacency. If 6K metadata is already immutable, retain its prefix and refuse an incompatible combined upgrade; do not invent a history repair. Applied/deployed state is unverified until an operator receipt.
- [ ] CT-8 — Qualify a standalone delivery on fresh DB, its baseline upgrade and rerun using only its own migrations. Before a combined delivery, also qualify baseline-to-first-track-to-combined with its frozen journal: every expected SQL hash occurs once, none is skipped, technical/business data survive. Alternative orders need their own pre-release qualification. Serialize migration jobs per target DB; never wait for the other track to qualify a standalone delivery.
- [ ] CT-9 — After joining histories, test the exact combined SHA/image: both mount sets, auth/session and 6L2 regressions, BASE with artifacts off, artifacts without optional business capabilities, two-reader API proof and migration history. A shared-image update must retain already-delivered capabilities; no stale branch image may overwrite them. Schema coordination never requires 6K business activation or makes MCP/H5 a BASE prerequisite.

Lease/receipt protocol: the conductor records each lease (holder, receiving
branch/HEAD, both input SHAs, exact hunks, migration reservations, tests).
The next holder acknowledges the receipt before another shared-file edit.
BASE Sol A is the integrator for `schema.ts`, shared app/startup files and
shared BASE verification files, and edits them only while holding the
recorded lease; otherwise it submits bounded hunks to the holder. Muse never
writes these files.

Standalone qualification (fresh DB, baseline upgrade, rerun with BASE-only
migrations) never waits for the other track. Combined delivery adds the
baseline-to-first-track-to-combined qualification and the exact-combined-SHA
proof; it never becomes a business delivery or activation prerequisite
between tracks.

## 12. Open decisions and unverified facts

Code trace verified in B0 (source presence never proves operational availability):

- `app.ts:152–154` mounts legacy graph/signals; `index.ts:101` composes
  `createApp` with `createDiscardedSignalsReader` and existing artifact options.
- `scoped-projection-revisions.ts:114–118` filters effective archive heads
  before returning nodes, so B1 reveal requires an authorized separate read.
- `scoped-writer.ts:184–212` recovers historical receipts under approval,
  membership, scoped epoch and context checks; missing receipts cannot mutate.
- `lots/lot-gate.ts:23–28` already checks enabled destination + configured
  basket. B2 adds the durable cutover opening requirement; it does not replace
  this configuration guard.
- Pinned 6K `3c6d3c1f95d6794ba0939cf71db6b169cb3f071d` reserves
  `0022_facet_lot_cutover.sql` (SHA-256 `c33768aa02233e04f887d2829772c6eec3fcf776be054816b3766b23cf5a3cda`)
  and `0023_facet_lot_versions_fence.sql` (SHA-256 `757d70bb5b90bc6d2e6b3d2d6bc18763254ece5651261afbc259a1d4655b66f3`).
  `lot-cutover-gate.ts` requires destination, epoch, qualified roster/manifest,
  writer coverage and recorded D5 decisions; `lot-cutover-open.ts` separately
  performs authorized readback before durable opening under the barrier.
  Original journal adjacency at `lot-cutover-journal-db.test.ts:29–31` is
  incompatible with an intervening artifact suffix; B2.1 qualifies relative
  prerequisites before K_SHA. SQL bytes remain fixed.
- CT-2 receipt fields: holder, receiving branch/HEAD, both input SHAs, exact
  hunks, migration reservations, tests, resulting commit and next-holder
  acknowledgement. B0 edits no CT-1 file and claims no lease.
- CT-7 applied/released journal state remains unverified: no operator receipt
  was supplied. Neither a source checkout nor a disposable DB establishes it.
- `base-api-verify` runs the standalone CT-8 fresh/upgrade/rerun profile on
  the current BASE journal. It cannot attest a later combined journal/image;
  combined CT-8/CT-9 remains a separate gate after history integration.

- OPEN O1: maintenance window is the execution default; continuous
  coordination is outside this delivery.
- OPEN O2: lot discard reason remains mandatory.
- OPEN O3: `lettre_envoyee` keeps its meaning; no `a_lettre` state, no
  historical relabeling.
- OPEN O4: independent signal baskets and separate archive scopes retained.
- D1–D4 remain ratified; concrete operational values (workspace, tenant
  bindings, members, moderators, manager, lot rights, basket, destinations)
  are `unverified`.
- `unverified` until executed: B0_SHA value, port availability
  (API 18910 / UI 15910 / Maildev 11910), runner behavior, typecheck/lint/
  test/mutation outcomes, bundle contents, migration-applied state,
  K_SHA value and timing, 6K history import bytes, remote CI and PR #906.

## 13. B5 qualification matrix and evidence boundary

The frozen executable manifest is `tools/make/base-api-b5-scope.sh`.
`base-api-b5-verify` executes the complete API CI include list with one
worker, API/test typechecks, explicit changed-file lint, declaration build,
CT-7 and standalone CT-8, then requires positive executed counts and no
skips or failures in every listed suite. Raw evidence and exact revisions
are recorded in `tmp/base-api-evidence/B5/report.md` outside source commits.

- B5.1: `base-api-lot-{authority,transitions,receipts,contexts}.spec.ts`
  qualifies signed sessions, supported bearer reads, distinct rights,
  history pagination, exact receipts and unresolved historical contexts.
- B5.2: `base-api-lot-{concurrency,replay-guards,closed-replays,batches}.spec.ts`
  qualifies stale heads/content, current approval/membership/operation rights,
  populated closure and atomic 1–500 batches. Ordered SQL snapshots include
  events, bindings, streams, heads, receipts, contexts and both revisions.
- B5.3: `base-api-cutover-readback.spec.ts` observes real qualified empty
  PostgreSQL readback while public HTTP remains 503, then opening and the
  first ordinary mark. `base-api-cutover-acceptance.spec.ts` adds gate,
  identity-binding and legacy observations. Inherited B4
  `base-api-activation{,-resume}.spec.ts`, `base-api-cutover-bound.spec.ts`
  and `base-api-mutation-closure.spec.ts` retain protected interruption,
  forward resume, persisted integrity and durable reconstruction witnesses.
- B5.4: `base-api-independence.spec.ts` qualifies absent startup configuration,
  unused artifact pool/host/control factories, successful BASE operations,
  exact replay and live no-call counters at the artifact backend boundary.
- B5.5: this complete contract replaces the EVOL document; the activation
  runbook identifies synthetic qualification and outstanding operator inputs.

B1–B4 mutation receipts keep their original identities and source hashes.
B5 mutation cycles record baseline/assertion failure/restored success.
Final reviews and receiving-branch integration require the exact tested SHA;
a B5 branch bundle alone does not establish receiving-branch acceptance.
Combined CT-8/CT-9 and operational activation remain separate qualifications.
