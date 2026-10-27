# Fonction : découverte OAuth et baseline MCP déployée — 861-a

## Objective
- [x] Isoler découverte PRM, ingress, fixtures et cible de test dans [PR #866](https://github.com/rhanka/radar-immobilier/pull/866), selon [spec v8](/home/antoinefa/src/sentropic/.tmp/immo-mcp-enablers/spec-v8.md) §§1, 2, 4–7, 10 et 11 ; le récepteur strict relève de [PR #865](https://github.com/rhanka/radar-immobilier/pull/865).
- [x] Référence normative : SHA-256 `6459675be17575251800efe658d27134df14b7d87f09b250df5f8ed32e06e666` ; comparaison complète avec la v7 dans `ECART-V7-V8.md`, répertoire de livraison `lots-radar-861` du scratchpad demandé.

## Scope / Guardrails
- [x] Worktree autorisé `.worktrees/861a`, branche `feat/861a-prm-fixtures` ; checkout racine et `ENV=dev` réservés à l'utilisateur.
- [x] Préserver les douze outils, les cinq réponses `not_wired_yet`, la connexion OAuth, les URL historiques et mcp-auth 0.1.0 ; aucun changement de dépendance ou de lockfile.
- [x] Exclure récepteur strict, échange/cache, registre et pages ; mcp-auth 0.2.2 et le retrait du GET canonique temporaire appartiennent à 2b-MCP (§§2/7, confirmation Sentropic du 16/10).
- [x] Mandat du 16/10 : sauvegardes WIP et réécriture locale autorisées, aucun push, fusion, déploiement ou commentaire GitHub ; aucune lecture de `.env`, aucun Python.
- [x] Tests Make/Docker avec `ENV` en dernier, `ENV=test-861a-historique` ; cible `--no-deps`, aucun port hôte publié. Allocation réservée si nécessaire : API 18861, UI 15861, Maildev UI 11861, Postgres 15862, S3 19861, Obscura 19862, SMTP 11862.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths** : `packages/immo-mcp/src/server-http{,.test}.ts`, `packages/immo-mcp/src/oauth-discovery.test.ts`, `packages/immo-mcp/src/deployed-baseline.test.ts`, `packages/immo-mcp/src/fixtures/immo-*.v1.json`, `deploy/k8s/41-immo-mcp-ingress.yaml`, ce plan.
- [x] **Forbidden Paths** : `api/**`, dépendances/lockfiles, `docker-compose*.yml`, `rules/**`, fichiers de bootstrap des agents, `.github/workflows/**`, autres plans ; `Makefile` sauf BR861-EX1.
- [x] **Conditional Paths** : `Makefile` limité à `test-immo-mcp` sous BR861-EX1 ; aucune modification de RBAC ou du dépôt Sentropic.

## Feedback Loop
- [x] BR861-EX1 : la cible MCP isolée fournit le point d'entrée de test manquant ; impact limité à l'outillage, retour arrière par retrait de cette cible.
- [x] B-m1/B-m6 : procédures ingress et promotion conformes aux §§6/7/11 ; la v8 renforce la séparation en deux PR et le rattachement aux têtes exactes.
- [x] B-m3 / Fable M2 : la v7 §5 observait le reçu `0a689f38c2a9b2bb926cf4fca89022ea606212f74ae6d3b67aa45ac8fe24e1b5` ; la v8 §§5/11 observe `ce7d005acf34938c69ac7975d30280a9f77aa290c221a83c1e2a7e0f48821940`, commité dans `97a405a9e4b3099bf5d07f21ade6b4e3cb09f7ff` après ajout du dernier élément de `gaps` sur la transition 401 → 403.
- [x] La correction sauvegardée ajoute seulement `toolFixtureSha256` au reçu : empreinte finale `eb984665cb7d3bdd2d51e77a18341862c3d5c9c0a9f6c83399d8f5b16430ab8f`. Les outils restent identiques : `31487e8fb9b85019fc707ed3a7296e33156c46fb5fd3071d456d6dae1b44d998` ; aucune capture historique réécrite.
- [ ] i-cond : rattacher la transmission de baseline au reçu final et à son commit ; les tests prouvent provenance consignée et parité source, sans nouvelle capture d'image, ingress réel ou stdio déployé.
- [x] Correspondance source : ancien 861-a `a5e9eefc95ea27ca24d3d0cbe922f759be52b144` + corrections sauvegardées dans `backup/861a-a5e9eefc` ; contenu commun initial également présent dans l'ancien 861-b `97a405a9e4b3099bf5d07f21ade6b4e3cb09f7ff`. Les SHA reconstruits figurent dans `RAPPORT-ASTRA-861-HISTORIQUE.md`.

## Orchestration Mode (AI-selected)
- [x] Écriture séquentielle dans les deux worktrees autorisés ; 861-b hérite des commits de 861-a puis ajoute uniquement API et plan 861B. Deux PR et deux têtes distinctes restent obligatoires, même avec un éventuel interrupteur de déploiement (§§1/6/11).

## UAT Management (in orchestration context)
- [x] Aucun changement UI ou UAT réel dans ce mandat ; l'opérateur qualifie les métadonnées et le client déjà connecté dans chaque environnement, préprod puis production.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Références et conservation**
  - [x] Lire les règles, les rapports de correction et le diff intégral v7 → v8 ; vérifier les empreintes des specs et sauvegarder les modifications locales avant réécriture.
  - [x] Rebaser sur `origin/main` `82d28af53bf11c77dafbf3e611a53137916a2cd2` ; seuls sept documents hérités de main s'ajoutent hors contenu 861-a.
- [x] **Lot 1 — Découverte OAuth et ingress**
  - [x] Garder le montage historique `/mcp` en premier, puis la même instance à la racine et le GET canonique explicite requis par 0.1.0 ; tester les variantes de casse et double slash.
  - [x] Garder `/mcp` Prefix et `/.well-known/oauth-protected-resource/mcp` Exact sur le même backend MCP, sans ouvrir toute la racine ; corriger l'en-tête opérationnel de l'ingress 41.
- [x] **Lot 2 — Baseline versionnée et tests**
  - [x] Vérifier reçu, images/builds préprod et production, nom/empreinte/nombre des outils et version MCP ; préserver les normalisations bornées, les cinq stubs et la distinction HTTP capturé / fabrique stdio en mémoire.
  - [x] Préserver les deux captures `missingCoarseScope.code = 401` et vérifier le refus courant avec jeton signé `immo:search` seul en HTTP/simulation sous 0.1.0.
  - [x] Preuve historique du correctif : 85 tests MCP dans 6 fichiers, puis `down -v` et absence de ressources `radar-test-861a-fix` ; détails dans `RAPPORT-ASTRA-861A-FIX.md`.
  - [x] Campagne du présent mandat : `test-immo-mcp` réussit (85 tests / 6 fichiers), `down -v` réussit et aucune ressource du projet ne subsiste ; journaux `astra-861-historique-logs/861a-*`. Quatre étapes intermédiaires passent aussi typecheck/tests ; le rapport prouve l'identité du code testé et du code reconstruit.
- [ ] **Lot 3 — Ingress préprod, opérateur (§6)**
  - [ ] Rendre `deploy/overlays/preprod` avec `kustomize build --load-restrictor LoadRestrictionsNone` ; l'overlay inclut déjà ingress 41.
  - [ ] Exécuter `deploy/ci/check-preprod-auth-isolation.sh` sur ce même rendu complet avant application ; refuser tout hôte/TLS de production.
  - [ ] Transmettre rendu revu, SHA-256 et sortie de garde à l'opérateur k8s ; appliquer seulement l'Ingress prévu, sans déployer incidemment tout l'overlay.
  - [ ] Reçu : source/ref, empreinte du rendu, garde, opérateur/application, namespace `radar-immobilier-preprod`, hôte `preprod.immo.sent-tech.ca`, TLS `radar-immo-preprod-tls`, chemins, digests API/MCP avant/après.
  - [ ] Préserver l'absence de droits Ingress de la CI ; ne créer ni workflow ni droit supplémentaire. Les propriétaires de CD images et de réconciliation ConfigMap restent distincts.
  - [ ] Suivre le challenge 401 par l'ingress réel ; les deux URL doivent renvoyer le JSON attendu, jamais le HTML UI ; vérifier le transport du client déjà connecté.
- [ ] **Lot 4 — Ingress production après qualification préprod (§6)**
  - [ ] Avant mutation : consigner tête main, digest actuel de `:latest`, étape/tag/commit/digest promus, reçus préprod/promotion et digests API/MCP en cours ; toute absence/incohérence bloque.
  - [ ] Appliquer normalement le seul fichier 41 revu, sans changement d'image/config ou redémarrage ; revoir séparément les objets 70 NetworkPolicy uniquement si nécessaires.
  - [ ] Si 30/40 sont nécessaires, figer leurs images aux digests déjà promus avant application et les réaffirmer avant tout redémarrage explicite ; jamais appliquer `:latest` puis réparer.
  - [ ] Ne jamais lancer `k8s-apply-mcp.yaml` non modifié : il applique 30/40/41/70 et redémarre MCP avec des images mutables, contournant les promotions.
  - [ ] Reçu : opérateur/procédure ou ref/run du workflow revu, cluster/namespace, empreintes des objets/rendus, digests résultants ; recontrôler à chaque application et rollback.
  - [ ] Vérifier séparément métadonnées et continuité production ; une preuve préprod ne ferme pas cette acceptation.
- [ ] **Lot 5 — Prérequis séquentiels de 2b-MCP puis 861-b (§§4/6/7/10/11)**
  - [ ] Imposer **861-a → 2b-MCP → 861-b**, fusions distinctes avec déploiement d'échange terminé et positif entre les deux dernières ; API et MCP sont déployés depuis la même image/source.
  - [ ] Q-A1 « Tout attend la fusion » : 2b-MCP attend #679 entier, registre/pages compris, les publications auth-hono/cluster-mesh et les reçus IdP/M3 propres à l'environnement ; aucune dépendance Sentropic ne bloque indépendamment 861-a.
  - [ ] mcp-auth 0.2.2 est déjà publié depuis `2026-10-16T08:18:02.527Z` (§7) ; vérifier signature de provenance, digest du sujet et archive avant mise à niveau. Aucune republication ou nouvelle approbation de #675 n'est demandée.
  - [ ] Rattacher le reçu vérifié à la source `6138a8d5514763a405ad8735582a9d3b64548dab`, au workflow CI et à l'intégrité npm du §7 ; les métadonnées décodées seules ne prouvent pas la signature.
  - [ ] Qualification isolée 2b : tarballs de branche + image API/IdP construite depuis un checkpoint accepté de #679 et image bootstrap du même snapshot ; reçus source, lock/outillage, entrées auth-hono, SHA-256 des archives et identités d'images vérifiés avant démarrage, chargement sans pull (§4).
  - [ ] Exécuter migration et M3 réels create/replay/conflict avec DB/clés/données jetables, deux environnements exacts et appartenances approuvées/refusées/ambiguës ; aucun montage source inter-dépôts, secret ou endpoint réel. Cela ne remplace pas les reçus IdP/M3 déployés.
  - [ ] Qualifier le tuple final avec `--strict-peer-deps`, sans `--legacy-peer-deps`, `--force` ou contournement ; conserver union des peers et releases de manifestes gateway/auth-ui du §10, ordre réel #662/#679 et preuves avant/après publication. Les versions candidates ne sont pas des garanties de publication.
  - [ ] 2b-MCP porte manifeste/lock, retrait du GET temporaire, challenge canonique et passage explicite du seul cas « scope requis manquant » de 401 à 403 `insufficient_scope` ; audience incorrecte reste 401 et captures historiques inchangées (§§2/7).
  - [ ] Qualifier 403 sans reconnexion ni consentement élargi ; conserver le reçu d'échange de l'environnement réellement atteint par main avant toute fusion 861-b. Cette branche n'ajoute aucun interrupteur.
  - [ ] Préprod d'abord ; production par deux tags protégés `v*` qualifiés distincts, échange puis strict, avec reçu intermédiaire et rollback conservant API stricte + MCP d'échange.
- [ ] **Lot 6 — Revue et intégration, i-cond**
  - [ ] Juste avant 861-a puis 2b-MCP, consigner `PREPROD_CD_ENABLED=true`, cible réelle de main et protections production ; inconnu/absent/faux bloque. Garder ce contrôle actif durant la bascule.
  - [ ] Actualiser les descriptions des deux PR avec spec v8, plans et correspondances source/têtes ; ce mandat local ne modifie pas GitHub.
  - [ ] Revoir indépendamment chaque tête finale, lier CI et revue au SHA complet et réconcilier les constats #865 ; les anciennes revues et tests ne valent pas acceptation des nouvelles têtes.
  - [ ] Commits ≤150 lignes, sauf la seule fixture d'outils capturée dans son commit de données ; titres anglais Conventional Commits, aucun trailer. Obtenir le GO d'intégration, fusion par merge commit uniquement, conserver la branche et archiver le plan à clôture.
