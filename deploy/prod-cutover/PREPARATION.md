# Préparation owner — 13 novembre 2026

D1 : tout le train part. La préprod devient la prod.
D2 : mêmes comptes, espaces, capacités, gestionnaires et modérateurs que la préprod actuelle.
D3 : artefacts statiques actifs. Artefacts live désactivés.
D4 : au plus tôt. La perte de données PV rafraîchies est acceptée. Le refresh les regénère.

Les [preuves agrégées](preparation-proof.json) ne contiennent aucun sujet OIDC.
Le répertoire privé `/home/antoinefa/.local/share/radar-prod-copy` est en 0700.
Le roster, le plan, les inventaires, le rendu, le curseur et l’archive sont en 0600.
Aucune donnée de tri Chaperon n’a été extraite de préprod. #1080 reste applicable.
L’archive complète prod conserve les données historiques pour la restauration.

La préprod contient six comptes approuvés, six appartenances actives et un espace.
L’espace est `agence-chaperon-immobilier`. Un membre gère les appartenances. Un membre modère les archives.
Le plan choisit le gestionnaire existant comme acteur. Aucun droit ajouté.
Les six sujets OIDC existent aussi en prod avec status=approved.
Le hook 6H ne crée aucun compte. Il reçoit le tableau exact du roster.
Le curseur `preprod-v1` et sa clé ont été conservés en privé. Clé décodée : au moins 32 octets.
La référence cible doit être câblée dans le Deployment prod avant ouverture. Ne jamais publier la clé.

Le dump passe par le service PostgreSQL prod et le port-forward local 25432.
Les identifiants viennent de `radar-db-ro-prod`. Le rôle est vérifié sans capacités DML/DDL héritées.
Transaction RO imposée. Dump custom `--no-owner --lock-wait-timeout=5s`.
Le port-forward est arrêté. Le mot de passe temporaire est supprimé.
Le catalogue custom est lisible avec pg_restore 16.4. Aucune restauration lancée.
L’archive préliminaire ne remplace pas la sauvegarde finale après drain.

## Configuration préparée

`prod-settings.json` porte D3. `render` produit quatre ConfigMaps dans `configuration.json` privé.
`radar-api` et `immo-mcp-config` activent le contrôle statique `general`.
Le mode git est `off`. Les outils git/live ne sont pas composés. La publication statique reste active.
Edge live à `0`. Qualification, invitations et redrive à `false`, sur les deux workloads.
Les scopes MCP statiques, leur compatibilité legacy et offline_access reprennent la préprod.
Le receiver reprend search activé et strict non armé. Les URL et coordonnées deviennent prod.
Le test de rendu contrôle ces portes et la conservation exacte des octets du plan.

Avant application, k8s doit confirmer bucket, DNS/TLS pages, reader et secrets S3/statique.
Reprendre les références de `patch-artifacts-api-env.yaml` et `patch-artifacts-mcp-env.yaml` de préprod.
Employer des Secrets prod. Ne pas reprendre les clés live, ni les endpoints préprod.
Fournir account-reader, artifact-writer et workload MCP avec leurs grants restreints.
L’IdP prod doit connaître les scopes artefacts et autoriser refresh_token/offline_access avant leur annonce.
Cette lane ne provisionne aucun de ces éléments en prod. Le rendu ne suffit pas à les créer.

## Commandes pour i-cond après revue

Clients PG16 préparés dans le répertoire privé `bin`. Aucune installation hôte.
L’image PostGIS locale est épinglée. Elle correspond à PostgreSQL 16.4/PostGIS 3.4.3 observés en prod.
La cible copy-up initialise radar et quatre rôles NOLOGIN. Elle ne restaure aucune archive.
Le port réservé est 25433. Le réseau Compose est interne. Aucun port UAT utilisé.
Les images API/UI viennent du manifeste du run 43506353942. Aucun rebuild.

Avant lancement, i-cond doit fournir `approval.json` privé : owner, sha complet, expiresAt,
planSha256 et rosterSha256 exacts. Le choix D2 est acquis. Le véhicule exige encore cette attestation.
Il doit fournir `evidence.json` privé avec un UUID run, release complet, instances réellement terminées
et completedAt de moins de 24 h. Preuve locale uniquement. Aucun drain prod inventé.
Chaque étape utilise le même OUTPUT privé et la même copie physique.

```sh
rtk make -f deploy/prod-cutover/preparation.mk copy-up ENV=rehearsal
rtk make -f deploy/prod-cutover/preparation.mk copy-step STEP=restore-test ENV=rehearsal
rtk make -f deploy/prod-cutover/preparation.mk copy-step STEP=migrate ENV=rehearsal
rtk make -f deploy/prod-cutover/preparation.mk copy-step STEP=transition ENV=rehearsal
rtk make -f deploy/prod-cutover/preparation.mk copy-step STEP=verify ENV=rehearsal
```

Ne pas lancer la cible automatique rehearsal pour remplacer la recette.
Préparer ensuite UI/API/MCP et stockage objet locaux sur cette copie.
Refresh et accès aux services prod désactivés. Les secrets de recette sont distincts.
Faire smoke avec SMOKE_URL local explicite et un compte autorisé du roster.
Le compte doit pouvoir s’authentifier dans l’IdP de recette. Son sujet doit correspondre au roster.
Il faut le gestionnaire pour la gestion des membres et le modérateur pour les archives.
Prévoir un compte PO pour le reclassement, des PV et un client MCP OAuth avec les scopes requis.
Aucun compte de recette créé en prod. L’authentification locale et les services restent à câbler.

Après recette, arrêter ces services. Renouveler EVIDENCE avec leurs terminaisons constatées.
Garder le même UUID run. Puis :

```sh
rtk make -f deploy/prod-cutover/preparation.mk copy-step STEP=rollback ENV=rehearsal
rtk make -f deploy/prod-cutover/preparation.mk copy-step STEP=rollback ENV=rehearsal
rtk make -f deploy/prod-cutover/preparation.mk copy-down ENV=rehearsal
```

Relever les durées, le WAL, les 44 puis 13 empreintes, les propriétaires, les ACL et les accès legacy.
Ne pas présenter l’inspection du catalogue comme une restauration validée.
