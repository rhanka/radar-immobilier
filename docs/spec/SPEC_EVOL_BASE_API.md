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

