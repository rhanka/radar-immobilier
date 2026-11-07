# Feature: Classification pilot L1–L2 — Engram profile, guide G0, convergence passes

## Objective
Lots L1 and L2 of the Steve-aligned classification pilot (plan-pilote-v2 §B-L1, §B-L2): steve-classification profile on Engram 0.21.2 unchanged, guide G0, convergence of the 3 max-effort annotators on the 504 dev items.

## Scope / Guardrails
- Scope limited to `tools/classif/**`, `radar/ontology/steve-classification/**` and this branch file.
- No DB, cluster or S3 write; Engram unchanged (0.21.2); 0 Python; private outputs in `$CLASSIF_HOME`.
- Annotators and optimisers never see the sealed evaluation set; Steve's text stays private (pack in `$CLASSIF_HOME`).
- Long runs under `systemd-run --user --slice=h2a-agents.slice`, 2 concurrent calls per seat, paid calls never repeated.
- In every `make` command, `ENV=<env>` is the last argument. All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `tools/classif/**`
  - `radar/ontology/steve-classification/**`
  - `plan/CLASSIFL1L2-BRANCH_feat-classif-pilot-l1l2.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `docs/spec/reports/reference-c/**`, `docs/spec/reports/classif-eval/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `radar/ontology/ontology-profile.yaml` (not touched)
- **Exception process**:
  - Inherits BRCLASSIF-EX1/EX2/EX3 from feat/classif-pilot-l0 (host Node, Makefile include, node:24 container).

## Feedback Loop
- `attention` Engram 0.21.2 `validate-extraction` does not load registry records (CLI passes the profile only): unknown codes are rejected radar-side with the same rule.
- `attention` Machine crashes: G0 attempts killed twice, Engram deps volume emptied once; resume state and revalidation added, no paid call repeated.
- `attention` Argon seat quota denials: lots re-called after the announced reset (no paid call lost).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one builder, sequential lots.

## UAT Management (in orchestration context)
- No UI surface: no UAT.

## Plan / Todo (lot-based)
- [x] **Lot L1 — Profile and guide**
  - [x] `radar/ontology/steve-classification/` (engram.yaml, profile.yaml, registries) + codebook export checked against the migration.
  - [x] Engram validate → dataprep (504 items) → profile-prompt (`make classif-l1-profile ENV=preprod`).
  - [x] Guide G0 by one isolated Opus 5.5 max session (`make classif-l1-guide ENV=preprod`).
  - [x] L0 open points: agy prompt on stdin, per-effort vibe homes (GLM low, Mistral medium verified).
- [x] **Lot L2 — Convergence passes**
  - [x] Annotation circuit through Engram, passes, convergence, complements, amendment, resumable chain.
  - [x] Pass 1: 3 × 159 calls; stop rule met (α verdict 0.773, α code 0.754, verdict unanimity 84.7 %).
- [x] **Lot L3 — Dev reference (0 LLM call)**
  - [x] `make classif-l3-reference ENV=preprod`: model_consensus reference, dev-core 386 / dev-ambiguous 118, PV acts 104/120 (republished passe 4: 105 was the stale pre-`found`-check value), ref-uses-external = 0, hashes of dev and sealed test.
  - [x] Low-Pertinent analysis (5 P / 504) with two options for the L4 dev objective.
  - [x] Fingerprint refusal audit (`make classif-l2-fingerprint-audit ENV=preprod`): bylaw-number list causes 29/30.
  - [ ] Track event before L4 (conductor, single track writer).
- [ ] **Lot L4-GEPA — GEPA prompt optimiser (owner-validated method)**
  - [x] Seats `sol-6.1-low` and `luna-6-low` (isolated codex route), run-scoped call cap in `lib/budget.mjs`.
  - [x] GEPA loop on the tuning half only (`make classif-l4-gepa SERIES=k MAX_CALLS=5000 ENV=preprod`), fake-seat tests.
  - [x] GEPA dev and blind verdict (0 miss per route, call failures <= 5 %) for series marked `method: gepa`.
  - [x] CI lint of `tools/classif` (unused variables, explicit `node:` imports).
  - [x] GEPA review fixes: tool events fail closed (dev, blind, S113, GEPA), codex cwd outside `$CLASSIF_HOME`, answer vs infra failures, final over every eligible candidate, codex home prepared once.
  - [x] GEPA re-review fixes: child rejected only at +2 failures vs its parent (5 % ceiling on D_pareto and on the final), child tool events reject and consume it, seat dir cleanup, seat env without `$CLASSIF_HOME`, codex seat homes in `~/.local/share/radar-classif-seats/<seat>`, S113 item id.
  - [x] Codex seat auth refresh: `make classif-seat-auth-refresh SEAT=<seat> ENV=preprod` copies `~/.codex/auth.json` atomically into the seat home (after a new codex login, or when a run stops on authentication errors), then resume the stopped run with the command named in the stop message.
  - [x] GEPA re-review 2 fixes: no breaker on retries nor on tool events outside a child, breaker over the whole batch, retries bounded to 2 per (candidate, route, case), parent tool events skip the iteration, child evaluation stops at its first tool event, vibe tool calls fail closed.
  - [x] GEPA re-review 3 fixes: a resumed run reserves only the uncached final calls (a stop during the final choice resumes under the same MAX_CALLS), bounded 402/429/quota backoff (`QUOTA_BACKOFF_MS`, default 30 s, 2 min, 5 min) before a failure counts, hermetic temp repos removed.
  - [x] GEPA re-review 4 fixes: a quota retry only uses budget beyond the reserved calls not yet launched (MAX_CALLS held), quota detection from stderr and the CLI error envelope only, a vibe `--max-price` stop is an answer failure without retry.
  - [x] Owner decision (« on prend sol pas luna »): GEPA routes = opus-5.5-low, glm-5.3-low, sol-6.1-low, mistral-large-4-low (luna-6-low stays a seat); a seat binary absent from PATH stops the run at its first call; a resume keeps the cache across the route change (the context sha does not cover the routes).
  - [x] ChatGPT quota guard of the codex seats (shared with the production immo detection): rate_limits logged per codex call (`quotaUsedPercent`, `quotaResetsAt`), dev, blind and GEPA stop launching codex calls at `CODEX_QUOTA_PAUSE` (default 85 %) or on a reached rate limit, with the exact resume; `make classif-quota-status ENV=preprod` shows the last measurement per seat.
  - [x] Quota source fixed after a real call: codex writes `rate_limits` only to its session file — the codex seats run without `--ephemeral`, callSeat reads the session file (rate_limits keys only) then deletes it in a finally; the "Code Mode is unavailable" error item is benign.
  - [ ] Real GEPA run, freeze of the winner and pre-registration of the GEPA series (conductor, paid calls).

- [x] **Gate**
  - [x] `make classif-check ENV=preprod` + `make classif-test ENV=preprod` (46/46, passe 4).
  - [x] Push branch (no PR).
