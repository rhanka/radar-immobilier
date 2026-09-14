---
status: completed
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v3
target-diff-sha256: a6a8ba3ed6ab7fd6aacf24065e32949761b333aacf169f5dbcef775dc24739f2
legs:
  - path: docs/spec/reviews/ARCHITECTURE_TWO_TRANSITIONS_history-state-v3.md
    status: completed
  - path: docs/spec/reviews/ARCHITECTURE_TWO_TRANSITIONS_decision-presentation-v3.md
    status: completed
consensus-verdict: CHANGES REQUIRED
---

# Architecture two transitions — adversarial consensus v3

Both replacement legs review the same amended EVOL and plan and remain blind
to one another until reconciliation. Earlier incomplete dossiers stay preserved.

## Reconciliation

Both completed legs accept the four original owner corrections and the exact
report window/preceding-PDF requirement. Their findings are complementary and
accepted:

- August manifest-only storage/image relations must all remain `declared`.
- PDF attachment equality needs extraction and source-hash comparison, distinct
  from visually appended pages.
- Scene parity needs one canonical node/edge/parent projection, not copied source
  hashes.
- M1 needs a finite attempt state machine and one-to-one output/result linkage.
- No-zoom acceptance must inventory every required node/text role in all four
  scenes and bind full-scene/PDF captures to those measurements.

Consensus verdict: **CHANGES REQUIRED**. All five findings are addressed in the
next target before review cycle v4; implementation remains gated.
