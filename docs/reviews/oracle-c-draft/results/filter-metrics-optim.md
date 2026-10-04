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
| C v1 Astra low | 27 | 13 | 14 | 6 | 27 | 48.1 [29.0–70.0] | 68.4 [38.9–91.3] | 56.5 [35.0–73.2] |
| C v1 Gemini low | 30 | 18 | 12 | 1 | 29 | 60.0 [41.2–80.0] | 94.7 [81.3–100.0] | 73.5 [57.1–87.0] |
| C v1 Opus 5.5 low | 33 | 18 | 15 | 1 | 26 | 54.5 [36.4–75.0] | 94.7 [81.3–100.0] | 69.2 [51.6–83.7] |
| C v2 Astra low | 36 | 18 | 18 | 1 | 23 | 50.0 [33.3–69.0] | 94.7 [81.3–100.0] | 65.5 [49.1–80.0] |
| C v2 Gemini low | 32 | 19 | 13 | 0 | 28 | 59.4 [41.9–77.8] | 100.0 [100.0–100.0] | 74.5 [59.1–87.5] |
| C v2 Opus 5.5 low | 35 | 19 | 16 | 0 | 25 | 54.3 [36.1–73.7] | 100.0 [100.0–100.0] | 70.4 [53.1–84.8] |
| C v2 majority of 3 | 35 | 19 | 16 | 0 | 25 | 54.3 [36.1–73.7] | 100.0 [100.0–100.0] | 70.4 [53.1–84.8] |
| C v2 strict Astra low (shows Pertinent only) | 17 | 14 | 3 | 5 | 38 | 82.4 [64.7–100.0] | 73.7 [52.6–91.7] | 77.8 [60.9–88.9] |
| C v2 strict Gemini low (shows Pertinent only) | 20 | 16 | 4 | 3 | 37 | 80.0 [62.5–100.0] | 84.2 [72.2–100.0] | 82.1 [69.2–95.7] |
| C v2 strict Opus 5.5 low (shows Pertinent only) | 18 | 15 | 3 | 4 | 38 | 83.3 [68.2–100.0] | 78.9 [60.0–95.0] | 81.1 [69.0–92.3] |

**Positive = Pertinent or À surveiller**

| System | Shown | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 36 | 25 | 11 | 8 | 16 | 69.4 [50.0–89.3] | 75.8 [63.3–88.9] | 72.5 [59.0–84.6] |
| B pass 2 (no Précoce) | 52 | 31 | 21 | 2 | 6 | 59.6 [44.7–74.4] | 93.9 [85.3–100.0] | 72.9 [60.6–83.2] |
| B pass 3 (no filter) | 60 | 33 | 27 | 0 | 0 | 55.0 [41.0–69.8] | 100.0 [100.0–100.0] | 71.0 [58.1–82.2] |
| Précoce alone (reconstructed) | 38 | 26 | 12 | 7 | 15 | 68.4 [47.7–90.2] | 78.8 [65.8–92.0] | 73.2 [58.8–86.1] |
| Zonage alone (reconstructed) | 48 | 33 | 15 | 0 | 12 | 68.8 [52.7–85.0] | 100.0 [100.0–100.0] | 81.5 [69.0–91.9] |
| Exclude PIIA + dérogation alone (reconstructed) | 53 | 32 | 21 | 1 | 6 | 60.4 [45.5–75.5] | 97.0 [91.7–100.0] | 74.4 [62.3–85.1] |
| C v1 Astra low | 27 | 22 | 5 | 11 | 22 | 81.5 [66.7–94.1] | 66.7 [45.2–85.4] | 73.3 [56.0–84.3] |
| C v1 Gemini low | 30 | 26 | 4 | 7 | 23 | 86.7 [72.2–100.0] | 78.8 [64.7–90.9] | 82.5 [71.4–91.4] |
| C v1 Opus 5.5 low | 33 | 28 | 5 | 5 | 22 | 84.8 [71.4–96.8] | 84.8 [72.7–94.7] | 84.8 [74.7–93.5] |
| C v2 Astra low | 36 | 29 | 7 | 4 | 20 | 80.6 [67.6–93.3] | 87.9 [74.1–97.4] | 84.1 [73.3–92.1] |
| C v2 Gemini low | 32 | 28 | 4 | 5 | 23 | 87.5 [77.5–96.9] | 84.8 [73.3–96.0] | 86.2 [78.0–93.5] |
| C v2 Opus 5.5 low | 35 | 30 | 5 | 3 | 22 | 85.7 [73.7–97.0] | 90.9 [82.1–100.0] | 88.2 [80.0–95.9] |
| C v2 majority of 3 | 35 | 30 | 5 | 3 | 22 | 85.7 [73.7–97.0] | 90.9 [82.1–100.0] | 88.2 [80.0–95.9] |
| C v2 strict Astra low (shows Pertinent only) | 17 | 15 | 2 | 18 | 25 | 88.2 [75.0–100.0] | 45.5 [29.0–60.9] | 60.0 [43.2–72.7] |
| C v2 strict Gemini low (shows Pertinent only) | 20 | 18 | 2 | 15 | 25 | 90.0 [78.3–100.0] | 54.5 [38.2–72.7] | 67.9 [52.9–81.8] |
| C v2 strict Opus 5.5 low (shows Pertinent only) | 18 | 16 | 2 | 17 | 25 | 88.9 [75.0–100.0] | 48.5 [29.4–66.7] | 62.7 [43.8–76.6] |

**Summary** (noise = Steve-"Non pertinent" among shown lines; Pertinent lost = Steve-Pertinent hidden)

| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 47.2 | 89.5 | 61.8 | 69.4 | 75.8 | 72.5 | 30.6 | 2/19 |
| B pass 2 (no Précoce) | 34.6 | 94.7 | 50.7 | 59.6 | 93.9 | 72.9 | 40.4 | 1/19 |
| B pass 3 (no filter) | 31.7 | 100.0 | 48.1 | 55.0 | 100.0 | 71.0 | 45.0 | 0/19 |
| Précoce alone (reconstructed) | 47.4 | 94.7 | 63.2 | 68.4 | 78.8 | 73.2 | 31.6 | 1/19 |
| Zonage alone (reconstructed) | 39.6 | 100.0 | 56.7 | 68.8 | 100.0 | 81.5 | 31.3 | 0/19 |
| Exclude PIIA + dérogation alone (reconstructed) | 34.0 | 94.7 | 50.0 | 60.4 | 97.0 | 74.4 | 39.6 | 1/19 |
| C v1 Astra low | 48.1 | 68.4 | 56.5 | 81.5 | 66.7 | 73.3 | 18.5 | 6/19 |
| C v1 Gemini low | 60.0 | 94.7 | 73.5 | 86.7 | 78.8 | 82.5 | 13.3 | 1/19 |
| C v1 Opus 5.5 low | 54.5 | 94.7 | 69.2 | 84.8 | 84.8 | 84.8 | 15.2 | 1/19 |
| C v2 Astra low | 50.0 | 94.7 | 65.5 | 80.6 | 87.9 | 84.1 | 19.4 | 1/19 |
| C v2 Gemini low | 59.4 | 100.0 | 74.5 | 87.5 | 84.8 | 86.2 | 12.5 | 0/19 |
| C v2 Opus 5.5 low | 54.3 | 100.0 | 70.4 | 85.7 | 90.9 | 88.2 | 14.3 | 0/19 |
| C v2 majority of 3 | 54.3 | 100.0 | 70.4 | 85.7 | 90.9 | 88.2 | 14.3 | 0/19 |
| C v2 strict Astra low (shows Pertinent only) | 82.4 | 73.7 | 77.8 | 88.2 | 45.5 | 60.0 | 11.8 | 5/19 |
| C v2 strict Gemini low (shows Pertinent only) | 80.0 | 84.2 | 82.1 | 90.0 | 54.5 | 67.9 | 10.0 | 3/19 |
| C v2 strict Opus 5.5 low (shows Pertinent only) | 83.3 | 78.9 | 81.1 | 88.9 | 48.5 | 62.7 | 11.1 | 4/19 |

Reconstructed filters (approximation from 2026-10-04 record properties, `non vérifié` against the code deployed in September):
- Précoce alone (reconstructed): etape ∈ {avis_motion, projet_reglement} on any record of the line.
- Zonage alone (reconstructed): category ∈ {rezonage, modification_zonage, densification, refonte, plan d'urbanisme}; densification_residentielle excluded as in the code.
- Exclude PIIA + dérogation alone (reconstructed): hides any record typed piia or dérogation (the code keeps a PIIA with residential proof: not reproducible here).
- Résidentiel alone: N-A — it depends on residential markers computed by the code, not stored in the record properties.
- Sanity check: on the 52 lines of pass 1 or 2, the reconstructed Précoce agrees with the observed pass on 51.
