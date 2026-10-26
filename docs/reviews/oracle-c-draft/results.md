# Results — draft oracle C: split, test-set protocol and today's baseline (B)

**Scope.** This folder holds the measurement frame for a targeting oracle (C): the split, the
sealed test set and its protocol, and the baseline of today's radar filters (B) on the same lines.
**No C prompt is measured here.** The next prompt (`v1`) will be written by a new author from the
author sandbox only (`TEST-SET-PROTOCOL.md` §3), and run once on the sealed test set.

All figures come from `scripts/08-filter-metrics.mjs`; tables are copied from
`results/filter-metrics-*.md`; no model is involved.

## Measurement level

- **Unit** = one line of Steve's Triage sheet attached to the radar record(s) it names: 121 lines
  (3 of 124 excluded, no radar record). **Test set = 61 lines / 25 municipalities** (reference,
  sealed, sha256 `51e32d2a…`); development set = 60 lines / 26 municipalities (diagnostic only,
  annex). Split by municipality, balanced on nine strata (`split-balance.md`).
- **Truth** = Steve's verdict on the line (Pertinent / À surveiller / Non pertinent), given on
  2026-09-15..21 from what the screen and the MCP tools showed him.
- **Task** = the display decision "show this line to Steve" vs "hide it". B (today's radar) shows a
  line if it was visible in the pass Steve ran with that filter combination.
- **Positives**: positive = Pertinent; positive = Pertinent or À surveiller.
- **Precision** = shown positives / shown; **recall** = shown positives / positives of the set;
  **F1**; **noise** = Steve-Non pertinent among shown; **Pertinent lost** = Steve-Pertinent hidden.
  Intervals: 95 %, bootstrap resampling whole municipalities.

### Selection bias of the universe
Every line exists because it was visible in one of Steve's three passes. Lines the radar never
showed, and records his filters rightly removed ("Écartés par les filtres"), are outside the
universe. Recall is therefore measured **inside the 121-line universe only** (pass 3 has recall
100 % by construction; true recall over the radar is not measurable here); precision is comparable
between systems on the same lines, and the bias favours B. Passes 1-3 are **observed**; single
filters are **reconstructed** from record properties read on 2026-10-04 (`non vérifié` against the
September code); "Résidentiel alone" is not computable (N-A). The reconstructed Précoce matches the
observed pass 1 / pass 2 split on 53 of 54 test lines.

## Reference: test set (61 lines: 20 Pertinent, 15 À surveiller, 26 Non pertinent)

| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 45.9 | 85.0 | 59.6 | 64.9 | 68.6 | 66.7 | 35.1 | 3/20 |
| B pass 2 (no Précoce) | 37.0 | 100.0 | 54.1 | 61.1 | 94.3 | 74.2 | 38.9 | 0/20 |
| B pass 3 (no filter) | 32.8 | 100.0 | 49.4 | 57.4 | 100.0 | 72.9 | 42.6 | 0/20 |
| Précoce alone (reconstructed) | 45.9 | 85.0 | 59.6 | 64.9 | 68.6 | 66.7 | 35.1 | 3/20 |
| Zonage alone (reconstructed) | 38.3 | 90.0 | 53.7 | 66.0 | 88.6 | 75.6 | 34.0 | 2/20 |
| Exclude PIIA + dérogation alone (reconstructed) | 33.3 | 100.0 | 50.0 | 58.3 | 100.0 | 73.7 | 41.7 | 0/20 |
| C v1 (new author) | pending | | | | | | | |

Clustered intervals, B pass 1: precision (P) 45.9 [28.1–62.9], recall (P) 85.0 [66.7–100];
precision (P+S) 64.9 [48.3–80.6], recall (P+S) 68.6 [55.9–82.1].

![Precision and recall of today's filters, test set](results/filter-pr-blind.svg)

### Reading (JUGEMENT)
Today's working view (pass 1) shows 37 of the 61 test lines: about one in two is Pertinent, one in
three is noise, and 3 of the 20 Pertinent are hidden. Removing Précoce (pass 2) recovers those 3
but raises noise to 39 %. This is the bar C must clear on the same lines: **higher precision than
pass 1 without losing a Pertinent**.

## Status of the test set
- Same 61 lines and sha256 as frozen on 2026-10-04 (owner decision), now **sealed**: encrypted
  outside the repository, key held by the test executor, every access logged
  (`test-access-log.jsonl`). Runs are refused unless the prompt is frozen and committed first, and
  a second run of the same prompt is refused (`TEST-SET-PROTOCOL.md`).
- The preparer / executor of this folder has seen the test set; that is why it no longer writes
  prompts. Its earlier exposure is recorded in the protocol.

## Limits
- Small sets, clustered by municipality (61 test lines, 25 municipalities); wide intervals.
- Steve's labels taken as truth; one annotator, no adjudication, no "non résolu".
- Records read on 2026-10-04 (`non vérifié` identical to what Steve saw); 4 test lines carry one
  cited record missing; motif family N-agenda-only absent from the test set.
- B passes reconstructed from the pass column (observed visibility), not re-run.

---

## Annex — development set (60 lines: 19 P, 14 S, 27 N), diagnostic only

| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 47.2 | 89.5 | 61.8 | 69.4 | 75.8 | 72.5 | 30.6 | 2/19 |
| B pass 2 (no Précoce) | 34.6 | 94.7 | 50.7 | 59.6 | 93.9 | 72.9 | 40.4 | 1/19 |
| B pass 3 (no filter) | 31.7 | 100.0 | 48.1 | 55.0 | 100.0 | 71.0 | 45.0 | 0/19 |
| Précoce alone (reconstructed) | 47.4 | 94.7 | 63.2 | 68.4 | 78.8 | 73.2 | 31.6 | 1/19 |
| Zonage alone (reconstructed) | 39.6 | 100.0 | 56.7 | 68.8 | 100.0 | 81.5 | 31.3 | 0/19 |
| Exclude PIIA + dérogation alone (reconstructed) | 34.0 | 94.7 | 50.0 | 60.4 | 97.0 | 74.4 | 39.6 | 1/19 |

![Precision and recall of today's filters, development set](results/filter-pr-optim.svg)

## Annex — full tables (generated)

### blind — 61 lines, 25 municipalities (Steve: 20 Pertinent, 15 À surveiller, 26 Non pertinent)

Values in %, municipality-clustered bootstrap 95 % interval in brackets (2000 draws, seed 808).

**Positive = Pertinent**

| System | Shown | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 37 | 17 | 20 | 3 | 21 | 45.9 [28.1–62.9] | 85.0 [66.7–100.0] | 59.6 [40.7–74.6] |
| B pass 2 (no Précoce) | 54 | 20 | 34 | 0 | 7 | 37.0 [25.0–52.1] | 100.0 [100.0–100.0] | 54.1 [40.0–68.5] |
| B pass 3 (no filter) | 61 | 20 | 41 | 0 | 0 | 32.8 [22.4–44.9] | 100.0 [100.0–100.0] | 49.4 [36.7–62.0] |
| Précoce alone (reconstructed) | 37 | 17 | 20 | 3 | 21 | 45.9 [28.3–63.6] | 85.0 [66.7–100.0] | 59.6 [40.8–75.0] |
| Zonage alone (reconstructed) | 47 | 18 | 29 | 2 | 12 | 38.3 [25.8–55.6] | 90.0 [78.1–100.0] | 53.7 [40.0–69.1] |
| Exclude PIIA + dérogation alone (reconstructed) | 60 | 20 | 40 | 0 | 1 | 33.3 [23.0–45.8] | 100.0 [100.0–100.0] | 50.0 [37.3–62.8] |

**Positive = Pertinent or À surveiller**

| System | Shown | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 37 | 24 | 13 | 11 | 13 | 64.9 [48.3–80.6] | 68.6 [55.9–82.1] | 66.7 [53.3–77.9] |
| B pass 2 (no Précoce) | 54 | 33 | 21 | 2 | 5 | 61.1 [51.4–72.7] | 94.3 [87.5–100.0] | 74.2 [66.7–81.8] |
| B pass 3 (no filter) | 61 | 35 | 26 | 0 | 0 | 57.4 [47.6–69.8] | 100.0 [100.0–100.0] | 72.9 [64.5–82.2] |
| Précoce alone (reconstructed) | 37 | 24 | 13 | 11 | 13 | 64.9 [48.5–79.5] | 68.6 [55.9–82.1] | 66.7 [54.0–77.9] |
| Zonage alone (reconstructed) | 47 | 31 | 16 | 4 | 10 | 66.0 [53.6–82.1] | 88.6 [80.0–97.1] | 75.6 [66.7–85.3] |
| Exclude PIIA + dérogation alone (reconstructed) | 60 | 35 | 25 | 0 | 1 | 58.3 [48.3–70.6] | 100.0 [100.0–100.0] | 73.7 [65.2–82.8] |

**Summary** (noise = Steve-"Non pertinent" among shown lines; Pertinent lost = Steve-Pertinent hidden)

| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 45.9 | 85.0 | 59.6 | 64.9 | 68.6 | 66.7 | 35.1 | 3/20 |
| B pass 2 (no Précoce) | 37.0 | 100.0 | 54.1 | 61.1 | 94.3 | 74.2 | 38.9 | 0/20 |
| B pass 3 (no filter) | 32.8 | 100.0 | 49.4 | 57.4 | 100.0 | 72.9 | 42.6 | 0/20 |
| Précoce alone (reconstructed) | 45.9 | 85.0 | 59.6 | 64.9 | 68.6 | 66.7 | 35.1 | 3/20 |
| Zonage alone (reconstructed) | 38.3 | 90.0 | 53.7 | 66.0 | 88.6 | 75.6 | 34.0 | 2/20 |
| Exclude PIIA + dérogation alone (reconstructed) | 33.3 | 100.0 | 50.0 | 58.3 | 100.0 | 73.7 | 41.7 | 0/20 |

Reconstructed filters (approximation from 2026-10-04 record properties, `non vérifié` against the code deployed in September):
- Précoce alone (reconstructed): etape ∈ {avis_motion, projet_reglement} on any record of the line.
- Zonage alone (reconstructed): category ∈ {rezonage, modification_zonage, densification, refonte, plan d'urbanisme}; densification_residentielle excluded as in the code.
- Exclude PIIA + dérogation alone (reconstructed): hides any record typed piia or dérogation (the code keeps a PIIA with residential proof: not reproducible here).
- Résidentiel alone: N-A — it depends on residential markers computed by the code, not stored in the record properties.
- Sanity check: on the 54 lines of pass 1 or 2, the reconstructed Précoce agrees with the observed pass on 53.

### optim — 60 lines, 26 municipalities (Steve: 19 Pertinent, 14 À surveiller, 27 Non pertinent)

Values in %, municipality-clustered bootstrap 95 % interval in brackets (2000 draws, seed 808).

**Positive = Pertinent**

| System | Shown | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 36 | 17 | 19 | 2 | 22 | 47.2 [30.2–65.5] | 89.5 [78.3–100.0] | 61.8 [44.8–76.7] |
| B pass 2 (no Précoce) | 52 | 18 | 34 | 1 | 7 | 34.6 [21.2–50.0] | 94.7 [83.3–100.0] | 50.7 [34.5–65.6] |
| B pass 3 (no filter) | 60 | 19 | 41 | 0 | 0 | 31.7 [19.7–45.9] | 100.0 [100.0–100.0] | 48.1 [32.9–62.9] |
| Précoce alone (reconstructed) | 38 | 18 | 20 | 1 | 21 | 47.4 [29.5–66.7] | 94.7 [85.7–100.0] | 63.2 [45.2–79.3] |
| Zonage alone (reconstructed) | 48 | 19 | 29 | 0 | 12 | 39.6 [25.5–55.8] | 100.0 [100.0–100.0] | 56.7 [40.6–71.6] |
| Exclude PIIA + dérogation alone (reconstructed) | 53 | 18 | 35 | 1 | 6 | 34.0 [21.3–48.1] | 94.7 [85.7–100.0] | 50.0 [34.6–64.6] |

**Positive = Pertinent or À surveiller**

| System | Shown | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 36 | 25 | 11 | 8 | 16 | 69.4 [50.0–89.3] | 75.8 [63.3–88.9] | 72.5 [59.0–84.6] |
| B pass 2 (no Précoce) | 52 | 31 | 21 | 2 | 6 | 59.6 [44.7–74.4] | 93.9 [85.3–100.0] | 72.9 [60.6–83.2] |
| B pass 3 (no filter) | 60 | 33 | 27 | 0 | 0 | 55.0 [41.0–69.8] | 100.0 [100.0–100.0] | 71.0 [58.1–82.2] |
| Précoce alone (reconstructed) | 38 | 26 | 12 | 7 | 15 | 68.4 [47.7–90.2] | 78.8 [65.8–92.0] | 73.2 [58.8–86.1] |
| Zonage alone (reconstructed) | 48 | 33 | 15 | 0 | 12 | 68.8 [52.7–85.0] | 100.0 [100.0–100.0] | 81.5 [69.0–91.9] |
| Exclude PIIA + dérogation alone (reconstructed) | 53 | 32 | 21 | 1 | 6 | 60.4 [45.5–75.5] | 97.0 [91.7–100.0] | 74.4 [62.3–85.1] |

**Summary** (noise = Steve-"Non pertinent" among shown lines; Pertinent lost = Steve-Pertinent hidden)

| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 47.2 | 89.5 | 61.8 | 69.4 | 75.8 | 72.5 | 30.6 | 2/19 |
| B pass 2 (no Précoce) | 34.6 | 94.7 | 50.7 | 59.6 | 93.9 | 72.9 | 40.4 | 1/19 |
| B pass 3 (no filter) | 31.7 | 100.0 | 48.1 | 55.0 | 100.0 | 71.0 | 45.0 | 0/19 |
| Précoce alone (reconstructed) | 47.4 | 94.7 | 63.2 | 68.4 | 78.8 | 73.2 | 31.6 | 1/19 |
| Zonage alone (reconstructed) | 39.6 | 100.0 | 56.7 | 68.8 | 100.0 | 81.5 | 31.3 | 0/19 |
| Exclude PIIA + dérogation alone (reconstructed) | 34.0 | 94.7 | 50.0 | 60.4 | 97.0 | 74.4 | 39.6 | 1/19 |

Reconstructed filters (approximation from 2026-10-04 record properties, `non vérifié` against the code deployed in September):
- Précoce alone (reconstructed): etape ∈ {avis_motion, projet_reglement} on any record of the line.
- Zonage alone (reconstructed): category ∈ {rezonage, modification_zonage, densification, refonte, plan d'urbanisme}; densification_residentielle excluded as in the code.
- Exclude PIIA + dérogation alone (reconstructed): hides any record typed piia or dérogation (the code keeps a PIIA with residential proof: not reproducible here).
- Résidentiel alone: N-A — it depends on residential markers computed by the code, not stored in the record properties.
- Sanity check: on the 52 lines of pass 1 or 2, the reconstructed Précoce agrees with the observed pass on 51.
