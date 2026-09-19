# Oracle v3 — corrigé des 100 documents du banc v101b

Statut au 2026-09-18 : **chaîne terminée, référence finale** (`consensus.json`, `final: true`, 674
unités). Chiffres et verdicts : `rapport-reference.md` ; notation des bras : `tableau-f1-100.md` ;
journal de la chaîne (incidents, relances, heures) : `ORACLE_V3_STATUS.md` du conducteur.

## Méthode (décisions owner relayées par i-cond, 2026-09-17 et 2026-09-18)

1. **Sept passes séquentielles de vérification / complément** (on ne refait pas l'annotation, on la
   vérifie et la complète) : astra-pass1 → fable-pass1 → gemini-pass1 → astra-pass2 → fable-pass2 →
   gemini-pass2 → astra-pass3. Modèles : `gpt-6-astra` xhigh (siège Codex, llm-mesh en conteneur),
   `claude-fable-5-1` xhigh (siège Claude, CLI contrainte), `gemini-3.8-flash` high (Cloud Code,
   llm-mesh en conteneur). Chaque passe lit le corrigé courant du document (tête de sa lignée,
   `inputStateStep`), rend des opérations motivées (`add` / `remove` / `correct`), toutes ancrées mot à
   mot dans le texte gelé. `astra-pass1b` = 52 sorties précoces d'une première astra-pass2, archivées
   et gardées dans la lignée (`relabel-astra-pass1b.json`).
2. **Vérification** (`converge-*`) : chaque modèle vote seul, motif obligatoire, sur **chaque** unité
   jamais proposée (versions + « absent »). Entrée dans la référence : **unanimité 3/3**.
3. **Arbitrage** (`arbitrate-*`) : tout ce qui n'est pas unanime et, sur les 5 documents annotés à la
   main, chaque écart avec le corrigé humain v2 ; les trois modèles voient extraits et positions
   motivées (anonymisées ; l'humain non présumé juste). Unanimité 3/3 ; sinon `unresolved.json`,
   exclu de la référence et remis à l'owner.
4. **Fusion souple par intervalles de caractères** : un item non unanime dont les trois votes portent
   sur des versions présentes de même objet exact, même étape, même page, dont les extraits se
   recouvrent d'au moins 12 caractères normalisés, est fusionné au lieu d'être arbitré. ROUGE-L est
   publié en diagnostic seulement. Motifs et comparaison : `rapport-reference.md`, `soft-diagnostics.json`,
   avis contradicteurs verbatim dans `avis/`.
5. **Notation** des 26 bras et des cascades sur 100 documents : **stricte** (non résolus neutralisés,
   ni attendus ni fausses détections), **large** (non résolus attendus), et deux colonnes séparées,
   jamais mélangées à la stricte : tolérante à l'étape, et souple par intervalles (+ diagnostic ROUGE-L).

Consignes (blocs PASS, VERIFY, ARBITRATE) et règles de traitement : `prompt-annotation.md`.

## Commandes (depuis la racine du worktree)

```sh
# chaîne complète, reprise possible à chaque étape (les documents déjà faits sont sautés)
ORACLE_V3_GO=1 ORACLE_V3_ASTRA_GO=1 MESH_CONCURRENCY=4 tools/refresh-benchmark/run-oracle-v3.sh [étape]
# hors ligne : référence, rapport, calibration, notation
node tools/refresh-benchmark/oracle-v3-build.mjs && node tools/refresh-benchmark/score-oracle-v3.mjs
# tests
node --test tools/refresh-benchmark/oracle-v3-lib.test.mjs tools/refresh-benchmark/score-oracle-v2.test.mjs
```

Garde-fous : sans `ORACLE_V3_GO=1`, aucun appel modèle ; sans `ORACLE_V3_ASTRA_GO=1`, aucune étape
Astra ; les étapes llm-mesh refusent de démarrer si une clé API est présente (sièges seulement).
Siège Claude : forme contrainte, 4 appels au plus en parallèle, arrêt au-delà de 60 % du compteur
hebdo (40 % jusqu'au 2026-09-18 13:40Z), arrêt immédiat sur message de limite et après 3 échecs vides
consécutifs. Siège Codex : arrêt au-delà de 70 % du compteur hebdo. Plafond de sortie Gemini 65 536
(32 768 ailleurs). Délais réseau llm-mesh : en-têtes 120 s, inactivité 600 s, échéance totale 30 min
(xhigh) ou 15 min (high), chien de garde +60 s (en vigueur à partir de 2026-09-18 21:13:30Z).

## Fichiers

| Chemin | Contenu |
|---|---|
| `consensus.json` | référence finale (unités au format `manual-oracle-v2.json`, provenance, lignées) |
| `rapport-reference.md` | unanimes, fusionnées, arbitrées, non résolues ; écarts humains par verdict ; appariement souple ; annexes |
| `unresolved.json` | points non résolus après arbitrage, avec extraits et positions (owner) |
| `disputed.json` | tous les points arbitrés ou fusionnés : options, extraits, positions, votes, résolution |
| `human-diffs.json`, `calibration.md` / `.json` | écarts avec le corrigé humain v2 et leur verdict ; rappel / précision |
| `soft-diagnostics.json` | paires même objet / même étape : recouvrement d'intervalles et ROUGE-L, liste nominative |
| `scores-100.json`, `tableau-f1-100.md` | notation stricte / large / tolérante / souple / diagnostic ROUGE-L |
| `annotations/<étape>/<doc>.json` (+ `.receipt.json`) | réponses brutes, opérations ou votes ; reçus d'usage |
| `corrige/<passe>/<doc>.json` | corrigé après chaque passe (unités, versions, historique motivé) |
| `grounding-rejects.json`, `volumes.json` | opérations rejetées par code ; volumes et jetons par étape |
| `quota-log.jsonl`, `run-resume.out`, `run.log` | journal des compteurs de quota et sortie de la chaîne |
| `relabel-astra-pass1b.json`, `archive-converge-astra-pre-pass3.json` | journaux de renommage et d'archivage (sha256) |
| `archive/` | sauvegardes avant renommage/archivage, build « exact » d'origine, calibration ROUGE-L abandonnée |
| `avis/` | avis contradicteurs Fable et Astra sur l'appariement souple, verbatim |
| `ping/` | ping Fable 5.1 du 2026-09-17 (1 appel, avant la chaîne) |

## Limites connues

- Biais d'ordre : chaque passe voit le corrigé courant.
- Deux passages éloignés qui prouvent le même acte ne sont pas rapprochés par les intervalles ; ils
  restent en arbitrage (voir `rapport-reference.md`).
- La calibration contre l'humain porte sur 5 documents (36 unités), dont Waterloo partiel.
- Le scoreur crédite une unité si l'extrait d'un bras contient l'ancre v3 sur la même page ; les
  colonnes tolérante et souple mesurent ce que cette règle laisse passer, sans entrer dans la stricte.
