# Oracle v3 — corrigé des 100 documents du banc v101b

Statut au 2026-09-17 : **outillage prêt et testé, aucune annotation produite.** Seul appel modèle
effectué : un ping Fable 5.1 sur un document (`ping/`), autorisé par i-cond. Tout le reste attend le
GO du conducteur (et la reprise du siège Codex le 2026-09-22 à 09:12 pour Astra).

## Méthode (décision owner relayée par i-cond, 2026-09-17)

Consensus séquentiel, pas un vote :

1. `astra-pass1`, `astra-pass2` — `gpt-6-astra` xhigh, siège Codex (llm-mesh en conteneur).
2. `fable-pass1`, `fable-pass2` — `claude-fable-5-1` xhigh, siège Claude (CLI contrainte).
3. `gemini-pass1`, `gemini-pass2` — `gemini-3.8-flash` high, Cloud Code (llm-mesh en conteneur).
4. `converge-astra`, `converge-fable`, `converge-gemini` — chaque modèle vote seul sur chaque
   désaccord ; 2 votes sur 3 tranchent.

Chaque passe reçoit le texte gelé et le corrigé courant (vide au départ), et rend des opérations
motivées (`add` / `remove` / `correct`). Consignes, règles d'ancrage, de désaccord et de convergence :
`prompt-annotation.md`.

## Commandes

```sh
cd /home/antoinefa/src/radar-immobilier/tmp/t1-model-benchmark-real
# chaîne complète, reprise possible à chaque étape (les documents déjà faits sont sautés)
ORACLE_V3_GO=1 ORACLE_V3_ASTRA_GO=1 tools/refresh-benchmark/run-oracle-v3.sh
# reprendre à partir d'une étape
ORACLE_V3_GO=1 ORACLE_V3_ASTRA_GO=1 tools/refresh-benchmark/run-oracle-v3.sh fable-pass1
# hors ligne : livrables à partir de ce qui existe (intérimaire tant que la chaîne n'est pas finie)
node tools/refresh-benchmark/oracle-v3-build.mjs && node tools/refresh-benchmark/score-oracle-v3.mjs
# tests
node --test tools/refresh-benchmark/oracle-v3-lib.test.mjs tools/refresh-benchmark/score-oracle-v2.test.mjs
```

Garde-fous : sans `ORACLE_V3_GO=1`, aucun appel modèle possible ; sans `ORACLE_V3_ASTRA_GO=1`, aucune
étape Astra. Les étapes llm-mesh refusent de démarrer si une clé `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY` ou `MISTRAL_API_KEY` est présente. Le siège Claude : forme contrainte
(`env -i`, répertoire vide, `--disallowed-tools '*'`, `--strict-mcp-config`), 4 appels au plus en
parallèle, lecture du compteur hebdo au départ puis toutes les 25 annotations, arrêt au-delà de
40 %, et arrêt si le siège signale une limite d'usage.

## Fichiers

| Chemin | Contenu |
|---|---|
| `prompt-annotation.md` | consignes PASSE et CONVERGENCE, règles de traitement |
| `annotations/<étape>/<doc>.json` | réponse brute, opérations, appliquées, rejetées ; votes pour la convergence |
| `annotations/<étape>/<doc>.receipt.json` | reçu d'usage (jetons, coût équivalent API, latence, modèle servi) |
| `corrige/<passe>/<doc>.json` | corrigé après la passe (unités, versions, historique motivé) |
| `consensus-interim.json` puis `consensus.json` | corrigé v3, au format des unités de `manual-oracle-v2.json` |
| `disputed.json` | désaccords, options, votes, résolution (`resolved` / `unresolved` / `pending`) |
| `grounding-rejects.json` | opérations rejetées, comptées par étape et par code |
| `volumes.json` | opérations et jetons par étape |
| `calibration.md` / `.json` | v3 contre le corrigé humain v2 (5 documents) |
| `scores-100.json`, `tableau-f1-100.md` | 27 bras + cascades C2/C3, P/R/F1 nets sur 100, écart avec le F1 sur 4 documents |

## Outillage (`tools/refresh-benchmark/`)

- `oracle-v3-lib.mjs` : fonctions pures (ancrage v9, clé d'objet, doublons, opérations, désaccords,
  votes, calibration).
- `oracle-v3-step.mjs` : lance une étape (transports `claude-cli`, llm-mesh, `fake:` pour les tests).
- `run-oracle-v3-mesh.sh` : étapes Astra et Gemini en conteneur `node:22-bookworm-slim`.
- `run-oracle-v3.sh` : la chaîne complète en une commande.
- `oracle-v3-build.mjs` : consensus, désaccords, rejets, volumes, calibration.
- `score-oracle-v3.mjs` : re-notation hors ligne à partir des sorties archivées. Étend
  `score-oracle-v2.mjs`, où deux options s'ajoutent, désactivées par défaut (les chiffres v2 ne
  bougent pas) : `useStageAliases` (R4) et `partialOracle`.

## Vérifications faites

- `node --test` : 12 tests oracle-v3 + 8 tests v2 existants, 20/20 verts.
- Non-régression du scoreur : avec le corrigé humain v2 en entrée, `score-oracle-v3.mjs` retrouve le
  F1 micro sur sorties acceptées publié dans `oracle-v2-comparison.json` pour les 27 bras (les 4 bras
  sans sortie acceptée sur ces documents sont N-A des deux côtés). L'ordre de lecture des tentatives
  est [4, 3, 2, 1], comme la comparaison publiée ; les bras Anthropic ont des tentatives 3.
- Essai à blanc de toute la chaîne (9 étapes factices → build → re-notation) sur un document.
- Conteneur : llm-mesh 0.19.3 installé, `v101-provider.mjs` importable, écriture sous l'uid hôte,
  transport factice, aucun appel modèle.

## Ping Fable 5.1 (`ping/`)

1 appel, `lac-des-seize-iles-2026-09-agenda`, consigne PASSE, corrigé vide. Modèle servi
`claude-fable-5-1` (modelUsage), 1 615 jetons de réflexion sur 2 563 en sortie, 32,6 s, coût
équivalent API 0,2525 USD (dont 0,0020 d'un appel annexe `claude-haiku-4-5` de la CLI). JSON strict,
4 ajouts motivés et ancrés, identiques aux unités humaines L36, L37, L54, L55. Le JSON ne porte aucun
champ d'effort : l'effort xhigh demandé n'est pas vérifié dans le reçu.

## Limites connues

- Chaque passe voit le corrigé courant : les passes suivantes peuvent être ancrées par les
  précédentes (biais d'ordre). La convergence ne porte que sur les unités contestées ; une unité
  jamais contestée est acceptée tacitement.
- Détection de doublon à l'ajout : même objet, même étape, extraits qui se chevauchent sur la même
  page. Une citation très longue qui couvre deux points d'ordre du jour sur la même adresse peut
  être rejetée à tort ; le rejet est journalisé (`duplicate_add`).
- Le scoreur crédite une unité si l'extrait d'un bras contient l'ancre v3 sur la même page. Aucun
  site alternatif n'est ajouté automatiquement : un bras qui cite une autre page pour le même acte
  n'est pas crédité.
