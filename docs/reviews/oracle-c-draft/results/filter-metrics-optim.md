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
