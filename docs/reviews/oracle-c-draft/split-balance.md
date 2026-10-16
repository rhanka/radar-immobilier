# Split balance — optim vs blind (oracle C draft)

Produced by `scripts/04-split.mjs` (seed 20261004, 400 restarts, local search over municipalities) **before any prompt was written or any model was run**.

- Source lines: 124 triage lines; 3 excluded (no resolvable radar record, listed below); **121 items split**.
- Partition unit: the municipality (51 cities). Optim: 60 items / 26 cities. Blind: 61 items / 25 cities. No city appears in both sets.
- Which half became `blind` was decided by the next draw of the same seeded PRNG after the balance search. This is not an independent coin flip: the seed, chosen by the operator, fixes both the partition and the side (review m3). Future splits should commit the seed beforehand or derive it from a public future value.
- Frozen: `optim.jsonl` sha256 `d724ed80e7f412a00958ad147906a405d14cfa442d9050c89d8b47a07da7e0c5`; `blind.jsonl` sha256 `51e32d2a3f30b1373555c213fac2a40411322d85601dacc2e855464f639c1e2c` (see `SHA256SUMS`).

Per stratum: chi-square statistic of the set x category table, **descriptive only**. The search deliberately minimised imbalance over these strata and assigned whole municipalities (clustered), so high p-values are expected by construction and do not certify homogeneity (reviews F07, m3). Several categories have expected counts below 5. The max absolute share gap is the plain balance metric.

| Stratum | Categories | chi² | df | p-value | Cramér's V | min expected | max share gap |
|---|---:|---:|---:|---:|---:|---:|---:|
| verdict | 3 | 0.07 | 2 | 0.965 | 0.024 | 14.4 | 2.4 pts |
| motifFamily | 9 | 4.49 | 8 | 0.810 | 0.193 | 2.0 | 6.7 pts |
| sens | 5 | 0.23 | 4 | 0.994 | 0.044 | 3.5 | 1.7 pts |
| pass | 3 | 0.10 | 2 | 0.950 | 0.029 | 7.4 | 1.9 pts |
| region | 3 | 0.24 | 2 | 0.887 | 0.045 | 6.4 | 4.3 pts |
| docType | 3 | 0.30 | 2 | 0.863 | 0.049 | 8.9 | 4.5 pts |
| nodeKind | 3 | 0.08 | 2 | 0.960 | 0.026 | 10.4 | 1.9 pts |
| length | 3 | 0.02 | 2 | 0.992 | 0.012 | 19.8 | 1.1 pts |
| citySize | 3 | 0.11 | 2 | 0.945 | 0.031 | 9.4 | 2.5 pts |

## Per-stratum tables

### verdict

| Category | optim | optim share | blind | blind share | total |
|---|---:|---:|---:|---:|---:|
| Non pertinent | 27 | 45.0 % | 26 | 42.6 % | 53 |
| Pertinent | 19 | 31.7 % | 20 | 32.8 % | 39 |
| À surveiller | 14 | 23.3 % | 15 | 24.6 % | 29 |

### motifFamily

| Category | optim | optim share | blind | blind share | total |
|---|---:|---:|---:|---:|---:|
| N-agenda-only | 4 | 6.7 % | 0 | 0.0 % | 4 |
| N-individual | 10 | 16.7 % | 10 | 16.4 % | 20 |
| N-no-capacity | 6 | 10.0 % | 7 | 11.5 % | 13 |
| N-not-res-or-urb | 4 | 6.7 % | 5 | 8.2 % | 9 |
| N-restrictive | 3 | 5.0 % | 4 | 6.6 % | 7 |
| P-meets | 19 | 31.7 % | 20 | 32.8 % | 39 |
| S-constrained | 3 | 5.0 % | 4 | 6.6 % | 7 |
| S-early | 2 | 3.3 % | 2 | 3.3 % | 4 |
| S-unreadable | 9 | 15.0 % | 9 | 14.8 % | 18 |

### sens

| Category | optim | optim share | blind | blind share | total |
|---|---:|---:|---:|---:|---:|
| Assouplissement | 26 | 43.3 % | 27 | 44.3 % | 53 |
| Indéterminé | 19 | 31.7 % | 19 | 31.1 % | 38 |
| Mixte | 4 | 6.7 % | 3 | 4.9 % | 7 |
| Neutre | 6 | 10.0 % | 7 | 11.5 % | 13 |
| Restriction | 5 | 8.3 % | 5 | 8.2 % | 10 |

### pass

| Category | optim | optim share | blind | blind share | total |
|---|---:|---:|---:|---:|---:|
| pass1 | 36 | 60.0 % | 37 | 60.7 % | 73 |
| pass2 | 16 | 26.7 % | 17 | 27.9 % | 33 |
| pass3 | 8 | 13.3 % | 7 | 11.5 % | 15 |

### region

| Category | optim | optim share | blind | blind share | total |
|---|---:|---:|---:|---:|---:|
| Laurentides | 6 | 10.0 % | 7 | 11.5 % | 13 |
| Montérégie | 38 | 63.3 % | 36 | 59.0 % | 74 |
| other regions | 16 | 26.7 % | 18 | 29.5 % | 34 |

### docType

| Category | optim | optim share | blind | blind share | total |
|---|---:|---:|---:|---:|---:|
| adoption/other record | 9 | 15.0 % | 9 | 14.8 % | 18 |
| early-stage record | 17 | 28.3 % | 20 | 32.8 % | 37 |
| procès-verbal record | 34 | 56.7 % | 32 | 52.5 % | 66 |

### nodeKind

| Category | optim | optim share | blind | blind share | total |
|---|---:|---:|---:|---:|---:|
| event | 11 | 18.3 % | 10 | 16.4 % | 21 |
| signal | 31 | 51.7 % | 32 | 52.5 % | 63 |
| signal+event | 18 | 30.0 % | 19 | 31.1 % | 37 |

### length

| Category | optim | optim share | blind | blind share | total |
|---|---:|---:|---:|---:|---:|
| long | 20 | 33.3 % | 21 | 34.4 % | 41 |
| medium | 20 | 33.3 % | 20 | 32.8 % | 40 |
| short | 20 | 33.3 % | 20 | 32.8 % | 40 |

### citySize

| Category | optim | optim share | blind | blind share | total |
|---|---:|---:|---:|---:|---:|
| city with 1 line | 10 | 16.7 % | 9 | 14.8 % | 19 |
| city with 2-3 lines | 28 | 46.7 % | 30 | 49.2 % | 58 |
| city with 4+ lines | 22 | 36.7 % | 22 | 36.1 % | 44 |

## Verdict by pass (both sets)

| Pass | optim P / S / N | blind P / S / N |
|---|---|---|
| pass1 | 17 / 8 / 11 | 17 / 7 / 13 |
| pass2 | 1 / 5 / 10 | 3 / 6 / 8 |
| pass3 | 1 / 1 / 6 | 0 / 2 / 5 |

## Coverage caveats (reviews F07, F08, m3, m4)

- Motif families present on one side only: N-agenda-only (optim 4 / blind 0). Blind cannot validate such a family.
- Records with no verbatim excerpt (label and properties only): optim 10 / blind 6.
- Lines scored with one cited record missing (partial mapping): optim 5 / blind 4. Most are a twin mentioned by Steve without its full id (the bare word `event`), kept as extracted; they are scored against the whole-line verdict.
- Twins across neighbouring municipalities of the same MRC are not controlled.

## Excluded lines (not split, not scored)

| Excel row | City | Verdict | Motif | Pass | Reason |
|---:|---|---|---|---|---|
| 19 | Saint-Jean-Baptiste | Non pertinent | V2-PRECEDENT | pass3 | node id(s) not found in graph_nodes: event-saint-jean-baptiste-derogation-DPDRL260017 |
| 60 | Mont-Saint-Hilaire | Pertinent | P-PROJ-INTEGRE | pass3 | no radar signal (line describes a dossier absent from the radar) |
| 63 | Sainte-Cécile-de-Milton | Non pertinent | N-NON-RES | off-radar | no radar signal (line describes a dossier absent from the radar) |

## Partition unit and its cost

Grouping by municipality is stricter than grouping by dossier (D10 asks that every unit of a dossier stay in one partition). It removes leakage through twin records (`signal-` / `event-` of the same act), coupled bylaws (plan + zoning concordance of the same session) and city-specific wording. The cost is that "city" cannot be balanced item-by-item; it is balanced instead through region and city-size strata.
