# SPEC_INTENT — Source Value Review `radar-immobilier`

> **Status**: INTENT, opened for BR05R `feat/source-value-review-ui`.
> **Inputs**: `docs/spec/input/VISION.md`, `docs/spec/input/PROCESS.md`, and
> BR05 source spikes.
> **Initial date**: 2026-05-25

## 1. User Intent

The source evaluation must be framed by the client vision, not by connector
feasibility alone. The client wants a radar that detects weak municipal and
market signals for residential densification before the opportunity becomes
obvious to the market.

The source review must therefore evaluate two dimensions for each source:

- technical feasibility, including access method, complexity, legal risk, and
  estimated subscription/access costs.
- business value, including weak-signal value, false-positive reduction,
  historical learning potential, and ability to support a proposal aligned with
  `VISION.md`.

The review must also consider cumulative value: some sources create alerts,
some add precision, some prevent false positives, and some help learn from past
patterns such as zoning changes followed by real estate projects.

## 2. Proposal Context

This deliverable supports a client proposal. It should help the client deliver
value aligned with the vision, and if possible exceed that value quickly, while
keeping costs low for both the client and Sentropic.

Recommendations must be practical and staged:

- what is already done (`fait`).
- what should be done next (`a faire (reco)`).
- what is expected from the client (`attendus`), such as access decisions,
  paid-provider approvals, municipal contacts, or validation of priorities.

## 3. UI Intent

The output must include a didactic UI that can be reviewed visually.

The UI must show:

- evaluation criteria, with hover explanations for acronyms and technical
  terms.
- a 2x2 quadrant for sources by value potential and potential complexity,
  where complexity includes technical complexity, access friction, legal risk,
  and subscription/access cost.
- recommendations beside the quadrant.
- clickable deep dives by source with concrete real examples from public pages,
  public datasets, or BR05 spike evidence. No fake data.

The review is expected to happen by looking at screens, then iterating on
layout, copy, source placement, and recommendations.

## 4. Required Evaluation Lenses

Each source should be evaluated for:

- weak-signal alert value.
- precision and recall contribution.
- false-positive control.
- historical learning value over at least two years where feasible.
- access modality: public stable access, public API, account, paid access,
  partner feed, manual due diligence, or excluded.
- estimated subscription/access cost category and cost notes.
- contradictory audit: argument for value and argument against value or against
  automation.

## 5. Access and Cost Focus

The review must explicitly qualify sources where paid, partner, or manual
access may unlock value:

- JLR.
- Registre foncier du Quebec.
- Centris/MLS.
- Cadastre/Infolot and official extracts.
- detailed permit feeds if not public.
- YouTube council videos, including API, captions, and transcription cost.

Grey/Obscura access must be framed carefully. Obscura is acceptable for
rendering, stability, and capture of public pages. It is not the preferred path
for bypassing paywalls, CAPTCHA, account restrictions, or terms-of-use
constraints.

## 6. Success Criteria

The branch succeeds when the user can open the UI, understand why each source
is placed where it is, see what is done/next/client-expected, and use the
screen as a proposal-support artifact.
