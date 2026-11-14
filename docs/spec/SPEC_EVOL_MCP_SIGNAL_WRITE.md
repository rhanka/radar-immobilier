# Scoped MCP signal writes

The preprod train adds MCP classification and free notes after class-feedback (#1104).
It is excluded from production v1.2.20. Migration 0048 follows the reserved 0047 feedback migration.

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
Only the server's current-session MCP elicitation can produce human validation.
The proposal includes the complete input and observed version. Acceptance is rechecked against the current version and current membership in the write transaction.
Absent, declined, cancelled or unsupported elicitation gives automatic validation; confirmation requires acceptance.

The global AI table stays global. MCP classes live in a scoped append-only journal.
UI manual history wins, then MCP human, then the latest automatic MCP/AI annotation.
Automatic MCP never replaces UI manual history or MCP human history.
Refresh and reannotation cannot mutate this journal. Reclassification retains every previous state.
Notes use native graph targets. Existing prospect notes use different relational UUID targets and do not provide workspace isolation or append-only semantics.
The new notes can also be added from the UI. Rendering always uses escaped text.

The MCP database binding has narrowly enumerated privileges. It never borrows the search token exchange for writes.
Every MCP write attempt records user, client, model, tool, input hash and result.
Rate limiting is per user. Workspace membership is checked inside each write transaction.

## Activation

Apply the migration and replay service-role grants on preprod only after the stacked dependencies.
Enable the signal binding, advertise immo:signals:write and register that scope at the IdP.
Keep the default consent selection read-only. Users must explicitly grant the new scope and reconnect.
No production manifests or release version change is part of this branch.
The dedicated PostgreSQL role is `immo_mcp_signal_writer`.
Provision its connection as `IMMO_MCP_SIGNAL_DATABASE_URL`, with the same database name as the API.
Set `IMMO_MCP_SIGNALS_WRITE_ENABLED=1` only after the migration and grants are qualified.
Read-only OAuth tokens still cannot write with that binding enabled.

## Verification

Cover missing scope, forged confirmation, accepted/declined elicitation, stale acceptance, manual and human priority, negative feedback validation, cleaned notes, audit, user rate limits and cross-workspace isolation.
Run typecheck, lint, scoped test-api, test-mcp, test-ui and browser badge/note checks.

## Review availability

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
API/PostgreSQL: 27 pass. MCP: 613 pass, nine skipped. OAuth/SDK/PostgreSQL: five pass.
UI: 19 pass. The final provenance-null change was rechecked with test-api and test-mcp.
`make -f tools/make/mcp-signal-write.mk test-ui-e2e ENV=test-mcp-signal-write` passes one real browser/API/PostgreSQL scenario.
It verifies human/automatic badges, cleaned notes and persisted user notes after reload.
All stacks were removed with volumes. Root UAT was untouched.
