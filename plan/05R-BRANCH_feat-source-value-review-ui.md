# Feature: Source value review UI

## Objective
Turn the BR05 source spikes into a decision-support UI for the client proposal:
evaluate each source by business value, technical/access complexity, estimated
cost, weak-signal usefulness, false-positive control, and concrete evidence
aligned with `VISION.md`.

## Scope / Guardrails
- Scope limited to source-value review documentation, static evaluation data,
  and a Svelte UI review surface.
- No production source adapter ships in this branch.
- No paid data, credentials, private datasets, or scraped samples are committed.
- All examples must reference real public pages, public datasets, or spike
  evidence already identified in BR05.
- Recommendations must use the triad `fait` / `a faire (reco)` / `attendus`
  where `attendus` means potential client-side inputs, access decisions, or
  confirmations strictly aligned with `VISION.md`.
- Subscription and access costs are treated as first-class complexity drivers.
- The review loop is visual: UAT must expose the screen locally and expect
  correction passes after user review.
- Make-only workflow, no direct Docker/npm/node commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT
  (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local isolated worktree
  `./tmp/feat-source-value-review-ui`; never use system `/tmp`.
- Automated test campaigns use `ENV=test-source-value-review`, never `dev`.
- UAT uses dedicated ports and does not stop the existing BR03 demo UAT.
- In every `make` command, `ENV=<env>` is the last argument.
- All new Markdown/spec text is English. UI display text may be French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/05R-BRANCH_feat-source-value-review-ui.md`
  - `PLAN.md`
  - `docs/spec/SPEC_INTENT_SOURCE_VALUE_REVIEW.md`
  - `docs/spec/SPEC_EVOL_SOURCE_VALUE_REVIEW.md`
  - `ui/src/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` except this file
  - `docs/spec/input/**`
  - production source adapters outside `_spikes/**`
  - `api/**`
  - `packages/radar-domain/**`
- **Conditional Paths**:
  - `packages/radar-sources/src/sources/_spikes/**` only if a factual source
    note needs correction; do not rewrite BR05 wholesale.
  - `package.json`, `package-lock.json`, `ui/package.json` only if a UI library
    is strictly required. Prefer existing Svelte + lucide dependencies.
- **Exception process**: declare reason, impact, and rollback here before
  touching any conditional path.

## Feedback Loop
No exceptions declared at branch start.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + visual UAT loop**
- [ ] **Multi-branch**
- Rationale: the value model, static data, and UI are one reviewable surface.
  Corrections are expected from visual review and should stay on one branch.

## UAT Management
- UAT target:
  `make dev API_PORT=8806 UI_PORT=5306 MAILDEV_UI_PORT=1106 POSTGRES_HOST_PORT=5536 S3_HOST_PORT=9106 S3_CONSOLE_HOST_PORT=9107 OBSCURA_HOST_PORT=9326 MAILDEV_SMTP_HOST_PORT=1026 ENV=feat-source-value-review`
- UAT URL: `http://localhost:5306`.
- Review expectation: user looks at the source-review screen, asks for copy,
  layout, scoring, and recommendation corrections, then the branch iterates.
- Existing BR03 screenshot environment on `UI_PORT=5304` must remain running.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline, intent, and branch planning**
  - [x] Read `rules/MASTER.md`, `rules/sources.md`, `VISION.md`, and
    `PROCESS.md`.
  - [x] Create isolated repository-local worktree
    `./tmp/feat-source-value-review-ui`.
  - [x] Confirm `tmp/` is ignored.
  - [x] Insert this branch into `PLAN.md` between BR05 and BR06.
  - [x] Capture user intent in `SPEC_INTENT_SOURCE_VALUE_REVIEW.md`.
  - [x] Draft `SPEC_EVOL_SOURCE_VALUE_REVIEW.md` for the source value model.

- [x] **Lot 1 — Evaluation model and data**
  - [x] Create typed static evaluation data for the 34 BR05 sources.
  - [x] Include estimated subscription/access cost category and cost notes.
  - [x] Include `fait`, `a faire (reco)`, and `attendus` for each source.
  - [x] Include contradiction notes: case for value, case against/noise.
  - [x] Add unit tests for quadrant placement, access-priority extraction, and
    VISION-aligned recommendation completeness.
  - [x] Lot gate: `make test-ui SCOPE=src/lib/source-review/source-evaluation-data.test.ts ENV=test-source-value-review`.

- [x] **Lot 2 — Source-review UI**
  - [x] Add a source-review screen reachable from the Svelte app.
  - [x] Render evaluation criteria with hover explanations for acronyms.
  - [x] Render a 2x2 quadrant: value potential vs complexity including costs.
  - [x] Render recommendations next to the quadrant using
    `fait` / `a faire (reco)` / `attendus`.
  - [x] Render clickable deep dive by source with real concrete evidence links.
  - [x] Keep layout dense, review-oriented, and responsive.
  - [x] Lot gate: `make typecheck ENV=test-source-value-review`,
    `make lint ENV=test-source-value-review`, and
    `make build ENV=test-source-value-review`.

- [x] **Lot 3 — Contradictory audit pass**
  - [x] Run source-family audits that challenge value, access, cost, and legal
    assumptions.
  - [x] Add corrections to the data/spec where the audit changes a decision.
  - [x] Explicitly qualify YouTube as early-signal source, including
    API/captions/transcription cost paths.
  - [x] Explicitly qualify paid/partner access priorities: JLR, Registre
    foncier, Centris/MLS, Cadastre/Infolot, permit feeds.
  - [x] Lot gate: `git diff --check`.

- [ ] **Lot 4 — Visual UAT**
  - [x] Start the branch stack on `UI_PORT=5306`.
  - [x] Verify the UI loads at `http://localhost:5306`.
  - [ ] Capture desktop and mobile screenshots.
  - [ ] Apply user corrections from screen review (UAT round 1 —
    see SPEC_EVOL §6):
    - [ ] UAT1-01 visual quality polish (impeccable check).
    - [ ] UAT1-02 inline acronym tooltips on the word + dotted underline +
      bottom glossary recap.
    - [ ] UAT1-03 all user-facing copy in French (bilingual deferred).
      (glossary/criteria definitions translated; other components pending.)
    - [x] UAT1-04 reference links inside each acronym description
      (glossary tooltips now show clickable official-source links).
    - [ ] UAT1-05 1→5 rubric per axis + VISION traceability + per-score
      rubric-meaning and justification (sentropic matrix model).
    - [ ] UAT1-06 real insights/findings per source as proof of value.
  - [ ] Lot gate: `make test-ui ENV=test-source-value-review` and
    `make build ENV=test-source-value-review`.

- [ ] **Lot 5 — PR and close**
  - [ ] Push branch.
  - [ ] Open PR with UAT URL, screenshots, and validation.
  - [ ] Verify CI green.
  - [ ] Merge via merge commit only after visual review acceptance.
  - [ ] Preserve source branch.
  - [ ] Move this file to `plan/done/05R-BRANCH_feat-source-value-review-ui.md`.
