# Benchmarks B et C — comparatif modèles (`gemini-4-hydrogen-low`, `gemini-4-neon-low`, `astra-6.2-low`)

## Verdicts en tête

### GPT-6.2-Astra low (`astra-6.2-low`, siège Codex)
- **Sur B (détection PV, 100 PV / oracle 676)** : **non en primaire à prompt figé v11/v12**.
  - Meilleure acceptation (**99/100**, `J=0, V=1, Pr=0, T=0`) et **meilleur rappel strict des modèles `low`** (**53,25 %**, 316/676 manqués vs 49,10 % / 344 pour GPT-6 Astra low — au niveau de GPT-6 Astra medium à 53,40 %, et **71,75 %** tolérant étape), mais forte sur-détection (**945 FP**, précision **27,59 %** vs 37,30 %), qui ramène le F1 strict à **0,363** (vs **0,424** pour Astra low).
- **Sur C (classification seule, mode B, prompt v2)** : **candidat primaire crédible, avec réserve 1/95 en mise au point**.
  - **Aveugle** : **seul modèle candidat à réussir D4** (**0/94 manqué**, rappel **100,00 %**), avec une précision de **76,42 %** (**+4,66 pts** vs Astra low v2 à 71,76 %), **0 invalide**, et rapide (**3,40 min** à concurrence 10 vs 3,98 min pour Astra low v2).
  - **Mise au point** : **1/95 manqué P ∪ S** (rappel 98,95 %, précision **68,12 %** vs 67,38 %, **D4 échoué**, 0 invalide). Coût quota très faible : **+3 %** hebdo Codex sur les 514 appels C (`11 % -> 14 %`).

### Gemini 4 Hydrogen low
- **En primaire (remplacement d'Astra low)** : **non** sur B comme sur C.
  - **B (détection PV, 100 PV / oracle 676)** : F1 strict **0,303** (P 28,05 %, R 32,99 %) contre **0,424** pour GPT-6 Astra low (P 37,3 %, R 49,1 %) — net recul (-16,1 pts de rappel, -9,2 pts de précision).
  - **C (classification seule, mode B, prompt v2)** : **2/94 manqués P ∪ S** en aveugle (rappel 97,87 %, **D4 échoué**) contre 0/94 pour Astra low v2 (D4 réussi).
- **En repli (remplacement de `gemini-3.8-flash` low)** : **non à qualité égale sur B ; candidat crédible sur C avec réserve D4**.
  - **B** : meilleure acceptation (**96/100** vs 85/100) et léger gain de rappel (**32,99 %** vs 30,0 %), mais forte perte de précision (**28,05 %** vs 47,5 %, F1 0,303 vs 0,368) : beaucoup plus de faux positifs (572 FP).
  - **C** : précision supérieure au baseline Astra (+3,5 pts mise au point, +4,9 pts aveugle) et très au-dessus de Flash (qui échouait sur P0 série 9), mais D4 échoue en aveugle (2 manqués).

### Gemini 4 Neon low
- **En primaire et face à Hydrogen low** : **non**. Dominé par Astra low sur B et C, et dominé par Hydrogen low sur B comme sur le rappel C.
  - **B (100 PV / oracle 676)** : 92/100 acceptés, F1 strict **0,278** (P 24,41 %, R 32,40 %, 457/676 manqués ; aveugle F1 0,227), 2,6× plus lent que Hydrogen (48,34 min actifs vs 18,67 min ; p50 114,7 s vs 42,3 s).
  - **C (mode B, prompt v2)** : meilleure précision mesurée (**75,40 %** mise au point, **78,45 %** aveugle, **0 invalide** sur 504), mais **3/94 manqués P ∪ S** en aveugle (rappel 96,81 %, **D4 échoué**) et 1,6× plus lent que Hydrogen (33,57 min vs ~21 min).

---

## 1. Benchmark B — détection PV (oracle 676, protocole gelé v11/v12)

Protocole figé : 100 PV du manifeste `v101b` (50 mise au point = 372 actes, 50 aveugle = 304 actes ; total 676 actes + 43 non résolus neutres). Prompt système SHA-256 `bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461` et 100 prompts documentaires vérifiés octet par octet avant tout appel. Validateur gelé v9 (`validate-outputs.mjs`) et scoreur `score-676.mjs` inchangés. Agrégats seulement ; aucune donnée par document aveugle publiée.

| Jeu | Modèle | Acceptés | Manqués | Rappel strict | Wilson 95 % rappel | Précision | F1 strict | Invalides | Durée | Appels | Jetons | Coût estimé |
|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---|
| Total (100 PV, 676) | GPT-6 Astra medium (v12) | 99/100 | 315/676 | 53,40 % | — | 37,10 % | 0,438 | 1 | v12 | 100 | v12 | 0,4689 USD API/doc (0,0207 siège) |
| Total (100 PV, 676) | GPT-6 Astra low (baseline v12) | 100/100 | 344/676 | 49,10 % | — | 37,30 % | 0,424 | 0 | v12 | 100 | v12 | 0,4072 USD API/doc (0,0180 siège) |
| Total (100 PV, 676) | Gemini 4 Argon low (v12, agy) | 88/100 | 386/676 | 42,90 % | — | 33,00 % | 0,373 | 12 | v12 | 140 | v12 | 0,2074 USD API/doc (0,00801 siège) |
| Total (100 PV, 676) | Muse Wonder 1.0 low (repli v12) | 90/100 | 451/676 | 33,30 % | — | 36,10 % | 0,346 | 10 | v12 | 100 | v12 | 0,2731 USD API/doc (`missing source` siège) |
| Total (100 PV, 676) | Gemini 3.8 Flash low (repli v12) | 85/100 | 473/676 | 30,00 % | — | 47,50 % | 0,368 | 15 | v12 | 100 | v12 | 0,0376 USD API/doc (0,00143 siège) |
| Total (100 PV, 676) | **GPT-6.2-Astra low (codex)** | **99/100** | **316/676** | **53,25 %** | **[49,49 % ; 56,99 %]** | **27,59 %** | **0,363** | **1** | **48,85 min actifs** | **110 (100 PV)** | **3 213 542** | `missing source` |
| Mise au point (50 PV, 372) | GPT-6.2-Astra low (codex) | 50/50 | 178/372 | 52,15 % | [47,08 % ; 57,18 %] | 28,32 % | 0,367 | 0 | — | 50 | — | `missing source` |
| Aveugle (50 PV, 304) | GPT-6.2-Astra low (codex) | 49/50 | 138/304 | 54,61 % | [48,99 % ; 60,11 %] | 26,77 % | 0,359 | 1 | — | 50 | — | `missing source` |
| Total (100 PV, 676) | **Gemini 4 Hydrogen low (agy)** | **96/100** | **453/676** | **32,99 %** | **[29,55 % ; 36,62 %]** | **28,05 %** | **0,303** | **4** | **18,67 min** | **100** | **3 716 728** | `missing source` |
| Mise au point (50 PV, 372) | Gemini 4 Hydrogen low (agy) | 48/50 | 234/372 | 37,10 % | [32,34 % ; 42,11 %] | 30,60 % | 0,335 | 2 | — | 50 | — | `missing source` |
| Aveugle (50 PV, 304) | Gemini 4 Hydrogen low (agy) | 48/50 | 219/304 | 27,96 % | [23,21 % ; 33,26 %] | 24,71 % | 0,262 | 2 | — | 50 | — | `missing source` |
| Total (100 PV, 676) | **Gemini 4 Neon low (agy)** | **92/100** | **457/676** | **32,40 %** | **[28,98 % ; 36,02 %]** | **24,41 %** | **0,278** | **8** | **48,34 min actifs** | **114 (100 PV)** | **3 771 530** | `missing source` |
| Mise au point (50 PV, 372) | Gemini 4 Neon low (agy) | 46/50 | 230/372 | 38,17 % | [33,38 % ; 43,21 %] | 27,10 % | 0,317 | 4 | — | 50 | — | `missing source` |
| Aveugle (50 PV, 304) | Gemini 4 Neon low (agy) | 46/50 | 227/304 | 25,33 % | [20,77 % ; 30,50 %] | 20,64 % | 0,227 | 4 | — | 50 | — | `missing source` |

Notes B GPT-6.2-Astra low :
- **Validation** : **99/100 acceptés**, 1 invalide (`J=0, V=1, Pr=0, T=0`), **0 événement d'outil** sur les 100 appels parvenus au modèle.
- **Reprise réseau** : passage 1 à concurrence 4 (47 PV, 27,50 min) puis bascule à concurrence 10 ; coupure réseau de l'hôte entre `17:17` et `17:46 UTC` (`Network unreachable` / `Host is unreachable`, 10 échecs `code: null`, `0` octet dont 8 entrées archivées via `fs.renameSync` dans `cache-failed-20261120T1908/`), suivie de la reprise des 50 PV restants à concurrence 10 (`18,62 min`, 50/50 `okRun: true`). Total actif : **48,85 min** (`p50 162,9 s`, `p90 252,6 s`), 110 appels journalisés, 0 refus de quota (`2 % -> 10 %` hebdo Codex, incluant le sweep prod de 17:00 UTC).
- **Autres métriques oracle 676** : F1 large `0,359` ; tolérant étape F1 `0,489` (R `71,75 %`, P `37,14 %`, `+125`) ; souple F1 `0,366` (`+3`) ; F1 4 docs humains `0,533`.
- **Jetons** : **3 213 542** (`2 406 789` entrée dont `562 560` cache, `806 753` sortie). Coût : `missing source`. Agrégats : `astra-6.2-bench-b-aggregates.json`.

Notes B Hydrogen low :
- **Validation** : 96/100 acceptés, 4 invalides (`J=0, V=2, Pr=0, T=2`). Les 2 échecs `T` sont des collisions MCP au démarrage concurrent d'AGY (`mcp_h2a_render_BarChart`, code 3, 0 jeton, aucun appel modèle ; même incident documenté pour Argon en v12). Sur les 98 appels modèle : **0 événement d'outil**, 96/98 acceptés (97,96 %). Les 2 échecs `T` restent au dénominateur strict, sans relance.
- **Autres métriques oracle 676** : F1 large `0,296` ; tolérant étape `0,367` (+47) ; souple `0,341` (+28) ; F1 4 docs humains `0,568`.
- **Exécution** : `agy` (`gemini-4-hydrogen-low`), concurrence 4, 0 refus de quota, 18,67 min (p50 42,3 s, p90 66,6 s), 3 716 728 jetons (2 666 145 entrée, 1 050 583 sortie dont 182 280 réflexion, 17 743 cache). Coût : `missing source`. Agrégats : `hydrogen-bench-b-aggregates.json`.

Notes B Neon low :
- **Validation** : 92/100 acceptés, 8 invalides (`J=0, V=1, Pr=0, T=7`). Sur les 93 appels parvenus au modèle : **0 événement d'outil**, 92/93 acceptés (98,92 %), 0 JSON, 0 provenance, 1 profil (`V=1`). Les 7 échecs `T` sont tous des collisions MCP au démarrage concurrent (`mcp_h2a_render_BarChart`, code 3, 0 jeton : 2 au passage principal + 5 au redémarrage de reprise), conservés invalides au dénominateur strict sans rejeu.
- **Reprise auth** : 14 échecs transitoires d'authentification AGY (`authentication failed or timed out`, 0 jeton, aucun appel modèle) archivés dans `cache-failed-20261120T0257/` puis repris par cache après renforcement de la garde `auth` dans `bench-b.mjs` et `run.mjs`. Total : 114 appels journalisés pour 100 PV, durée active 48,34 min (43,22 min passage 1 + 5,12 min reprise ; 121,4 min murale pause incluse ; p50 114,7 s, p90 187,5 s), 0 refus de quota.
- **Autres métriques oracle 676** : F1 large `0,273` ; tolérant étape `0,342` (+50) ; souple `0,324` (+36) ; F1 4 docs humains `0,357`.
- **Jetons** : 3 771 530 (2 347 901 entrée, 1 423 629 sortie dont 317 793 réflexion, 68 175 cache). Coût : `missing source`. Agrégats : `neon-bench-b-aggregates.json`.

---

## 2. Benchmark C — classification seule (jeux C, mode B, prompt v2)

Protocole figé : jeux C (252 unités mise au point dont 95 P ∪ S ; 252 unités aveugle dont 94 P ∪ S), mode B (réannotation), prompt v2 SHA-256 `34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50`. D4 exige zéro manqué P ∪ S. Aucune donnée par unité aveugle publiée.

| Jeu | Modèle | Manqués P ∪ S | Rappel | Wilson 95 % rappel | Précision | D4 | Invalides | Durée | Appels | Jetons | Coût estimé |
|---|---|---:|---:|---|---:|---|---:|---:|---:|---:|---|
| Mise au point | Astra low v2 (baseline) | 0/95 | 100,00 % | [96,11 % ; 100,00 %] | 67,38 % | réussi | 0 | 3,37 min | 252 | `missing source` | `missing source` |
| Mise au point | **GPT-6.2-Astra low** | **1/95** | **98,95 %** | **[94,28 % ; 99,81 %]** | **68,12 %** | **échoué** | **0** | **3,85 min actifs** | **262 (252 u.)** | **4 346 303** | `missing source` |
| Mise au point | **Gemini 4 Hydrogen low** | **0/95** | **100,00 %** | **[96,11 % ; 100,00 %]** | **70,90 %** | **réussi** | **1** | ~11 min | 252 | ~4,8 M | `missing source` |
| Mise au point | **Gemini 4 Neon low** | **0/95** | **100,00 %** | **[96,11 % ; 100,00 %]** | **75,40 %** | **réussi** | **0** | **16,78 min** | **252** | **4 735 833** | `missing source` |
| Mise au point | Muse Wonder 1.0 low (série 13, P0) | 0/95 | 100,00 % | [96,11 % ; 100,00 %] | 59,01 % | réussi | 0 | `missing source` | 252 | `missing source` | `missing source` |
| Mise au point | Gemini 3.8 Flash low (v2 B) | `missing source` | — | — | — | — | — | — | — | — | `missing source` |
| Aveugle | Astra low v2 (baseline) | 0/94 | 100,00 % | [96,07 % ; 100,00 %] | 71,76 % | réussi | 0 | 3,98 min | 252 | `missing source` | `missing source` |
| Aveugle | **GPT-6.2-Astra low** | **0/94** | **100,00 %** | **[96,07 % ; 100,00 %]** | **76,42 %** | **réussi** | **0** | **3,40 min** | **252** | **4 171 742** | `missing source` |
| Aveugle | **Gemini 4 Hydrogen low** | **2/94** | **97,87 %** | **[92,57 % ; 99,41 %]** | **76,67 %** | **échoué** | **1** | 9,91 min | 252 | ~4,8 M | `missing source` |
| Aveugle | **Gemini 4 Neon low** | **3/94** | **96,81 %** | **[91,03 % ; 98,91 %]** | **78,45 %** | **échoué** | **0** | **16,79 min** | **252** | **4 787 924** | `missing source` |
| Aveugle | Muse Wonder 1.0 low (série 13, P0) | 1/94 | 98,94 % | [94,22 % ; 99,81 %] | 62,84 % | échoué | 0 | `missing source` | 252 | `missing source` | `missing source` |
| Aveugle | Gemini 3.8 Flash low (v2 B) | `missing source` | — | — | — | — | — | — | — | — | `missing source` |

Notes C :
- **GPT-6.2-Astra low** : 514/514 appels `code 0` (504 unités ; 10 appels en vol non mis en cache lors d'un arrêt faux-positif sur repli WebSocket `403`, corrigé puis repris), **0 événement d'outil**, **0 invalide**, concurrence 10, 0 refus de quota (`11 % -> 14 %` hebdo Codex), **7,25 min actifs** (3,85 min mise au point p50 `6,71 s` + 3,40 min aveugle p50 `6,29 s`), **8 518 045 jetons** (8 475 206 entrée dont 3 966 208 cache, 42 839 sortie dont 918 réflexion), coût `missing source`. Agrégats : `astra-6.2-tuning-aggregates.json`, `astra-6.2-blind-aggregates.json`.
- **Hydrogen low** : 504 appels (502 code 0, 2 échecs comptés invalides), concurrence 4, ~21 min au total (reprise par cache à 184/252 en mise au point), **9 604 776 jetons**, coût `missing source`. Agrégats : `hydrogen-tuning-aggregates.json`, `hydrogen-blind-aggregates.json`.
- **Neon low** : 504/504 code 0, **0 événement d'outil**, **0 invalide**, concurrence 4, 0 refus de quota, **33,57 min** au total (16,79 min aveugle puis 16,78 min mise au point), **9 523 757 jetons** (8 829 196 entrée, 694 561 sortie dont 644 943 réflexion, 366 744 cache), coût `missing source`. Agrégats : `neon-tuning-aggregates.json`, `neon-blind-aggregates.json`.
- **Muse Wonder 1.0 low** : mesures de la série 13 existante (prompt P0 SHA-256 `a60713366128ae4348a45a7323d0b0984cef87ca6cb33eda15073c045235b016`, mêmes 252 + 252 unités C ; sources `series-13-dev.json` et `blind/series-13-aggregates.json`). Aucun appel v2 lancé : sonde `muse usage --json` à **92 % hebdo** (seuil 90 % dépassé, réinitialisation `2026-11-23T00:00:00Z`), quota Muse préservé. Prompt P0 ≠ v2 : comparaison indicative.
- **Gemini 3.8 Flash low** : `missing source` sur prompt v2 mode B (à titre indicatif sur prompt P0 série 9 mise au point seule : 5/95 manqués, rappel 94,74 %, précision 24,57 %, 126/252 échecs, non lancé en aveugle).

---

## 3. Généralisation du harnais et catalogue vérifié

- `tools/classif/run-seat.mjs`, `tools/classif/csets/seat.mjs`, `tools/classif/csets/run.mjs`, `tools/classif/csets/bench-b.mjs`, `tools/classif/csets/bench-b-score.mjs`, `tools/classif/csets/inputs.mjs`, `tools/classif/csets/matching.mjs` et `tools/classif/csets.mk` acceptent `BENCH_MODEL` et `BENCH_CONCURRENCY` pour B comme pour C.
- Identifiants vérifiés dans les catalogues locaux : `gemini-4-hydrogen-low`, `gemini-4-neon-low` (`agy models`), `gpt-6.2-astra` (`astra-6.2-low`, effort `low`, `~/.codex/models_cache.json`, requiert Codex CLI `0.171.0+` résolu via `seat.mjs` + `[agents].enabled = false` et notice de dépréciation `multi_agent` dans `run-seat.mjs`).
- Garde de quota et d'authentification :
  - Codex (`astra-low`, `astra-6.2-low`) : sonde fraîche obligatoire (`quota-start.json`), arrêt à 90 % hebdo et arrêt immédiat sur `429`/refus quota/auth sans mise en cache, concurrence 10, reprise par cache.
  - AGY (`gemini-4-hydrogen-low`, `gemini-4-neon-low`, `gemini-3.8-flash-low`) : concurrence 4, arrêt immédiat sur refus 429/quota/auth (`401`/`403`/`authentication`) sans mettre en cache l'appel refusé, reprise par cache sans relance selon la classe.

---

## 4. État du calendrier (complet)

| Ordre | Modèle | Route | Statut B + C | Quota observé |
|---|---|---|---|---|
| 1 | **Gemini 4 Hydrogen low** | `gemini-4-hydrogen-low` (AGY) | Terminé (B + C) | 0 refus |
| 2 | **Gemini 4 Neon low** | `gemini-4-neon-low` (AGY) | Terminé (B + C) | 0 refus |
| 3 | **GPT-6.2-Astra low** | `astra-6.2-low` (Codex) | Terminé (B + C) | Hebdo `2 % -> 14 %` (0 refus) |
