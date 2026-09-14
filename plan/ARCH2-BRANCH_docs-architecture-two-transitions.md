# Documentation: Two dated architecture transitions

## Objective
- [ ] Specify two independent before/after pairs for the Focus dossier and report; hand off the exact design HEAD for two adversarial reviews before implementation.

## Scope / Guardrails
- [x] Worktree: `tmp/architecture-two-transitions`; branch: `docs/architecture-two-transitions`; base: `4d5cb8f7f5e7934196b57e29305fec37813bf7a9`.
- [x] Design only: no Focus implementation, generated report, provider call, deployment, data mutation or cost/window change.
- [x] Make-only and Docker-first; commands end in `ENV=test-architecture-two-transitions`; no stack or ports allocated in this design phase.
- [x] Preserve root dev/UAT and all unrelated work; English artifacts, French discussion.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**: `docs/spec/SPEC_EVOL_ARCHITECTURE_TWO_TRANSITIONS.md`, `plan/ARCH2-BRANCH_docs-architecture-two-transitions.md`.
- [x] **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.track/**`, other plans, implementation and generated artifacts.
- [x] **Conditional Paths**: Focus/report implementation requires a later reviewed scope amendment with exact paths, impact and rollback; no such release is claimed here.
- [x] Cross-repository sources are read-only; no Geo or poc-k8s write is authorized by this plan.

## Feedback Loop
- [x] ARCH2-EX1: the owner requires spec+plan commits only; the conductor retains Track import/write ownership. Harness recorder output is execution evidence, not a persisted Track event.
- [x] The installed harness recorder emits a placeholder `1970-01-01` timestamp; it is not a historical observation timestamp.
- [ ] Reconcile two independent reviews at the handed-off HEAD; preserve unresolved disagreements and owner decisions.
- [x] Owner amendment before review: TEM visible in all four graphs, exact `Navigateur utilisateur` label, roughly half-height cards and double-size visible type; numeric Chromium/PDF acceptance specified without implementation.

## Orchestration Mode (AI-selected)
- [x] One isolated documentation branch; no cherry-pick, delegated implementation or parallel writer.
- [x] Conductor dispatches two independent adversarial reviews after the initial design handoff.

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
- [ ] Conductor: import the reviewed plan into Track, release bounded implementation lots, then run required Focus mapping/browser/clipboard/report checks without changing billing.
- [ ] Later close: consolidate reviewed EVOL, push/open PR, verify CI, merge commit only and preserve branch; no merge authorization is inferred from this design handoff.
