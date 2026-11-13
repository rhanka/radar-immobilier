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

## Verification

Cover missing scope, forged confirmation, accepted/declined elicitation, stale acceptance, manual and human priority, negative feedback validation, cleaned notes, audit, user rate limits and cross-workspace isolation.
Run typecheck, lint, scoped test-api, test-mcp, test-ui and browser badge/note checks.
