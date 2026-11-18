# Scoped MCP signal writes

MCP classification and free notes after class-feedback (#1104), retargeted to `main`.
Owner decision: the target is production (the preprod-first exclusion is lifted).
Migration 0048 follows the reserved 0047 feedback migration.

## Contract

- `immo:signals:write` is an explicit OAuth grant. Read and artifact scopes never imply it.
- `list_class_reasons` reads the existing four classes and 28 reason definitions.
- `get_signal_classification(signalRef)` reads the effective scoped class, complete provenance, ambiguity, history, feedback and free notes.
- `classify_signal(signalRef, classe, reasonCode, reason, model, humanConfirmed?)` appends a classification. A nonblank change reason and declared model are required.
- `confirm_classification(signalRef, verdict, model, newClasse?, reasonCode?, reason?)` appends feedback. A negative verdict requires a different class and a registry reason.
- `annotate_signal(signalRef, text, model, humanConfirmed?)` appends plain text, bounded to 2000 characters before cleaning.
- `signalRef` contains workspaceId, scope (personal/workspace), citySlug, type (Signal/DesignationEvent) and id. Shared class writes have the same archive-only restriction and moderation capability as the UI.

## Authority and storage

OAuth supplies the user and client. Tool parameters cannot supply either identity.
MCP writes always have `validation=auto`, enforced by a table CHECK and the SQL writer.
Accepted elicitation additionally sets `pending_human=true`. It never proves human intervention.
The UI badge is `MCP · <model> · à confirmer` while this flag is set.
The proposal includes the complete input and observed version. Acceptance is rechecked against the current version and current membership in the write transaction.
Absent, declined, cancelled or unsupported elicitation gives automatic validation; confirmation requires acceptance.

The global AI table stays global. MCP classes live in a scoped append-only journal.
Only the authenticated immo browser session can confirm a classification with 👍 or reclassify it.
Confirmation requires the original authenticated actor. It appends a manual human event linked by
`linked_event_id` to the immutable automatic MCP event. Bearer sessions cannot call this route.
`Non classé` also appends an explicit manual event, with `classe=non_classe`.
UI manual history wins over automatic MCP/AI. Pending MCP has the same overwrite priority as automatic MCP.
A shared archive remains authoritative over personal classes. Both UI reads and direct personal writers
consult MCP shared archives. Restoration requires `moderateArchive`, exactly as shared UI archives do.
An authorized restoration appends a shared clearing event and the resulting personal class atomically.
It increments shared and personal revisions. Personal UI archives remain effective until explicitly restored.
Refresh and reannotation cannot mutate this journal. Reclassification retains every previous state.
Notes use native graph targets. Existing prospect notes use different relational UUID targets and do not provide workspace isolation or append-only semantics.
The new notes can also be added from the UI. Rendering always uses escaped text.

The MCP database binding has narrowly enumerated privileges. It never borrows the search token exchange for writes.
Every MCP write attempt records user, client, model, tool, input hash and result.
Rate limiting is per user. Workspace membership is checked inside each write transaction.

## Activation

Production target (owner decision). The manifests in this branch are prepared
in the repository only; nothing is applied by the branch itself.

Production prerequisites, in order:

1. Migration 0048 applied on the production database and service-role grants
   replayed by the migrator (`api/src/db/service-role-grants.ts`). The
   restricted role executes only `signal_mcp_read`, `signal_mcp_write_mcp`
   and `signal_mcp_result`; it holds no direct table privilege.
2. Dedicated PostgreSQL role `immo_mcp_signal_writer` created by the
   operator, with its connection provisioned as the Secret
   `immo-mcp-signal-writer` (key `IMMO_MCP_SIGNAL_DATABASE_URL`), bound by the
   `radar-immo-mcp` Deployment in `deploy/k8s/immo-mcp/40-immo-mcp-http-deploy.yaml`.
   Same database name as the API.
3. Scope `immo:signals:write` declared in the production IdP catalogue and on
   the immo-mcp client row before it is advertised, otherwise authorization
   requests carrying it are refused with `invalid_scope`. The prod base
   stays inert (`IMMO_MCP_SIGNALS_WRITE_ENABLED="0"`, scope not announced,
   optional Secret reference); activation is the separate
   `deploy/overlays/prod-signal-write` overlay, applied by an operator after
   the prerequisites. The preprod overlay carries the activation values for
   qualification first. Commissioning order and the exact 0048 rollback SQL
   live in `docs/operator/mcp-signal-write-runbook.md`.
4. Default consent selection stays read-only. Users explicitly grant the new
   scope and reconnect. Read-only OAuth tokens still cannot write with the
   binding enabled.
5. Rollout applies `deploy/k8s/immo-mcp/` through the usual prod promotion;
   no release version change is part of this branch.

## Verification

Cover missing scope, forged confirmation, accepted/declined elicitation, stale acceptance, manual priority, negative feedback validation, cleaned notes, audit, user rate limits and cross-workspace isolation.
Run typecheck, lint, scoped test-api, test-mcp, test-ui and browser badge/note checks.

## Initial review availability

Design received two independent reviews, for scoped correctness and authorization.
The installed final-review skill requires a complementary host/model pair launched through h2a MCP.
That launch tool is absent in this session. Exact author model/effort metadata is also unavailable.
Final peer selection status: `selection-failed`. No final consensus verdict is claimed.
Implementation is checked through executable PostgreSQL, OAuth/SDK and browser contracts.

```yaml
review-author:
  host: codex
  model: unavailable
  effort: unavailable
target-ref: 91b9d6b857557dc0309c135e1dbed417e3d12fe0
status: selection-failed
observed-failure: h2a_run MCP tool and exact author model/effort metadata unavailable
```

## Qualification

`make -f tools/make/mcp-signal-write.mk verify ENV=test-mcp-signal-write` passes.
Typecheck covers every workspace. Lint covers the repository.
Diagnostics: eight Svelte warnings and one lint warning; zero errors.
API/PostgreSQL: 30 pass in the default scope; 44 pass when including the existing shared-archive suites.
MCP: 613 pass, nine skipped. OAuth/SDK/PostgreSQL: five pass. UI: 37 pass.
The nine MCP skips concern unrelated P0 database transport profiles: four source transport,
three strict registry transport, one v2 transport and one strict HTTP transport case.
They require their dedicated database/profile setup. No signal SQL or SDK test is skipped in this gate.
`make -f tools/make/mcp-signal-write.mk test-ui-e2e ENV=test-mcp-signal-write` covers two real browser/API/PostgreSQL scenarios.
They verify pending/automatic badges, cleaned notes, persisted user notes, linked browser confirmation,
reclassification after confirmation and explicit Non classé after reload.
The dedicated target supplies `E2E_MCP_SEEDED=1` after preparing its MCP seed.
The generic browser suite skips this case because its shared baseline does not contain MCP state.
The CI `MCP signals (PostgreSQL, SDK and browser)` job runs the dedicated make targets with
`MCP_SIGNAL_DB_TEST=1` and `LOT_MIGRATION_DB_TEST=1`. The ten original SQL tests and five SDK tests
are required there, together with the added regressions and seeded browser scenarios.
All stacks were removed with volumes. Root UAT was untouched.
