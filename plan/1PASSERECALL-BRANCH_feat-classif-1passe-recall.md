# Immediate single-pass recall against B

## Objective
- [ ] Measure detection, visible and P∪S recall against the corrected 676-act B oracle.
- [x] Owner decision, 13 November: production single pass = GPT-6 Astra low + P0 extended to extraction.

## Scope / Guardrails
- [x] Dedicated branch feat/classif-1passe-recall, based on feat/classif-1passe-bc; direction i-cond.
- [x] No .env, Python, trailers or merge. No services, ports or UAT.
- [x] Other lane worktree untouched. Private 1passe-bc strictly read-only.
- [x] Private writes only under 1passe-recall. Blind results REFC1; aggregates only.
- [x] 100 full PV, concurrency 10, one Astra low call per PV. No invalid-response retries.
- [x] Weekly Codex quota before, every 10 minutes, after. Stop new launches at 90%.
- [x] This owner-authorized immediate B measurement is separate from D3 and final C qualification.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: tools/classif/1passe/recall/**, this plan.
- [x] Forbidden Paths: other plans, root Makefile, rules, API, other lane worktree and private files.
- [x] Conditional Paths: none.

## Feedback Loop
- [x] BRRECALL-EX1: French report and trailer-free commits per owner. Rollback: remove lane files.
- [x] BRRECALL-EX2: standalone make without includes or .env; native Node built-ins for seat orchestration, inherited BR1PASSE-EX3. Rollback: remove dispatcher.
- [x] BRRECALL-EX3: immutable prompt copy may exceed 150 lines in its own commit; preserve exact classification bytes and traceability. Rollback: remove prompt copy.
- [x] Correct support: 676, not historical 672; 372 tuning, 304 blind. Neutral 43 kept separate.
- [x] PR #1099 prompt body reused. Output extension changes chunk/graph to whole-PV/flat detection acts.

## Orchestration Mode (AI-selected)
- [x] One dispatcher, ten concurrent CLI calls. No optimizer, no dependence on D3.

## UAT Management (in orchestration context)
- [x] No application behavior change; no UAT.

## Plan / Todo (lot-based)
- [x] Freeze prompt, source comparison and metrics before calls; commits 4b9cd7958 and 806ab7041.
- [ ] Execute 100 PV, seal blind outputs, record quotas and usage.
- [ ] Score three recalls by half and total; Wilson lower bounds; inspect tuning misses only.
- [ ] Compare current B arm and cost, or explicitly report missing source.
- [ ] Document later C recalculation target; commit aggregates, push, draft PR; no merge.
