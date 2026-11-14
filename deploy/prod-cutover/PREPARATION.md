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
`prod-bindings.cjs` reprend les références utiles de préprod avec des noms prod.
`window-deploy` les pose après drain. Les Secrets sont obligatoires.
La clé curseur prod doit égaler `CURSOR_REFERENCE`, le fichier privé conservé en préparation.
Le snapshot garde les ConfigMaps et les env. Le rollback les restaure avant les anciennes images.
`prod-content-ingress.json` prépare le reader monté sur radar-api. Le wildcard doit exister avant window-start.
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

`copy-prepare OWNER=i-cond` atteste les empreintes exactes du plan et du roster.
Il contrôle aussi l’archive. L’approbation expire après 24 h. Elle interdit explicitement la prod.
Les identifiants de recette, le certificat local et les clés IdP sont distincts. Rien n’est affiché.
Chaque nouvelle préparation alloue un OUTPUT privé. `active-copy.json` en garde le chemin.
Toutes les étapes suivantes reprennent cet OUTPUT et la même copie physique.
`copy-up` termine une vraie sonde PostgreSQL locale. `copy-evidence` observe son conteneur terminé.
Le reçu porte UUID, release, IDs, heures de fin et identité du conteneur DB.
Chaque opération sur la copie revérifie l’état Docker. Un consommateur ou hook actif fait refuser.
Ces preuves ne décrivent aucun drain prod.

```sh
rtk make -f deploy/prod-cutover/preparation.mk copy-rehearse OWNER=i-cond ENV=rehearsal
```

Cette commande restaure, migre, rejoue 6H deux fois et vérifie les 44 empreintes.
Elle démarre ensuite API/UI/MCP, IdP et S3 locaux. Elle lance le smoke dans le réseau interne.
Elle laisse la copie disponible pour la recette humaine. Un échec nettoie la stack avec down -v.
Ports loopback requis : 25433, 18821, 15321, 15400 et 443. Aucun port UAT.
Réseau interne. Aucun refresh planifié. Aucun endpoint prod dans la configuration de recette.
Le backend S3 est adobe/s3mock 3.12.0 épinglé par digest. Le proxy local fournit TLS.

Ouvrir `https://recette.localhost:15321`. Faire confiance au certificat privé `ca.crt` sur le poste de recette.
L’IdP propose uniquement les comptes du roster. Le mot de passe local est dans `auth.json`, champ login.
Ne pas publier ce fichier. Choisir le gestionnaire pour les membres et le modérateur pour les archives.
Prévoir un compte Product Owner déjà autorisé pour le reclassement.
Client MCP public : `immo-mcp-rehearsal`. PKCE S256. Callback loopback HTTP explicite.
Issuer : `https://recette.localhost:15321/oidc`. Resource : `https://recette.localhost:15321/mcp`.
Les scopes artefacts et offline_access sont disponibles. Refresh rotatif et échange MCP locaux.

Pour les PV, fournir les fichiers autorisés dans le sous-répertoire privé `documents`.
Le manifeste privé `documents.json` liste bucket, key, file et sha256 pour chaque fichier.
L’import refuse les octets divergents. Il ne télécharge rien en prod.
Sans ces fichiers, la recette des PDF reste à faire. Ne pas présenter des buckets vides comme des PV validés.

Après recette, arrêter les services. Le reçu est renouvelé avec leurs terminaisons constatées.
Le même UUID run est conservé. Puis :

```sh
rtk make -f deploy/prod-cutover/preparation.mk copy-services-stop ENV=rehearsal
rtk make -f deploy/prod-cutover/preparation.mk copy-step STEP=rollback ENV=rehearsal
rtk make -f deploy/prod-cutover/preparation.mk copy-step STEP=rollback ENV=rehearsal
rtk make -f deploy/prod-cutover/preparation.mk copy-down ENV=rehearsal
```

Relever les durées, le WAL, les 44 puis 13 empreintes, les propriétaires, les ACL et les accès legacy.
Ne pas présenter l’inspection du catalogue comme une restauration validée.
