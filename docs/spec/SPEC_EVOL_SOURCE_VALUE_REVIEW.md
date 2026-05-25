# SPEC_EVOL — Source Value Review `radar-immobilier`

> **Status**: EVOL, opened for BR05R `feat/source-value-review-ui`.
> **Predecessor**: `SPEC_EVOL_SOURCE_FEASIBILITY.md`.
> **Initial date**: 2026-05-25

## Status Updates

- **2026-05-25**: BR05R opened to turn source feasibility into a value-driven
  proposal and review UI. This branch does not change source adapters; it
  evaluates source value, cost/access friction, anti-false-positive utility,
  and client expectations.
- **2026-05-25**: initial typed evaluation dataset covers all 34 BR05 sources,
  including value/complexity scoring, access/cost categories, contradiction
  notes, concrete evidence links, and the `fait` / `a faire (reco)` /
  `attendus` recommendation contract.
- **2026-05-25**: review UI added with criteria tooltips, a value/complexity
  quadrant, source deep dives, selected-source recommendations, and a separate
  challenge-agent presentation. Contradictory audits shifted the framing toward
  a low-cost public-source spine, with paid/partner sources treated as optional
  client-funded enrichments unless access is explicitly provided.

## 1. Goal

Create a reviewable source-evaluation UI and supporting value model for the 34
BR05 source spikes. The goal is to decide what to build, what to buy or
negotiate, what to validate manually, and what to defer in order to maximize
early proposal value aligned with `VISION.md`.

## 2. Evaluation Model

Each source receives a value profile:

| Dimension | Meaning |
| --------- | ------- |
| Weak-signal value | Ability to detect densification opportunities before the market. |
| Precision | Ability to identify a sector, address, lot, bylaw, dossier, or project. |
| Recall | Ability to avoid missing relevant variants across archives, PDFs, videos, and follow-up documents. |
| Anti-false-positive value | Ability to reject, downgrade, or qualify over-optimistic signals. |
| Historical learning value | Ability to reconstruct past event chains and learn patterns. |
| Business value | Aggregated proposal value for the client vision. |
| Complexity | Technical effort plus access friction, legal risk, and cost. |
| Access/cost | Public/free, API, account, paid, partner, manual, or excluded. |

The UI quadrant uses:

- Y axis: business value potential.
- X axis: potential complexity, including subscription/access costs.

The challenge-agent view adds a proposal-control layer. It separates:

- observed feasibility from production connectors.
- source chains from isolated source scores.
- public/free Phase 1 proof paths from paid or partner-funded enrichment.
- pattern hypotheses from validated historical patterns.

## 3. Recommendation Contract

Every source deep dive must include:

- `fait`: what has already been observed, spiked, or validated.
- `a faire (reco)`: the recommended next implementation, access, or audit step.
- `attendus`: what the client may need to provide or decide, strictly aligned
  with the source's role in `VISION.md`.

## 4. Quadrant Decisions

The initial quadrant policy is:

| Quadrant | Meaning | Default action |
| -------- | ------- | -------------- |
| High value / Low complexity | Early proposal leverage. | Build or prototype now. |
| High value / High complexity | Potentially decisive but costly or risky. | Qualify access/cost now. |
| Low value / Low complexity | Cheap context. | Use only if it helps the demo narrative. |
| Low value / High complexity | Poor Phase 1 ROI. | Defer or drop. |

## 5. Visual Review Loop

The UI is intentionally a review surface. After the first UAT deployment, the
user is expected to inspect the screen and request corrections to:

- source placement.
- copy and labels.
- acronym explanations.
- cost/access assumptions.
- recommendation tone.
- concrete evidence examples.

The branch remains open until the screen is accepted for proposal use.

## 6. Post-UAT Correction Backlog (UAT round 1 — 2026-05-25)

Captured from the first visual UAT review. These are correction intentions for
the current branch version, to be applied in Lot 4 before the screen is
accepted. They do not change branch scope.

- **UAT1-01 — Visual quality**: the screen is visibly buggy at this stage
  (layout/overflow/contrast). A polish pass is required so the surface reads as
  a proposal-grade artifact, validated against `impeccable` anti-patterns.
- **UAT1-02 — Inline acronym tooltips**: every acronym occurrence anywhere on
  the page (including inside running text, not only the glossary) must carry a
  hover/focus tooltip on the word itself. Implement a single reusable inline
  component (e.g. `<Acronym>`); render with a subtle dotted underline. The
  bottom glossary remains as a full recap of all acronyms used on the page.
  Applies across the whole CPTAQ-facing presentation, per acronym item.
- **UAT1-03 — Full French**: all user-facing copy must be French at this stage
  (acronym explanations are currently English). Bilingual support is deferred to
  a later branch; do not build the i18n layer here, just ship French copy.
- **UAT1-04 — Reference links in acronym descriptions**: each acronym definition
  must carry one or more authoritative reference links (official source pages).
- **UAT1-05 — Scored evaluation matrix with rationale + VISION traceability**:
  for every value/complexity axis, define a 1→5 rubric describing what each
  level means (e.g. "1/5 = faible … 5/5 = …"). This rationalization matrix must
  be discoverable in the UI (and persisted in the data model). Each per-source
  score must then display both (a) the standard rubric meaning for that level
  and (b) the source-specific justification for the assigned level — modeled on
  the sentropic evaluation matrices (`../sentropic` matrix UI/rubric). The
  rubric itself must be traceable to `docs/spec/input/VISION.md` (cite the
  vision section each axis serves).
- **UAT1-06 — Real insights as proof of "capacity to convince"**: for each data
  source, attach real findings/insights (behind a value axis or in the deep
  dive) with links and a description of each finding, as a demonstration of the
  source's value. When the source itself is not accessible, provide at minimum
  links that justify/demonstrate its quality.

### Cross-cutting finding (out of this branch's scope — flag only)

- **ENV/PORTS hygiene**: UAT currently runs on per-branch worktree ports
  (BR05R on `5306`, BR03 on `5304`, …), so the UAT URL changes every review and
  stale stacks linger. The sentropic model — UAT on the **root checkout** at
  **fixed dev ports** (data stable), worktrees reserved for test/branch ports
  only — is the target. `rules/MASTER.md` already states the principle ("root
  checkout reserved for dev/UAT, ENV=dev, must remain stable") but it is not
  operationalized (branch templates still define per-branch UAT ports; no fixed
  UAT port contract; no `make conductor-report`). Fixing this touches
  `rules/**`, `Makefile`, and `plan/BRANCH_TEMPLATE.md`, all forbidden here, so
  it must be handled on a dedicated chore branch, not in BR05R.
