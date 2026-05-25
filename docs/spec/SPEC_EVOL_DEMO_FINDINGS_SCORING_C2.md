# C2 Independent Scoring — Valleyfield Densification (Codex GPT-5.5 xhigh, isolated)

> **Evaluator stance**: independent, neutral. SAME frozen reference set (R1–R11) and SAME M1–M7
> calibration used for H1/A2/G2 in
> `feat-demo-findings-valleyfield/docs/spec/SPEC_EVOL_DEMO_FINDINGS_SCORING.md`.
> C2 = `tmp/iso-vf-codex2/report.md` (automated, isolated, PTY/tmux re-run; the earlier codex run
> that produced no report is superseded by this completed one).
> Claims cross-checked against the frozen reference AND against C2's own run log
> (`codex-run.log`) to confirm each figure was actually fetched/parsed, not invented.

---

## (b) Scoring row (0–5 each; total /35)

| Track | M1 Signal cov. | M2 Reg. precision | M3 Traceability | M4 Honesty | M5 Actionable spec. | M6 FP control | M7 Vision weighting | **Total** |
|---|---|---|---|---|---|---|---|---|
| **A2** (web-only) | 5 | 5 | 5 | 5 | 4 | 5 | 5 | **34** |
| **H1** (human) | 5 | 5 | 4 | 5 | 3 | 4 | 4 | **30** |
| **C2** (codex, this run) | 3 | 5 | 5 | 5 | 5 | 4 | 4 | **31** |
| **G2** (isolated) | 2 | 2 | 2 | 1 | 4 | 2 | 2 | **14** |

### Per-metric justification (C2)

**M1 — Densification-signal coverage = 3.**
Captures the core zoning-amendment story well: 150-49 (+150-49-1/-2) with the boisé-conservation
density mechanism, and 150-51 with its residential zones (U-521→H-521, C-566, H-535, H-627-2,
H-561). **But misses entirely**: all 6 PPCMOI files (R6), PPCMOI 2024-0023/H-656 (R7), Quartier V
~360 units (R8), the 100 affordable seniors units (R9), the city densification doctrine / density
poles (R10), and Plan 450 (R1). It also drops 150-50 (R4) — defensible for a residential-only
mission, but combined with the PPCMOI/Quartier-V omissions the coverage is materially narrower than
A2/H1 (both 5). Not as low as G2 (2), because everything C2 *does* cover is real and central.

**M2 — Regulatory precision = 5.**
Every figure verified against the fetched official PDFs in the run log: base 0,5 log/ha; H-143-1 &
H-148-1 = 2 log/ha @55 % / 15 log/ha @70 %; H-143 & H-609-4 = 50 log/ha @30 % (run log 5604–5964,
9127) — matches R3 verbatim and is correctly mapped *per zone* (more granular than the reference,
which lumped the thresholds). Dates are correct and in places **more precise than the frozen
reference**: the city notice "**REPORTÉE AU LUNDI 23 MARS** … 150-49 et 150-50" (run log 3174/8778)
and the second-project avis "consultation tenue le 23 mars 2026 … adopté à la séance du 24 mars
2026" (run log 9107–9108) confirm C2's "consultation 11 Mar → reportée 23 Mar; 2e projet 24 Mar";
150-49-1 "adopté … 14 avril 2026, registre 28 avril" is quoted verbatim from the avis (run log
8858). 150-51 zone-rename U-521→H-521 is exactly what the notice states (run log 9579/9621). Ties
A2/H1 at the top.

**M3 — Source traceability = 5.**
Per-section exact links: the precise cloudfront avis/règlement PDFs (AP_150-49_150-50…,
Reglement-150-49-residuel.pdf, AN2-Grilles…, URBA-AN3…150-51-Plans, Approbation-referendaire-150-51),
the reglements-en-attente pages, AND a reproducible open-data chain for every lot figure
(donneesquebec dataset → indexRole2026.csv → **RL70052_2026.xml** + the v2.5 schema PDF). Uses the
correct host `ville.valleyfield.qc.ca`. This is the only track that makes its lot-level numbers
independently reproducible. Ties A2's best-in-class traceability.

**M4 — Factual honesty = 5.**
**No fabrication found** (see verdict below). Strong fact/hypothesis discipline: every lot is
"Faits vérifiés (rôle)" for the role-printed attributes, but the lot↔zone membership is explicitly
flagged as **hypothesis** ("candidat … si l'intersection avec la zone est confirmée"; potentials
labelled "théorique … sous réserve"). Honest "Information non disponible" (9×) for SIG geometry,
lot-zone intersection, flood zones, CPTAQ per lot, depth, easements; explicitly notes the
interactive map exposed no usable zoning/cadastre layer, and that candidate lots carry no agri flag
(`RL0303A = 0`). Matches the A2/H1 honesty bar; the polar opposite of G2.

**M5 — Actionable specificity = 5.**
The most granular *and verified* deliverable of the four. Reaches sector→zone→street→**lot** with
real cadastral attributes pulled from the official 2026 role: e.g. lot 5306188, matricule
5311-52-2424, 89 851,4 m², frontage 73,45 m, valeur 808 700 $ — all matching the parsed XML byte
for byte (run log 8530). Five ranked candidate lots with matricule, area, value, complexity tier,
and theoretical unit yields tied to the correct zone density rule. Where G2 reached this form via
*invented* numbers, C2 reached it via *reproducible* data while staying honest about the unconfirmed
lot↔zone polygon step. Edges past A2 (4) on raw localized specificity.

**M6 — False-positive control = 4.**
Good: candidate lots filtered to non-agricultural (`RL0303A=0`), explicitly warns the street-name
filter is not a zoning-polygon intersection, treats all unit counts as conditional, drops the
already-in-force 150-48 noise. Slightly below A2 (5): it does not flag the non-residential PPCMOI
(490 Hébert pickleball / 74 Maden) — because it never enumerated the PPCMOI list at all — and the
candidate lots, while honestly hedged, are not yet confirmed in-zone (an accepted residual FP risk).
Above H1 effectively but scored at 4 to stay calibrated with H1.

**M7 — Vision-weighted prioritisation = 4.**
Correctly leads with the zoning amendments (weight 10) — 150-49 H-609-4/H-143 and 150-51 — and
ranks the two big H-609-4 conservation-density lots top, then the smaller H-521/C-566/H-627-2
infill. Notes referendum-approval exposure and PAE/PIIA risk per zone. Does **not** address CPTAQ
weighting (no zone agricole engaged) and ignores PPCMOI (weight 7) entirely — so the weight spread
is thinner than A2's full zoning>CPTAQ>PPCMOI>dérogation ranking. Below A2 (5), at H1's level (4).

---

## (2) Fabrication / hallucination verdict

**No fabrication found in C2.** This is the decisive contrast with G2.

Every load-bearing figure was traced to a source that C2 actually fetched and parsed in the run log:

- **Lot data (the highest-risk area — where G2 fabricated):** lots 5306188, 6118846, 6545777,
  3819474, 6474030/6474032 with their matricules, superficies, frontages, usage code 9100, and land
  values are **exact matches** to C2's own parse of the official `RL70052_2026.xml` (Salaberry-de-
  Valleyfield, muni 70052) from `donneesouvertes.affmunqc.net` (run log 8441–8530, 10846–10920).
  C2 wrote a correct parser against the official v2.5 role schema (RL0101Gx street, RL0103Ax lot,
  RL0302A area, RL0303A agri, RL0402A/RL0404A values) over 2 667 real records. These are genuine
  open-data extractions, not inventions.
- **Regulations / dates / density (R1–R5 cross-check):** all corroborated, and in two cases C2 is
  **more accurate than the frozen reference** — it captured the consultation postponement to 23 Mar
  2026 and the 24 Mar 2026 second-project adoption (both quoted verbatim in the official notices,
  run log 3174/8778/9107), which R3 had not recorded; and it used the post-amendment zone name
  H-521 (the notice renames U-521→H-521, run log 9579/9621). The reference set should be updated to
  reflect these, not C2 penalized.
- **Density thresholds** match the 150-49 règlement text verbatim and are correctly mapped per zone
  (run log 5604–5964).

The one honest limitation — lot↔zone polygon membership not confirmed — is **explicitly disclosed**
as a hypothesis throughout, not asserted as fact. That is exactly the discipline G2 lacked.

> **Compared to G2:** G2 presented ≥5 uncorroborable items as "Faits vérifiés" (PPCMOI 2024-0145
> specifics, invented lot numbers, resolution numbers, a $1.35 M price, a location misattribution,
> "risque nul"). C2 has **zero** such items. Where C2 prints a number, the number is real and
> reproducible.

---

## (3) Calibration vs the other tracks

**Ranking: A2 (34) > C2 (31) > H1 (30) > G2 (14).**

- **C2 beats H1 (31 vs 30), narrowly.** C2 matches H1 on regulatory precision (5) and honesty (5),
  beats it on traceability (5 vs 4) and actionable specificity (5 vs 3 — C2 delivered the real
  ranked lot table H1's truncated transcript never reached), but **loses on signal coverage (3 vs
  5)** because C2 ignored PPCMOI, Quartier V, the seniors project, the density doctrine and Plan 450.
  Net +1.
- **C2 falls short of A2 (31 vs 34), by 3.** A2 wins on breadth (M1 5 vs 3), false-positive control
  (M6 5 vs 4 — A2 flagged non-residential PPCMOI; C2 skipped PPCMOI), and vision weighting (M7 5 vs
  4 — A2 spanned zoning+CPTAQ+PPCMOI; C2 covered zoning only). C2 *ties* A2 on M2/M3/M4 and *beats*
  it on M5 (real lot-level granularity). The gap is entirely scope/breadth, not correctness.
- **C2 vastly outperforms G2 (31 vs 14)** and is the inverse case: G2 was broad-form but fabricated;
  C2 is narrower but fully verified and uniquely reproducible at lot level.

**One-line characterization:** C2 is a deep, honest, fully-traceable *vertical* — it went further
than anyone on real lot-level data (the only track to mine the Quebec open-data role and the only
one more precise than the reference on the 150-49 dates), but tunnel-visioned on the two zoning
amendments and skipped the PPCMOI / project-pipeline signals, which is what keeps it just under A2.
