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
| C v2 Astra low | 38 | 20 | 18 | 0 | 23 | 52.6 [37.8–69.2] | 100.0 [100.0–100.0] | 69.0 [54.9–81.8] |
| C v2 Gemini low | 35 | 20 | 15 | 0 | 26 | 57.1 [40.0–77.1] | 100.0 [100.0–100.0] | 72.7 [57.1–87.1] |
| C v2 Opus 5.5 low | 38 | 20 | 18 | 0 | 23 | 52.6 [37.5–69.4] | 100.0 [100.0–100.0] | 69.0 [54.5–82.0] |
| C v2 majority of 3 | 35 | 20 | 15 | 0 | 26 | 57.1 [40.6–75.9] | 100.0 [100.0–100.0] | 72.7 [57.8–86.3] |
| C v2 strict Astra low (shows Pertinent only) | 18 | 15 | 3 | 5 | 38 | 83.3 [66.7–100.0] | 75.0 [55.0–93.8] | 78.9 [63.2–90.6] |
| C v2 strict Gemini low (shows Pertinent only) | 21 | 17 | 4 | 3 | 37 | 81.0 [63.2–100.0] | 85.0 [69.6–100.0] | 82.9 [69.8–94.1] |
| C v2 strict Opus 5.5 low (shows Pertinent only) | 15 | 13 | 2 | 7 | 39 | 86.7 [68.8–100.0] | 65.0 [47.8–83.3] | 74.3 [60.0–86.5] |

**Positive = Pertinent or À surveiller**

| System | Shown | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 37 | 24 | 13 | 11 | 13 | 64.9 [48.3–80.6] | 68.6 [55.9–82.1] | 66.7 [53.3–77.9] |
| B pass 2 (no Précoce) | 54 | 33 | 21 | 2 | 5 | 61.1 [51.4–72.7] | 94.3 [87.5–100.0] | 74.2 [66.7–81.8] |
| B pass 3 (no filter) | 61 | 35 | 26 | 0 | 0 | 57.4 [47.6–69.8] | 100.0 [100.0–100.0] | 72.9 [64.5–82.2] |
| Précoce alone (reconstructed) | 37 | 24 | 13 | 11 | 13 | 64.9 [48.5–79.5] | 68.6 [55.9–82.1] | 66.7 [54.0–77.9] |
| Zonage alone (reconstructed) | 47 | 31 | 16 | 4 | 10 | 66.0 [53.6–82.1] | 88.6 [80.0–97.1] | 75.6 [66.7–85.3] |
| Exclude PIIA + dérogation alone (reconstructed) | 60 | 35 | 25 | 0 | 1 | 58.3 [48.3–70.6] | 100.0 [100.0–100.0] | 73.7 [65.2–82.8] |
| C v2 Astra low | 38 | 31 | 7 | 4 | 19 | 81.6 [69.2–93.2] | 88.6 [76.9–97.4] | 84.9 [75.7–93.2] |
| C v2 Gemini low | 35 | 31 | 4 | 4 | 22 | 88.6 [75.6–100.0] | 88.6 [76.9–97.4] | 88.6 [79.3–96.2] |
| C v2 Opus 5.5 low | 38 | 32 | 6 | 3 | 20 | 84.2 [72.2–95.7] | 91.4 [81.3–100.0] | 87.7 [80.0–94.7] |
| C v2 majority of 3 | 35 | 31 | 4 | 4 | 22 | 88.6 [75.0–100.0] | 88.6 [76.9–97.4] | 88.6 [78.6–96.8] |
| C v2 strict Astra low (shows Pertinent only) | 18 | 17 | 1 | 18 | 25 | 94.4 [82.4–100.0] | 48.6 [32.3–65.6] | 64.2 [47.6–78.0] |
| C v2 strict Gemini low (shows Pertinent only) | 21 | 19 | 2 | 16 | 24 | 90.5 [72.4–100.0] | 54.3 [38.9–70.3] | 67.9 [53.1–80.8] |
| C v2 strict Opus 5.5 low (shows Pertinent only) | 15 | 14 | 1 | 21 | 25 | 93.3 [80.0–100.0] | 40.0 [26.3–56.4] | 56.0 [40.9–70.8] |

**Summary** (noise = Steve-"Non pertinent" among shown lines; Pertinent lost = Steve-Pertinent hidden)

| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 45.9 | 85.0 | 59.6 | 64.9 | 68.6 | 66.7 | 35.1 | 3/20 |
| B pass 2 (no Précoce) | 37.0 | 100.0 | 54.1 | 61.1 | 94.3 | 74.2 | 38.9 | 0/20 |
| B pass 3 (no filter) | 32.8 | 100.0 | 49.4 | 57.4 | 100.0 | 72.9 | 42.6 | 0/20 |
| Précoce alone (reconstructed) | 45.9 | 85.0 | 59.6 | 64.9 | 68.6 | 66.7 | 35.1 | 3/20 |
| Zonage alone (reconstructed) | 38.3 | 90.0 | 53.7 | 66.0 | 88.6 | 75.6 | 34.0 | 2/20 |
| Exclude PIIA + dérogation alone (reconstructed) | 33.3 | 100.0 | 50.0 | 58.3 | 100.0 | 73.7 | 41.7 | 0/20 |
| C v1 Astra low | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A — not run on blind (blind is measured once, with the frozen final prompt only) |
| C v1 Gemini low | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A — not run on blind (blind is measured once, with the frozen final prompt only) |
| C v1 Opus 5.5 low | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A — not run on blind (blind is measured once, with the frozen final prompt only) |
| C v2 Astra low | 52.6 | 100.0 | 69.0 | 81.6 | 88.6 | 84.9 | 18.4 | 0/20 |
| C v2 Gemini low | 57.1 | 100.0 | 72.7 | 88.6 | 88.6 | 88.6 | 11.4 | 0/20 |
| C v2 Opus 5.5 low | 52.6 | 100.0 | 69.0 | 84.2 | 91.4 | 87.7 | 15.8 | 0/20 |
| C v2 majority of 3 | 57.1 | 100.0 | 72.7 | 88.6 | 88.6 | 88.6 | 11.4 | 0/20 |
| C v2 strict Astra low (shows Pertinent only) | 83.3 | 75.0 | 78.9 | 94.4 | 48.6 | 64.2 | 5.6 | 5/20 |
| C v2 strict Gemini low (shows Pertinent only) | 81.0 | 85.0 | 82.9 | 90.5 | 54.3 | 67.9 | 9.5 | 3/20 |
| C v2 strict Opus 5.5 low (shows Pertinent only) | 86.7 | 65.0 | 74.3 | 93.3 | 40.0 | 56.0 | 6.7 | 7/20 |

Reconstructed filters (approximation from 2026-10-04 record properties, `non vérifié` against the code deployed in September):
- Précoce alone (reconstructed): etape ∈ {avis_motion, projet_reglement} on any record of the line.
- Zonage alone (reconstructed): category ∈ {rezonage, modification_zonage, densification, refonte, plan d'urbanisme}; densification_residentielle excluded as in the code.
- Exclude PIIA + dérogation alone (reconstructed): hides any record typed piia or dérogation (the code keeps a PIIA with residential proof: not reproducible here).
- Résidentiel alone: N-A — it depends on residential markers computed by the code, not stored in the record properties.
- Sanity check: on the 54 lines of pass 1 or 2, the reconstructed Précoce agrees with the observed pass on 53.
