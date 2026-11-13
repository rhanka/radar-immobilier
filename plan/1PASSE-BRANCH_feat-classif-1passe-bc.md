# Passe unique B+C — étapes 0 à 4

## Objective
- [ ] Constituer la référence C des actes B, puis qualifier une passe unique sans manqué.
- [x] Conduite : i-cond. Branche : `feat/classif-1passe-bc`.

## Scope / Guardrails
- [x] Worktree : `tmp/classif-1passe`. Aucun service, port ou UAT.
- [x] Aucun .env, secret affiché, Python, trailer ou fusion.
- [x] Make autonome sans include. `ENV=test-classif-1passe` en dernier.
- [x] Aveugle REFC1 hors Git. Agrégats et empreintes seuls dans Git.
- [x] Aucun résultat candidat dans les prompts de référence.
- [x] D1 actée le 13/11 : 676 actes B ; 43 cas non résolus neutres.
- [x] D2 actée : Astra medium et Opus 5.5 medium, indépendants.
- [x] D3 actée : Argon high, puis Non classé à montrer si échec ou désaccord résiduel.
- [x] D4 actée : zéro manqué dans chaque moitié, puis meilleure précision aveugle.
- [x] D5 provisoire : Astra low/medium, Sol 6.1 medium, Opus 5.5 medium ; deux IA par itération.
- [x] Départ arbitré : série 7, P0 × Astra low, précision aveugle historique 0,752.
- [x] Série 10 écartée : 3 et 5 manqués aveugles.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths : `tools/classif/1passe/**`, ce plan.
- [x] Forbidden Paths : Makefile racine, compose, règles, bootstrap, autres plans.
- [x] Conditional Paths : aucune.

## Feedback Loop
- [x] BR1PASSE-EX1 : français et commits sans trailer, instruction owner. Retour : réviser les documents.
- [x] BR1PASSE-EX2 : make autonome sans .env. Retour : supprimer les cibles autonomes.
- [x] BR1PASSE-EX3 : Node hôte pour piloter les sièges CLI, comme BRCLASSIF-EX1. Modules natifs seuls. Retour : supprimer le dispatcher.
- [x] Ancien plan CLASSIF1PASSE conservé comme livraison historique de l’étape 0.
- [ ] Écart publié : découpage stratifié sur présence B, supports C encore inconnus. Aucun retirage.

## Orchestration Mode (AI-selected)
- [x] Mono-branche. Deux bras d’annotation simultanés, huit appels par bras.

## UAT Management (in orchestration context)
- [x] Aucun changement UI/API. Aucune UAT.

## Plan / Todo (lot-based)
- [x] Correction : citations normalisées, page physique ancrée, ambiguïté séparée et affectations forcées seules.
- [x] Recalcul hors ligne : état initial archivé, détails aveugles scellés, nouveaux désaccords et réutilisation D3 par empreinte du prompt.
- [x] Reprise ciblée : dispatcher dédié, prompts identiques, journal durable, concurrence totale 10 et quota Codex à 90 %.
- [ ] Recalcul avant/après, reprise ciblée des interruptions, rapport et PR draft. D3 suspendu par i-cond à 17 h 57.
- [x] Étape 0 : pré-enregistrement, graine, 100 PV, 50/50, pack et manifestes livrés.
- [x] Étape 0bis : plan sédimenté, décisions et surface CLI gelées avant appel.
  - [x] Porte : empreintes, 100 textes complets, pack, budget et quota vérifiés. Codex : 26 %.
- [ ] Étape 1 : deux annotations indépendantes sur les 100 PV.
  - [x] Reprise : 33 départs, 17 réponses, 16 interruptions sans rejeu. Quota Codex : 27 %.
  - [x] Rapprochement : preuves exactes, étapes et cibles compatibles, un à un ; tests ciblés réussis.
  - [x] Budget : 200 départs ; 184 réponses et 16 interruptions sans rejeu. Aucune reprise de quota.
  - [x] Quota codex avant, toutes les 10 min, après : 27 %, 29 %, 31 %. Seuil de 90 % respecté.
  - [x] Aucun 429 ou refus pendant l’annotation. Quota Claude après : 62 % ; avant non mesuré.
  - [x] Accord : kappa 0,613265 ; accord brut 90,9763 %, validé 8,2840 %. 620 désaccords D3.
  - [ ] Arbitrage : désaccords seuls, Argon high via agy, concurrence 1, arrêt au premier refus.
  - [ ] Budget arbitrage : 776 appels maximum. Échec : à montrer.
  - [ ] Échantillon owner : 20 arbitrages au plus, mise au point seule.
  - [ ] Porte : référence privée, aveugle scellé, agrégats et empreintes committés.
- [ ] Étape 2 : passe unique, itération 1 à partir de P0 ; deux IA maximum.
  - [ ] Budget mise au point : 200 appels, deux itérations de deux routes au plus.
  - [ ] Porte : zéro manqué en mise au point ; prompts et finalistes gelés.
- [ ] Étape 3 : une lecture aveugle des finalistes, 100 appels maximum.
  - [ ] Porte : zéro manqué des deux côtés, puis précision aveugle ; aucun retour au tuning.
- [ ] Étape 4 : rapport, push, PR draft ; aucune fusion.
  - [ ] Budget total : 1 276 lectures et 40 reprises de quota au plus.
  - [ ] Porte : durées, appels, quotas, accord, arbitrages, classes et incidents publiés.
