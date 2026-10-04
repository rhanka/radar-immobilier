# Extension plan — from 121 items toward ~600 (proposal only, NOT executed)

## Target and why
- The previous extraction oracle (oracle E, v3) holds **674 units over 100 documents in 100
  municipalities** (sampled from 536 eligible documents in 225 municipalities, stratified by size
  terciles; `docs/reports/benchmark-v101b-2026-09-17.md` lines 26-28 and 115; 676 units in the
  uncommitted local copy used by v11alpha). The draft oracle C holds **121 items in 51
  municipalities**, i.e. ~60 per half.
- Precision of a measured accuracy around 70 % (95 % Wilson half-width): n = 60 → ±11.3 pts;
  n = 121 → ±8.0; n = 300 → ±5.2; n = 600 → ±3.7. Today a 10-point gap between two models on
  blind is not distinguishable from noise. ~600 items (≈300 blind) is the size at which a 5-point
  gap becomes readable.

## Sources of additional items (in order of label quality)
| # | Source | Items (estimate) | Label available today | Work to reach Steve-grade labels |
|---|---|---:|---|---|
| S1 | Steve's next 52 municipalities, same three-pass method (announced in his analysis §7) | ~120-150 (his first 51 cities gave 124 lines) | none yet | Steve triages as before: verdict + motif. **Reserved as blind v2** |
| S2 | Sheet "Écartés par les filtres" of the same workbook | 121 rows (some grouped) | filter verdict (102 "écarté à raison", 3 "écarté à tort"…), no P/S/N code | map rows to nodes; derive N for "écarté à raison" only after Steve confirms a motif per family; regroup aggregated rows |
| S3 | Radar graph nodes (Signal / DesignationEvent) of the 103 municipalities of his view, not triaged | several hundred (`non vérifié`) | none | model pre-label + human validation (below) |
| S4 | Signals bridged to the 100 documents of oracle E (`docRefs.docSha` → unit) | `non vérifié` (intersection with Steve's set judged small in the dossier) | extraction unit only | pre-label + validation; gives an E↔C bridge on a common corpus |
| S5 | Synthetic hard cases derived from optim items only (verb flips "afin de permettre" ↔ "afin d'interdire", mixed bylaws, agenda-only wording, single-lot PPCMOI vs zone-wide change) | 60-100 | generated label by construction | Steve validates each; tagged `synthetic`, **never in blind**, scored in a separate column |

Order of magnitude: S1 150 + S2 ~100 + S3 ~200 + S5 ~80 + current 121 ≈ 650; S4 adds a bridge.

## Annotation "à la Steve"
1. **Codebook frozen first**: the 28 motif codes of his workbook, his three cumulative criteria,
   the five exclusions and the asymmetry reserve; plus the motif-code → criteria derivation table
   the dossier asks Steve to review (D8). Version the codebook (`codebook-c-v1`).
2. **Pre-labelling by models** (S2, S3, S4, S5 only): three families (Astra, Opus, Gemini) at high
   effort with the frozen prompt, each blind to the others, as in oracle E (independent passes,
   then a vote with a mandatory reason).
3. **Human validation**:
   - Steve (or Mathieu, on Steve's codebook, with Steve arbitrating) validates: every item where
     the models disagree, every model-"Pertinent", every model-"Non pertinent" whose motif is an
     exclusion (V2-PRECEDENT, N-ODJ-SEUL, N-RESTRICTIF), and a 20 % random sample of unanimous
     items to measure model-vs-human error on the "easy" part.
   - The validator sees the radar record, not the model verdicts first (verdicts revealed after a
     first human call) to limit anchoring; time per item recorded.
   - Disagreement validator ↔ Steve → Steve decides; unresolved → `non résolu`, excluded from scoring
     (oracle E rule).
4. **S1 is annotated by Steve alone, without model pre-labels**: it is the next blind set, so no
   model output may touch it before scoring.

## Leakage controls
- Partition unit stays the **municipality**; a municipality in any blind set is never used in
  optim, in prompt examples, in synthetic derivation or in pre-label calibration.
- Blind v1 (61 items, this draft) stays frozen and is reported as-is; it is not re-used to tune.
- Blind v2 = S1 (Steve's next 52 municipalities). Steve's survey method biases toward what the
  screen showed; S3 items (not shown) are therefore split 50/50 by municipality too, to measure the
  "never shown" population (the seven missed dossiers of his analysis §4).
- Synthetic items derive from optim only, carry `synthetic: true`, never enter blind.
- Few-shot examples, if any, come only from optim and are listed by id in the prompt file.

## Freeze and version
- `oracle-ciblage-steve-v1` = this draft (121 items) once the owner accepts it; `v2` = v1 + S1-S5.
- Each version: manifest (items, sources, annotator per label, dates, codebook version), sha256 of
  every set file, partition table, excluded lines with reasons. Corrections create a new version,
  never an in-place edit; two arms are never compared on two different versions.
- Storage proposed by the dossier (§9.3): `oracle_releases` row + frozen JSON in the repo. Given the
  public repository, the frozen JSON may need a private location (D6).

## Effort and dependencies (estimates, `non vérifié`)
- Steve: S1 survey (comparable to his first survey), validation of ~150-250 pre-labelled items,
  review of the code → criteria table. Only Steve can produce S1; it gates blind v2.
- Team: mapping S2 rows to nodes, pre-label runs (seat quotas), adjudication tooling (the oracle E
  tooling can be reused: verify/vote/arbitrate steps, receipts with input/response sha256).
- Dependencies: D8 (contradictory cases), D10 (oracle design), D6 (where the frozen sets may live).
