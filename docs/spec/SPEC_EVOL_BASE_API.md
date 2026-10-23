# SPEC_EVOL_BASE_API — Independent BASE API contract (B0)

Status: evolving. B0 freezes the wire, authority and acceptance contract traced
to code at `feat/base-api-decouplee` (`9a815087`). Anything not established
from code is marked `unverified`. B0 changes no application code.

Binding: B0_SHA (final audited B0 commit, named in the delivery report) is the frozen
contract baseline. B1 starts from B0_SHA. B2 starts from K_SHA, released by
the BASE integrator after the CT-7 migration qualification in B2.1. Packet
clauses CT-1 through CT-9 (§11) govern both tracks verbatim.

## 1. Existing route inventory (read from code)

All scoped routers below are implemented but UNMOUNTED in `app.ts` pending
6H/6K activation. Legacy routers remain mounted and serve unchanged behavior.
Mount state is `unverified` beyond the `app.ts` read of this baseline.

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
- Destination closure (`lot_destination_disabled:<workspaceId>`, 503) precedes
  business reads and receipt returns once the 6K gate lands (B2.2/B2.3).

## 5. Reveal and reason catalog (B1 additions, contract reserved)

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

