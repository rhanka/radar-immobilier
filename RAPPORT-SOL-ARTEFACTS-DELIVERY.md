VERDICT: À CORRIGER

1. **BLOQUANT — La façade appelée par `search_signals` reste désactivée dans le véritable démarrage API.** Fichiers : `api/src/index.ts:97`, `api/src/routes/mcp-signal-search.ts:71`, `packages/immo-mcp/src/data-source.ts:235`.

   Scénario : après le déploiement de cette tête, un utilisateur approuvé lance `search_signals` avec une délégation valide et un workspace accessible. Le nouvel adaptateur HTTP appelle exclusivement `GET /api/v1/mcp/facets/signals/search`. La route exige `deps.mcpSignalSearch.enabled`, mais le `createApp({...})` exécuté par `api/src/index.ts` ne fournit jamais `mcpSignalSearch`. Toute requête qui franchit l'authentification reçoit donc `503 { error: "capability_unavailable" }`, avant même la résolution de workspace et le choix legacy/BASE. Une configuration OAuth ou un changement d'état BASE ne peut pas fournir ce paramètre absent du code de démarrage.

   L'adaptateur A2-BASE est bien inclus par le graphe d'import du bundle MCP ; sa présence ne suffit donc pas à assurer la continuité de la recherche. La garde fermée fonctionne, mais aucun raccordement de production ne permet de l'ouvrir après qualification.

   Correction attendue : raccorder explicitement la capacité de recherche qualifiée dans le véritable entrypoint API, avec une activation serveur contrôlée et fermée par défaut. Ne pas supprimer la garde ni réintroduire un repli vers l'ancienne route. Responsable : intégration API/A2-BASE. Acceptation : avec l'image finale et son vrai démarrage, un appel MCP autorisé atteint la recherche et restitue les signaux attendus ; configuration absente, maintenance et accès refusé restent fermés. Cette preuve devra couvrir les états legacy et BASE concernés par la livraison.

2. **BLOQUANT — La livraison automatique de l'image MCP n'apporte pas ses nouveaux raccordements d'autorisation et d'échange.** Fichiers : `packages/immo-mcp/src/server-http.ts:260`, `packages/immo-mcp/src/server-http.ts:445`, `deploy/k8s/40-immo-mcp-http-deploy.yaml:153`, `deploy/overlays/preprod/patch-immo-mcp-config.yaml:27`, `deploy/ci/reconcile-preprod.sh:149`.

   Scénario : un Deployment MCP conforme aux manifests versionnés reçoit la nouvelle image par la CD. Son seul `envFrom` référence `immo-mcp-config`, qui configure le mode HTTP et l'API, mais ni `IMMO_MCP_ACCOUNT_DATABASE_URL`, ni les références du workload d'échange, ni son secret. Le patch préprod ne fournit que l'issuer, la ressource OAuth et l'URL publique.

   Conséquence déterministe de cette configuration : `createAccountBinding` retourne `undefined` (`account-binding.ts:41`) ; l'autoriseur par défaut de `createImmoHttpApp` refuse les outils en mode HTTP. Même après raccordement du compte, l'absence du couple configuration/secret empêche la construction de `exchange` ; `search_signals` est encore refusé par `exchange_missing_authority` ou `exchange_not_configured` (`authorized-egress.ts:62`). La CD réconcilie le ConfigMap, change l'image et peut remonter les replicas à un, mais ne réconcilie pas le contrat du Deployment MCP. Le nouveau processus peut ainsi démarrer sans rendre la recherche disponible.

   Correction attendue : compléter la livraison opérateur avant le changement d'image par les références de secrets, les paramètres non secrets de délégation et les accès nécessaires au compte de lecture ; ou vérifier et exiger un reçu de qualification de ces raccordements s'ils sont déjà appliqués hors dépôt. Garder les valeurs secrètes hors du rapport et conserver les refus par défaut. Responsable : livraison MCP/A7 et opérateur préprod. Acceptation : sur le digest livré, démontrer un appel `search_signals` autorisé et les refus après suspension/révocation, puis conditionner la livraison à cette preuve. La readiness actuelle ne vérifie que la découverte OAuth (`40-immo-mcp-http-deploy.yaml:159`), pas ce parcours.

   Limite de ce constat : aucun état Kubernetes ni secret réel n'a été consulté. Un raccordement opérateur déjà présent peut lever ce deuxième défaut, à condition de le démontrer pour l'image livrée ; il ne résout pas le premier.

Remarques :

- **Périmètre et indépendance.** Revue statique de `4fce3a0570eeb2ebc018c09acf4e13880a529d9e`, branche `feat/artefacts-delivery`, pour la PR #921. Merge examiné : `dc7919674666f10bbf4110aaf2b9b052f6b3ed51`, parents `ee224f162034afdc35a1e30979dd44ba40f13092` et `8156568aab7647c516a70f98eb3c2179fc7bc5fd`, base commune `313fcf443b3c5fc2d58ccc44226bd8b1f27226b5`. Le rapport explicitement exclu n'a pas été consulté. Aucun fichier `.env`, aucun test, aucun Docker, aucun déploiement. Seul ce rapport est écrit.

- **Conservation des parents.** La comparaison depuis la base commune montre seulement trois fichiers modifiés des deux côtés : `api/Dockerfile`, `artifacts-provider-contract.helpers.ts` et `artifacts-provider-failures.spec.ts`. Pour tous les fichiers modifiés d'un seul côté, le résultat du merge conserve exactement la version de ce parent : aucune divergence détectée. Les deux blocages de livraison ci-dessus existent déjà dans le parent ARTEFACTS ; ils ne sont pas causés par une mauvaise résolution du conflit. Ils empêchent néanmoins de confirmer la continuité demandée sur main.

- **Conflit manuel : résolution correcte.** `git show --remerge-diff dc791967` ne révèle qu'un fichier en conflit. Dans `api/tests/integration/artifacts-provider-failures.spec.ts:491`, les assertions exigent toujours `conflict`, `retriable: false`, `not_committed`, la phase `lock`, puis la cause privée `55P03` par lecture directe. La projection publique reste exactement `409 { error: "conflict" }` ; les nombres de releases et de reçus doivent rester inchangés. Les autres zones retiennent la projection publique du parent main, avec égalité HTTP/MCP, au lieu de comparer directement l'enveloppe interne au reçu durable.

- **Correctif `4fce3a05` : pertinent, sans affaiblissement identifié des assertions examinées.** À `api/tests/integration/artifacts-provider-failures.spec.ts:735`, le manifeste réussi doit conserver `artifactId`, `ownerId: ACTOR` et `storageScopeId: SCOPE`. Ces valeurs de provenance ne peuvent simultanément être interdites dans la chaîne du manifeste retourné. Le correctif remplace cette interdiction contradictoire par l'interdiction du bucket, de l'endpoint et des identifiants S3. L'égalité exacte du résultat public, sa parité HTTP/MCP, l'unicité de release/reçu, l'absence de nouvelle erreur comptabilisée et l'immutabilité du reçu après replay restent exigées. `assertPublicBodyRedacted` lui-même n'est pas modifié.

- **Helpers sensibles : conservés.** `artifacts-provider-contract.helpers.ts:157` conserve la détection précise de l'entrée amont absente apportée par main et relance les erreurs transitives ; `:237` conserve l'exigence de capacités constituées de chaînes primitives, gelées et exactement sélectionnées ; `:1022` conserve la fermeture bornée du worker. Le drainage des arrivées tardives de `artifacts-e3-barrier.helpers.ts` venant de main est repris. Le helper `api/tests/artifacts-blob-store.helpers.ts:6`, dont le `listKeys(prefix)` refuse les préfixes vides ou contenant `..` et délègue au vrai store, est identique dans les deux parents et dans la tête.

- **Dockerfile : additions compatibles.** Les quatre entrypoints BASE de main et le fichier `/workspace/api/release-sha` sont présents (`api/Dockerfile:89`, `:183`). Les éléments ARTEFACTS sont également conservés : installation verrouillée `npm ci --ignore-scripts --strict-peer-deps`, serveur content-reader, bundle MCP, externalisation de cluster-mesh, copie du package MCP et de son `node_modules` local, migrations et entrypoint de service. `server-http.ts` importe `data-source.ts` et le handler de recherche ; ce dernier utilise bien la nouvelle façade. Il s'agit d'une vérification du code de construction, sans construction ni inspection d'une image produite.

- **Application et gardes.** `api/src/app.ts`, `api/package.json`, le `package.json` racine, le lockfile et le journal Drizzle sont identiques au parent ARTEFACTS approuvé. L'authentification reste devant les routes métier, le contenu reste filtré avant elle et le contrôle d'artefacts demeure fermé sans backend. L'overlay préprod garde `ARTIFACTS_CONTROL_MODE: "off"`. L'activation du récepteur strict exige toujours un reçu concordant ; une activation demandée avec un reçu invalide arrête le démarrage. Aucune ouverture implicite de ces gardes n'a été trouvée dans le merge.

- **Dépendances.** Les dépendances déclarées par API, artifacts-host et MCP correspondent exactement à leurs entrées du lockfile. Tuple conservé : artifacts `0.2.1`, cluster-mesh `0.22.0`, mcp-auth `0.2.1`, mcp-platform `0.4.0`. Le lockfile conserve les dépendances transitives et les intégrités de ce tuple. Aucun écart de fusion détecté ; installation non exécutée.

- **Migrations.** Les 23 entrées du journal de main sont préservées sans modification. `0024_artifacts_coordinator` est le seul ajout, à `idx: 23`, avec `when: 1792000000000`, après `0023_facet_lot_versions_fence` (`1791900000000`). Les 24 indices sont consécutifs de 0 à 23 ; aucun doublon d'indice, de tag ou de timestamp. Les SQL `0015` à `0023` de main ne changent pas. `0024` ajoute les tables de coordination et les tables de politique/quota/échec sans suppression des tables existantes. Le journal contient déjà une ancienne inversion de timestamp à `0002_graph_store` : le préfixe étant identique à main, ce n'est pas une régression de cette livraison. Aucune migration n'a été exécutée.

- **Destination de la CD : préprod seule sous l'hypothèse demandée.** Pour un push sur main avec `PREPROD_CD_ENABLED == 'true'`, le job prod historique est exclu (`.github/workflows/build-push-images.yml:237`) et `deploy-preprod` est sélectionné (`:577`, namespace `radar-immobilier-preprod`). La promotion prod exige une référence `refs/tags/v*` (`:1100`). Le MCP préprod reçoit la même image API (`:823`). La valeur courante de la variable GitHub n'a pas été interrogée. Le ciblage est correct ; il ne lève pas les deux blocages fonctionnels ci-dessus.

- **Portée du verdict.** Aucun défaut supplémentaire de conservation des changements parentaux n'a été identifié dans le merge ni dans le correctif de test. En revanche, la présence de l'adaptateur dans les sources de l'image ne permet pas d'approuver la livraison avec maintien de `search_signals`. Le verdict porte sur cet objectif complet, pas seulement sur la résolution Git. Les vérifications exécutées se limitent aux lectures, comparaisons Git et analyses statiques JSON ; `git diff --check` ne signale aucune erreur.

## Corrections revue livraison

Correctifs locaux réalisés sur `feat/artefacts-delivery`, depuis
`4fce3a0570eeb2ebc018c09acf4e13880a529d9e`. Le constat de revue ci-dessus est
conservé comme état antérieur. Aucun push, merge ou déploiement exécuté.

- L'entrypoint réel `api/src/index.ts` transmet maintenant l'activation serveur
  `MCP_SIGNAL_SEARCH_ENABLED`, strictement 0/1, désactivée par défaut.
  Le test lance ce vrai programme dans un processus séparé, avec PostgreSQL,
  HTTP, JWT délégué et appel MCP ; il couvre les états sans epoch, legacy et BASE.
  Absence d'activation, requête sans jeton, maintenance et révocation restent fermées.
- Les manifests référencent les Secrets `immo-mcp-account-reader` et
  `immo-mcp-workload`, ainsi que les références partagées du workload et du
  reçu API dans `radar-mcp-receiver`. Le modèle versionné reste fermé
  (`MCP_SIGNAL_SEARCH_ENABLED=0`, `STRICT_RECEIVER_ARMED=0`).
  Une règle réseau autorise le seul trajet MCP vers PostgreSQL:5432.
  L'endpoint de jetons est épinglé au chemin IdP `/api/v1/auth/oauth/token`.
- [RUNBOOK-PREPROD-MCP-RACCORDEMENTS.md](RUNBOOK-PREPROD-MCP-RACCORDEMENTS.md)
  contient l'inventaire exact, les comportements en cas d'absence, les GRANT
  limités aux colonnes de comptes/adhésions, les commandes opérateur paramétrées,
  l'ordre avant CD, le reçu lié aux digests et la sonde MCP après déploiement.
  La nouvelle image MCP sans ces raccordements casserait les outils actuels :
  le processus peut être prêt tout en refusant les appels ; les nouvelles
  références obligatoires empêchent le démarrage si les objets manquent.

Qualification locale, zéro échec dans les campagnes finales :

| Vérification | Résultat |
|---|---|
| Démarrage réel + parcours réseau MCP | 17/17 ; avant correctif, 3 refus reproduisaient le blocage |
| Suites ciblées recherche/A2-BASE | 146/146, aucune ignorée |
| API complète, sélection CI sans filtre | 3536 réussis, 695 conditionnels ignorés ; aucun échec |
| MCP hors service E2E, sélection habituelle | 406/406 |
| Q1 / Q2 / acceptance, activation explicite | 31/31, 32/32, 6/6 |
| SQL du runbook et autoriseur réel avec rôle restreint | 1/1 ; lectures, refus d'écriture, suspension et révocation |
| Lint / typecheck des workspaces | Réussis |
| Kustomize base/préprod, dry-run client, YAML et isolation auth/H3 | Réussis |

Preuves : `tmp/delivery-evidence/20261026T165651-4` (reproduction),
`20261026T165729-4` (17 tests), `20261026T170042-4` (campagne complète),
`20261026T171330-4` (rôle SQL et manifests finaux).
La campagne CI retire `LOT_MIGRATION_DB_TEST` comme la configuration CI ;
les suites ciblées l'activent séparément. Les commandes et rapports JSON sont
conservés. Un lancement intermédiaire avait réussi son test mais échoué dans
le lanceur modifié pendant son exécution ; le lanceur utilise désormais une
copie figée et sa réexécution complète termine avec statut 0.
Nettoyage `down -v --remove-orphans` limité au projet possédé ; aucun
conteneur de cette campagne ne subsiste, aucune autre pile n'a été touchée.

La livraison réelle reste conditionnée au provisionnement opérateur et aux
preuves sur les digests déployés. Les sources IdP disponibles ne déclarent pas
le grant RFC 8693 ; les tentatives de découverte publique ont échoué en TLS,
donc l'état de l'IdP déployé n'est pas établi. Son responsable doit fournir
une révision avec échange qualifié et le workload confidentiel avant livraison.
Les Secrets, le cluster et un appel préprod réel n'ont pas été inspectés.
La préparation des Deployments MCP/API et du reçu est indispensable : la CD
actuelle ne réconcilie pas le Deployment MCP ni ce ConfigMap opérateur.

Code qualifié : `2a463844e51c5f30c693dbf15cf16b4f2771fa01` ;
le commit suivant conserve ce rapport et la clôture documentaire locale.
Tous les commits locaux respectent 150 lignes maximum, sujets Conventional,
sans corps ni trailer. Le SHA final est fourni dans la réponse de livraison.
