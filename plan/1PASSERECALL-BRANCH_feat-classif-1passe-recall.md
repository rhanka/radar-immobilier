# Rappel immédiat de la passe unique contre B

## Objective
- [x] Mesurer les rappels de détection, visible et P∪S sur les 676 actes B corrigés.
- [x] Décision owner du 13 novembre : passe unique en production = GPT-6 Astra low + P0 étendu à l’extraction.

## Scope / Guardrails
- [x] Branche dédiée feat/classif-1passe-recall, issue de feat/classif-1passe-bc ; direction i-cond.
- [x] Aucun .env, Python, trailer ou fusion. Aucun service, port ou UAT.
- [x] Autre worktree intact. Dossier privé 1passe-bc en lecture seule.
- [x] Sorties privées sous 1passe-recall. Aveugle REFC1 ; agrégats seuls publiés.
- [x] 100 PV entiers, concurrence 10, un appel Astra low par PV. Aucun rejeu.
- [x] Quota Codex avant, toutes les dix minutes, après. Arrêt des départs à 90 %.
- [x] Mesure immédiate autorisée, indépendante de D3 et de la qualification C finale.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: tools/classif/1passe/recall/**, ce plan.
- [x] Forbidden Paths: autres plans, Makefile racine, règles, API, worktree et fichiers privés de l’autre lane.
- [x] Conditional Paths: aucune.

## Feedback Loop
- [x] BRRECALL-EX1 : français et commits sans trailer, instruction owner. Retour : supprimer les fichiers de lane.
- [x] BRRECALL-EX2 : make autonome sans include ni .env ; Node natif pour piloter les sièges, héritage BR1PASSE-EX3. Retour : supprimer le dispatcher.
- [x] BRRECALL-EX3 : copie immuable du prompt au-delà de 150 lignes dans son propre commit, pour préserver les règles exactes. Retour : supprimer la copie.
- [x] Support corrigé : 676, contre 672 historique ; 372 en mise au point, 304 en aveugle. 43 neutres séparés.
- [x] Corps du prompt PR #1099 repris. Output passe du graphe par fragment aux actes plats sur PV entier.
- [x] Limite : apparieur strict et scoreur B historique divergents. Diagnostic secondaire publié sans modifier le principal.
- [x] Incidents de calcul corrigés : variantes des neutres sans id ; compteur de jetons input confondu avec un texte.
- [x] Revue multi-pairs indisponible ; aucun consensus revendiqué. Voir recall/REVIEW.md.

## Orchestration Mode (AI-selected)
- [x] Un dispatcher, dix appels CLI simultanés. Aucun optimiseur ni attente de D3.

## UAT Management (in orchestration context)
- [x] Aucun changement du comportement applicatif ; aucune UAT.

## Plan / Todo (lot-based)
- [x] Prompt, source et métriques figés avant appels ; commits 4b9cd7958 et 806ab7041.
- [x] 100 PV exécutés ; 100 réponses valides, 50 sceaux aveugles ; quota 32 % → 34 %, durée 357,576 s.
- [x] Trois rappels par moitié et au total ; bornes Wilson ; détails des manqués de mise au point privés.
- [x] Bras B rejoué sur textes identiques ; coût de classification séparée : missing source.
- [x] Cible score-c pour le recalcul ultérieur sans appel modèle ; aucun résultat D3 attendu ou consommé.
- [ ] Agrégats committés, branche poussée, PR draft ; aucune fusion.
