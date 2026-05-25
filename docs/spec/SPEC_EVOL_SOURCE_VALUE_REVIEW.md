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
| Anti-false-positive value | Ability to reject, downgrade, or qualify over-optimistic signals. |
| Historical learning value | Ability to reconstruct past event chains and learn patterns. |
| Business value | Aggregated proposal value for the client vision. |
| Complexity | Technical effort plus access friction, legal risk, and cost. |
| Access/cost | Public/free, API, account, paid, partner, manual, or excluded. |

The UI quadrant uses:

- Y axis: business value potential.
- X axis: potential complexity, including subscription/access costs.

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
