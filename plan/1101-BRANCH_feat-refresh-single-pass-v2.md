# Feature: Single-pass classification v2

## Objective
- [ ] Require one of three AI classes, an exact registered code and explicit ambiguity.

## Scope / Guardrails
- [x] Worktree tmp/refresh-v2; branch feat/refresh-single-pass-v2; base feat/refresh-single-pass.
- [x] Preserve v1, manual Non classé and absent-annotation state. No historical reannotation or merge.
- [x] No dotenv reads, Python, Kubernetes access or commit trailers. Make uses SKIP_DOTENV=1 and compose --env-file /dev/null.
- [x] Tests: test-refresh-v2; API 8895, UI 5395, Maildev 1195, PostgreSQL 5595, S3 9195, Obscura 9295, SMTP 1095. ENV last.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: radar/prompts/refresh-single-pass*, api/src/services/graph/{refresh-single-pass*,class-annotations*,reannotate-signals*}, api/drizzle/0046_signal_class_ambiguity.sql, api/drizzle/meta/_journal.json, ui/src/lib/signals/{class-annotation-label*,graph-signal-detail-client.ts}, this plan.
- [x] Forbidden: Makefile, docker-compose*.yml, rules/**, AGENTS.md, CLAUDE.md, GEMINI.md, other branch plans, unrelated UI.
- [x] Conditional: none.

## Feedback Loop
- [x] BR1101-EX1: immutable v1 copy requires a single new prompt file over 150 lines. Impact: versioned prompt only. Rollback: remove v2 and restore manifest.
- [x] Owner decisions dated 2026-11-13 fix the design; implementation needs no new product decision.

## Orchestration Mode (AI-selected)
- [x] Single branch, sequential implementation; no cherry-pick.

## UAT Management (in orchestration context)
- [x] No root checkout changes; targeted badge tests qualify the narrow UI change.

## Plan / Todo (lot-based)
- [x] Lot 0: Read project rules, analysis recommendations (a)/(d), harness plan/test/review; confirm clean branch and minimal UI scope.
- [x] Lot 1: Preserve v1 and publish v2 prompt and exact manifest fingerprint.
- [x] Lot 2: Restrict AI schema/validator to registered classes/codes; preserve ambiguity through reannotation contract without running it.
- [x] Lot 3: Add ambiguity persistence and badge; retain human precedence. No separate annotation history table exists; graph properties retain the flag.
- [ ] Lot 4: Validator, fallback, terminal failure, PostgreSQL persistence and badge tests.
- [ ] Lot 5: Typecheck, lint, targeted API/PostgreSQL/UI; remove test stack with volumes.
- [ ] Lot 6: Review diff, push and open PR against feat/refresh-single-pass; no merge.
