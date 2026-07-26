# Audit — live production B′ cohort versus Steve ratings

**Snapshot:** 2026-07-26T00:19:41.972022Z
**Data authority:** production PostgreSQL `radar.graph_nodes`, accessed through `radar-postgres-0` in `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`. No fixture, seed, mutation, migration, or persistent object was used.

## Direct answer

The live production source contains **7,221** `Signal` / `DesignationEvent` nodes across **724** cities. Replaying the B′ selection rules against that snapshot retains **312 signals in 172 cities** — not approximately 166.

The data prove strong **city-level recall** for the known Steve high cases: all **10** 6–10/10 benchmark cities are retained. They do *not* prove that only those 10 are high acquisition opportunities. Steve supplied numeric ratings for only 30 reviewed cities; **158 of the 172 retained cities have no numeric Steve city label.** A rating for them would be invented.

Only **one** retained city has an exact known Steve 3/10 rating: Saint-Côme-Linière. Its low rating is due to municipal ownership, a fact B′ does not and should not currently gate on. Petite-Rivière-Saint-François (2/10) is also retained for the same semantic reason: its regulatory signal is good, while the owner makes the acquisition unattractive.

There is, however, a real selection defect in the live cohort: **Stratford** is retained through `signal-stratford-rezonage-RU13` despite Steve's 0/10 verdict for the same regulation 1257 / zone RU-13, an extension of a campground. The served signal text says only “création nouvelle zone RU-13 — modification zonage”; without a land-use semantic field, R3 cannot see the campground.

## Method and boundary

`/api/graph-signals/by-city` is session-protected, but its backing query reads `graph_nodes` dynamically. The production raw rows were read directly and replayed through the B′ rules at audited revision `e2d1b60a1037bd8505a67d717ac18c9afcb5150a`: zonage, R1 annotated stage, R2 residential eligibility for `rezonage` / `refonte`, R3/R4 exclusion, then early stages `avis_motion` / `projet_reglement`.

This is a live-data reconstruction of the served B′ projection, not a static fixture. The HTTP representation itself was not captured because it requires a user OIDC session. If the deployed classifier differs from the audited revision, an authenticated endpoint export remains the byte-for-byte check; the source population and every audited signal below are current production rows.

### JSON-path control — verified on production

The business fields are under `props.properties`, not at the JSON root. A
separate read-only control over the same 7,221 rows returned the following
non-null counts:

| Field | `props->>field` | `props->'properties'->>field` |
|---|---:|---:|
| `category` | 0 | 1,603 |
| `etape` | 0 | 7,173 |
| `kind` | 0 | 4,345 |
| `description` | 3 | 6,209 |

The production replay resolves `category`, `etape`, and `description` from
`props.properties` first, then follows the application fallback order through
document references and root properties. It does **not** use
`props->>'category'` as its business classification input.

| Live measure | Result |
|---|---:|
| Source nodes | 7,221 |
| Source cities | 724 |
| Retained B′ signals | 312 |
| Retained B′ cities | **172** |
| Retained signals with residential evidence `oui` | 138 (44.2%) |
| Retained signals residentially `indetermine` | 174 (55.8%) |
| Cities with at least one confirmed-residential retained signal | 86 |
| Cities retained only through indeterminate-residential signals | **86** |
| Zoning-positive signals excluded as non-residential | 672 |

The 86 / 86 city split is decisive: half of the live B′ city cohort has no retained signal with explicit residential evidence. Those cities may be useful for discovery, but cannot honestly be presented as Steve-like high-priority acquisition opportunities.

## Known Steve benchmark intersected with live B′

This table is a **city/signal-reference audit**, not an imputation of a score. Mont-Saint-Hilaire demonstrates why: its Steve 0/10 and 7/10 labels concern different signals in the same city.

| Steve benchmark case | Live B′ result | Audit reading |
|---|---:|---|
| 10 high labels, 6–10/10 | **10/10 cities retained** | Strong high-case city recall; canonical signal IDs are still needed before calling this signal-level recall. |
| Saint-Stanislas-de-Kostka 10/10 | 1 signal vs target 2 | Under target; live row is the 451-2025 complete-revision signal. |
| Sutton 10/10 | 1 vs target 2 | Under target; live row is the 2026 complete-revision signal. |
| Saint-Raphaël, Saint-Raymond, Saint-Boniface, Saint-Mathieu-de-Beloeil, Saint-Amable, Mont-Saint-Hilaire, Saint-Gilbert | target count met | Counts are 2, 4, 1, 2, 3, 2, 2 respectively. |
| Coaticook 8/10 | 3 vs target 2 | The RD-104 PPCMOI rows are present, plus one extra indeterminate rezoning. |
| Saint-Côme-Linière 3/10 | 1 retained | Expected exception: city ownership explains Steve's low acquisition verdict, not a bad regulatory signal. |
| Petite-Rivière-Saint-François 2/10 | 3 retained | Expected exception: U-24 is intrinsically good; firm ownership explains the low acquisition verdict. |
| Rosemère 2/10 | 0 retained | Current absence is observed. It must not be credited to R3/R4 without the source signal and semantic reason. |
| Stratford 0/10 | **1 retained** | Confirmed live false positive: the reviewed RU-13 campground case is retained as an indeterminate rezoning. |
| Neuville 4/10 | **1 retained** | Contrary to the B′ recipe target of 0. The live Pa-4 “usages non-agricoles” row is an indeterminate rezoning; it cannot prove the Steve CPTAQ case was retained. |
| Mont-Saint-Hilaire 0/10 + 7/10 | 2 retained | City membership is non-diagnostic; the live rows concern habitation and cannot score the promoter-tailored 0/10 signal. |

The 15 distinct scored Steve cities resolve in the live cohort as 14 retained and Rosemère absent. This is **not** a 14-city score distribution: one city is mixed, and a city can contain a new or different signal from Steve's review.

## Calibration finding and correction

B′ combines two materially different live populations:

1. **Evidence-confirmed residential signals** — 138 signals, in 86 cities.
2. **Discovery candidates admitted by unknown residential status** — 174 signals, in 86 cities with no confirmed-residential retained signal.

The second population is where complete reforms and early rezoning discovery should remain visible. It is also precisely how Neuville and Stratford are admitted. Calling both populations “retained cities” makes the cohort look like an acquisition shortlist when half has not met the minimum residential proof.

1. Keep the 172-city set as **B′ discovery**; do not narrow it just to make the Steve labels look cleaner.
2. Publish a separate **Steve-ready / evidenced residential** tier. It requires explicit residential use or a source-backed before/after zoning-grid delta, rather than `residentiel=indetermine` alone. On this snapshot it begins at 86 cities, before owner, lot, project-scale, and market evidence.
3. Add a source-backed land-use semantic marker for campground, commercial pole, industrial, and similar outcomes. Lexical rules cannot exclude Stratford when the served title omits “camping”.
4. Keep owner-driven low cases as regulatory discoveries, but never count them as Steve high acquisition cases. Owner, lot, project scale, and regulatory grid belong in the downstream dossier.
5. Persist a canonical `steve_label_id -> graph_signal_id` crosswalk. Without it, the remaining 158 unlabelled retained cities cannot receive a Steve note and mixed cities cannot be collapsed into one rating.

## Audit conclusion

On real production data, B′ retains all known 6–10 Steve cities but is **not calibrated as a Steve 6–10 list**. Its 172 cities split equally between confirmed-residential and unknown-residential discovery cases. The evidence proves one exact 3/10 case retained and one exact 0/10 campground case wrongly retained; it provides no numeric Steve rating for the remaining 158 unlabelled cities. The defensible output is therefore a measured coverage/abstention result, not a forced 172-city Steve score histogram.
