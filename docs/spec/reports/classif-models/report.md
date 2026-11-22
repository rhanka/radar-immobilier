# Benchmarks B et C — comparatif modèles (`gemini-4-hydrogen-low`, `gemini-4-neon-low`, `astra-6.2-low`, `CP+ astra-6.2-low`, `fable-5.2-low`)

## Verdicts en tête

### B « CP+ » : GPT-6.2-Astra low → vérification Gemini 3.8 Flash low
- **Remplacement de CP prod (`Astra medium → Flash low`) : candidat très proche en effort `low` (-0,009 F1), et nettement supérieur à CP-low (+0,013 F1, +4,0 pts rappel)**.
  - **99/100 acceptés**, **541/1 285 actes retirés** (`-538` faux positifs, **1 seul vrai positif perdu**).
  - **Score strict (oracle 676)** : P **46,87 %** (`+19,28 pts` vs Astra 6.2 low seul), R **53,11 %** (`317/676` manqués, `-0,15 pt`), **F1 strict 0,498** (aveugle **0,502**, tolérant étape **0,657**, F1 4 docs humains **0,686**).
  - **Face à CP prod v12 (`Astra medium → Flash low`)** : P 48,4 %, R 53,3 %, F1 **0,507** (`-1,5 pt` P, `-0,2 pt` R, `-0,009` F1) pour un détecteur en effort `low` au lieu de `medium`.

### GPT-6.2-Astra low (`astra-6.2-low`, siège Codex)
- **Sur B seul (100 PV / oracle 676)** : **non en primaire à prompt figé v11/v12** sans étape de vérification Flash (F1 strict **0,363**, P 27,59 %, R **53,25 %**, 945 FP). Avec vérification Flash (CP+ ci-dessus), F1 remonte à **0,498**.
- **Sur C (classification seule, mode B, prompt v2)** : **candidat primaire crédible, avec réserve 1/95 en mise au point**.
  - **Aveugle** : **seul modèle candidat à réussir D4** (**0/94 manqué**, rappel **100,00 %**), précision **76,42 %** (**+4,66 pts** vs Astra low v2 à 71,76 %), **0 invalide**, **3,40 min**.
  - **Mise au point** : **1/95 manqué P ∪ S** (rappel 98,95 %, précision **68,12 %**, **D4 échoué**, 0 invalide). Coût quota : **+3 %** hebdo Codex sur les 514 appels C (`11 % -> 14 %`).

### Fable 5.2 low (`claude-fable-5-2`, effort `low`, siège Claude)
- **Sur B (100 PV / oracle 676)** : **non en primaire** ; **meilleure fiabilité de format (100/100 acceptés, 0 invalide)** et net bond sur Opus 5.5 low (+13,2 pts rappel), mais rappel strict **34,91 %** (440/676 manqués, P 32,73 %, F1 **0,338**), loin derrière Astra low (0,424) et CP+ (0,498).
- **Sur C (classification seule, mode B, prompt v2)** : **excellent profil vitesse/précision avec réserve D4 aveugle (1/94 manqué)**.
  - **Mise au point** : **0/95 manqué**, R **100,00 %**, P **73,64 %** (`+6,26 pts` vs Astra low v2), **D4 réussi**, 0 invalide, **2,21 min**.
  - **Aveugle** : **1/94 manqué**, R **98,94 %**, **P 78,81 %** (**meilleure précision mesurée**, `+7,05 pts` vs Astra low v2), **D4 échoué**, 0 invalide, **2,19 min** (modèle le plus rapide sur C : **4,40 min** au total).

### Gemini 4 Hydrogen low
- **En primaire (remplacement d'Astra low)** : **non** sur B comme sur C.
  - **B** : 96/100 acceptés, F1 strict **0,303** (P 28,05 %, R 32,99 %, 453/676 manqués).
  - **C** : **2/94 manqués P ∪ S** en aveugle (rappel 97,87 %, P 76,67 %, **D4 échoué**).
- **En repli (remplacement de `gemini-3.8-flash` low)** : **non à qualité égale sur B** (572 FP, F1 0,303 vs 0,368) ; **candidat crédible sur C avec réserve D4**.

### Gemini 4 Neon low
- **En primaire et face à Hydrogen low** : **non**.
  - **B** : 92/100 acceptés, F1 strict **0,278** (P 24,41 %, R 32,40 %, 457/676 manqués), 48,34 min actifs.
  - **C** : P 75,40 % / 78,45 %, 0 invalide, mais **3/94 manqués P ∪ S** en aveugle (rappel 96,81 %, **D4 échoué**), 33,57 min.

---

## 1. Benchmark B — détection PV (oracle 676, protocole gelé v11/v12)

Protocole figé : 100 PV du manifeste `v101b` (50 mise au point = 372 actes, 50 aveugle = 304 actes ; total 676 actes + 43 non résolus neutres). Prompt système SHA-256 `bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461` et 100 prompts documentaires vérifiés octet par octet avant tout appel. Prompt de vérification CP+ SHA-256 `cf015e57c6e1cd1404efc7e22ddb014da0e4851aba9befea9ef39cae46094b68`, identique entre `api/src/services/graph/refresh-verification-prompt.ts:2-14` et `harness/cp-prompt-filtre.md:4-16`. Validateur gelé v9 et scoreur `score-676.mjs` inchangés. Agrégats seulement ; aucune donnée par document aveugle publiée.

| Jeu | Modèle | Acceptés | Manqués | Rappel strict | Wilson 95 % rappel | Précision | F1 strict | Invalides | Durée | Appels | Jetons | Coût estimé |
|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---|
| Total (100 PV, 676) | CP prod (GPT-6 Astra medium → Flash low, v12) | 99/100 | 316/676 | 53,30 % | — | 48,40 % | 0,507 | 1 | v12 | 100+99 | v12 | 0,4813 USD API/doc (0,0212 siège) |
| Total (100 PV, 676) | **CP+ (GPT-6.2-Astra low → Flash low)** | **99/100** | **317/676** | **53,11 %** | **[49,34 % ; 56,84 %]** | **46,87 %** | **0,498** | **1** | **+7,20 min vérif.** | **103 vérif. (99 PV)** | **2 530 961 vérif.** | `missing source` |
| Mise au point (50 PV, 372) | CP+ (GPT-6.2-Astra low → Flash low) | 50/50 | 178/372 | 52,15 % | [47,08 % ; 57,18 %] | 47,09 % | 0,495 | 0 | — | 50 | — | `missing source` |
| Aveugle (50 PV, 304) | CP+ (GPT-6.2-Astra low → Flash low) | 49/50 | 139/304 | 54,28 % | [48,66 % ; 59,79 %] | 46,61 % | 0,502 | 1 | — | 49 | — | `missing source` |
| Total (100 PV, 676) | CP-low (GPT-6 Astra low → Flash low, v12) | 100/100 | 344/676 | 49,10 % | — | 47,90 % | 0,485 | 0 | v12 | 100+100 | v12 | `missing source` |
| Total (100 PV, 676) | GPT-6 Astra medium (v12) | 99/100 | 315/676 | 53,40 % | — | 37,10 % | 0,438 | 1 | v12 | 100 | v12 | 0,4689 USD API/doc (0,0207 siège) |
| Total (100 PV, 676) | GPT-6 Astra low (baseline v12) | 100/100 | 344/676 | 49,10 % | — | 37,30 % | 0,424 | 0 | v12 | 100 | v12 | 0,4072 USD API/doc (0,0180 siège) |
| Total (100 PV, 676) | Gemini 4 Argon low (v12, agy) | 88/100 | 386/676 | 42,90 % | — | 33,00 % | 0,373 | 12 | v12 | 140 | v12 | 0,2074 USD API/doc (0,00801 siège) |
| Total (100 PV, 676) | Gemini 3.8 Flash low (repli v12) | 85/100 | 473/676 | 30,00 % | — | 47,50 % | 0,368 | 15 | v12 | 100 | v12 | 0,0376 USD API/doc (0,00143 siège) |
| Total (100 PV, 676) | **GPT-6.2-Astra low (codex)** | **99/100** | **316/676** | **53,25 %** | **[49,49 % ; 56,99 %]** | **27,59 %** | **0,363** | **1** | **48,85 min actifs** | **110 (100 PV)** | **3 213 542** | `missing source` |
| Mise au point (50 PV, 372) | GPT-6.2-Astra low (codex) | 50/50 | 178/372 | 52,15 % | [47,08 % ; 57,18 %] | 28,32 % | 0,367 | 0 | — | 50 | — | `missing source` |
| Aveugle (50 PV, 304) | GPT-6.2-Astra low (codex) | 49/50 | 138/304 | 54,61 % | [48,99 % ; 60,11 %] | 26,77 % | 0,359 | 1 | — | 50 | — | `missing source` |
| Total (100 PV, 676) | Muse Wonder 1.0 low (repli v12) | 90/100 | 451/676 | 33,30 % | — | 36,10 % | 0,346 | 10 | v12 | 100 | v12 | 0,2731 USD API/doc (`missing source` siège) |
| Total (100 PV, 676) | **Fable 5.2 low (claude)** | **100/100** | **440/676** | **34,91 %** | **[31,41 % ; 38,58 %]** | **32,73 %** | **0,338** | **0** | **19,84 min** | **103 (100 PV)** | **3 661 482** | `missing source` |
| Mise au point (50 PV, 372) | Fable 5.2 low (claude) | 50/50 | 235/372 | 36,83 % | [32,08 % ; 41,84 %] | 35,40 % | 0,361 | 0 | — | 50 | — | `missing source` |
| Aveugle (50 PV, 304) | Fable 5.2 low (claude) | 50/50 | 205/304 | 32,57 % | [27,54 % ; 38,02 %] | 29,64 % | 0,310 | 0 | — | 50 | — | `missing source` |
| Total (100 PV, 676) | **Gemini 4 Hydrogen low (agy)** | **96/100** | **453/676** | **32,99 %** | **[29,55 % ; 36,62 %]** | **28,05 %** | **0,303** | **4** | **18,67 min** | **100** | **3 716 728** | `missing source` |
| Mise au point (50 PV, 372) | Gemini 4 Hydrogen low (agy) | 48/50 | 234/372 | 37,10 % | [32,34 % ; 42,11 %] | 30,60 % | 0,335 | 2 | — | 50 | — | `missing source` |
| Aveugle (50 PV, 304) | Gemini 4 Hydrogen low (agy) | 48/50 | 219/304 | 27,96 % | [23,21 % ; 33,26 %] | 24,71 % | 0,262 | 2 | — | 50 | — | `missing source` |
| Total (100 PV, 676) | **Gemini 4 Neon low (agy)** | **92/100** | **457/676** | **32,40 %** | **[28,98 % ; 36,02 %]** | **24,41 %** | **0,278** | **8** | **48,34 min actifs** | **114 (100 PV)** | **3 771 530** | `missing source` |
| Mise au point (50 PV, 372) | Gemini 4 Neon low (agy) | 46/50 | 230/372 | 38,17 % | [33,38 % ; 43,21 %] | 27,10 % | 0,317 | 4 | — | 50 | — | `missing source` |
| Aveugle (50 PV, 304) | Gemini 4 Neon low (agy) | 46/50 | 227/304 | 25,33 % | [20,77 % ; 30,50 %] | 20,64 % | 0,227 | 4 | — | 50 | — | `missing source` |

Notes B :
- **CP+ (`Astra 6.2 low` → `Gemini 3.8 Flash low`)** : sorties Astra 6.2 low réutilisées depuis le cache (0 ré-extraction). Prompt vérifié identique octet par octet (`SHA-256 cf015e57c6e1cd1404efc7e22ddb014da0e4851aba9befea9ef39cae46094b68`) entre `api/src/services/graph/refresh-verification-prompt.ts:2-14` et `harness/cp-prompt-filtre.md:4-16` ; même logique `actsOf`/`filterUserMessage`/`applyDecisions` (`harness/precision-cascade.mjs:48-116` = `api/src/services/graph/refresh-verification.ts:88-204`). 1 285 actes jugés, **541 retirés** (`-538 FP`, **1 seul TP perdu**), `unknownIds: 0`, `keptNoValidDecision: 37`, `supportedUngrounded: 7`, `fallbackUnchanged: 1`. Vérificateur Flash : 103 appels (100 `code 0`), 7,20 min (`p50 14,7 s`, `p90 27,6 s`), 2 530 961 jetons. Autres métriques : F1 large `0,486` ; tolérant étape F1 `0,657` (`R 70,12 %`, `P 61,80 %`) ; souple `0,502` ; F1 4 docs humains `0,686`. Agrégats : `cp-astra-6.2-flash-bench-b-aggregates.json`.
- **GPT-6.2-Astra low** : **99/100 acceptés**, 1 invalide (`J=0, V=1, Pr=0, T=0`), 0 événement d'outil sur les 100 appels modèle. Reprise après coupure réseau hôte (`12 h 17–12 h 46` Montréal, 8 entrées `code: null` archivées par `fs.renameSync` dans `cache-failed-20261120T1908/`). Total actif : 48,85 min (`p50 162,9 s`, `p90 252,6 s`), 110 appels journalisés, 3 213 542 jetons, quota hebdo Codex `2 % -> 10 %`. Agrégats : `astra-6.2-bench-b-aggregates.json`.
- **Fable 5.2 low** : **100/100 acceptés** (`J=0, V=0, Pr=0, T=0`), **0 événement d'outil**. Concurrence 10, 19,84 min (`p50 72,3 s`, `p90 158,6 s`), 103 appels journalisés (103/103 `code 0` ; 3 appels en vol repris après correction du statut `allowed_warning` à 25 % hebdo), **3 661 482 jetons** retenus (`2 555 496` entrée dont `65 789` cache, `1 105 986` sortie ; `3 770 827` sur les 103 appels dont `153 163` réflexion), quota hebdo Claude `18 % -> 25 %`, 0 refus. Autres métriques : F1 large `0,331` ; tolérant étape F1 `0,395` (`+40`) ; souple F1 `0,418` (`+56`) ; F1 4 docs humains `0,559`. Agrégats : `fable-5.2-bench-b-aggregates.json`.
- **Hydrogen low** : 96/100 acceptés (`J=0, V=2, Pr=0, T=2`, 2 collisions MCP AGY au démarrage, 0 événement d'outil sur les 98 appels modèle), 18,67 min (`p50 42,3 s`, `p90 66,6 s`), 3 716 728 jetons. Agrégats : `hydrogen-bench-b-aggregates.json`.
- **Neon low** : 92/100 acceptés (`J=0, V=1, Pr=0, T=7`, 7 collisions MCP AGY au démarrage, 92/93 appels modèle acceptés), 48,34 min actifs (14 échecs auth transitoires archivés dans `cache-failed-20261120T0257/` puis repris), 3 771 530 jetons. Agrégats : `neon-bench-b-aggregates.json`.

---

## 2. Benchmark C — classification seule (jeux C, mode B, prompt v2)

Protocole figé : jeux C (252 unités mise au point dont 95 P ∪ S ; 252 unités aveugle dont 94 P ∪ S), mode B (réannotation), prompt v2 SHA-256 `34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50`. D4 exige zéro manqué P ∪ S. Aucune donnée par unité aveugle publiée.

| Jeu | Modèle | Manqués P ∪ S | Rappel | Wilson 95 % rappel | Précision | D4 | Invalides | Durée | Appels | Jetons | Coût estimé |
|---|---|---:|---:|---|---:|---|---:|---:|---:|---:|---|
| Mise au point | Astra low v2 (baseline) | 0/95 | 100,00 % | [96,11 % ; 100,00 %] | 67,38 % | réussi | 0 | 3,37 min | 252 | `missing source` | `missing source` |
| Mise au point | **Fable 5.2 low (claude)** | **0/95** | **100,00 %** | **[96,11 % ; 100,00 %]** | **73,64 %** | **réussi** | **0** | **2,21 min** | **252** | **3 328 062** | `missing source` |
| Mise au point | **GPT-6.2-Astra low** | **1/95** | **98,95 %** | **[94,28 % ; 99,81 %]** | **68,12 %** | **échoué** | **0** | **3,85 min actifs** | **262 (252 u.)** | **4 346 303** | `missing source` |
| Mise au point | **Gemini 4 Hydrogen low** | **0/95** | **100,00 %** | **[96,11 % ; 100,00 %]** | **70,90 %** | **réussi** | **1** | ~11 min | 252 | ~4,8 M | `missing source` |
| Mise au point | **Gemini 4 Neon low** | **0/95** | **100,00 %** | **[96,11 % ; 100,00 %]** | **75,40 %** | **réussi** | **0** | **16,78 min** | **252** | **4 735 833** | `missing source` |
| Mise au point | Muse Wonder 1.0 low (série 13, P0) | 0/95 | 100,00 % | [96,11 % ; 100,00 %] | 59,01 % | réussi | 0 | `missing source` | 252 | `missing source` | `missing source` |
| Mise au point | Gemini 3.8 Flash low (v2 B) | `missing source` | — | — | — | — | — | — | — | — | `missing source` |
| Aveugle | Astra low v2 (baseline) | 0/94 | 100,00 % | [96,07 % ; 100,00 %] | 71,76 % | réussi | 0 | 3,98 min | 252 | `missing source` | `missing source` |
| Aveugle | **GPT-6.2-Astra low** | **0/94** | **100,00 %** | **[96,07 % ; 100,00 %]** | **76,42 %** | **réussi** | **0** | **3,40 min** | **252** | **4 171 742** | `missing source` |
| Aveugle | **Fable 5.2 low (claude)** | **1/94** | **98,94 %** | **[94,22 % ; 99,81 %]** | **78,81 %** | **échoué** | **0** | **2,19 min** | **252** | **3 296 525** | `missing source` |
| Aveugle | **Gemini 4 Hydrogen low** | **2/94** | **97,87 %** | **[92,57 % ; 99,41 %]** | **76,67 %** | **échoué** | **1** | 9,91 min | 252 | ~4,8 M | `missing source` |
| Aveugle | **Gemini 4 Neon low** | **3/94** | **96,81 %** | **[91,03 % ; 98,91 %]** | **78,45 %** | **échoué** | **0** | **16,79 min** | **252** | **4 787 924** | `missing source` |
| Aveugle | Muse Wonder 1.0 low (série 13, P0) | 1/94 | 98,94 % | [94,22 % ; 99,81 %] | 62,84 % | échoué | 0 | `missing source` | 252 | `missing source` | `missing source` |
| Aveugle | Gemini 3.8 Flash low (v2 B) | `missing source` | — | — | — | — | — | — | — | — | `missing source` |

Notes C :
- **Fable 5.2 low** : 504/504 appels `code 0`, **0 événement d'outil**, **0 invalide**, concurrence 10, 0 refus de quota (`25 % -> 34 %` hebdo Claude), **4,40 min** au total (2,21 min mise au point p50 `4,95 s` + 2,19 min aveugle p50 `5,19 s`), **6 624 587 jetons** (6 432 975 entrée, 191 612 sortie dont 125 197 réflexion), coût `missing source`. Agrégats : `fable-5.2-tuning-aggregates.json`, `fable-5.2-blind-aggregates.json`.
- **GPT-6.2-Astra low** : 514/514 appels `code 0` (504 unités ; 10 appels en vol repris), 0 événement d'outil, 0 invalide, concurrence 10, 0 refus de quota (`11 % -> 14 %` hebdo Codex), **7,25 min actifs**, **8 518 045 jetons**, coût `missing source`. Agrégats : `astra-6.2-tuning-aggregates.json`, `astra-6.2-blind-aggregates.json`.
- **Hydrogen low** : 504 appels (502 code 0, 2 échecs comptés invalides), concurrence 4, ~21 min, **9 604 776 jetons**. Agrégats : `hydrogen-tuning-aggregates.json`, `hydrogen-blind-aggregates.json`.
- **Neon low** : 504/504 code 0, 0 événement d'outil, 0 invalide, concurrence 4, 33,57 min, **9 523 757 jetons**. Agrégats : `neon-tuning-aggregates.json`, `neon-blind-aggregates.json`.
- **Muse Wonder 1.0 low** : série 13 existante (prompt P0, comparaison indicative ; quota Muse à 92 % hebdo préservé).

---

## 3. Généralisation du harnais et catalogue vérifié

- `tools/classif/run-seat.mjs`, `tools/classif/csets/{seat,run,bench-b,bench-b-score,bench-b-cp,inputs,matching,quota}.mjs` et `tools/classif/csets.mk` couvrent B, B-CP+ et C par `BENCH_MODEL` et `BENCH_CONCURRENCY`.
- Identifiants vérifiés : `gemini-4-hydrogen-low`, `gemini-4-neon-low`, `gemini-3.8-flash-low` (`agy`), `gpt-6.2-astra` (`astra-6.2-low`, Codex `0.171.0+`), `claude-fable-5-2` (`fable-5.2-low`, `claude -p --output-format stream-json --verbose`, `rate_limit_event` suivi sur chaque appel).
- Garde de quota : arrêt à 90 % hebdo (`used_percent >= 90` ou statut rejeté) et arrêt immédiat sur `429`/refus quota/auth sans mise en cache, reprise par cache.

---

## 4. État du calendrier (complet)

| Ordre | Modèle / Route | Siège | Statut | Quota observé |
|---|---|---|---|---|
| 1 | **Gemini 4 Hydrogen low** | AGY | Terminé (B + C) | 0 refus |
| 2 | **Gemini 4 Neon low** | AGY | Terminé (B + C) | 0 refus |
| 3 | **GPT-6.2-Astra low** | Codex | Terminé (B + C) | Hebdo `2 % -> 14 %` (0 refus) |
| 4 | **CP+ (`Astra 6.2 low → Flash low`)** | Cache Codex + AGY | Terminé (B) | 0 refus |
| 5 | **Fable 5.2 low** | Claude | Terminé (B + C) | Hebdo `18 % -> 34 %` (0 refus, reset 26 nov. 17 h 00 Montréal) |
