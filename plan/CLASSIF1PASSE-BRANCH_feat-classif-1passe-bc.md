# Étape 0 — Pré-enregistrement B+C

## Objective
- [ ] Figer le protocole, les routes et le découpage avant tout appel.

## Scope / Guardrails
- [x] Worktree local `tmp/classif-1passe`, base `origin/feat/classif-pilot-l1l2`.
- [x] Aucun appel de modèle. Aucun .env. Aucun Python. Aucune fusion.
- [x] Make autonome sans include. `ENV=test-classif-step0` en dernier.
- [x] Aucun service lancé. Aucun port utilisé. Aucune UAT nécessaire.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths : `tools/classif/1passe/**`, ce plan.
- [x] Forbidden Paths : `Makefile`, `docker-compose*.yml`, `rules/**`, autres plans, fichiers de bootstrap.
- [x] Conditional Paths : aucune.

## Feedback Loop
- [x] BRCLASSIF1PASSE-EX1 : français et commits sans trailer, instruction explicite du 13/11. Impact documentaire. Retour : réviser les documents.
- [x] BRCLASSIF1PASSE-EX2 : make autonome, sans include du Makefile racine qui lit .env. Impact nul sur les cibles existantes. Retour : supprimer cette entrée.
- [x] Revue multi-IA non exécutée : interdiction explicite de tout appel de modèle.

## Orchestration Mode (AI-selected)
- [x] Mono-branche, sans délégation. Conduite : i-cond.

## UAT Management (in orchestration context)
- [x] Documents et outillage hors production. Aucune modification UI/API.

## Plan / Todo (lot-based)
- [x] Lot 0 : règles, sources, compte réel, graine avant tirage.
- [ ] Lot 1 : protocole, découpage REFC1 et manifestes.
- [x] Sous-lot : 100 PV répartis 50/50. Sceau REFC1 privé. Supports B : 372/304 ; C inconnu.
- [x] Sous-lot : protocole figé, recommandations et limites explicites.
- [x] Sous-lot : cinq routes exactes, prompts et budgets inscrits sans lancement.
- [x] Sous-lot : syntaxe, tirage reproductible, pack et sceau vérifiés hors ligne ; zéro appel.
- [ ] Écarts : stratification C exacte, supports P∪S et dispatcher B+C encore requis.
- [ ] Lot 2 : contrôles hors ligne, push et PR draft vers main.
- [ ] Hors étape 0 : confirmations owner, annotations, exécution et évaluation.
- [ ] Hors demande : fusion.
