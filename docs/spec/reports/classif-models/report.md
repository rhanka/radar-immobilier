# Benchmarks B et C — comparatif modèles (`gemini-4-hydrogen-low`)

## Verdict en tête — Gemini 4 Hydrogen low

- **En primaire (remplacement d'Astra low)** : **non** sur B comme sur C.
  - **B (détection PV, 100 PV / oracle 676)** : F1 strict **0,303** (P 28,05 %, R 32,99 %) contre **0,424** pour GPT-6 Astra low (P 37,3 %, R 49,1 %) — net recul (-16,1 pts de rappel, -9,2 pts de précision).
  - **C (classification seule, mode B, prompt v2)** : **2/94 manqués P ∪ S** en aveugle (rappel 97,87 %, **D4 échoué**) contre 0/94 pour Astra low v2 (D4 réussi).
- **En repli (remplacement de `gemini-3.8-flash` low)** : **non à qualité égale sur B ; candidat crédible sur C avec réserve D4**.
  - **B** : meilleure acceptation (**96/100** vs 85/100) et léger gain de rappel (**32,99 %** vs 30,0 %), mais forte perte de précision (**28,05 %** vs 47,5 %, F1 0,303 vs 0,368) : beaucoup plus de faux positifs (572 FP).
  - **C** : précision supérieure au baseline Astra (+3,5 pts mise au point, +4,9 pts aveugle) et très au-dessus de Flash (qui échouait sur P0 série 9), mais D4 échoue en aveugle (2 manqués).

---

## 1. Benchmark B — détection PV (oracle 676, protocole gelé v11/v12)

Protocole figé : 100 PV du manifeste `v101b` (50 mise au point = 372 actes, 50 aveugle = 304 actes ; total 676 actes + 43 non résolus neutres). Prompt système SHA-256 `bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461` et 100 prompts documentaires vérifiés octet par octet avant tout appel. Validateur gelé v9 (`validate-outputs.mjs`) et scoreur `score-676.mjs` inchangés. Agrégats seulement ; aucune donnée par document aveugle publiée.

| Jeu | Modèle | Acceptés | Manqués | Rappel strict | Wilson 95 % rappel | Précision | F1 strict | Invalides | Durée | Appels | Coût estimé |
|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---|
| Total (100 PV, 676) | GPT-6 Astra medium (v12) | 99/100 | 315/676 | 53,40 % | — | 37,10 % | 0,438 | 1 | v12 | 100 | 0,4689 USD API/doc (0,0207 siège) |
| Total (100 PV, 676) | GPT-6 Astra low (baseline v12) | 100/100 | 344/676 | 49,10 % | — | 37,30 % | 0,424 | 0 | v12 | 100 | 0,4072 USD API/doc (0,0180 siège) |
| Total (100 PV, 676) | Gemini 4 Argon low (v12, agy) | 88/100 | 386/676 | 42,90 % | — | 33,00 % | 0,373 | 12 | v12 | 140 | 0,2074 USD API/doc (0,00801 siège) |
| Total (100 PV, 676) | Muse Wonder 1.0 low (repli v12) | 90/100 | 451/676 | 33,30 % | — | 36,10 % | 0,346 | 10 | v12 | 100 | 0,2731 USD API/doc (`missing source` siège) |
| Total (100 PV, 676) | Gemini 3.8 Flash low (repli v12) | 85/100 | 473/676 | 30,00 % | — | 47,50 % | 0,368 | 15 | v12 | 100 | 0,0376 USD API/doc (0,00143 siège) |
| Total (100 PV, 676) | **Gemini 4 Hydrogen low (agy)** | **96/100** | **453/676** | **32,99 %** | **[29,55 % ; 36,62 %]** | **28,05 %** | **0,303** | **4** | **18,67 min** | **100** | `missing source` |
| Mise au point (50 PV, 372) | **Gemini 4 Hydrogen low (agy)** | **48/50** | **234/372** | **37,10 %** | **[32,34 % ; 42,11 %]** | **30,60 %** | **0,335** | **2** | — | 50 | `missing source` |
| Aveugle (50 PV, 304) | **Gemini 4 Hydrogen low (agy)** | **48/50** | **219/304** | **27,96 %** | **[23,21 % ; 33,26 %]** | **24,71 %** | **0,262** | **2** | — | 50 | `missing source` |

Notes B Hydrogen low :
- **Détail validation** : 96/100 acceptés, 4 invalides (`J=0`, `V=2`, `Pr=0`, `T=2`). Les 2 échecs `T` sont des collisions de construction de boîte à outils MCP au démarrage concurrent d'AGY (code 3, 0 jeton, aucun appel modèle ; même incident documenté pour Argon en v12). Sur les 98 appels parvenus au modèle : **0 événement d'outil**, 96/98 acceptés (97,96 %), 0 erreur JSON, 0 erreur de provenance. Les 2 échecs `T` restent comptés invalides au dénominateur strict, sans relance.
- **Autres métriques oracle 676** : F1 large `0,296` (R 31,15 %, P 28,14 %) ; tolérant étape `0,367` (+47 appariements, R 39,94 %) ; souple `0,341` (+28 appariements, R 37,13 %) ; F1 sur les 4 documents humains : `0,568`.
- **Exécution B** : transport `agy` (`gemini-4-hydrogen-low`), concurrence 4, garde d'arrêt 429/quota active (0 refus de quota), durée murale 18,67 min (1 120 s ; latence p50 42,3 s, p90 66,6 s), **3 716 728 jetons** (2 666 145 entrée, 1 050 583 sortie dont 182 280 réflexion, 17 743 cache). Coût : `missing source` (aucun tarif public Hydrogen dans le dépôt). Agrégats : `docs/spec/reports/classif-models/hydrogen-bench-b-aggregates.json`.

---

## 2. Benchmark C — classification seule (jeux C, mode B, prompt v2)

Protocole figé : jeux C (252 unités mise au point dont 95 P ∪ S ; 252 unités aveugle dont 94 P ∪ S), mode B (réannotation), prompt v2 SHA-256 `34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50`. D4 exige zéro manqué P ∪ S. Aucune donnée par unité aveugle publiée.

| Jeu | Modèle | Manqués P ∪ S | Rappel | Wilson 95 % rappel | Précision | D4 | Invalides | Durée | Appels | Coût estimé |
|---|---|---:|---:|---|---:|---|---:|---:|---:|---|
| Mise au point | Astra low v2 (baseline) | 0/95 | 100,00 % | [96,11 % ; 100,00 %] | 67,38 % | réussi | 0 | 3,37 min | 252 | `missing source` |
| Mise au point | **Gemini 4 Hydrogen low** | **0/95** | **100,00 %** | **[96,11 % ; 100,00 %]** | **70,90 %** | **réussi** | **1** | ~11 min | 252 | `missing source` |
| Aveugle | Astra low v2 (baseline) | 0/94 | 100,00 % | [96,07 % ; 100,00 %] | 71,76 % | réussi | 0 | 3,98 min | 252 | `missing source` |
| Aveugle | **Gemini 4 Hydrogen low** | **2/94** | **97,87 %** | **[92,57 % ; 99,41 %]** | **76,67 %** | **échoué** | **1** | 9,91 min | 252 | `missing source` |
| Mise au point | Muse Wonder 1.0 low (série 13, P0) | 0/95 | 100,00 % | [96,11 % ; 100,00 %] | 59,01 % | réussi | 0 | `missing source` | 252 | `missing source` |
| Aveugle | Muse Wonder 1.0 low (série 13, P0) | 1/94 | 98,94 % | [94,22 % ; 99,81 %] | 62,84 % | échoué | 0 | `missing source` | 252 | `missing source` |
| Mise au point | Gemini 3.8 Flash low (v2 B) | `missing source` | — | — | — | — | — | — | — | `missing source` |
| Aveugle | Gemini 3.8 Flash low (v2 B) | `missing source` | — | — | — | — | — | — | — | `missing source` |

Note Muse Wonder 1.0 low sur C : les mesures proviennent de la série 13 existante (prompt P0 SHA-256 `a60713366128ae4348a45a7323d0b0984cef87ca6cb33eda15073c045235b016`, mêmes 252 + 252 unités C ; sources `series-13-dev.json` et `blind/series-13-aggregates.json`). Aucun appel v2 n'a été lancé : sonde `muse usage --json` à **92 % hebdo** (seuil 90 % déjà dépassé, réinitialisation `2026-11-23T00:00:00Z`), et consigne owner d'économiser le quota Muse. Prompt P0 ≠ v2 : comparaison indicative.

Note Flash sur C : aucun agrégat jeux C prompt v2 mode B n'existe pour `gemini-3.8-flash-low` (`missing source`). À titre indicatif uniquement (protocole différent : prompt P0 série 9, mêmes 252 unités mise au point), `gemini-3.8-flash-low` affichait 5/95 manqués (rappel 94,74 %), précision 24,57 % et 126/252 échecs (non lancé en aveugle).

Notes exécution C Hydrogen low :
- Transport : siège `agy` (`gemini-4-hydrogen-low`), concurrence 4, garde 429/quota active.
- Appels : 504 mesurés (252 + 252), 502 en code 0, 2 échecs comptés invalides. Aucune relance selon la classe. Reprise par cache après un arrêt en mise au point à 184/252.
- Durée murale totale : ~21 min pour les deux jeux. Jetons : **9 604 776** au total. Coût : `missing source`.
- Agrégats : `hydrogen-tuning-aggregates.json` et `hydrogen-blind-aggregates.json`.

---

## 3. Généralisation du harnais et catalogue vérifié

- `tools/classif/run-seat.mjs`, `tools/classif/csets/seat.mjs`, `tools/classif/csets/run.mjs`, `tools/classif/csets/bench-b.mjs`, `tools/classif/csets/bench-b-score.mjs` et `tools/classif/csets.mk` acceptent `BENCH_MODEL` et `BENCH_CONCURRENCY` pour B comme pour C.
- Identifiants exacts vérifiés dans les catalogues locaux (2026-11-19) :
  - `gemini-4-hydrogen-low` — vérifié dans `agy models` (`Gemini 4 Hydrogen (Low)`).
  - `gemini-4-neon-low` — vérifié dans `agy models` (`Gemini 4 Neon (Low)`).
  - `gpt-6.2-astra` (route `astra-6.2-low`, effort `low`) — vérifié dans `~/.codex/models_cache.json` (`GPT-6.2-Astra`, `visibility: list`, `default_reasoning_level: low`).
- Garde de quota :
  - Sièges Codex (`astra-low`, `astra-6.2-low`) : sonde fraîche obligatoire (`quota-start.json`), arrêt des nouveaux appels à 90 % du quota hebdomadaire, concurrence 10, reprise par cache.
  - Sièges AGY (`gemini-4-hydrogen-low`, `gemini-4-neon-low`, `gemini-3.8-flash-low`) : arrêt immédiat sur refus 429/quota/auth dans l'enveloppe d'erreur ou `stderr`, concurrence réduite (4), reprise par cache sans relancer une réponse selon sa classe.

---

## 4. Planification Astra 6.2 low puis Neon low (non exécutés)

Aucun appel n'est lancé sur Astra 6.2 low ni Neon low avant feu vert d'i-cond.

| Ordre | Modèle | Route | Volume B + C | Durée estimée | Garde / fenêtre proposée |
|---|---|---|---:|---:|---|
| 1 | **GPT-6.2-Astra low** | `astra-6.2-low` (Codex) | 100 (B) + 504 (C) = 604 appels | ~20 min total (conc. 10) | Après réinitialisation hebdo Codex (**2026-11-20 12:05 UTC** ; coût observé sur Astra low : ~2–3 % par 252 appels C, ~8–12 % pour 100 PV B → ~15 % au total). Sonde fraîche + arrêt à 90 %. Hors fenêtre de sweep prod. |
| 2 | **Gemini 4 Neon low** | `gemini-4-neon-low` (AGY) | 100 (B) + 504 (C) = 604 appels | ~40 min total (conc. 4) | 24–48 h après Hydrogen (ex. **2026-11-21 ou 2026-11-22**) pour étaler le siège AGY : B d'abord (100 PV, ~19 min), pause contrôle, puis C mise au point (252) et C aveugle (252). Arrêt immédiat sur 429/quota, reprise par cache. |
