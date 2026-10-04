### blind (excluding sens-non-donne) — 55 lines, 21 municipalities (Steve: 14 Pertinent, 15 À surveiller, 26 Non pertinent)

Values in %, municipality-clustered bootstrap 95 % interval in brackets (2000 draws, seed 808).

**Positive = Pertinent**

| System | Shown | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 31 | 11 | 20 | 3 | 21 | 35.5 [15.6–54.5] | 78.6 [52.9–100.0] | 48.9 [25.0–66.7] |
| B pass 2 (no Précoce) | 48 | 14 | 34 | 0 | 7 | 29.2 [15.8–42.9] | 100.0 [100.0–100.0] | 45.2 [27.3–60.0] |
| B pass 3 (no filter) | 55 | 14 | 41 | 0 | 0 | 25.5 [14.1–36.2] | 100.0 [100.0–100.0] | 40.6 [24.7–53.2] |
| Précoce alone (reconstructed) | 31 | 11 | 20 | 3 | 21 | 35.5 [15.6–54.5] | 78.6 [52.9–100.0] | 48.9 [25.0–66.7] |
| Zonage alone (reconstructed) | 42 | 13 | 29 | 1 | 12 | 31.0 [18.4–45.7] | 92.9 [78.6–100.0] | 46.4 [30.8–61.5] |
| Exclude PIIA + dérogation alone (reconstructed) | 54 | 14 | 40 | 0 | 1 | 25.9 [14.3–37.0] | 100.0 [100.0–100.0] | 41.2 [25.0–54.1] |
| C v2 Astra low | 32 | 14 | 18 | 0 | 23 | 43.8 [26.9–60.5] | 100.0 [100.0–100.0] | 60.9 [42.4–75.4] |
| C v2 Gemini low | 29 | 14 | 15 | 0 | 26 | 48.3 [28.6–68.0] | 100.0 [100.0–100.0] | 65.1 [44.4–81.0] |
| C v2 Opus 5.5 low | 32 | 14 | 18 | 0 | 23 | 43.8 [25.9–60.5] | 100.0 [100.0–100.0] | 60.9 [41.2–75.4] |
| C v2 majority of 3 | 29 | 14 | 15 | 0 | 26 | 48.3 [29.2–66.7] | 100.0 [100.0–100.0] | 65.1 [45.2–80.0] |
| C v2 strict Astra low (shows Pertinent only) | 14 | 11 | 3 | 3 | 38 | 78.6 [57.1–100.0] | 78.6 [57.9–100.0] | 78.6 [61.5–90.3] |
| C v2 strict Gemini low (shows Pertinent only) | 16 | 12 | 4 | 2 | 37 | 75.0 [53.8–100.0] | 85.7 [70.0–100.0] | 80.0 [66.7–92.9] |
| C v2 strict Opus 5.5 low (shows Pertinent only) | 11 | 9 | 2 | 5 | 39 | 81.8 [60.0–100.0] | 64.3 [50.0–84.6] | 72.0 [57.1–84.2] |

**Positive = Pertinent or À surveiller**

| System | Shown | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 31 | 18 | 13 | 11 | 13 | 58.1 [39.3–76.5] | 62.1 [47.8–75.0] | 60.0 [44.9–71.8] |
| B pass 2 (no Précoce) | 48 | 27 | 21 | 2 | 5 | 56.3 [45.0–69.0] | 93.1 [84.8–100.0] | 70.1 [61.0–78.5] |
| B pass 3 (no filter) | 55 | 29 | 26 | 0 | 0 | 52.7 [41.2–67.2] | 100.0 [100.0–100.0] | 69.0 [58.3–80.4] |
| Précoce alone (reconstructed) | 31 | 18 | 13 | 11 | 13 | 58.1 [40.0–75.0] | 62.1 [47.8–75.0] | 60.0 [45.3–71.2] |
| Zonage alone (reconstructed) | 42 | 26 | 16 | 3 | 10 | 61.9 [50.0–78.4] | 89.7 [80.0–100.0] | 73.2 [64.6–82.9] |
| Exclude PIIA + dérogation alone (reconstructed) | 54 | 29 | 25 | 0 | 1 | 53.7 [41.9–67.9] | 100.0 [100.0–100.0] | 69.9 [59.1–80.9] |
| C v2 Astra low | 32 | 25 | 7 | 4 | 19 | 78.1 [64.3–90.9] | 86.2 [72.4–96.7] | 82.0 [70.3–90.9] |
| C v2 Gemini low | 29 | 25 | 4 | 4 | 22 | 86.2 [71.0–100.0] | 86.2 [72.4–96.7] | 86.2 [74.4–95.2] |
| C v2 Opus 5.5 low | 32 | 26 | 6 | 3 | 20 | 81.3 [66.7–95.3] | 89.7 [78.1–100.0] | 85.2 [75.4–93.7] |
| C v2 majority of 3 | 29 | 25 | 4 | 4 | 22 | 86.2 [70.8–100.0] | 86.2 [72.4–96.7] | 86.2 [73.9–95.2] |
| C v2 strict Astra low (shows Pertinent only) | 14 | 13 | 1 | 16 | 25 | 92.9 [78.6–100.0] | 44.8 [26.7–61.5] | 60.5 [41.2–75.0] |
| C v2 strict Gemini low (shows Pertinent only) | 16 | 14 | 2 | 15 | 24 | 87.5 [66.7–100.0] | 48.3 [31.0–64.0] | 62.2 [44.4–76.6] |
| C v2 strict Opus 5.5 low (shows Pertinent only) | 11 | 10 | 1 | 19 | 25 | 90.9 [75.0–100.0] | 34.5 [21.4–48.5] | 50.0 [34.5–63.8] |

**Summary** (noise = Steve-"Non pertinent" among shown lines; Pertinent lost = Steve-Pertinent hidden)

| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 35.5 | 78.6 | 48.9 | 58.1 | 62.1 | 60.0 | 41.9 | 3/14 |
| B pass 2 (no Précoce) | 29.2 | 100.0 | 45.2 | 56.3 | 93.1 | 70.1 | 43.8 | 0/14 |
| B pass 3 (no filter) | 25.5 | 100.0 | 40.6 | 52.7 | 100.0 | 69.0 | 47.3 | 0/14 |
| Précoce alone (reconstructed) | 35.5 | 78.6 | 48.9 | 58.1 | 62.1 | 60.0 | 41.9 | 3/14 |
| Zonage alone (reconstructed) | 31.0 | 92.9 | 46.4 | 61.9 | 89.7 | 73.2 | 38.1 | 1/14 |
| Exclude PIIA + dérogation alone (reconstructed) | 25.9 | 100.0 | 41.2 | 53.7 | 100.0 | 69.9 | 46.3 | 0/14 |
| C v1 Astra low | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A — not run on blind (blind is measured once, with the frozen final prompt only) |
| C v1 Gemini low | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A — not run on blind (blind is measured once, with the frozen final prompt only) |
| C v1 Opus 5.5 low | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A — not run on blind (blind is measured once, with the frozen final prompt only) |
| C v2 Astra low | 43.8 | 100.0 | 60.9 | 78.1 | 86.2 | 82.0 | 21.9 | 0/14 |
| C v2 Gemini low | 48.3 | 100.0 | 65.1 | 86.2 | 86.2 | 86.2 | 13.8 | 0/14 |
| C v2 Opus 5.5 low | 43.8 | 100.0 | 60.9 | 81.3 | 89.7 | 85.2 | 18.8 | 0/14 |
| C v2 majority of 3 | 48.3 | 100.0 | 65.1 | 86.2 | 86.2 | 86.2 | 13.8 | 0/14 |
| C v2 strict Astra low (shows Pertinent only) | 78.6 | 78.6 | 78.6 | 92.9 | 44.8 | 60.5 | 7.1 | 3/14 |
| C v2 strict Gemini low (shows Pertinent only) | 75.0 | 85.7 | 80.0 | 87.5 | 48.3 | 62.2 | 12.5 | 2/14 |
| C v2 strict Opus 5.5 low (shows Pertinent only) | 81.8 | 64.3 | 72.0 | 90.9 | 34.5 | 50.0 | 9.1 | 5/14 |

Reconstructed filters (approximation from 2026-10-04 record properties, `non vérifié` against the code deployed in September):
- Précoce alone (reconstructed): etape ∈ {avis_motion, projet_reglement} on any record of the line.
- Zonage alone (reconstructed): category ∈ {rezonage, modification_zonage, densification, refonte, plan d'urbanisme}; densification_residentielle excluded as in the code.
- Exclude PIIA + dérogation alone (reconstructed): hides any record typed piia or dérogation (the code keeps a PIIA with residential proof: not reproducible here).
- Résidentiel alone: N-A — it depends on residential markers computed by the code, not stored in the record properties.
- Sanity check: on the 48 lines of pass 1 or 2, the reconstructed Précoce agrees with the observed pass on 47.
