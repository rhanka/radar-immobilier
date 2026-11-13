# Feature: Scoped MCP signal classification writes

## Objective
- [ ] Expose classification, human feedback and free notes through MCP and the signal UI.

## Scope / Guardrails
- [x] Base: feat/class-feedback (#1104). Target the preprod train; exclude production v1.2.20.
- [x] Worktree: tmp/mcp-signal-write; branch feat/mcp-signal-write.
- [x] No environment files, Python, kubeconfig, merges or generated commit trailers.
- [x] Make-only commands; ENV last; isolated stacks removed with down -v.
- [x] Test environment: test-mcp-signal-write. No published ports; API 18873, UI 15873, Maildev 11873 reserved if needed.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: api/src/services/graph/**, api/src/routes/**, api/src/db/service-role-grants*, api/drizzle/meta/_journal.json.
- [x] Allowed: packages/immo-mcp/**, ui/src/lib/signals/**, ui/src/lib/components/maps/**, ui/e2e-real/**.
- [x] Allowed: tools/make/mcp-signal-write*, docs/spec/SPEC_EVOL_MCP_SIGNAL_WRITE.md, this plan.
- [x] Forbidden: root Makefile, docker-compose*.yml, rules/**, agent entrypoints, other branch plans.
- [x] Conditional: api/drizzle/0048_signal_mcp_write.sql; deploy/overlays/preprod/patch-immo-mcp-config.yaml.

## Feedback Loop
- [x] MCPSIGNALWRITE-EX1: additive migration 0048; reserve 0047 for #1104 renumbering after #1102. Impact: scoped journal only. Rollback: disable the binding and scope; retain audit rows.
- [x] MCPSIGNALWRITE-EX2: preprod scope discovery only. Explicit IdP consent remains required. Rollback: remove advertised scope.
- [x] Independent design reviews: security and scoped data correctness. Reconciled: global IA table cannot store personal MCP classes; native graph notes need a new scoped anchor.

## Orchestration Mode (AI-selected)
- [x] Single branch; independent read-only design and final reviews.

## UAT Management (in orchestration context)
- [x] Root UAT remains untouched. Automated browser checks use the isolated test stack.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, server, annotations, feedback, facets and existing prospect notes.
- [ ] Lot 1: additive scoped journal, notes, audit, grants and concurrency guards.
  - [x] Scoped append-only tables and transactional write/read functions drafted.
- [ ] Lot 2: write scope, schemas, session-bound elicitation and tools.
- [ ] Lot 3: scoped read projection, UI provenance badges and note addition.
- [ ] Lot 4: unit, PostgreSQL, MCP client and UI tests; typecheck and lint.
- [ ] Lot 5: final independent review, selective commits, push and PR to feat/class-feedback.
- [ ] Verify CI; report tools, scope, schema, tests and PR number. No merge.
