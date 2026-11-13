# Exact PR 1099 single-pass recall against B

## Objective
- [ ] Measure production B+C detection, visible and P∪S recall on all 100 oracle documents.

## Scope / Guardrails
- [x] Direction i-cond; dedicated feat/classif-1passe-recall1099 worktree.
- [x] Import PR 1099 production extraction and chunking; never copy or edit its prompt.
- [x] Astra low, Codex isolated seat, concurrency 10; no Gemini fallback or retries.
- [x] Stop new Codex calls at 90% usage; publish quota samples and token usage.
- [x] Private writes only in 1passe-recall1099; source and neighboring lane read-only.
- [x] Blind outputs sealed immediately; aggregate-only publication; no prompt tuning.
- [x] No .env reads; no Python; no merge; draft PR only.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: tools/classif/1passe/recall1099/**, this plan.
- [x] Forbidden Paths: Makefile, docker-compose*.yml, rules/**, AGENTS.md, CLAUDE.md, GEMINI.md, other branch plans.
- [x] Conditional Paths: none.

## Feedback Loop
- [x] BRRECALL1099-EX1: owner requires French reports and trailer-free commits. Rollback: remove lane artifacts.
- [x] BRRECALL1099-EX2: standalone make without includes or .env; native Node for seat orchestration, inherited BR1PASSE-EX3. Production TS runs in a container with existing dependencies. Rollback: remove harness.
- [x] Production worktree is read-only; harness imports its functions without changing production code.

## Orchestration Mode (AI-selected)
- [x] Single lane; independent of neighboring variant; no delegated execution.

## UAT Management
- [x] Measurement only; no services or UAT ports.

## Plan / Todo (lot-based)
- [x] Lot 0: rules, source and frozen protocol inspected.
- [ ] Lot 1: import production extraction; freeze source and request fingerprints before calls.
- [ ] Lot 2: run 100 documents, concurrency 10, quota guard and sealed blind responses.
- [ ] Lot 3: score with frozen matcher; publish Wilson bounds, tuning misses and baseline comparison.
- [ ] Lot 4: validate aggregates, commit, push and open draft PR; no merge.
