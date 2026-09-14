# Documentation: Two dated architecture transitions

## Objective
- [x] Specify two independent before/after pairs for the Focus dossier and report; reconcile two adversarial reviews before implementation.

## Scope / Guardrails
- [x] Worktree: `tmp/architecture-two-transitions`; branch: `docs/architecture-two-transitions`; base: `4d5cb8f7f5e7934196b57e29305fec37813bf7a9`.
- [x] Design phase completed before implementation release; no provider call, deployment, data mutation or cost/window change is authorized.
- [x] Make-only and Docker-first; commands end in `ENV=test-architecture-two-transitions`; no stack or ports allocated in this design phase.
- [x] Preserve root dev/UAT and all unrelated work; English artifacts, French discussion.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**: `docs/spec/SPEC_EVOL_ARCHITECTURE_TWO_TRANSITIONS.md`, `plan/ARCH2-BRANCH_docs-architecture-two-transitions.md`, `docs/spec/reviews/ARCHITECTURE_TWO_TRANSITIONS_*.md`, `docs/architecture.md`, `docs/architecture/focus/**`, `docs/architecture/decision-focus.html`, and `docs/reports/architecture-monthly/**`.
- [x] **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.track/**`, other plans, implementation and generated artifacts.
- [x] **Conditional Paths**: `docs/spec/reports/study-2026-08/report.pdf` is read-only attachment input at its pinned SHA-256; changing it is forbidden. Rollback removes the four-scene implementation commit and restores D8 artifacts without touching runtime or billing data.
- [x] Cross-repository sources are read-only; no Geo or poc-k8s write is authorized by this plan.

## Feedback Loop
- [x] ARCH2-EX1: the owner requires spec+plan commits only; the conductor retains Track import/write ownership. Harness recorder output is execution evidence, not a persisted Track event.
- [x] The installed harness recorder emits a placeholder `1970-01-01` timestamp; it is not a historical observation timestamp.
- [x] Reconcile two independent reviews at the handed-off HEAD; preserve unresolved disagreements and owner decisions. Cycle v6 consensus is `GO`.
- [x] Owner amendment before review: TEM visible in all four graphs, exact `Navigateur utilisateur` label, roughly half-height cards and double-size visible type; numeric Chromium/PDF acceptance specified without implementation.
- [x] Review 1 returned `CHANGES REQUIRED`: make Sonnet comparable with out-of-repo credential hygiene; classify Gemini no-output as non-result; make pair-B corpus/graph provider-neutral; qualify history and source anchors. Amend the EVOL before new reviews.
- [x] Preserve the first post-amendment dispatch as incomplete: both headless reviewer processes exited after a started receipt without producing their assigned artifact. Re-dispatch under a separate dossier; do not treat the failed legs as reviews.
- [x] Preserve review cycle v2 as incomplete: the history/state launch produced no artifact; the decision/presentation leg completed with `CHANGES REQUIRED` on the exact report window and preceding-PDF attachment contract. Correct before a fresh review cycle.
- [x] Amend the EVOL with exact 35-day window, byte-identified preceding-PDF attachment, executable `architecture.md`/Focus/PDF parity and JSON-level no-output classification before review cycle v3.
- [x] Review cycle v3 completed with `CHANGES REQUIRED`: make August manifest relations uniformly declared; specify extractable PDF attachment proof; canonicalize topology parity; close the M1 attempt state machine; inventory every no-zoom metric. Correct all five before cycle v4.
- [x] Preserve cycle v4 as incomplete: history/state produced no artifact; decision/presentation required bijective M1 result linkage and rendered per-page predecessor parity. Correct both before cycle v5.
- [x] Amend the EVOL with a normative M1 schema/bijection and Poppler 26.01.0 per-page source/appendix image hashes before cycle v5.
- [x] Cycle v5 completed with `CHANGES REQUIRED`: classify every A-before node/edge; hash edge state; require one canonical candidate per exact M1 option; inventory edge geometry; fully specify provenance/label normalization. Correct all before cycle v6.

## Orchestration Mode (AI-selected)
- [x] One isolated documentation branch; no cherry-pick, delegated implementation or parallel writer.
- [x] Two independent adversarial reviews were dispatched and reconciled before implementation.

## UAT Management (in orchestration context)
- [x] No application UAT or root checkout switch for spec-only work.
- [ ] A later implementation must qualify the same HEAD in isolated browser checks before owner-facing UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0**: read rules and skills; open `harness branch init`, `harness brainstorm --peers 2 --ladder evol`, and `harness plan --lots 5` through Make/container execution.
- [x] **Lot 1**: freeze scope, dated evidence, decisions and rendering invariants in the EVOL; gate: selective diff and whitespace check.
- [x] **Lot 2**: specify four graph topologies and state qualifications; gate: author source-to-node/edge review, no projected production activation; peer review remains pending.
- [x] **Lot 3**: specify M1 options, evidence/judges and comment+JSON capture; gate: no invented measurements, no preselected winner.
- [x] **Lot 4**: prepare the immutable design HEAD for conductor dispatch to historical-correctness and product/decision-integrity reviewers; design acceptance remains pending reconciliation.
  - [x] Harness scope check passed for the two changed paths; whitespace check passed; no application test or browser validation claimed for this spec-only phase.
  - [x] Amend spec/graph contracts for transverse TEM and compact/readable rendering; preserve review-pending status and unchanged billing/window.
- [ ] Later visual gate: check all four Mermaid/SvelteFlow/PDF views, exact user label, retained TEM, 120–156 px cards, rendered title/body/status minima, blank-space limits and Chromium screenshots/metrics at normal zoom; do not claim these passed during design.
- [ ] **Lot 5**: commit the reviewed spec/review records and authoritative four-scene `architecture.md`; gate canonical scene/source inventory.
- [ ] **Lot 6**: implement exhaustive metadata, canonical hashes and M1 JSON Schema/invalid fixtures; gate mapping/nesting/provenance/schema tests.
- [ ] **Lot 7**: render four native SvelteFlow and four Mermaid views with compact readable nodes; gate Chromium 1440×1000 and 1920×1080 at zoom 100%.
- [ ] **Lot 8**: update the 10 August–13 September report, append and embed the pinned preceding PDF, and bind four graph pages; gate manifest/PDF/page parity.
- [ ] **Lot 9**: run full Focus build, browser, clipboard and report checks; inspect screenshots/PDF pages; update the lane report.
- [ ] Conductor: import the reviewed plan into Track without changing billing.
- [ ] Later close: consolidate reviewed EVOL, push/open PR, verify CI, merge commit only and preserve branch; no merge authorization is inferred from this design handoff.
