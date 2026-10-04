# Adversarial review brief — draft oracle C

You are an adversarial reviewer. Your job is to find what is wrong, overstated, leaky or
unreproducible in this draft, not to approve it. Read-only: do not modify any file, do not run
any model, do not access any network or cluster.

## Context
The owner asked for a draft targeting oracle ("C": should this radar signal be shown to Steve, a
real-estate developer?) built from Steve's triage of 21 Sept 2026 (workbook, 124 lines, verdicts
Pertinent / À surveiller / Non pertinent + one motif code each). Requirements:
1. reproduce the previous oracle methodology (oracle E / v3: 674 units, 100 documents, 100 cities,
   multi-family consensus, frozen by sha256) but for targeting, from Steve's truth, files only;
2. a homogeneous 50/50 split optim / blind, stratified, balance checked and frozen BEFORE any prompt
   work; blind never used for optimisation, measured once at the end;
3. a first prompt prefiguring C, iterated only on optim;
4. alignment measured with Astra low, Claude Opus 5.5 low, Gemini low (seats only), metrics on optim
   per iteration and on blind once;
5. inputs = what each triage line refers to, read-only; unresolvable lines excluded transparently;
6. an extension plan toward ~600 items annotated "à la Steve" (proposal only).

## Material (current directory = docs/reviews/oracle-c-draft/)
- `README.md`, `split-balance.md`, `split-manifest.json`, `SHA256SUMS`
- `prompt-c-v1.md`, `prompt-c-v2.md`, `selection-rule.md`, `final-prompt.json`
- `results.md`, `results/*.json`, `extension-plan.md`
- `scripts/*.mjs`, `scripts/lib/*.mjs`
- `optim.jsonl` (you may read it). `blind.jsonl`: you may hash it or check ids/cities, but do NOT
  use its labels to suggest prompt changes.
- Commit order: `git log --format='%h %ad %s' --date=iso -- .` (prompt v1/v2 and the selection rule
  were committed before the v2 run; `final-prompt.json` before the blind run).

## What to check (at least)
1. Leakage: can any of Steve's judgement reach the model input (columns, codes, wording in the
   prompt, examples, city lists)? Is the city-level partition sound? Is the prompt's v2 content
   traceable to general rules, or tuned to specific optim lines?
2. Split: is the balance search + coin flip honest? Are the strata the right ones? Is the chi-square
   use correct and are its limits stated?
3. Metrics: correct definitions (noise, Pertinent kept, post-filter on B), any bug in
   `06-score.mjs`, treatment of invalid answers, B baseline construction.
4. Claims: does every number in `results.md` match `results/*.json`? Any overstatement (model
   ranking, significance, "reproduces Steve")? Missing limits?
5. Methodology gap vs oracle E (single annotator, no consensus, no unresolved bucket, one run per
   model, low effort only, model routes vs the previous benchmark).
6. Extension plan: feasibility, leakage controls, sizing arithmetic, anchoring bias, who annotates.
7. Seat-only / no-API-key guarantee in `scripts/lib/models.mjs`; read-only guarantee in
   `scripts/02-fetch-nodes.mjs`.

## Output (Markdown, English)
1. Verdict: ACCEPT / ACCEPT WITH CHANGES / REJECT, one line.
2. Findings table: id, severity (blocker / major / minor), file:line or section, finding, proposed fix.
3. Anything you could not verify, marked `unverified`.
Be specific and terse. No praise section.
