# Feature: A2-BASE API read chain

## Objective
- [ ] Deliver T01/T03/T04/T05/T06/T07 from the approved MCP adapter v2 design, with no active production mount.

## Scope / Guardrails
- [x] Base: `c5fb85dbd77e12c0c4355a207de84ead0c3fa5d9`; lane: `tmp/a2base-api`; branch: `feat/artefacts-mcp-a2base-api`.
- [x] Make only; no host runtime, new dependency, migration or environment-file read.
- [x] Test environment: `test-a2base-api`; API/UI/Maildev ports: `18919/15919/11919`; ENV last.
- [x] One Docker campaign machine-wide; wait 60 seconds between ownership checks; one worker; stop below 10 GiB; clean only owned resources.
- [x] Shared Git remains read-only; use an ignored local Git directory with this worktree, subject-only Conventional Commits of at most 150 changed lines; no push.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths**: `api/src/routes/mcp-signal-search*`, `api/src/services/facets/mcp-signal-*`, `api/tests/integration/mcp-signal-search*`, new `tools/make/base-api-a2base*`, this lane plan.
- [x] **Conditional Paths**: canonical helper exports in `api/src/routes/graph-signals.ts`; EX5 entry in the ARTEFACTS plan; root delivery report.
- [x] **Forbidden Paths**: `packages/immo-mcp/**`, A3 receiver, H5 reader, `api/src/{app,index,config}.ts`, `api/src/routes/auth.ts`, schemas/migrations/manifests/lockfile, root Makefile/Compose, rules, bootstrap, other plans, client materials.
- [x] **Exception process**: BRARTEFACTS-EX5 records rationale, impact and recovery in the parent plan before conditional edits.

## Feedback Loop
- [x] Owner explicitly assigned developer/tester/integrator duties and local backup Git delivery.
- [x] Production wiring and A3/MCP/H5 remain with their assigned owners; CT-3/CT-9 are unchanged.

## Orchestration Mode (AI-selected)
- [x] Single API lane with sequential writes and tests; no copied commits or shared-file lease required.

## UAT Management (in orchestration context)
- [x] No UI change or UAT stack; root checkout and stable dev data remain untouched.

## Plan / Todo (lot-based)
- [x] Lot 0: read master/workflow/testing, approved design and both reviews; verify clean assigned branch.
- [ ] T01: strict local request/response contract and GET decoder, compared with inert S0.
- [x] T01 implementation: strict wire decoder and reserved response schema; unit cases written, qualification pending.
- [x] Normalized city contract preserves real double-hyphen municipality/MRC slugs already retained by citySlug().
- [ ] T03: approved-account workspace resolution (0/1/N, UUID, no substitution).
- [x] T03 implementation and unit cases written; database qualification pending.
- [ ] T04: revalidate the entire membership set and reject changed singleton.
- [x] T04 revalidation helper and unit cases written; race qualification pending.
- [x] T01/T03/T04 real createApp/PostgreSQL fixture and deterministic membership race cases written; test-only probe uses the existing verified-bearer seam, not A3 qualification.
- [x] T05 inventory before edits: context interface/factory at graph-signals lines 360/366; async canonical card at 545; synchronous degraded card at 573. Three export slices, no helper moves or duplicated implementation; keep existing builder/evidence dependencies in place.
- [ ] T05a: expose per-request document context/factory; explicit graph-signals/date-parity gates.
- [x] T05a code exports the existing context/factory without moving implementation; direct invariant test written, mandatory regressions pending.
- [ ] T05b: expose canonical async card helper; explicit graph-signals/date-parity gates.
- [x] T05b exports the unchanged async helper and adds a direct canonical-card invariant test; gate pending.
- [x] Static test review supplies explicit mock parameter types and a stored-node timestamp consistent with the nonnullable schema.
- [ ] T05c: expose canonical degraded card helper; explicit graph-signals/date-parity gates.
- [ ] T06: authorized coherent city population and personal/common masking before enrichment.
- [x] T06 coherent population and visibility cases written; no domain normalization or active mount is introduced.
- [x] Unit authority/masking tests assert that hidden or unauthorized targets never reach document enrichment; reveal keeps all guards.
- [x] PostgreSQL visibility fixture now observes real canonical object-store calls and requires zero documentary reads for hidden targets.
- [x] Visibility cases also preserve an active selection and prove personal restoration cannot lift a common archive.
- [x] Static fixture review respects the graph city/id primary key and snapshots facet/mark/activation state, including selections.
- [x] First campaign: 44 passed, six fixture setup failures on chk_workspace_memberships_revoked_at; fixed synthetic membership timestamps without weakening DB constraints. Owned cleanup passed.
- [x] T05a regressions passed: graph-signals (48), date parity (5), direct context (1); mixed campaign 103 passed, one test-only Hono route-registration failure. Split unmounted and authenticated probes onto separate apps before building their matchers.
- [ ] T07: read-only reveal, post-enrichment authority/revision checks and shared document context across bounded attempts.
- [x] T07 deterministic createApp/PG races written for approval, membership set, graph source and common archive changes during document I/O; execution waits for canonical exports.
- [x] T07 default 2,000ms cross-retry budget and persistent drift cases written with an explicit 1,000ms scheduling allowance outside documentary waiting.
- [x] Missing/legacy/barrier epoch and unresolved-history refusals are covered by real createApp/PostgreSQL cases, including empty reveal requests.
- [ ] Lot gate: unit tests, real createApp/PostgreSQL tests, named behavioral mutations, targeted lint/typecheck.
- [x] Machine-serialized runner written with explicit file scopes, a 60-second wait, disk monitoring, one-worker container configuration and inherited ownership-checked cleanup.
- [x] Eight named mutants prepared in the isolated container source copy, with a control before each, exact-byte restoration and a passing restored control required; execution pending.
- [x] Workspace race barriers release on early refusal too, so negative mutations cannot leave their coordinator waiting for a callback that already failed.
- [x] Container checks and test-only S0 contract comparison written; API runtime has no MCP import.
- [ ] Delivery: report qualified slices, commands/counts, per-commit numstat, remaining integration duties, exact SHA and isolated bundle audit/hash.
- [x] Selective staging, 150-line audit, subject-only commits and bundle verification in a blank prerequisite-only repository have dedicated make targets; no shared Git writes or push.

## Docs consolidation
- [ ] Record final evidence in `RAPPORT-SOL-A2BASE-API.md`; qualification does not close CT-9 or authorize activation.

## Merge & close
- [ ] Integrator imports audited bundle and qualifies the combined SHA/image; no merge or push in this mission.
