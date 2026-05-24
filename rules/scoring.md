---
description: "Scoring transparency and evidence policy specific to radar-immobilier"
paths: ["packages/radar-scoring/**", "api/src/services/scoring/**"]
tags: [scoring]
---

# Scoring

## Source of weights

From `docs/spec/input/PROCESS.md` §3:

| Critère | Poids | Lecture opérationnelle |
|---------|-------|------------------------|
| Potentiel réglementaire | 30 % | Usages, densité, exceptions possibles, alignement avec intentions municipales |
| Risque de contrainte    | 20 % | CPTAQ, inondation, hydrographie, servitudes, contamination, blocages |
| Timing                  | 20 % | Avis publics, PPCMOI, consultations, investissements publics, fenêtres |
| Faisabilité foncière    | 15 % | Forme du lot, accès, superficie, assemblage, propriétaire, morcellement |
| Valeur marché           | 15 % | Comparables, permis, absorption, rareté, écart valeur municipale / projetée |

The five weights must always sum to 100. Adjusting them is a deliberate decision that requires a `SPEC_EVOL_SCORING.md` update.

## Evidence requirement

- Every `score` row in Postgres carries an `evidence jsonb` field.
- The evidence must reference: source document (S3 key + page if PDF), excerpt (≤ 500 chars), extraction confidence (0–1), timestamp.
- A score without evidence is invalid and is downgraded automatically to "surveillance" status.

## Score scale

- Per criterion: 0–5 (matches PROCESS.md §6 "Attribuer un score de 0 à 5 par critère").
- Aggregate radar score: `sum(weight_i × score_i)` → 0–500 → normalized to 0–100.
- A radar score ≥ 70 with high evidence confidence triggers "qualifier avec expert" recommendation.

## Decision rules (from PROCESS.md §3)

- A lot becomes a "perle rare candidate" when it combines a high potentiel score, a qualifiable risque, and a timing still invisible to the market.
- A high score without recent evidence is downgraded to "surveillance".
- The radar produces a decision: `reject` / `watch` / `qualify_with_expert` / `approach_owner` / `acquisition_dossier`.

## Auditability

- The scorer must produce the score AND the rationale in the same transaction.
- The UI must display the score breakdown criterion by criterion, with the evidence excerpt and the source link.
- No "magic" score: if a value cannot be justified by extracted evidence, it MUST default to 0 with confidence 0.
