# Feature: Scoped MCP signal classification writes

## Objective
- [x] Expose classification, human feedback and free notes through MCP and the signal UI.

## Scope / Guardrails
- [x] Base: feat/class-feedback (#1104). Target the preprod train; exclude production v1.2.20.
- [x] Worktree: tmp/mcp-signal-write; branch feat/mcp-signal-write.
- [x] No environment files, Python, kubeconfig, merges or generated commit trailers.
- [x] Make-only commands; ENV last; isolated stacks removed with down -v.
- [x] Test environment: test-mcp-signal-write. No published ports; API 18873, UI 15873, Maildev 11873 reserved if needed.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: api/src/services/graph/**, api/src/routes/**, api/src/app.ts, api/src/db/service-role-grants*, api/drizzle/meta/_journal.json.
- [x] Allowed: packages/immo-mcp/**, ui/src/lib/signals/**, ui/src/lib/components/maps/**, ui/e2e-real/**.
- [x] Allowed: tools/make/mcp-signal-write*, docs/spec/SPEC_EVOL_MCP_SIGNAL_WRITE.md, this plan.
- [x] Allowed: api/tests/integration/signal-mcp-client.spec.ts.
- [x] Forbidden: root Makefile, docker-compose*.yml, rules/**, agent entrypoints, other branch plans.
- [x] Conditional: api/drizzle/0048_signal_mcp_write.sql; deploy/overlays/preprod/patch-immo-mcp-config.yaml.

## Feedback Loop
- [x] MCPSIGNALWRITE-EX1: additive migration 0048; reserve 0047 for #1104 renumbering after #1102. Impact: scoped journal only. Rollback: disable the binding and scope; retain audit rows.
- [x] MCPSIGNALWRITE-EX2 unused: no preprod manifest changes. Activation/explicit IdP consent are documented for the preprod train.
- [x] Route mounting in api/src/app.ts is necessary for UI note access. Impact: one authenticated scoped router. Rollback: remove its registration.
- [x] MCPSIGNALWRITE-EX3: allow api/src/services/facets/{scoped-writer,workspace-reader}.ts and .github/workflows/ci.yml for PR #1107 corrections. Impact: shared MCP archive authority and a dedicated gated-test CI job. Rollback: disable MCP writes and remove the job; retain journals.
- [x] Independent design reviews: security and scoped data correctness. Reconciled: global IA table cannot store personal MCP classes; native graph notes need a new scoped anchor.

## Orchestration Mode (AI-selected)
- [x] Single branch; two independent read-only design reviews. Final h2a selection failed: launch tool and exact author metadata unavailable; no consensus claimed.

## UAT Management (in orchestration context)
- [x] Root UAT remains untouched. Automated browser checks use the isolated test stack.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, server, annotations, feedback, facets and existing prospect notes.
- [x] Lot 1: additive scoped journal, notes, audit, grants and concurrency guards.
  - [x] Scoped append-only tables and transactional write/read functions drafted.
  - [x] Parent rebased after #1104 reserved 0047; MCP journal index 47 and migration 0048.
- [x] Lot 2: write scope, schemas, session-bound elicitation and tools.
  - [x] Five contracts registered; verified client identity and current-session elicitation wired.
- [x] Lot 3: scoped read projection, UI provenance badges and note addition.
- [x] Lot 4: typecheck/lint pass; 27 API/PostgreSQL, 613 MCP (9 skipped), 5 OAuth/SDK/PostgreSQL, 19 UI and 1 browser tests pass.
- [x] Every test stack removed with down -v; no containers or volumes remain for this ENV.
- [x] Lot 5: selective commits pushed; PR #1107 opened against feat/class-feedback.
- [x] CI observed: branch policy passed; quality gates and generic browser suite running. No merge.
- [x] Delivery report prepared: five tools, explicit write scope, migration 0048, local test totals and activation instructions.
- [x] Review correction 1: MCP always auto; accepted elicitation is pending_human; SQL CHECK and client contract updated.
- [x] Review correction 2: browser decisions linked to immutable MCP events; shared archive moderation and projection.
- [ ] Review correction 3: explicit manual Non classé and confirmation controls in the UI.
- [ ] Review correction 4: SQL, SDK, UI and browser regressions; dedicated CI gate; final checks and delivery.
