# Préparation owner — 13 novembre 2026

D1 : tout le train part. La préprod devient la prod.
D2 : mêmes comptes, espaces, capacités, gestionnaires et modérateurs que la préprod actuelle.
D3 : artefacts statiques actifs. Artefacts live désactivés.
D4 : au plus tôt. La perte de données PV rafraîchies est acceptée. Le refresh les regénère.
Vers 19 h : « Tout ce soir, bascule décalée ». Les prérequis statiques restent obligatoires.

Les [preuves agrégées](preparation-proof.json) ne contiennent aucun sujet OIDC.
La [répétition réelle](REHEARSAL.md) est terminée. La copie reste au candidat pour recette humaine.
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
Le catalogue custom est lisible avec pg_restore 16.4. La restauration sur copie a réussi en 110,847 s.
L’archive préliminaire ne remplace pas la sauvegarde finale après drain.

## Configuration préparée

`prod-settings.json` porte D3. `render` produit quatre ConfigMaps dans `configuration.json` privé.
`radar-api` et `immo-mcp-config` activent le contrôle statique `general`.
Le mode git est `off`. Les outils git/live ne sont pas composés. La publication statique reste active.
Edge live à `0`. Qualification, invitations et redrive à `false`, sur les deux workloads.
Les scopes MCP statiques, leur compatibilité legacy et offline_access reprennent la préprod.
Le receiver reprend search activé et strict non armé. Les URL et coordonnées deviennent prod.
Le test de rendu contrôle ces portes et la conservation exacte des octets du plan.

Bucket et DNS wildcard sont fournis par k8s. immo provisionne Certificate, Ingress, Secrets et rôles MCP.
k8s confirme le CORS administrateur avant ouverture. Voir le runbook actualisé.
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
La cible copy-up initialise radar et quatre rôles NOLOGIN. Elle recrée la base depuis template0.
Le marqueur de destination reste 127.0.0.1:25433. Les clients PG et le hook passent par le réseau interne.
Docker ne publie pas de port sur ce réseau interne. Seul le proxy UI rejoint aussi le réseau d’entrée.
Les ports du proxy restent en loopback. API, MCP, IdP et S3 n’ont aucun réseau de sortie.
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
Elle laisse la copie disponible pour la recette humaine. Un échec avant restauration nettoie avec down -v.
Après restauration réussie, un échec garde la copie arrêtée pour diagnostic. `copy-resume` reprend sous la même attestation.
Ports loopback requis : 25433, 18821, 15321, 15400 et 443. Aucun port UAT.
Backend sur réseau interne. Aucun refresh planifié. Aucun endpoint prod dans la configuration de recette.
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
Pour mesurer les deux retours sans écraser le premier reçu, `copy-rollback-twice ENV=rehearsal`
arrête les services et conserve `rollback-first.json` et `rollback-second.json` dans OUTPUT.
La répétition du 13/11 a remis la même copie au candidat pour la recette humaine.
La suppression finale reste différée à la fin de cette recette.
