# Independent Scoring — Valleyfield Densification Analyst Reports

> **Evaluator stance**: independent, neutral. Identical frozen metrics (M1–M7, 0–5) applied to
> every track. No track favored. Fabrications called out regardless of source. Verification done
> against official public sources (ville.valleyfield.qc.ca, cloudfront avis PDFs, local press) on
> ~25 May 2026.

## Tracks scored
- **H1** — human, manual ChatGPT GPT-5.5 (`feat-demo-findings-valleyfield/docs/spec/input/PROMPT_RESULT_GPT5.5.md`). Note: H1's file stops at Phase 3 (Phases 4–6 not transcribed).
- **A2** — automated, isolated, web-only (`iso-vf-opus/report.md`). Full 6-phase report.
- **G2** — automated, isolated (`iso-vf-gemini/report.md`). Full 6-phase report.
- **C2** — automated, isolated (`iso-vf-codex/`). **PENDING / INCOMPLETE.** No `report.md` exists;
  only `prompt.txt` and a 12 671-line `report.log` containing raw scraped HTML (nav menus, link
  dumps) with no synthesized analyst output. **C2 is not scored** — it produced no report.

---

## (a) Reference set — verified regulations / zones / facts (neutral ground truth)

All items below were corroborated against official sources. Density figures and zone lists for
150-49/150-50/150-51 were extracted directly from the city's own avis PDFs (binary FlateDecode,
parsed locally with pdftotext).

| # | Verified fact | Source |
|---|---|---|
| R1 | **Plan d'urbanisme = Règlement 450** (codified 450-01), adopted in council **12 Nov 2024**; MRC approval to follow end-2024. | ville.valleyfield.qc.ca/reglements-municipaux/projet-de-reglement-450…; INFOSuroit; neomedia 625464 |
| R2 | **Règlement de zonage = nº 150**; current codified version = **150-48** (in force). Amendments 150-44 (A zones), 150-47 (I/P/U/CONS/REC) in force. | ville…/zonage-et-ses-amendements |
| R3 | **150-49** (zoning amendment, "en attente"): first project adopted **10 Feb 2026**; public consultation **11 Mar 2026** (per the notice itself); referendum-procedure notices for 150-49-1 / 150-49-2 dated **22 Apr 2026**. Zones **H-143, H-143-1, H-148-1, H-609-4**; base density **0,5 log./ha**, raised by boisé conservation: **2 log./ha @55 %, 15 log./ha @70 %, 50 log./ha @30 %**; min 20 % continuous; new **CONSERVATION** zoning; new zone **A-118-1**, **CONS-147-1**. | cloudfront avis `AP_150-49_150-50_assemblee_consultation.pdf` (dated 25 Feb 2026); avis-publics page |
| R4 | **150-50** ("en attente"): same origin (10 Feb 2026); referendum approval notice **1 Apr 2026**. Restricts commercial uses; redivides **C-541, C-543** into **C-541-1, C-541-2, C-543-3, C-543-4**; **C-543-1** enlarged. | same consultation PDF; avis-publics page |
| R5 | **150-51** ("en attente"): consultation **7 Apr 2026**; second project adopted **14 Apr 2026**; referendum approval notice **22 Apr 2026**. Zones **REC-137, H-334, U-521, C-534, H-535, H-561, P-571, C-566, C-627, H-801, I-918**. Adds multifamilial **5–8 / 4–12 logements, max 3 étages / 12 m**; maisons de chambres & **résidences étudiantes** (H-535, opposite Cégep sports field); H-561 enlarged on rue Laroche; H-334 PIIA reference removed. | cloudfront avis `Avis-public-Approbation-referendaire-150-51.pdf` (dated 22 Apr 2026) |
| R6 | **PPCMOI page (current)** lists exactly 6 active files: **2025-0059** (boul. Gérard-Cadieux), **2025-0065** (futur 1785 rue Tougas), **2025-0198** (74 rue Maden), **2024-0036** (21 rue Victoria Est), **2026-0061** (490 boul. Hébert), **2026-0066** (110 chemin Larocque). | ville…/ppcmoi |
| R7 | **PPCMOI 2024-0023** (Pierre-Paul-Messier, **zone H-656**): real. Filed by S. Graham for "Société en Commandite PPM", 180–260 Pierre-Paul-Messier, portion of H-656, **five multifamily buildings**. Appears in council minutes **8 Oct 2024**. (No longer on the "current" PPCMOI page → likely concluded.) | PV séance 8 Oct 2024 (cloudfront) |
| R8 | **Quartier V** (rue Tougas): real, ~**360 units**, ~**$60 M**, consortium Loiselle / S. Ménard / Harden / Habitat 2000, ~20 buildings, 4–5 yr horizon. | infodaffaires; neomedia 430770; harden.ca |
| R9 | **100 affordable seniors units**: real, at **corner Tougas / Michel-Choinière**, ~$22.5 M (FACL + Québec), delivery **spring 2027**, OMH-managed. **NOT** described publicly as "behind the Maxi / boul. Mgr-Langlois / zone C-232-2." | ville…/actualites; Constructo; CMHC; Québec.ca |
| R10 | City densification doctrine: only **~30 % of territory developable**; max **10 étages** limited to two downtown MOCO sectors; rest mostly 1–2 storeys. | journalsaint-francois "densité assumée hors de la CMM" |
| R11 | Rôle d'évaluation en ligne (PG Solutions / ImmoNet, pgmunicipal) is access-blocked (Cloudflare); interactive map is a JS app. Lot-level data (matricule, superficie, valeur) is **expected "non disponible"** — honest non-availability must not be penalized. | per mission brief; corroborated by H1 & A2 method notes |

### Items that could NOT be corroborated (flagged)
- **No public source** confirms a "PPCMOI 2024-0145 at 240 chemin Larocque, zone C-537, 26 logements" (G2). The current PPCMOI list (R6) does not contain it; web search returns only a real *247* ch. Larocque acquisition and an unrelated 24-unit social-housing project. → **Unverifiable / likely fabricated (G2).**
- **No source** confirms lot numbers 6 484 778–782, 6 484 805–808, 6 620 349, 6 692 252, resolution "2024-10-613" / "2025-05-293", or the **$1,350,000** land price (G2). Not retrievable from any public page or press; the neomedia article G2 cites (544321) is not findable. → **Unverifiable / likely fabricated (G2).**
- G2 places the 100-seniors project at "1785 Tougas behind Maxi / boul. Mgr-Langlois / zone C-232-2"; official sources place it at **Tougas/Michel-Choinière** (R9). → **Misattribution / conflation (G2).**

---

## (b) Scoring table (0–5 each; total /35)

| Track | M1 Signal cov. | M2 Reg. precision | M3 Traceability | M4 Honesty | M5 Actionable spec. | M6 FP control | M7 Vision weighting | **Total** |
|---|---|---|---|---|---|---|---|---|
| **H1** (human) | 5 | 5 | 4 | 5 | 3 | 4 | 4 | **30** |
| **A2** (web-only) | 5 | 5 | 5 | 5 | 4 | 5 | 5 | **34** |
| **G2** (isolated) | 2 | 2 | 2 | 1 | 4 | 2 | 2 | **14** |
| **C2** (codex) | — | — | — | — | — | — | — | **n/a (no report)** |

### Per-metric justification

**M1 — Densification-signal coverage**
- H1 **5**: captures all three real pending amendments (150-49/-50/-51) incl. sub-règlements 150-49-1/-2, all 6 PPCMOI, plus zone-level detail (H-143, H-609-4, U-521, C-627…). Matches reference set R3–R6.
- A2 **5**: same three amendments + 6 PPCMOI + Quartier V, 100-seniors, UHA (~4 500 lots), 4 density poles, règl. 432 affordable rule. Broadest real coverage.
- G2 **2**: only the PPCMOI mechanism; **misses 150-49/-50/-51 entirely** (the core of the mission). Real signal H-656/PPCMOI 2024-0023 found, but two of its three "signals" are unverifiable (240 Larocque, Tougas misattribution).

**M2 — Regulatory precision** (exact number + date + verifiable nature)
- H1 **5**: cites 150-48 codified, 150-49/-50/-51 with statuses; density thresholds (50 log./ha @30 %) match the official notice exactly; dates mostly correct (minor: consultation said 23 Mar vs official 11 Mar).
- A2 **5**: 450 (plan), 150-48 (zoning), 150-49/-50/-51 with correct adoption/consultation/referendum dates (10 Feb / 7 Apr / 14 Apr / 22 Apr), density figures verbatim-correct, règl. 432 & UHA cited. Highest precision overall.
- G2 **2**: Plan 450 correct; but relies on **resolution numbers and dates not corroborable** (2024-10-613, 2025-05-293), invents "max standard 32 logements / 4 étages" baselines, and never engages the actual zoning amendments. Zone C-537 / H-656 partially real but unverifiable specifics.

**M3 — Source traceability** (exact link per factual claim)
- H1 **4**: rich source chips and exact cloudfront PDF links per section; some claims (PPCMOI numbers) carried without per-line links.
- A2 **5**: every section has an exact source line; deep-links to the precise avis/PPCMOI/press PDFs. Best traceability.
- G2 **2**: only 5 generic top-level links (e.g. `/reglements-municipaux`, `/avis-publics`) reused for nearly every claim; **bare domain `valleyfield.qc.ca`** (wrong host — real site is `ville.valleyfield.qc.ca`); lot numbers and prices cited to generic pages that don't contain them.

**M4 — Factual honesty** (facts vs hypotheses; "non disponible" vs invention; penalize fabrication)
- H1 **5**: explicit "✅ vérifié / 🔎 hypothèse", honest "Information non disponible" for all lot data, flags portal block, discards uncorroborated dates. No fabrication found.
- A2 **5**: same discipline (✅/🔎/⛔ markers), honest non-availability for all lot-level data, explicitly flags Cloudflare block; no fabrication found. Correctly separates Quartier V vs 100-seniors.
- G2 **1**: presents **unverifiable lot numbers, resolution numbers, a $1.35 M price, and a PPCMOI (2024-0145) as verified facts** ("Fait vérifié"), and **misattributes** the 100-seniors project to a wrong zone/location. Claims referendum risk is "**nul** (Fait vérifié)". This is the only track with apparent fabrication — heavily penalized per the absolute no-cheating rule.

**M5 — Actionable specificity** (sector→zone→street→lot; # qualified localized opportunities)
- H1 **3**: excellent at sector→zone→street level (named street lists per zone), honest that lot enumeration needs SIG/rôle; but file ends at Phase 3 — no final ranked opportunity table.
- A2 **4**: reaches zone + street + named PPCMOI lots (where the avis actually print them, e.g. 2026-0066 lots 3 819 015/031/167/168), ~5 ranked opportunities with complexity. Verifiable lots only where the source prints them.
- G2 **4**: most granular *looking* (specific lot numbers, $ value, 350-unit potential) and a clean Top-3 — but the granularity rests on unverifiable/invented data, so it scores well on *form* yet is undercut elsewhere (M4).

**M6 — False-positive control** (drops noise; flags non-residential / blocked)
- H1 **4**: prioritizes correctly, notes 150-48 already-in-force is "less actionable"; lighter on flagging non-residential PPCMOI (file truncated before Phase 4).
- A2 **5**: explicitly flags **490 Hébert as non-residential (pickleball) ❌ out of scope**, notes 74 Maden = hockey centre, drops minor dérogations, marks already-in-force items. Best noise control.
- G2 **2**: treats every PPCMOI as a prime residential opportunity; no non-residential filtering; asserts "risk nul", which over-sells.

**M7 — Vision-weighted prioritisation** (zoning 10 > CPTAQ 8 > PPCMOI 7 > minor dérogations)
- H1 **4**: ranks zoning amendments (150-49 H-143/H-609-4, 150-51) above PPCMOI; flags A-118 CPTAQ proximity. Truncation limits the final weighted ranking.
- A2 **5**: top opportunities are the 150-51 / 150-49 zoning changes, then poles, then a single PPCMOI; explicitly raises CPTAQ risk on A-118-1; dérogations treated as secondary. Best alignment with weights.
- G2 **2**: ranking is **PPCMOI-only** (weight 7) and ignores the higher-weight zoning amendments (weight 10) and CPTAQ entirely — inverted vs the vision weights.

---

## (c) Per-track strengths / weaknesses

**H1 (human GPT-5.5)** — Strong: exhaustive, precise regulatory reading; density thresholds and
zone lists match official notices; rigorous fact/hypothesis separation; honest non-availability.
Weak: the transcribed file **stops at Phase 3** (no final Phase 4–6 ranking/opportunity table),
which caps M5; one consultation date (23 Mar vs official 11 Mar) slightly off; source links rich
but not always per-claim.

**A2 (automated, web-only)** — Strong: matches or exceeds the human on every regulatory metric;
correct dates and verbatim density figures; best traceability (exact deep-links) and best noise
control (flags non-residential PPCMOI, drops minor dérogations); cleanest vision-weighted ranking;
honest about the Cloudflare-blocked rôle. Weak: minor — could push slightly further on
lot-enumeration method, but stayed honest rather than inventing.

**G2 (automated, isolated)** — Strong: most concrete-*looking* deliverable, clean Top-3, identified
the real PPCMOI 2024-0023 / H-656 Pierre-Paul-Messier signal, correct Plan 450. Weak: **missed the
entire 150-49/-50/-51 zoning-amendment story** (the mission's core); generic/wrong-host source
links; and — critically — **presents multiple unverifiable specifics (lot numbers, resolution
numbers, a $1.35 M price, a PPCMOI 2024-0145, "risk nul") as verified facts**, plus a location
misattribution for the 100-seniors project.

**C2 (codex)** — No report produced (only raw HTML log). Not scored.

---

## (d) Honest verdict — did the automated agents beat the human?

**Yes — one of them did, decisively; the other failed.**

- **A2 (automated, web-only) BEAT the human baseline**, 34 vs 30. A2 won or tied H1 on every
  metric and won outright on **M3 (traceability)**, **M5 (actionable specificity)**, **M6
  (false-positive control)** and **M7 (vision weighting)** — largely because H1's transcript was
  truncated at Phase 3 (no final ranked opportunities / non-residential filtering / weighted
  Top-5), whereas A2 completed all six phases with equal regulatory precision and equal honesty.
  On the pure regulatory core (**M1, M2, M4**) the two are **tied at the top** — both nailed the
  150-49 density thresholds (0.5→2→15→50 log./ha) and the 150-51 zone list and dates against the
  official notices, and both were scrupulously honest about unavailable lot data.

- **Where the human won / held par**: H1 matched A2 on signal coverage, regulatory precision, and
  honesty, and its Phase-1/2 regulatory synthesis is arguably the most detailed of all (full
  zone-by-zone breakdown with contiguous zones). Had H1's Phases 4–6 been transcribed, M5/M6/M7
  would likely have closed most of the gap. So the human's *analytical ceiling* is at A2's level;
  it lost points only on **completeness of the delivered artifact**, not on substance.

- **G2 (automated) LOST badly** (14/35) — it did not beat the human and would be unsafe to act on:
  it skipped the central zoning amendments and grounded its headline opportunities in
  uncorroborable / likely-fabricated specifics.

**Bottom line**: the strongest automated agent (A2) is at least as good as the human on substance
and better on completeness/traceability — but this is **not** a blanket "AI beats human" result:
the other automated agent (G2) fabricated, and one (C2) produced nothing. The win belongs to A2
specifically, and it won partly because the human artifact was truncated, not because the human
reasoning was weaker.

---

## (e) Fabrication / hallucination found — per track

- **H1 (human)**: **None found.** All checkable claims (450, 150-48, 150-49 density thresholds,
  150-51 zones/dates, PPCMOI list) verified true. Honest "non disponible" for lot data. One minor
  date imprecision (consultation 23 Mar vs official 11 Mar) — an inaccuracy, not a fabrication.

- **A2 (web-only)**: **None found.** Dates, density figures, zone lists, and the Quartier-V /
  100-seniors / non-residential-PPCMOI distinctions all verified. Lot data honestly marked
  unavailable rather than invented.

- **G2 (isolated)**: **Multiple likely fabrications / unverifiable "facts" presented as verified**:
  1. **PPCMOI "2024-0145" at 240 chemin Larocque, zone C-537, 26 logements** — not on the official
     PPCMOI list and not corroborable anywhere.
  2. **Lot numbers** 6 484 778–782, 6 484 805–808, 6 620 349, 6 692 252 — uncorroborable; asserted
     as cadastral fact.
  3. **Resolution numbers** 2024-10-613, 2025-05-293 and the **$1,350,000** land price — not
     findable in any public source; the cited neomedia article does not surface.
  4. **Location misattribution**: 100-seniors project placed "behind the Maxi / boul.
     Mgr-Langlois / zone C-232-2" vs the official Tougas/Michel-Choinière.
  5. **"Risque réglementaire … nul (Fait vérifié)"** — an over-asserted conclusion stated as
     verified fact.
  (Note: G2 also has *real* anchors — Plan 450, PPCMOI 2024-0023/H-656 Pierre-Paul-Messier,
  the genuine 100-unit seniors project — so it is a mix of real signal and fabricated specifics,
  which is precisely what makes it dangerous.)

- **C2 (codex)**: Not applicable — no report.
