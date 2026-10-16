# Fonction : récepteur API délégué strict — 861-b

## Objective
- [x] Isoler le récepteur strict dans [PR brouillon #865](https://github.com/rhanka/radar-immobilier/pull/865), branche `feat/861-immo-mcp-secure-receiver`, selon [spec v8](/home/antoinefa/src/sentropic/.tmp/immo-mcp-enablers/spec-v8.md) §§1, 2, 4–7, 10 et 11.
- [x] Référence normative : SHA-256 `6459675be17575251800efe658d27134df14b7d87f09b250df5f8ed32e06e666` ; analyse `ECART-V7-V8.md` dans `lots-radar-861` du scratchpad demandé.

## Scope / Guardrails
- [x] Worktree autorisé `.worktrees/861-secure-receiver` ; ancien HEAD `97a405a9e4b3099bf5d07f21ade6b4e3cb09f7ff`, corrections conservées dans `backup/861b-97a405a9` avant réécriture.
- [x] Préserver cookies, comptes approuvés et routes publiques de données brutes ; contrôle strict inconditionnel, aucun interrupteur de déploiement dans cette branche.
- [x] Hériter des commits 861-a ([PR #866](https://github.com/rhanka/radar-immobilier/pull/866)), puis ajouter seulement `api/**` et ce plan ; découverte, fixtures, ingress et Make restent attribués à 861-a. Échange/cache et upgrade mcp-auth 0.2.2 appartiennent à 2b-MCP.
- [x] Mandat du 16/10 : sauvegardes et commits locaux autorisés ; aucun push, fusion, déploiement ou commentaire GitHub. Make/Docker, `ENV` en dernier, aucune lecture de `.env`, aucun Python ; checkout racine/`ENV=dev` réservés à l'utilisateur.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths** : `api/src/config{,.test}.ts`, `api/src/routes/auth{,.test}.ts`, `api/src/services/auth/oidc{,.test}.ts`, ce plan ; l'ancien `plan/861-BRANCH_feat-immo-mcp-secure-receiver.md` est absent de l'arbre final.
- [x] **Forbidden Paths** : nouvelles modifications `packages/**`, fixtures, ingress/`deploy/**`, `Makefile`, `docker-compose*.yml`, dépendances/lockfiles, `rules/**`, bootstrap agents, `.github/workflows/**`, autres plans.
- [x] **Conditional Paths** : contenu commun hérité exactement de 861-a, y compris son plan et les sept documents apportés par le rebase sur main ; rapports et journaux dans le scratchpad autorisé.

## Feedback Loop
- [x] **Clarification** : deux PR, plans et têtes distincts sont obligatoires (§§1/6/11), même avec un interrupteur qualifié ; le mandat remplace l'ancien plan combiné. Le rapport d'historique relie les têtes initiales aux nouvelles têtes sans publier les branches.
- [x] **Configuration** : audience unique égale à l'origine de `AUTH_CALLBACK_BASE_URL` ; `SENTROPIC_MCP_WORKLOAD_CLIENT_ID` lie `act.sub` et `client_id`, défaut `immo-mcp-workload`.
- [x] **Décision** : avertir si l'auth est activée sans audience dérivable ; refuser les bearers tout en conservant les sessions navigateur. Aucun jeton ou secret dans cet avertissement.
- [x] **Inventaire** : `by-city` est le seul segment littéral sous `/api/graph-signals/` ; il agrège les villes et reste exclu du profil délégué.
- [x] **Consommateurs** : l'audit du correctif précédent n'a trouvé dans API/UI/packages aucun autre consommateur de bearer IdP vers Radar que `search_signals` ; cette preuve locale ne constitue pas un inventaire des clients externes.
- [x] **Rollback** : la revue citée par v8 §6 observe `ROLLBACK_ON_FAILURE_ENABLED` absent ; valeur effective actuelle non revérifiée dans ce mandat. Son relevé et sa désactivation durant l'activation restent un gate opérateur explicite.
- [ ] **Attention / i-cond** : les preuves locales ne ferment ni revue indépendante des têtes réécrites, ni CI distante, ni reçus de fusion/déploiement/retour arrière.

## Orchestration Mode (AI-selected)
- [x] Écriture séquentielle ; histoire locale = commits 861-a + seuls commits API/plan 861B, sans copie des commits MCP. L'intégration réelle reste **861-a → 2b-MCP → 861-b**.

## UAT Management (in orchestration context)
- [x] Aucune UI ou pile réelle modifiée ; i-cond possède l'acceptation du client déjà connecté et des ingress réels, préprod puis production (§6).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Références et conservation**
  - [x] Lire règles, rapports de correction et diff complet v7 → v8 ; la v8 conserve le contrat du récepteur et ajoute des obligations de provenance, séparation et qualification.
  - [x] Tests isolés `ENV=test-861b-historique` : API 18871, UI 15871, Maildev UI 11871, Postgres 15872, S3 19871, Obscura 19872, SMTP 11872 ; vérifier les ports avant démarrage, compose test sans publication hôte.
- [x] **Lot 1 — Récepteur et profil de lecture (§6, B-M1)**
  - [x] Vérifier signature, issuer, expiration/not-before, sujet humain non vide, audience API unique (chaîne ou tableau singleton), acteur/client et compte approuvé ; exposer les claims vérifiés au middleware.
  - [x] Autoriser seulement scope `immo:search` et GET `/api/graph-signals/:city`, segment canonique unique sans `by-city` ; interdire agrégat, variantes de casse, doubles slashs, encodages et slash final avec 403 et aucun handler métier.
  - [x] Préserver tests positifs, refus du jeton MCP à l'API, audience multiple/incorrecte, issuer/clé/signature/expiration, comptes inconnus/suspendus et régressions cookies/routes publiques ; aucun cookie ne masque les tests négatifs bearer.
- [x] **Lot 2 — Acteur et motifs de refus (B-m4/B-m5)**
  - [x] N'accepter que `act: { sub: expectedWorkload }` ; refuser clés supplémentaires/acteur imbriqué/client incorrect, avec réponse HTTP uniforme 401 et aucun handler.
  - [x] Vérifier messages exacts et propriétés jose `code/claim/reason` dans les tests unitaires ; l'API ne divulgue pas ces détails.
- [x] **Lot 3 — Audience absente (Fable m3)**
  - [x] Tester avertissement pour URL absente/vide, absence d'avertissement avec configuration valide/auth désactivée, bearer 401 et cookie valide 200.
- [x] **Lot 4 — Conservation des preuves de correction**
  - [x] Historique précédent : 13 échecs attendus / 179 réussites avant correction ; puis 192 tests ciblés, 2 348 tests API réussis / 6 ignorés, typecheck/lint à 0 et nettoyage complet ; `RAPPORT-ASTRA-861B-FIX.md` distingue ces exécutions.
  - [x] Campagne du présent mandat : API complète 2 348 réussites / 6 ignorés, typecheck/lint à 0 (7 avertissements Svelte inchangés), huit étapes API intermédiaires typecheck/tests à 0 ; `down -v` et absence des ressources du projet vérifiés. Résultats, identité du code et SHA dans `RAPPORT-ASTRA-861-HISTORIQUE.md`, journaux `astra-861-historique-logs/`.
- [ ] **Lot 5 — Prérequis amont, i-cond (§§4/6/7/10/11)**
  - [ ] Q-A1 « Tout attend la fusion » : #679 entier, registre/pages compris, doit être fusionné ; consigner publications auth-hono/cluster-mesh, tuple exact qualifié et reçus IdP déployé/M3 protégé de l'environnement avant 2b-MCP.
  - [ ] mcp-auth 0.2.2 est publié depuis `2026-10-16T08:18:02.527Z` ; vérifier signature de provenance (source `6138a8d5514763a405ad8735582a9d3b64548dab`, workflow, digest du sujet) et intégrité de l'archive du §7 avant consommation. Pas de republication ou nouveau GO #675 ; 861-a reste sur 0.1.0.
  - [ ] Qualification isolée : tarballs + bundle API/IdP et bootstrap construits depuis le même checkpoint accepté de #679 (§4), avec migration/provisioning réels. Vérifier SHA source, lock/outillage, entrées auth-hono, empreintes des archives et identités d'images avant démarrage ; pull désactivé, aucun montage de sources inter-dépôts.
  - [ ] Faire exercer M3 create/replay/conflict et les deux environnements exacts, comptes/adhésions approuvés/refusés/ambigus, avec DB/clés/données synthétiques jetables ; reconstruire/requalifier si les entrées changent. Aucun secret ou endpoint réel ; ce reçu ne remplace pas IdP/M3 déployés.
  - [ ] Consommer le tuple prouvé en installation stricte `--strict-peer-deps`, sans résolution legacy/force/omission ; garder l'union des peers, les releases gateway/auth-ui même limitées aux manifestes et le rapprochement candidat/publié (§10). L'ordre réel #662/#679 gouverne les versions finales.
  - [ ] 2b-MCP porte mise à niveau manifeste/lock, suppression du GET canonique temporaire et preuve 403 `insufficient_scope` sans reconnexion/consentement élargi ; mauvaise audience reste 401, captures historiques inchangées (§§2/7).
- [ ] **Lot 6 — Fusion et activation, i-cond (§6)**
  - [ ] Garder #865 brouillon jusqu'aux fusions séparées 861-a puis 2b-MCP et au déploiement réussi de l'échange dans l'environnement réellement atteint par main ; aucune activation simultanée échange/strict.
  - [ ] Recontrôler `PREPROD_CD_ENABLED=true`, cible réelle de main et protections production avant 861-a, 2b-MCP et le récepteur ; inconnu/absent/faux bloque. Main atteint préprod ; production progresse par promotions qualifiées.
  - [ ] Avant fusion 861-b, reçu d'échange terminé : environnement, source complète, digests API/MCP déployés, issuer/JWKS et provisioning M3, `search_signals` positif avec le même humain ; préserver les commits/images distincts échange seul et strict.
  - [ ] Relever la valeur effective `ROLLBACK_ON_FAILURE_ENABLED` et garder le rollback automatique désactivé durant activation. Aucun retour vers une API non stricte, une audience MCP acceptée ou un MCP passthrough ; une éventuelle cible automatique exige image/config strictes déjà qualifiées.
  - [ ] Préparer et qualifier le rollback MCP d'échange + API stricte avant bascule ; conserver contrôles audience/acteur/client/profil et connexion publique/consentement, puis réexercer les deux refus d'audience après retour arrière.
  - [ ] Qualifier préprod : matrice bearer sans cookies, séparation inter-environnements, même sujet humain, scopes/acteurs/comptes, deux utilisateurs et identités fraîches, panne cache chaud/froid, révocation/rotation, données publiques/stubs inchangés ; conserver latences et limite de disponibilité 60 s (§§2/6).
  - [ ] Rattacher les réponses réelles aux reçus ingress du plan 861A : rendu préprod gardé/appliqué par opérateur et production 41 seule ou 30/40 figés avant application ; digests conformes à l'étape, jamais workflow MCP non modifié ni `:latest` non promu.
  - [ ] Production : après reçu préprod complet, promouvoir échange seul par un premier tag protégé `v*`, enregistrer son reçu positif production, puis strict par un second tag `v*` distinct ; les deux commits restent ancêtres de main, toute reconstruction d'image impose requalification.
  - [ ] Actualiser les descriptions PR avec spec v8, plans et correspondances source/têtes, puis revue indépendante de chaque tête et CI liée au SHA complet ; les anciens rapports ne sont pas une approbation des nouvelles têtes.
  - [ ] Commits sélectifs ≤150 lignes, titres anglais Conventional Commits sans trailer ; publication/intégration restent hors mandat. Fusion par merge commit, branche conservée et plan archivé après acceptation.
