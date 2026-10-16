# Annexe technique — réalisation de la cible #861

**14 octobre 2026 · v11.** Tes [décisions](DECISIONS-OWNER.md) fixent
cluster-mesh dans Immo, la continuité du MCP et les écritures métier sous les
droits du lecteur. Les [schémas Focus](focus/architecture.md) décrivent cette
cible en cinq vues ; les mécanismes ci-dessous restent à réaliser et à vérifier.
Une question reste ouverte : la façon dont le MCP enveloppé appelle Radar
(voir §5 du dossier et J5 ci-dessous). Elle ne rouvre pas les décisions prises.

« Hôte retenu » désigne désormais **Immo**. La bibliothèque et ses modèles
appartiennent à Sentropic ; DB/S3 et publication sont exploités par l’instance
Immo. L’ancien service central ne fait pas partie du pilote. Les faits sourcés
restent marqués [FACT], les propositions techniques [JUDGMENT].

La continuité MCP est impérative dès le pilote : même adresse, compte et
connexion, sans reconnexion ni réglage, mêmes noms, paramètres et réponses.
Les mécanismes d’activation des **vues** ne s’appliquent pas à cette connexion MCP.
La cible fonctionnelle est le profil métier avec écritures ; des données fictives
peuvent servir aux essais préparatoires, sans remplacer le résultat demandé.

Les repères internes des recettes sont conservés pour retrouver les revues :
R0 = contrôles API, L-1 = essai local, L0a = essais fictifs, L0b = intégration,
L4 = recette. Ce ne sont pas des questions owner. Les mots techniques gardés
dans cette annexe sont définis au glossaire (section K) ; les cinq vues Focus
n’emploient que des libellés d’usage. Les pistes d’intégration embarquée et de
consommateur distant restent explicitement hors pilote. L’exécution par vue
(adresse stable de la vue) fait partie du pilote ; le lien épinglé par version
reste disponible pour citer une version exacte.

## A. Réutilisation, frontières et présentation

| Brique | Existant vérifié | Évolution proposée |
|---|---|---|
| Stockage | [FACT] `ArtifactStorePort` : put/getBytes/getStream/head/delete ; binding S3/checksum/stream, backend local ; pas de VersionId contractuel. S07. | Bucket privé et démarrage refusé sans S3/auth en préprod ; blobs/manifeste, upload temporaire borné, pré-signature à construire, quotas/purge. |
| Identité/résidence | [FACT] Membership approuvé → tenant, workspace distinct ; single-node ; token exchange fermé. S08. | Contexte vérifié du namespace ; ne jamais accepter `ownerSub`/`tid` d’un argument comme autorité. |
| `/mcp` produit | [FACT] `ClusterMeshHonoNamespaceModule`, `mcp-auth`, `createMcpSupervisor`, contrôle de génération/auteur, `createMcpPlatformHono`. Dispatch Drive / sinon Gmail. S12. | Promouvoir mcp-platform/mcp-auth, réemployer connector-host et productMcpModule ; artefacts et Immo sous leurs manifestes/adaptateurs, sans moteur absorbé. |
| Paquet mesh | [FACT] Catalogue `mcp/platform=source_unavailable`, distinct du montage dans l’API. S08/S12/S34. | Composer le fournisseur artefacts autonome et les modules MCP, selon CM-D1/D6/D13 ; feuilles/acquisition à qualifier. Le nœud instancie les providers ; installer le paquet ne déploie rien. |
| immo-mcp | [FACT] SDK MCP direct, 12 tools, HTTP à sessions et stdio ; mcp-auth/oauth-verify publiés, pas de dépendance cluster-mesh. S36. | Consommateur du socle MCP composé via cluster-mesh ; manifeste/adaptateur et handlers Radar ; configuration des outils versionnée dans le code Immo, validée par relecture et embarquée dans le nœud (le registre Sentropic reste la source d’approbation, sans appel pendant le fonctionnement). Migration de transport et parité explicites, pas seulement ajout d’un connecteur. |
| Mutations MCP | [FACT] Racine stable read-only, mutations expérimentales ; §13 réservé au PRINCIPAL. S17/S22. | Stabiliser ou adopter explicitement les opérations nécessaires ; autorisations métier après scopes MCP, idempotence et audit. |
| `/apps` | [FACT] Templates draft/published/deprecated, instances prod/preview/local, ports et contrôles administrateur. S18. | Réutiliser la source DB de la décision Architecture D2 ; projection catalogue ; autorisation propriétaire à concevoir, sans ouvrir globalement les routes admin. |
| `/transfers` | [FACT] Limites déclarées : 64 Mio compressés, 2 048 entrées, 32 Mio/entrée, 256 Mio décompressés. Mais JSZip vérifie les CRC en décompressant avant le contrôle des tailles décompressées ; seule la limite compressée précède cette étape. S18/S31. | Port réutilisable, garde CPU/mémoire à construire pendant la décompression ; ne pas reprendre ce validateur tel quel pour une archive hostile. Contrôler aussi doublons bruts, liens et chemins. |
| D5 / ARCH-17 | [FACT] D5 de la spec Architecture impose grants courts, edge stateless et domaine distinct. ARCH-17 reçoit ces sujets, sans format de grant défini dans sa spec désignée ; étude BR-54 absente au commit consulté. S14/S23/S30. | #861 propose un premier contrat à instruire avec ces responsables ; aucune revue existante ni compatibilité acquise ne lui est attribuée. |
| Publication locale/CI | [FACT] Device sessions avec refresh ; `auth-client` S2S à audience, TTL par défaut 900 s, pas de révocation S2S immédiate. S21. | Device pour l’humain ; S2S + délégation révocable par artefact pour la CI. TTL S2S ≠ borne des grants edge. |
| Radar / geo | [FACT] Vite proxy ; auth/me cookie seul ; bearer sans restriction de profil ; geo relatif dans nginx, satellite à origine restreinte. S03–S05/S11. | R0, adaptateur UI/auth ; route OGC bornée conservée ; `VITE_GEO_SAT_BASEMAP=false` dans le kit, aucun proxy du satellite par défaut. |

**Correspondance avec les modèles Sentropic.** Le gabarit reprend `/apps/templates` (décision Architecture D2) ; un artefact instancié référence une instance d’app et son manifeste `static-web`. Une vue durable rejoint le modèle `AppDeployment` ; une preview de worktree référence `(workspace, branch/ref, app, ttl, authPolicy)` comme `UatEndpoint`, avec un binding S3 à instruire. L’absence de remote doit être représentée explicitement : ne pas inventer un `remoteId` ni déclarer ce schéma déjà compatible. La revue de contrats à préparer compare réemploi cohérent de /apps, /resources, /transfers (et /documents à étudier) et nouveau namespace /artifacts sous CM-D13/D11/ARCH-12 ; aucune variante ratifiée.

**Présentation.** Fiche de confiance dans Immo, fournie par la capacité commune Sentropic : auteur, titre, type/MIME, état, version, base source, visibilité, expiration, capacités API, ouvrir/forker/exporter/supprimer. Les métadonnées et commentaires héritent de l’ACL ; les sources ont un droit supplémentaire. [FACT] Le catalogue possède le kind `canvas`, la spec décrit `LiveDocumentRef` et `comments` admet `artifact` [S25]. Cela ne constitue pas un renderer `static-web` complet.

`contentKind=static-web`, `mediaType=text/html`, projection catalogue `canvas` et référence LiveDocument sont distincts. Prévoir un adaptateur vers le catalogue et les commentaires, avec version/digest de release ; ne pas charger du HTML custom dans l’origine de contrôle, y compris dans un aperçu ou `initialContent`.

Deux modes de présentation, distincts du profil de données :

- **`page`**, livré au pilote : navigation de premier niveau, cookie hôte-seul, BFF relatif, `frame-ancestors 'none'` pour ce profil.
- **`embed`**, réservé, demandé = erreur `presentation_mode_not_available` au pilote. Cible : iframe sandbox sur origine épinglée, parents Sentropic explicitement autorisés, shell de confiance et pont versionné. Aucune promesse d’iframe privée fonctionnelle avec les cookies Lax de `page`.

Le futur pont a une frontière minimale, pas une implémentation approuvée : `init(artifactId, releaseId, nonce, protocolVersion)` ; messages à IDs corrélés et opérations typées, pas d’URL arbitraire ; vérification `event.source`, origine exacte, nonce, expiration et droits ; `targetOrigin` exact, jamais `*` pour une donnée privée ; aucun bearer transmis au contenu. Les octets et réponses métier restent servis par l’edge, pas relayés à travers l’API de contrôle. Les choix de sandbox/origine opaque, de chargement des sous-ressources privées et de canal shell→edge exigent une preuve spécifique. CHIPS/DPoP sont des variantes à étudier, pas une compatibilité universelle. Interdire `embed` tant que cette preuve manque.

## B. Contrat minimal SPA et boucle locale

### Les trois formes d’URL envisagées par Fabien

[JUDGMENT] Cette comparaison motive le routage proposé ; elle n’ajoute pas une
question à Fabien et ne choisit aucun nom de domaine. La séparation du
domaine de contenu est une règle existante (décision Architecture D5, S14).

| Variante | Intérêt | Contrainte et conclusion proposée |
|---|---|---|
| Préfixe `/artefact/<uuid>/…` | Un certificat, routage simple, lien lisible. | Les vues partagent une origine et les SPA doivent adapter leurs chemins de base. Écarté sur l’origine de l’application principale ; envisageable sur domaine distinct pour du contenu de même confiance ou avec une isolation supplémentaire. |
| Postfixe `…@artefact/<uuid>` | Raccourci logique possible pour retrouver ou rediriger vers une vue. | Les imports et appels API n’héritent pas automatiquement du suffixe. S’il est placé après `#`, le serveur ne le reçoit pas. Alias éventuel, pas un contrat de routage transparent pour toute SPA. |
| UUID en sous-domaine, sur domaine de contenu distinct | Une racine `/` par vue, chemins relatifs usuels et origine propre ; c’est la recommandation. | DNS et certificat wildcard à exploiter ; sessions et voisinage entre sous-domaines à traiter. Le wildcard seul ne sépare pas tous les espaces de confiance du navigateur. |

Un hôte contient **un UUID standard de 36 caractères**, soit celui de l’artefact,
soit celui de sa version. Les deux UUID ne sont pas concaténés : ils dépasseraient
la limite de 63 octets d’une étiquette DNS (W6). Le §5 du dossier explique le
comportement des liens et la récupération de l’identité. Les hôtes épinglés
restent une proposition technique ; changer d’origine ne transfère pas les
préférences ni la session du navigateur. Le kit doit accompagner ce changement.

### Le contrat proposé pour la SPA

| Surface | Contrat |
|---|---|
| Contenu | Export statique HTML/CSS/JS/WASM ; aucun build serveur, SSR, container utilisateur ou backend arbitraire. |
| URL/assets | Racine `/` ; chemins cohérents ; dépendances CDN déclarées ou vendoriées. Pas de réécriture heuristique du JavaScript. |
| Navigation | Modes history/hash/none. Fallback uniquement pour navigation HTML ; jamais pour `/api`, auth, modules, workers ou assets absents. Un chemin avec point peut être une route, donc pas de simple heuristique d’extension. |
| Réservés | `/api/*`, `/__artefact/*` ; bundle ne peut les masquer. Route d’assets hachés gérée par le manifeste. |
| MIME | MIME déclaré/vérifié, `.mjs` JavaScript, `.wasm` WebAssembly, `nosniff`, Range sous même autorisation que GET. |
| Réseau | Profil serveur vers amonts fixes préprod/OGC, jamais URL arbitraire du manifeste. Refus localhost/metadata/production/redirects hors profil. |
| CSP | Produite par la plateforme ; profil HTML inline fonctionnel (hashes si appropriés), origines annexes explicites, `eval` non accordé silencieusement. |
| Workers | Workers dédiés et PDF permis selon profil ; SW refusés via `Service-Worker: script` sur toute route, fallback inclus. À vérifier avec ingress/navigateurs. |
| Limites | SSR, SW, URLs figées d’une autre app, WebSocket de dev hébergé : autre contrat. « Toute SPA » signifie toute SPA statique satisfaisant ce contrat, pas zéro adaptation universelle. |

**L-1 local.** Réutiliser `API_PROXY_TARGET`, ajouter au proxy un token utilisateur gardé côté processus et l’adaptateur `/me/login/logout`. Client PKCE public préenregistré, callback loopback exact/port fixé, `resource` Radar préprod ; `userinfo`/claims validés pour l’identité, et contrôle du compte approuvé via une route protégée. Ne pas fabriquer `/me` en décodant un JWT sans vérification. La route `/me` produit l’état réellement obtenu, pas un faux cookie Radar.

**Routage Geo explicite, en L-1 comme dans l’edge.** La règle la plus spécifique
`/api/geo/collections` cible geo-préprod, avec le chemin OGC et le Host attendus,
avant la règle générale `/api` vers Radar ; aucun bearer Radar n’est envoyé à Geo.
[FACT] Le nginx préprod fait déjà ce routage (S04). À l’intérieur de radar-api,
les routes collections et source-coverage prennent cependant
`GEO_OGC_BASE_URL` ou, par défaut, `https://api.geo.sent-tech.ca` (production) ;
aucun réglage de cette variable n’est trouvé dans deploy/ ou .github/ au commit
lu (S29). Faire suivre tout /api à Radar n’est donc pas équivalent au nginx.
La lane Radar/k8s doit confirmer la valeur réellement déployée et prouver que
les appels internes, notamment source-coverage, restent en préprod avant leur
admission au profil. Rien n’est corrigé dans les dépôts par cette étude.

Le serveur Vite actuel écoute `0.0.0.0` [S03] : le mode local proposé doit écouter le loopback, valider Host/Origin, refuser les requêtes cross-site et ne pas devenir un proxy ouvert sur le LAN. Aucun token dans une variable `VITE_*`, bundle, URL ou journal. Profil explicite de méthodes, routes, paramètres et données : usages métier de l’UI et écritures permises avec les droits du lecteur. Les essais fictifs sans amont réel restent possibles. Une route non inventoriée reste refusée jusqu’à qualification par l’équipe ; ce travail doit inclure notes, marques et évaluation du parcours demandé. Les routes locales d’auth sont traitées séparément, non relayées librement vers l’API.

Avant R0, ce bearer reste utilisable plus largement si le proxy/processus est compromis : le filtre local n’est pas une restriction côté Radar. L-1 est limité à un développeur autorisé avec les droits qu’il possède déjà, sur un poste admis par DV3. Pas d’auteur distant ni de partage du serveur local. Dès R0, employer l’audience restreinte. Règles make/containers/`ENV` et canal UAT du dépôt conservés ; pas de checkout racine transformé ici en environnement de test.

## C. Identifiants, manifeste, sources et stockage

**UUID standards, récupération par nom stable décrite au §2 du dossier.** Un UUID et une
seed de nommage répondent à deux besoins distincts : l’UUID adresse l’objet ;
la clé de liaison permet de le retrouver depuis une branche ou un nom de vue.
Un hash de contenu n’est ni l’un ni l’autre. Les règles ci-dessous décrivent
**S2, hypothèse de travail pour la préparation, sans contrat ratifié**. S1 conserve seulement le reçu ;
S3 dérive l’UUID d’une seed. Ces alternatives techniques restent conservées ici comme historique ; le pilote retient l’UUID serveur et la récupération par nom stable.

| Élément | Qui le fournit, quand | Où le retrouver / à quoi il sert |
|---|---|---|
| `artifactId` = UUIDv4 en S1/S2 | Le registre serveur, à la création ou au fork ; S2 retrouve d’abord la liaison existante. Unicité vérifiée avant enregistrement. | Identité durable, catalogue sous ACL, reçu et préfixe S3. Propriétaire immuable ; tenant/workspace vérifiés. S3 change l’attribution : UUIDv5 calculé depuis namespace et seed. |
| `bindingKey` en S2 | Le client choisit ou recalcule une clé de nommage depuis son contexte ; le contrôle vérifie sa portée. | `ensure(bindingKey)` crée ou retrouve l’artefact dans (tenant, principal propriétaire). La clé n’est ni un secret ni une permission. |
| `releaseId` = UUIDv4 distinct | Le registre réserve une release par (artifactId, manifestDigest). | Même manifeste et release non terminale : même release ; nouvelle publication après retrait selon C conserve artifactId mais crée releaseId. Pending non servi. |
| `uploadId` = UUIDv4 | Le service, après contrôle des droits et quotas. | Préfixe temporaire autorisé et borné ; aucun hôte public associé. |
| SHA-256 fichier / manifeste / sources | Le client calcule l’empreinte ; le serveur la recalcule sur les octets validés. | Intégrité, delta d’upload et références aux blobs. Ni identité de l’auteur, ni autorisation, ni nom DNS. Un ETag S3 n’est pas ce hash. |
| `idempotencyKey` | Le client avant une opération, selon le type existant `IdempotencyKey`. | Rejeu de la même demande ; même clé et autre demande = conflit. Cette clé d’opération ne remplace pas la bindingKey ni le digest de publication. |

**Au pilote : fiche stable, exécution par vue.** La fiche de la vue appartient
à l’origine de contrôle de confiance et résout son `artifactId`. La page s’exécute
à `https://<artifactId>.<domaine-artefacts>/`, adresse stable de la vue ; chaque
nouvelle version demande aux destinataires de l’activer (voir E2). Un lien épinglé
`https://<releaseId>.<domaine-artefacts>/` reste disponible pour citer exactement
une version. Ce choix évite un nouveau lien à chaque publication, qui freinerait
le maquettage rapide ; l’équipe le confirme pendant la réalisation ou explique
pourquoi une adresse par version resterait nécessaire.
Chaque hôte d’exécution contient un seul UUID. Un UUID canonique
minuscule fait 36 caractères : il tient dans la limite de 63 octets [W6].
Concaténer deux UUID avec un séparateur la dépasserait. Le registre sait si
l’hôte désigne un artefact ou une release et résout le triplet
`{tenant, artifactId, releaseId}` ; le client ne déduit pas l’artefact du nom
de release. [FACT] `control.app_instance_hostnames` réserve déjà un nom
canonique minuscule à une instance (S27). Réutiliser cet index si le mapping
instance/release le permet ; sinon, étendre son modèle sous ARCH-17, avec une
autorité de réservation commune. Ne pas créer deux index indépendants pouvant
accepter le même hôte. Les collisions provoquent une nouvelle allocation en S1/S2.
Les hôtes retirés ne sont jamais réattribués ; la réservation résiduelle conserve
UUID/type et dates, sans titre, seed ou bindingKey en texte libre (DL-10, S28).
Le domaine enregistrable distinct reste à choisir selon la décision D5 de
SPEC_EVOL_ARCHITECTURE, qui n’est pas un nom DNS.

**Certificat wildcard uniquement, jamais de certificat par hôte.** Les journaux
Certificate Transparency publient les certificats soumis (W10) : un certificat
individuel divulguerait son UUID. Le wildcard divulgue le domaine, pas tous les
identifiants. [FACT] La plateforme Radar décrit déjà ACME DNS-01 (S26) ;
la zone séparée et son issuer restent à créer. Un UUID ne remplace jamais l’ACL.

**Exemples complets des trois vues du schéma** (valeurs illustratives, aucun déploiement) :

| Vue | `artifactId` / hôte d’exécution du pilote (par vue) |
|---|---|
| A · carte de Farid, fork privé de l’UI standard ; API privée auteur | `550e8400-e29b-41d4-a716-446655440000.<domaine-artefacts>` |
| B · liste de Farid partagée à Steve ; droits de Steve après activation par version dans le pilote retenu | `6ba7b810-9dad-41d1-80b4-00c04fd430c8.<domaine-artefacts>` |
| C · preview de branche ; API privée auteur | `7d444840-9dc0-4f2b-8d53-1d09b9a26711.<domaine-artefacts>` |

Par exemple, la première release de A a son propre UUID :
`9c858901-8a57-4791-81fe-4c455b099bc9`. Son hôte épinglé est donc
`9c858901-8a57-4791-81fe-4c455b099bc9.<domaine-artefacts>`. A, A1, A2, B et B1 dans
la vue de stockage sont seulement des abréviations de tels UUID complets.

**Reprise sans état client durable — S2 proposé, contrat non figé.** Exemples de clés :
`git:radar-immobilier@refs/heads/feat/x` ou `vue:carte-alice`. La forme
canonique doit aussi distinguer hébergeur/dépôt et workspace lorsque nécessaires :
ce sont des exemples lisibles, pas une grammaire déjà figée. La clé reste stable
entre commits d’une même branche ; changer de branche ou de nom change la liaison.
Un chat peut redemander le nom de vue ; il ne doit pas mémoriser un UUID opaque.
Un runner éphémère ou un worktree recréé recalcule sa clé et appelle ensure.

La transaction ensure crée ou retrouve (tenant, propriétaire, bindingKey) ;
deux appels concurrents retournent le même artifactId. [FACT] Le motif UUID
serveur + upsert sur clé naturelle existe dans app_workspace_bindings (S27) ;
ce n’est pas déjà une API ensure d’artefacts. La CI agit dans la portée d’un
propriétaire **déléguée et vérifiée**, pas sous un ownerSub fourni librement.
Pour le pilote S2, délégation à une clé exacte ou un artefact exact ; autoriser
un préfixe de branches serait une extension de droits à décider séparément.
Sans délégation, le principal de service a sa propre portée et ses propres artefacts.

Après suppression, la liaison est effacée : un **nouvel appel ensure explicite**
sur la même clé crée un nouvel UUID. Un retry d’une ancienne opération reste
terminal et ne ressuscite rien. Le reçu garde UUID, URLs, digests et contexte
non secret ; un fichier local peut le mettre en cache, sans être requis en S2.
Le nom .sentropic/artifact.json n’est plus imposé : le repo binding appartient
au chantier ARCH-05 (S30). S1 exige au contraire un reçu/configuration durable,
ou une recherche manuelle par catalogue ACL si ce lien est perdu.

**Idempotence alignée sur Sentropic.** [FACT] Le type IdempotencyKey existe ;
la messagerie utilise (principal, destination, clé), avec rejeu à empreinte
identique et conflit sinon (S27). L’adaptation proposée aux artefacts emploie
une destination typée et canonique (tier, tenant, opération, artefact ou liaison).
Ce mapping est nouveau ; il doit être validé, sans réinventer la sémantique.
Réservation atomique ; ACL/membership revérifiées à chaque rejeu, URLs
d’upload expirées régénérées après contrôle. La rétention des clés est bornée
et annoncée ; passé ce délai, les mutations ambiguës exigent une nouvelle opération
explicite. Les réservations d’hôtes survivent sans corps de demande ni texte libre.

**Déduplication des publications, distincte des retries.** Le serveur calcule
manifestDigest sur un manifeste canonique versionné : chemins triés, digests,
MIME, routage, mode de présentation, profil demandé et provenance/source.
Exclure dates, uploadId, releaseId, URLs et idempotencyKey, qui changent à chaque
tentative. Deux publications du même manifeste dans le même artefact retrouvent
la même release, même sans clé d’opération conservée. Les ACL courantes sont
toujours vérifiées ; aucune déduplication d’identité entre artefacts.
Le retry d’une opération dont la release est retirée/purgée reste terminal :
`release_retired`, jamais de réactivation. En revanche une **nouvelle opération
de publication explicite**, avec nouvelle clé d’idempotence, peut republier
les mêmes octets sous le **même artifactId encore actif**, après autorisation
complète. Elle reçoit un nouveau releaseId ; l’ancienne release et son hôte
restent retirés. Cela conserve la liaison de branche S2 après un revert.

Unicité partielle `(storageScopeId, artifactId, manifestDigest)` uniquement
sur les releases **pending/ready** ; une release remplacée mais conservée reste
ready, une release retired/purged ne participe plus à l’index. Des commits
concurrents nouveaux convergent sur la même réservation/release non terminale.
Le journal d’idempotence est consulté **avant** la recherche par digest : un vieux
retry ne peut donc pas être transformé en la nouvelle publication. Une réservation
abandonnée peut être reprise après contrôle, sans inventer de release prête.
Retrouver une release prête non courante ne la promeut pas : promotion explicite
avec expectedCurrentRelease nécessaire.

Retrait de release et interdiction d’un contenu sont différents : si une règle
de sécurité bloque un digest/profil/artefact, elle s’applique aussi à la nouvelle
publication. Aucun droit de relire/forker une ancienne release retirée n’est acquis.
Le client doit apporter des octets autorisés ou un réemploi encore permis.
Suppression de l’artefact entier reste terminale ; nouvel ensure après effacement
crée un nouvel artifactId, comme décrit plus haut.

Un lien logique sur le contrôle peut ouvrir la bonne URL ; retour validé vers
un hôte connu, aucun redirecteur libre. Un fork a de nouvelles origines et
reste privé, sans sessions, consentements ou ACL copiés.

Exemple de demande de publication d’un fork Radar :

```json
{
  "schemaVersion": "static-web.v1",
  "contentKind": "static-web",
  "mediaType": "text/html",
  "presentation": { "mode": "page" },
  "entrypoint": "index.html",
  "routing": { "mode": "history" },
  "requestedApiProfile": "radar-preprod-business.v1",
  "files": [
    { "path": "index.html", "sha256": "<64-hex>", "size": 1240, "mediaType": "text/html", "cacheClass": "sensitive" },
    { "path": "assets/app.<hash>.js", "sha256": "<64-hex>", "size": 45200, "mediaType": "text/javascript", "cacheClass": "sensitive" }
  ],
  "provenance": {
    "templateRef": "radar-ui@<version>",
    "baseCommit": "<real-git-commit>",
    "sourceDigest": "sha256:<snapshot-digest>",
    "dirtySnapshot": true,
    "buildRecipeRef": "radar-ui-build@<version>"
  },
  "idempotencyKey": "<client-key>"
}
```

Le serveur ajoute principal, appartenance, profil accordé, dates et politique. `requestedApiProfile` et `cacheClass` ne confèrent aucun droit ; classification validée côté service/template, sensible par défaut.

**Base et retour vers l’UI officielle.** `baseCommit` obligatoire pour tout fork du dépôt Radar ou d’un gabarit issu de Git ; snapshot dirty a un digest indépendant et un diff vérifiable sur cette base. Un HTML original créé en chat peut avoir `baseCommit=null` avec provenance `inline-original` explicite : inventer un commit serait une fausse preuve. L’export fournit sources et diff, y compris fichiers ajoutés/supprimés ; un utilisateur autorisé applique ce diff dans un worktree du vrai dépôt puis passe par PR/revue/UAT. Pas de PR automatique à partir d’un simple bundle minifié.

**Origines par vue/épinglées et imports tardifs.** **Au pilote : origine d’exécution par vue.** L’auteur garde localStorage/
IndexedDB sur l’adresse stable de sa vue ; le lien épinglé par version reste strictement attaché à son manifeste.
Un cookie est partagé entre onglets : il ne dit pas quelle release a déclenché
un GET /assets/chunk.hash.js. Conserver le blob seul ne suffit donc pas.

La résolution proposée est déterministe :

1. Le HTML et les navigations SPA viennent de la release courante **du grant**.
   Un grant renouvelé peut suivre la nouvelle release autorisée ; un onglet
   déjà ouvert conserve son ancien document.
2. Pour un fichier, chercher d’abord le chemin exact dans ce manifeste.
   Sur une origine stable seulement, s’il est absent, chercher dans au plus
   **K = 3 releases précédentes**, encore retenues et autorisées au lecteur
   pour cet artefact. K est une borne proposée à mesurer en L0.
3. Ce rattrapage ne concerne que des fichiers à nom haché déclarés immuables
   **et vérifiés** par le service. Un même chemin immuable ne peut désigner
   deux digests dans l’artefact : conflit refusé à publication. Ne pas déduire
   l’immuabilité d’une simple expression régulière dans le nom.
4. Aucun rattrapage de HTML, API, auth, sources, noms fixes ou fichiers révoqués.
   Une URL épinglée reste strictement dans son manifeste. Absence : vrai 404.
   Le kit recharge une fois le document courant sur échec d’import ; une SPA
   tierce doit gérer ce cas, sinon elle peut demander un rechargement manuel.

L’autorité fournit à émission/renouvellement du grant la liste bornée des
manifestes autorisés, leurs digests et le profil applicable. L’edge les met en
cache immuable et applique le grant localement ; aucune recherche DB ou S3
globale à chaque fichier. Révocation des précédentes prise en compte à
renouvellement, avec la même borne ≤60 s. La classification sensible reste
no-store même pour un nom haché.

[FACT] Vite documente le cas des imports dynamiques périmés après déploiement,
l’événement vite:preloadError et le rechargement du HTML (W9).
**Le rattrapage K/release/ACL ci-dessus est notre proposition**, pas une capacité
annoncée de Vite. Il réduit les 404 sans garantir la survie indéfinie des onglets.

Pour les appels API privés, le kit doit porter un contexte de release explicite
vérifié contre l’autorisation temporaire ; le cookie seul ne fournit pas ce contexte. Une requête
ancienne ne gagne jamais les droits d’un profil élargi par un autre onglet :
refus du contexte périmé et rechargement/consentement, ou lien épinglé.
Sans preuve de cet adaptateur, l’équipe explique pourquoi l’adresse par vue
ne suffirait pas et revient au réglage du §6 du dossier avant de figer l’adresse par version.
Le pilote retenu conserve une fiche stable et une exécution par vue. L’auteur et le lecteur activent la version reçue sur la page de confiance. Fixer le code ne fige jamais les données de l’API.

**Organisation S3 proposée — UUID pour les objets, SHA-256 pour leurs octets.**
[Vue interactive UUID et S3](DOSSIER-DECISION.html#scene-04-stockage).
Un stockage privé, pas un bucket par vue :

```text
artifacts/<storageScopeId>/uploads/<uploadId>/...
artifacts/<storageScopeId>/blobs/sha256/<digest>
artifacts/<storageScopeId>/<artifactId>/releases/<releaseId>/manifest.json
artifacts/<storageScopeId>/<artifactId>/sources/<sourceDigest>/...
```

**Convention nouvelle, portée explicite — ARCH-11/G1.** [FACT] Les documents
Sentropic actuels utilisent `documents/<workspaceId>/…` (S32). ARCH-11 prévoit
la ré-indexation du tenant actuellement dérivé du workspace vers tenant = org,
et G1 avant persistance cross-org (S44). Aucun état de franchissement de G1
n’est attesté par ce dossier.

[JUDGMENT] `storageScopeId` est un UUID opaque aléatoire créé par le service,
sans nom d’org, workspace ou principal dans la clé S3. La DB conserve
`StorageScope(id, tenantRef, orgRef?, mappingVersion, state)` et les bindings
workspace autorisés. **P1 est mono-org.** Les claims tenant ne sont jamais
concaténés pour choisir le préfixe ; le service résout l’org/portée par une
liaison vérifiée. Cette indirection conserve les clés lors d’une ré-indexation
d’identité : migration contrôlée du mapping DB, accès fermé en cas d’ambiguïté,
sans copie des blobs si le périmètre de données reste le même.

Une future séparation/fusion réelle d’org n’est pas une simple ré-indexation :
nouvelle portée, inventaire, copie si nécessaire, droits et purge explicites.
Le multi-org reste conditionné à G1 et à une recette dédiée.
Déduplication uniquement dans une portée autorisée ; pas de réemploi inter-org.
Chaque référence conserve workspaceId/artefact/release. L’effacement d’un
workspace retire ses références ; celui de l’org énumère ses portées en DB,
puis purge leurs clés. L’indirection n’accorde aucun droit par elle-même.

Les uploads expirent par ART-GC. Le préfixe variable
`artifacts/<storageScopeId>/uploads/…` n’autorise pas une règle lifecycle
unique par suffixe : tags de temporaires à qualifier, règles par portée ou
expiration applicative. Aucune règle globale sur artifacts/ qui effacerait les blobs finaux.

Exemple de manifeste de la première release de A (les empreintes sont des
placeholders ; le service les calcule et les vérifie sur les vrais octets) :

```json
{
  "artifactId": "550e8400-e29b-41d4-a716-446655440000",
  "releaseId": "9c858901-8a57-4791-81fe-4c455b099bc9",
  "entrypoint": "index.html",
  "files": [
    { "path": "index.html", "sha256": "<digest-html>", "mediaType": "text/html" },
    { "path": "assets/app.<hash>.js", "sha256": "<digest-js>", "mediaType": "text/javascript", "immutablePath": true }
  ]
}
```

Le manifeste est stocké sous
`artifacts/<storageScopeId>/550e8400-e29b-41d4-a716-446655440000/releases/9c858901-8a57-4791-81fe-4c455b099bc9/manifest.json`.
Pour `GET /assets/app.<hash>.js`, l’edge vérifie le grant et sa release, consulte
`files[path]`, puis lit `artifacts/<storageScopeId>/blobs/sha256/<digest-js>`.
Ce chemin public n’est pas une clé S3 libre fournie par le navigateur.
`/api` part vers l’amont Radar fixe, jamais vers le bucket ; les règles
SPA/404 de F restent applicables. L’edge conserve seulement des caches
immuables vérifiés, pas un registre de sessions ou d’ACL.

Une deuxième release de A ajoute un nouveau manifeste, réutilise les blobs
autorisés inchangés et ajoute les nouveaux. Le commit validé déplace
`currentReleaseId` en base par transaction/CAS ; aucun `latest.json`
mutable dans S3 ne décide de la publication. B est une autre personnalisation
de l’UI standard par Fabien, partagée explicitement à Steve après création privée ;
ce n’est pas un fork de A. B a son propre UUID, son manifeste et ses ACL,
même si les fichiers hérités de la même base partagent des blobs. Les snapshots
source sont conservés par artefact et digest, avec leur droit d’export distinct.

Manifeste d’abord ; upload des seuls blobs manquants que le demandeur est autorisé à réutiliser. **Un hash connu n’est pas une permission.** Réutilisation exige accès à la source/release d’origine ou upload et vérification de ses propres octets. Ni oracle global de présence ni déduplication inter-tenant. Les références et rétentions empêchent le GC de supprimer des blobs encore utilisés par une release/un fork. Pas de clés S3 finales choisies par le client, ni listing public.

**Upload contre purge : référence provisoire et état de suppression.**
À create_upload, avant de répondre « blob présent », une transaction pose sur
chaque digest réemployé une référence provisoire liée à l’upload et à son
expiration. Même discipline pour un blob neuf une fois vérifié. L’upload
réserve son quota ; expiration/abandon libère les références et le quota.
Un upload au-delà de sa durée maximale ne peut pas committer.

Le GC ne choisit que les digests sans référence durable ni provisoire, après
un délai de grâce au moins égal à la durée maximale d’upload. Acquisition de
référence et passage à l’état deleting prennent le même verrou DB par digest :
le GC revérifie les conditions dans cette transaction. Un digest deleting
n’est plus annoncé réutilisable ni réécrit. La suppression physique et ses
retries sont enregistrés ; réupload au même emplacement seulement après
confirmation de suppression, pour qu’un ancien DELETE ne supprime pas une
nouvelle écriture. Crash/retry doivent conserver ce verrou logique et l’état.

Avant commit, pins encore valides et présence physique de **chaque objet final**
sont vérifiées, avec taille/digest validés, pas seulement ses références DB.
Transaction : conversion des références provisoires en références de release
et CAS du pointeur. Objet absent = échec explicite, nouvel upload du manquant,
jamais release ready partielle.

[FACT] Le port n’offre pas de listing ni de GC de références (S07/S28).
Enregistrer en DB l’intention et la clé **avant toute écriture S3**, y compris
avant de délivrer une URL temporaire, permet de retrouver les orphelins après
crash sans listing. ART-GC est un composant neuf. DL-9 exige l’énumération des
lignes et clés externes ; DL-10 borne les traces résiduelles sans texte libre.
Le reçu distingue accès coupé, objets encore partagés, suppression effective,
rétention de sauvegarde et erreurs ; une cascade DB n’est pas une preuve de purge.

Les ACL courantes vivent dans la DB de contrôle ; un manifeste immuable n’est pas réécrit pour retirer Steve. Le projet borne tous ses historiques. Nouvelle release privée par défaut ; promotion partagée explicite ou politique de publication autorisée, jamais publicisation d’anciennes releases/sources. Hôte épinglé ne contourne ni retrait du projet ni expiration.

## D. Publication MCP/HTTP et identités d’auteur

Le cycle de publication (manifeste, fichiers autorisés, validation, mise en ligne, retrait et effacement) est décrit en prose dans cette section et en E–F ; il n’est plus une vue Focus séparée, pour garder cinq vues lisibles.

| Opération proposée | Résultat | Contrôle |
|---|---|---|
| `artifacts_get_template` | Gabarit `/apps`, sourceRef, recette, dépendances, profils. | Lecture/fork/licence ; projection ACL du catalogue. |
| `artifacts_get_api_guide` | Ressource versionnée : routes, auth, exemples, données/limites. | Seulement profils visibles ; aucune promesse de toute l’API. |
| `artifacts_ensure` (S2, proposé) | bindingKey → artefact existant ou nouvelle fiche privée et UUID serveur. | Portée propriétaire vérifiée, délégation CI exacte, unicité transactionnelle ; jamais un ownerSub libre. |
| `artifacts_publish` | Petit HTML → release privée, digest, URL après commit. | Principal/membership, droit de créer, quota, validation, opération mutante autorisée. |
| `artifacts_create_upload` | Manifeste → uploadId et dépôts temporaires bornés. | Droit sur cible, délégation CI éventuelle, réserve quota, droits de réutilisation des blobs. |
| `artifacts_commit_upload` | Release prête, digest, URLs logique/épinglée. | Octets finaux vérifiés ; CAS `expectedCurrentRelease` ; droits réévalués au commit. |
| `artifacts_list/get` | Métadonnées/releases visibles, pagination. | ACL avant pagination ; pas de fuite de titre/sourceRef. |
| `artifacts_get_source` | Sources, recette, baseCommit et diff si base Git. | Droit source distinct ; canal authentifié, pas lien public durable. |
| `artifacts_fork` | Nouveau projet privé, provenance/filiation. | Droit source/fork ; pas d’ACL ni session héritée ; pas de changement de tenant implicite. |
| `artifacts_set_access` | ACL/révision effective et releases visées. | Propriétaire/admin autorisé ; au pilote, `public` signifie « tous les comptes approuvés de la préproduction » et l’anonyme est refusé ; droit source distinct ; audit. Partage déclaré sensible (confirmation demandée à l’agent, à vérifier). |
| `artifacts_renew/delete` | Échéance ou révocation, borne d’accès/purge et reçu. | Droit de gérer ; suppression annulable par son auteur avant l’effacement définitif ; après effacement, pas de résurrection ; suppression idempotente. Suppression déclarée sensible. |

HTTP versionné et MCP appellent le même service. **À l’entrée, garder les droits Immo actuels** (`immo:read`, `immo:search`, `immo:documents:read` constatés sur les connexions actuelles) : le seuil d’autorisation se règle comme aujourd’hui, sans exiger les droits génériques du socle (`mcp:discover`, `mcp:resources:read`, `mcp:tools:invoke`) que les connexions actuelles n’ont pas. **Publier, partager et supprimer ne demandent aucun nouveau droit de connexion** : avec la connexion actuelle, le serveur vérifie chaque vue, une par une (propriétaire, partage, état). C’est le réglage par défaut qui respecte « sans reconnexion ». L’alternative plus stricte — un droit « publier » séparé — imposerait une nouvelle autorisation, voire une reconnexion, à toute personne qui publie ; elle n’est pas retenue au pilote. Permissions d’objet/opération dans le connecteur, **pas un nouveau serveur à scopes `artifacts:*` supposés existants**. Namespace et schéma définitifs à valider sous ARCH-12. Le contrôle peut servir les petites entrées inline ; les gros octets passent par upload HTTP, jamais un journal h2a/MCP géant.

**CLI/worktree.** Réutiliser `/session/device/{code,poll,approve}` et le cycle du runtime personnel. [FACT] Le résultat est une session d’application, pas automatiquement un bearer OAuth à audience accepté par `/mcp` [S21]. L0 prouve soit le chemin HTTP autorisé de cette session, soit une jonction officielle vers le resource server. À défaut, client PKCE statique déjà supporté ; aucune invention de token exchange RFC 8693 ni conversion d’une session en JWT auto-signé.

**CI.** `auth-client` client_credentials pour le principal de service et l’audience adéquate ; plus délégation d’objet émise par le propriétaire : droit `publish` sur un artifactId, principal de service/tenant liés, TTL, quota, révocation, valeur opaque stockée hachée si secret-capacité. Ce droit métier n’est pas un scope OAuth fabriqué. Vérifier S2S **et** délégation à création d’upload et commit ; révocation en cours d’upload empêche le commit. Création au nom d’un service affichée comme telle ; jamais `ownerSub` libre. Les 900 s des tokens S2S ne forcent pas 900 s de révocation du droit métier contrôlé en DB.

**Chaîne atomique.** URLs présignées seulement vers des clés temporaires et courte durée ; redaction des URLs ; aucun fetch d’URL arbitraire. Réutiliser le validateur transfers et ajouter entrée HTML, MIME, chemins canoniques/réservés, collisions, liens, encodages, checksum et budget CPU/mémoire. Données sensibles connues refusées, sans prétendre détecter toute PII.

Seul le serveur écrit les objets finaux, après inscription de l’intention DB.
Il ingère un snapshot du temporaire et vérifie les octets finaux ; un PUT tardif
ne change aucune release. Les références provisoires et l’état deleting de C
protègent cette séquence. Transaction DB après objets complets, CAS du pointeur.
Crash avant transaction = clés retrouvables par les intentions ; après = release
complète. Idempotence selon C, y compris unicité (artifactId, manifestDigest).
Archive incomplète expire, jamais visible. Les éventuels VersionId S3 nécessitent
une extension explicite du port.

## E. Authentification, grants et données

### E1. Trois autorisations et deux tiers

| Autorisation | Autorité |
|---|---|
| Publier/gérer | Principal vérifié MCP/HTTP + membership + ACL + éventuelle délégation CI. |
| Ouvrir HTML/assets | Contrôle à émission/renouvellement du grant ; edge vérifie localement chaque requête. |
| Lire et écrire dans Radar | Identité du lecteur, compte approuvé, audience/profil Radar, grant de release, politique de tier. |

Le pilote respecte le contrôle réseau constaté et autorisé pour son hôte ; `private` et `shared` ne remplacent pas le contrôle réseau. Le pilote est réservé aux comptes approuvés, même pour un HTML sans appel API. Un profil de données publiques ne rend pas public le service de préprod. Les tokens des tiers prod/préprod ne sont pas interchangeables (DV5).

Une page privée sans appel Radar requiert l’identité et les droits de l’hôte artefacts. L’accès Radar ajoute le compte approuvé et le profil métier retenu. Le partage suit les propres droits de Steve, jamais ceux de l’auteur. L’activation de version informe sur le code exécuté et l’attribution des actions ; elle ne crée pas une isolation entre collègues. Le mode fictif est disponible pour auteur et lecteur, sans accès réel.

### E2. Page : login, ticket et session stateless

1. Naviguer vers hôte inscrit. Sans grant, aucun octet privé ; init de login générique possible. Edge pose un nonce `__Host-preview-init`, Secure/HttpOnly/Path=/, sans Domain, SameSite=Lax.
2. Transaction de login liée à navigateur, origine exacte, artifact/release, profil et retour normalisé ; stockage transactionnel au contrôle. Redirection top-level vers le broker **sur l’hôte de contrôle retenu**.
3. Callback OAuth exact, PKCE/state/nonce, validation issuer/audience. Identité vérifiée pour l’ouverture ; autorisation Radar séparée, resource preview allowlistée, même principal vérifié. Ne pas confondre access token d’artefacts et access token Radar.
4. Contrôle des accès, état et durée, compte et politique. Auteur et destinataire voient auteur/version/profil sur l’origine de confiance et activent cette version. Nouvelle version ou élargissement de profil : nouvelle activation privée. Le mode fictif ne délivre aucune autorisation de données réelles.
5. Ticket opaque à usage unique, ≤60 s, lié à l’init navigateur/origine/release. Edge vérifie liaison et consomme atomiquement au contrôle ; rejeu/autre navigateur/autre cible refusés.
6. Réponse de consommation : grant signé court et, si nécessaire, bearer court du lecteur. Edge émet une enveloppe AEAD `__Host-preview-session` HttpOnly/Secure, avec hôte/tier/session comme contexte authentifié. Pas de refresh token durable. Le navigateur détient le chiffré, pas un bearer lisible par JS ; le vol du cookie reste un risque de rejeu jusqu’à sa borne.
7. Redirection vers URL propre **avant** exécution du custom. `no-referrer`, `no-store`, redaction des query strings/tickets dans logs ; pas d’analytics au callback.
8. Edge vérifie localement cookie/grant, signature, hôte, tenant, release, profil, destinataire, expiration ; appelle un amont fixé avec bearer du lecteur, en ignorant Authorization/identités proposées par le JS.

**Contrat de grant.** `issuer`, audience edge, tier/homeNode, artifact/release, principal/session, profil/upstreamRef, actions, policyRevision, `iat`, échéance absolue, identifiant de clé. Profil de routes versionné administré au serveur ; aucune URL libre. Pas de grant valable sur un autre artefact, origine épinglée, tenant ou tier. Le renouvellement consulte l’autorité courante, réévalue ACL/compte/profil et ne prolonge pas une release révoquée. L’échéance est au plus celle du bearer.

**Borne opérationnelle.** TTL proposé 55 s + budget maximal de dérive/propagation 5 s, à mesurer pour tenir ≤60 s depuis commit de révocation. Pas de tolérance de signature qui prolonge cette borne. Renouvellement seulement à approche/expiration de grant, cache local éphémère possible, pas de consultation du contrôle par requête. En panne : grants valides jusqu’à échéance, refus ensuite ; flux ouverts coupés au plus à cette échéance. Refus de renouvellement = pas de repli sur droits anciens.

**Ce qui n’est pas démontré.** L’enveloppe doit tenir dans les limites réelles cookie/header, notamment 4 Kio usuels par cookie. Mesurer avec les JWT réels/claims les plus longs en L0a ; ne pas inventer une taille ou multiplier les cookies en silence. [FACT] Le code IdP a un TTL d’access token par défaut de 3 600 s [S09]. Le client/profil preview devra donc configurer et prouver sa durée : un grant de 55 s ne raccourcit pas le bearer sous-jacent. Si le cookie est trop grand, comparer un coffre de données externe explicitement déployable avec l’edge ou un autre format avant L0b. D5 impose stateless/separation, pas une unique technique de cookie : une dépendance externe ne prouve pas automatiquement une violation de D5, mais change disponibilité et auto-hébergement. L’ancien accès DB de contrôle par requête est retiré.

### E3. Profil de données, protection des requêtes et domaines voisins

Le profil artefacts impose côté Radar une audience dédiée, une liste de routes/méthodes **et de données**, un compte approuvé et le bon environnement. Le choix confirmé autorise les usages métier de l’UI et leurs écritures avec les droits du lecteur, administration exclue. Le serveur contrôle l’auteur des notes et l’attribution des actions. Un mode fictif de test ne joint pas les données réelles. Le test avec bearer directement présenté à Radar doit refuser les chemins interdits. L’audience MCP existante n’est pas retirée ; migration globale des cookies/clients hors périmètre sauf défaut directement bloquant prouvé.

Proxy : canoniser chemin/query, limites de taille/temps, amont fixe, redirects et Set-Cookie filtrés ; Host/X-Forwarded-* ne valent qu’après ingress de confiance. Adaptateur `/me/login/logout` vers session preview, sans route auth upstream générale ; capacités UI cohérentes mais contrôle toujours serveur. Déconnexion de preview ne déconnecte pas implicitement l’IdP global.

Sur `/api/*` et routes de session/contrôle de l’edge : `Sec-Fetch-Site: same-origin`, origine exacte quand présente, opérations sensibles protégées CSRF. Pas de CORS avec credentials vers un voisin. Une absence de Fetch Metadata ne devient pas une autorisation : repli strict documenté pour clients nécessaires ou refus. Exceptions **étroites** pour init/atterrissage de login top-level, avec transaction/ticket ; accepter une navigation externe vers le HTML après auth sans exiger same-origin sur toute ouverture. Un callback ne peut être un POST générique sans CSRF.

Cookies de la plateforme : préfixe `__Host-` seulement. Cela protège contre l’écrasement via `Domain=parent`, pas contre des en-têtes gonflés par un voisin. Broker/contrôle hors domaine de contenu. PSL souhaitée pour service durable, mais [FACT] la procédure décline généralement les petits projets/labs et exige le titulaire [W8]. Ne pas traiter dépôt/acceptation/propagation aux navigateurs comme acquis. La PSL empêche certains cookies de domaine et change la notion de site ; elle ne garantit pas à elle seule toutes les partitions de caches ni l’innocuité du contenu.

Test cookie bomb au niveau de l’ingress réel : pas d’en-têtes illimités, rejet borné ; aide de reprise accessible sur l’origine de contrôle et nettoyage local explicite. Une page edge ne peut pas assurer sa propre purge si la requête est rejetée avant elle, ni effacer tous les cookies HttpOnly d’un voisin. Risque de déni de service résiduel avant PSL ou domaines indépendants ; acceptable seulement comme restriction déclarée d’un pilote interne, pas promesse d’hébergement hostile multi-tenant.

### E4. Classification et données réelles

Le §13 de la plateforme MCP réserve les expositions de données réelles et les outils capables d’écriture à l’owner (S22). Fabien a retenu les usages métier avec écritures pour #861 (messages 10–11). La réalisation documente routes, champs, finalités et preuves de refus dans ce périmètre ; elle ne demande pas de voter à nouveau sur le principe des écritures. Une activation individuelle de Steve n’élargit pas ce périmètre. Une extension réelle serait un écart à traiter explicitement.

[FACT] Le workflow prévoit iso-prod, sous armement explicite ; les dumps contiennent de la PII et le schéma CRM possède contacts/journal [S15/S20]. Aucun état réel de DB n’a été lu. Politique conservatrice : préprod traitée comme contenant des données réelles.

Le profil n’est pas « tous les GET ». L’équipe inventorie les appels nécessaires et leurs paramètres : droits métier habituels et écritures. Administration et secrets restent exclus. Contacts et exports métier suivent le profil métier retenu et les droits existants ; ils ne sont pas activés globalement par un rôle administrateur. Journal : lecteur, artefact, version, profil, opération, résultat et corrélation, sans recopier les données personnelles. Le contrat des annotations est déjà team-shared en lecture et author-only en mutation (S46) ; l’audit complet des autres routes reste à faire.

CSP, domaine distinct et HttpOnly réduisent l’exposition ; ils ne prouvent pas qu’un code autorisé à lire ne transmettra jamais ce qu’il voit. Pas de promesse d’isoler des données confidentielles d’un auteur non fiable avec un simple proxy. Pour une expérimentation sans ce niveau de confiance : environnement synthétique distinct, explicitement identifié.

## F. Cache, révocation, quotas, secrets et purge

| Classe | Politique proposée | Limite |
|---|---|---|
| HTML, sessions, API, source/kit, données personnelles ou fichiers non classifiés | `private, no-store` ; pas de cache CDN public. | Réduit la persistance passive ; ne récupère pas un téléchargement ou une copie JS. |
| Asset haché explicitement classé réutilisable sans données/confidentialité propres au lecteur | `private, max-age=31536000, immutable` autorisé ; hash vérifié. | Ce navigateur peut le resservir après révocation/logout ; cette propriété est acceptée pour cette classe seulement. |
| Octets dans cache interne edge/S3 | Adressés par digest, privés ; grant vérifié avant réponse. | Aucun cache partagé ne décide seul de l’ACL. |

Cache long et déduplication servent la rapidité, mais pas sur tout fichier d’un artefact privé. `private` signifie cache HTTP non partagé, pas cache lié à un compte applicatif. Un autre utilisateur du même profil navigateur peut retrouver un asset sans requête réseau. Une source propriétaire ou une donnée embarquée reste sensible même si son nom est haché. Pas de redirection GET privée vers une URL S3/CDN durable contournant l’edge.

Supprimer/révoquer = commit de refus des nouvelles autorisations temporaires et invalidation des uploads ; autorisations existantes expirent dans la borne de E2 (objectif 60 s, à mesurer avant engagement), y compris pour les flux. **L’auteur peut annuler sa suppression avant l’effacement définitif** ; après effacement, aucune réouverture. Sources distribuées par le service de contenu sous une autorisation spécifique et la même borne, sans URL de lecture présignée durable ni relais d’octets par le contrôle. Puis effacement différé des objets/blobs sans références, selon lifecycle/versions/backups. Reçu distinct : `revokedAt`, `accessCutoffAt`, `purgeScheduledAt`, `purgedAt`. Échec d’effacement visible/rejouable. Copies et forks déjà remis exclus de la garantie.

Limites initiales à mesurer : HTML inline 256 Kio ; bundle décompressé 50 Mio / 2 000 fichiers, plafonds de transfers conservés ou resserrés ; 20 releases actives/auteur ; rétention des worktrees et vues à mesurer, renouvellement et épinglage durable sous quota. Afficher expiration/renouvellement, éviter perte surprise des sources. Aucun dimensionnement mensuel sans mesure.

**CRED_CYCLE**, livrable Node/TS sous lane k8s/identité : S3 dédié, client OAuth/CI, clés AEAD/signature, DNS-01 de la zone ; stockage chiffré/SealedSecrets par tier, rôles et procédures de rotation/révocation, preuve opérateur rejouable, rollback des clés limité. `.env` seulement pour bootstrap local documenté et exclu des kits ; aucun secret dans le HTML. Identifiants S3/DNS permanents jamais distribués aux auteurs ni aux jobs de publication CI : URLs d’upload bornées. Ne pas réutiliser le credential S3 de sauvegarde prod. La séparation par tier est obligatoire.

Observabilité : publication p50/p95, octets nouveaux/réutilisés, erreurs/grants, âge d’expiration, refus ACL, purge, rotation, quotas. Audit sans tokens/cookies/URL signée complète/contenu source. Aucune image Python : validation/GC/CLI en Node/TS et outils natifs déjà autorisés, suivant les commandes et images des dépôts lors de l’implémentation.

## G. Kit de fork, guide API et dérive

**Exemple de départ** : HTML/JS lisible, erreur/connexion gérées, publication depuis le MCP Immo habituel. Un exemple fictif peut servir à éprouver le transport ; le kit Radar et ses usages métier avec écritures font partie du résultat du pilote.

**Kit Radar** : baseCommit réel, snapshot/diff, lockfile, versions de paquets, recette make, dépendances internes accessibles aux destinataires autorisés, adaptateur auth et configuration. Pas de `.env`, tokens registry, historique `.git`, node_modules, chemins locaux ni données de travail. [FACT] Licence propriétaire et variable `VITE_RADAR_ONTOLOGY_WRITE_TOKEN` présentes dans les sources [S16] : valeur interdite dans le kit/bundle ; ne pas confondre absence de valeur lue ici et preuve que tous les bundles déployés sont sains. Satellite désactivé, OGC conservé via profil.

Le droit source ne rend pas secret le JS déjà servi au navigateur ; sourcemaps non publiées par défaut. Un scan aide pour les secrets connus, sans certifier l’absence de PII. Fork remis non révocable ; GC ne casse pas les forks autorisés.

Guide MCP versionné : endpoints réellement admis, méthodes/paramètres/champs, classification, auth, pagination, timeouts, erreurs 401/403/429, limites, exemples, version API/kit. Mention explicite **« sans garantie de compatibilité entre évolutions de l’API tant que les tests de contrat ne sont pas en place »**. [FACT] La cible OpenAPI reste un placeholder [S10]. Référencer commit/guide et tester le sous-ensemble, pas ouvrir toute l’API en attendant. TTL courts, avertissement de dérive, reconstruction et chemin diff→PR permettent de revenir vers l’UI officielle.

## H. Matrice d’acceptation — future, non exécutée

| ID | Épreuve | Attendu |
|---|---|---|
| T01 | HTML chat, bundle worktree appairé, CI S2S + délégation. | Même service/protocole, URL après commit ; principal correct ; pas de build serveur ; jonction device/MCP explicitement prouvée. |
| T02 | Tiers/anonyme sur HTML, assets, Range, historique, sources, fiche/catalogue et commentaires privés. | Refus sans fuite ; propriétaire autorisé ; tous les chemins sous DV3/ACL, projection et commentaires compris. |
| T03 | Partage/retrait, nouvelle release, tentatives `public` et anonyme au pilote. | Sources/historiques non publiés implicitement ; `public` = tous les comptes approuvés seulement, anonyme refusé ; fermeture des accès mesurée (objectif 60 s, pas un acquis), copies remises distinguées ; suppression annulable avant effacement. |
| T04 | Farid et Steve ouvrent la même vue ; notes partagées, écritures sous leurs comptes. | Actions métier autorisées dans le périmètre retenu ; modifier la note de l’autre refusé. Attribution et activation par version vérifiées ; aucun prêt du compte auteur. |
| T05 | Mauvais iss/aud/tier, owner/tenant forgés, token artefacts à Radar. | Refus ; contexte d’argument jamais autorité ; prod/préprod séparés. |
| T06 | Auteur publie v2 avec même profil puis profil élargi ; adresse par vue au pilote, lien épinglé disponible. | Adresse par vue : code inchangé à l’adresse stable ; auteur et lecteur activent la nouvelle version, aucun élargissement silencieux ; ancien onglet sans nouveau droit ; lien épinglé strictement dans son manifeste. Si l’adaptateur de contexte de version échoue, l’équipe motive un retour à l’adresse par version avant de le figer. |
| T07 | Ticket volé/rejoué/autre navigateur/hôte/returnTo. | Refus ; usage unique ; ticket absent des URL finales/Referer/logs. |
| T08 | History/hash, refresh profond, imports, `.mjs` PDF, WASM, asset manquant. | Rendu correct ; vrais 404 ; API/auth jamais fallback HTML. |
| T09 | Admin, mutation hors profil, chemin encodé, amont arbitraire, metadata/prod/redirect. | Refus serveur ; une mutation métier autorisée doit réussir sous le bon auteur. Aucun bearer au mauvais amont. |
| T10 | Cookies/storage d’un autre artefact ; SW via asset/fallback. | Pas d’accès aux sessions voisines ; SW refusé, workers dédiés opérationnels. |
| T11 | ZIP slip/bomb/doublons bruts/liens, hash faux, quota, PUT tardif. | Budget pendant décompression, avant CRC intégral ; aucune release partielle ; mesurer CPU/mémoire même si la taille déclarée ment. |
| T12 | Concurrence de commit/retry/crash S3-DB. | Idempotence/CAS ; release complète ou erreur ; nettoyage des orphelins. |
| T13 | Révocation pendant flux, panne contrôle, effacement échoué ; délégation CI retirée en upload. | Autorisations valides seulement jusqu’à échéance (objectif 60 s depuis le retrait, à mesurer) ; flux fermés ; aucun renouvellement ; commit CI refusé ; effacement rejouable ; suppression annulable avant effacement. |
| T14 | Kit dans environnement propre autorisé. | Reconstruction/fork fonctionnels, dépendances disponibles, satellite désactivé. |
| T15 | Droit source/fork puis suppression du parent. | Licence/ACL respectées ; fork autonome ; blobs référencés non collectés. |
| T16 | Chrome/Firefox/Safari, mode page. | Login top-level sans cookies tiers ; erreur sans boucle ; aucune prétention de validation embed. |
| T17 | Page privée sans compte Radar. | Le pilote demande un compte approuvé ; l’identité seule n’accorde aucun droit Radar ni accès à une vue. |
| T18 | Bearer artefacts directement sur Radar, routes permises/interdites dans chaque profil. | Radar applique lui-même le profil ; écritures métier autorisées sous les droits du lecteur ; admin et hors-profil refusés. |
| T19 | Jeton sentinelle/fichier interdit dans kit/bundle. | Refus de ces cas connus ; aucune certification générale anti-PII. |
| T20 | Client MCP statique, mutation, mauvais scope, connectorId inconnu ; chat hébergé. | Auth/dispatch/permissions démontrés ; inconnu refusé ; accès chat mesuré sous DV3, aucune ouverture réseau de repli. |
| T21 | Fetch avec credentials depuis artefact voisin vers `/api` et session. | 403 via Fetch Metadata/origine ; seule exception de callback liée à transaction. |
| T22 | Cookie bomb voisin et reprise après 431. | Rejet borné par ingress, contrôle toujours accessible ; procédure locale vérifiée ; risque résiduel documenté. |
| T23 | Label DNS maximal, casse, UUID+UUID, digest brut. | Un UUID canonique minuscule de 36 caractères ; concaténation de deux UUID refusée ; réservation commune, hôte non recyclé ; wildcard uniquement. |
| T24 | Navigation/MCP/edge depuis extérieur des accès autorisés. | Refus réseau et identité propres à l’hôte ; comptes non approuvés refusés ; pas d’amont exposé indirectement. |
| T25 | Rotation AEAD/grant/S3/client/DNS et mélange de tiers. | Procédure CRED_CYCLE rejouable ; bornes respectées ; aucun secret prod partagé. |
| T26 | Loopback, Host/LAN/cross-site, /me ; routage Geo et source-coverage. | Token hors JS ; route collections vers geo-préprod avant /api ; aucun bearer Radar à Geo ; prouver aussi l’amont des appels internes de Radar. |
| T27 | `embed` demandé au pilote ; futur pont avec origin/source/nonce erroné. | Pilote : erreur explicite. Futur lot : aucun octet privé ni message de données avant authentification ; preuve multi-navigateurs avant activation. |
| T28 | Cookie/session avec JWT et claims de taille maximale ; expiration/réseau coupé. | Limites headers respectées ; pas de lecture DB par requête ; échec fermé à la borne ; pas de fallback coffre non décidé. |
| T29 | Logout Fabien/login Steve dans même profil navigateur, cache chaud/offline. | Contenu sensible non resservi par cache HTTP ; cache long seulement classe réutilisable acceptée ; limites bfcache/copies explicites. |
| T30 | Hash d’autrui, fork+GC ; create_upload → purge dernière release → commit ; crash avant/après PUT et pendant DELETE. | Pas d’oracle ; pin bloque GC ; deleting bloque réemploi/réécriture ; vérification physique au commit ; intentions retrouvent chaque clé ; purge/retries DL-9, traces DL-10 ; jamais de release partielle. |
| T31 | Première vue, HMR, 30 publications 20 Mio sur lien mesuré. | Mesurer durée de publication et ouverture chez un collègue ; annoncer les mesures, sans objectif de performance fictif. |
| T32 | Base Git/snapshot dirty/diff vers UI officielle, dérive API. | Base réelle, diff complet, reconstruction ; incompatibilité signalée, aucune promesse de compatibilité sans contrat. |
| T33 | Pilote : exécution par vue, deux onglets de versions différentes et import tardif. | Rattachement des imports au manifeste autorisé, borne de recherche, aucun élargissement de profil par cookie commun ; lien épinglé strictement dans son manifeste. |
| T34 | Runner neuf/worktree recréé/chat relancé ; ensure concurrent ; même manifeste avec une nouvelle clé ; suppression puis nouvelle demande. | Selon la récupération décrite au §2 du dossier : nom stable retrouvé sans reçu ; même manifeste retrouve une release sans quota supplémentaire ; retry ancien terminal ; nouvel ensure explicite crée un nouvel UUID après effacement ; délégation CI exacte. |
| T35 | Inventaire des 12 tools Immo avant/après migration ; clients stdio et Streamable HTTP, initialize/list/call/resources et client déjà connecté pendant la bascule ; publication avec la même connexion. | Adresse MCP, comptes et connexion conservés sans reconnexion ni réglage ; droits Immo actuels gardés à l’entrée ; noms, schémas, résultats, erreurs et redaction conservés ; stubs toujours explicites ; publication/partage/suppression autorisés vue par vue côté serveur sans nouveau droit de connexion ; partage/suppression présentés comme sensibles. |
| T36 | Même commande via MCP Immo et API HTTP locale ; réemploi par un autre MCP en recette de bibliothèque ; principal/tenant falsifiés ou délégation absente. | Même autorité, mêmes ACL/quotas/idempotence/audit ; refus hors portée ; aucun transfert de bearer vers un service distant non prévu, aucune identité libre en argument. |
| T37 | Sérialisation canonique, aller-retour DB/manifeste/API ; ordre différent des fichiers, schéma inconnu, contenu modifié. | Même contenu logique = même digest ; contenu/profil/provenance modifiés = digest distinct ; version inconnue refusée ; aucune ACL ni secret importé du manifeste. |
| T38 | Crash entre écritures DB/S3, migration/reprise depuis sauvegarde, purge concurrente. | État pending non servi ; intentions retrouvent les clés ; références inter-tenant refusées ; pointeur vers release ready du même artefact ; ACL perdues = accès fermé. |
| T39 | Immo sur paquets publiés ; doublon de tool/provider et provider inconnu. | Aucun import api/src ou Radar depuis la lib ; drivers serveur dans Immo ; un montage /mcp et une version physique de mcp-auth ; registre injecté validé. Réemploi par un autre hôte testé séparément, hors dépendances du pilote. |
| T40 | Qualification du socle MCP commun et non-régression de ses consommateurs existants. | Aucun client cassé par l’évolution du socle ; garde d’invocation, une autorité active et retour arrière prouvés. Ajouter les artefacts au MCP du produit Sentropic reste hors pilote Immo. |
| T41 | Identité dans Immo : principal absent, tenant seul, consentement expiré/révoqué, redémarrage et changement d’utilisateur. | Identité humaine liée à chaque requête, credentials aval propres et réévaluation des droits ; tenant seul insuffisant. Reprise durable sans reconnexion imposée au client actuel. Une délégation vers un hôte artefacts distant demanderait une recette supplémentaire hors pilote. |
| T42 | Évolution du fournisseur hors programme r13, schéma incompatible/crash/double démarrage, restauration DB/S3. | Migration du domaine versionnée, exécuteur unique de l’hôte ; aucune retouche de la migration r13 ni troisième journal imposé ; endpoints fermés avant succès, rollback/restauration prouvés. |
| T43 | Ancien retry après retrait ; nouvelle publication identique sous artefact actif ; publications concurrentes ; digest interdit. | Ancien retry terminal ; nouveau releaseId et même artifactId après contrôles, ancienne release jamais réactivée ; index partiel empêche double réservation ; interdiction de contenu toujours appliquée. |
| T44 | Configuration des outils au pilote : version incompatible, handler inconnu, registre Sentropic indisponible. | Configuration versionnée dans le code Immo, validée par relecture avant embarquement ; incompatibilité refusée à la construction/revue, jamais à l’appel métier ; indisponibilité du registre sans effet sur les outils en fonctionnement ; aucun appel au registre pendant le fonctionnement. |
| T45 | Migration mcp-auth 0.1→tuple qualifié, adresse de découverte OAuth, client claude.ai déjà connecté et rollback. | Même adresse, métadonnées/découverte compatibles (y compris la règle de routage de l’adresse de découverte, aujourd’hui sous `/mcp` alors que l’entrée ne route que `/mcp`), comptes et connexion conservés sans reconnexion ni réglage imposés ; identité fraîche par requête ; un auteur d’effets par génération ; tuple npm testé avec les dépendances serveur du nœud Immo. La validité de la connexion (émetteur, public, droits, découverte) est l’exigence ; les sessions en mémoire, rouvertes par le client comme aujourd’hui, ne sont pas une « conservation » à promettre. |
| T46 | Ré-indexation workspace→org sur stockage opaque, mapping ambigu, tentative cross-org avant G1. | Clés S3 inchangées si périmètre constant, ACL conservées, ambiguïté/cross-org refusées ; purge énumère les portées via DB et non via une chaîne tenant supposée stable. |

L0a : T02/T05/T07/T08/T10/T13/T18/T28 sur doubles de test, prototypes T01/T20. R0 : T18 et auth/CSRF/profil. L0b : répéter les preuves d’intégration avec clients réels, T16/T21/T24 et taille réelle des tokens ; tests de données dans le périmètre owner retenu et avec des comptes autorisés. L4 : ensemble applicable ; T27 vérifie uniquement le refus d’embed tant que le lot futur n’est pas engagé. Aucun test de stack n’a été exécuté dans cette étude.

## I. Suivi des choix acquis

Les décisions et le commentaire déjà publié sont dans [DECISIONS-OWNER.md](DECISIONS-OWNER.md).
Le conducteur peut rattacher la v11 à l’item Track existant. Cette écriture n’a
pas été effectuée dans la reprise ; la carte reste ouverte et le service n’est
pas déclaré réalisé. Les dépendances de mise en œuvre restent à qualifier
sur la cible Immo, sans déplacer silencieusement l’hébergement.

**Dépendances du pilote, à fournir comme bibliothèques (pas comme service central).**
Dans la version étudiée de cluster-mesh, les modules MCP sont catalogués comme
non livrés par cette version, et la bibliothèque de gestion des vues reste à créer.
Le socle MCP commun (protocole et autorisation) et son montage dans Immo restent
à qualifier. S’y ajoutent le domaine dédié aux vues avec son certificat couvrant
toutes les vues, et la règle de routage de l’adresse de découverte de la connexion.
Cette liste sert à prioriser #861 ; ce n’est pas une estimation de charge.

## J. Bibliothèques composées par cluster-mesh, registre et migration Immo

[FACT] **Message 6, verbatim :**

> je souhaiterais que la gestion des artefact soit une partie de la lib cluster-mesh d'une part (relation db / s3 modélisée par sentropic dans une lib, avec serialisation et api via cluster-mesh), ainsi que le mcp
> le mcp immo devrait reposer sur la lib cluster mesh, pour ses fonctions actuelle (configuration spécifiques de tools mcp dans le registre sentropic / cluster mesh), et pour ces tools supplémentaire (publier / gérer le cycle)

[FACT] CM-D1=B, CM-D6=A, CM-D13 (S39) imposent des providers autonomes,
leur API composée, et MCP dans mcp-platform/mcp-auth. Le cadrage Immo v0
le prévoyait déjà (S40). **Le reste de J est [JUDGMENT] sauf faits étiquetés.**
Cette lecture applique les décisions existantes ; l’autre interprétation physique exigerait un amendement
owner. Les noms et exports ci-dessous sont proposés, pas des contrats livrés.

### J1. Un fournisseur autonome et une surface commune

| Surface | Propriétaire / rôle | Réemploi ou ajout |
|---|---|---|
| `@sentropic/artifacts/contracts` et `/client` | DTO/codecs neutres et client HTTP, sans driver ni serveur ; aucun import cluster-mesh. | À créer ; nom durable à approuver, contrats filaires soumis à D11/ARCH-12/P1. |
| `artifacts/server` et `/adapters` | Domaine, mapping SQL/S3, ACL, UUID/release, pins/intentions/GC, migrations ; ports injectés. | À créer ; extraction qualifiée d’ArtifactStorePort/S3 depuis api/src selon matrice CM-D3. |
| `artifacts/mcp` | AppMcpProviderManifest et AppConnectorProviderAdapter artefacts ; traduit vers un port de commandes. | À créer sur les contrats publiés de mcp-platform ; service local Immo au pilote ; client distant réservé à un autre consommateur futur. |
| `cluster-mesh/artifacts`, `compose/artifacts`, catalogue et namespace | Acquisition optionnelle, compatibilité, composition Hono ; ne possède pas le domaine. | Extension à qualifier selon le motif llm-mesh/gateway. Provider utilisable seul. |
| `mcp-platform`, `mcp-auth` | Protocole, sessions/consentement/elicitation et OAuth ; routeur autonome composé une fois. | Réemployer/promouvoir les modules catalogués mcp/platform(/hono), mcp/auth ; gaps transport à combler ici. |
| `connector-host` | Registre des adaptateurs et montage deny-by-default par workspace ; exécution provider. | Réemploi du propriétaire existant ; aucun nouveau paquet concurrent. |
| Produit Sentropic | Bibliothèque commune, composition centrale, superviseur et ressources. | Fournit la bibliothèque et les contrats ; exploitation centrale hors pilote. |
| Produit Radar | Racine cluster-mesh mono-nœud propre, singleton MCP cible, manifeste/adaptateur Immo et handlers métier. | Enveloppement dès le pilote, paquets publiés qualifiés ; fournisseur local et ressources dédiées injectées. Contrat utilisateur existant inchangé. |
| Edge D5 | Contenu/BFF et vérification locale des grants ; utilise seulement contrats/codecs nécessaires. | Service séparé autonome ; ne dépend pas du plugin pour fonctionner. |

**Chemin MCP conforme à CM-D6/CM-D2 :** plugin →
VerifiedInvocationContextPort → génération active/autorité MCP →
routeur mcp-platform + mcp-auth → connector-host → adaptateur.
La garde superviseur de productMcpModule reste au point de composition.
Les handlers viennent de code approuvé/versionné, jamais d’une ligne DB exécutable.
Provider inconnu, doublon de tool, contexte absent ou garde manquante : refus.

[FACT] /hono actuel ne couvre pas tools/list ni la parité Streamable HTTP/stdio
d’Immo et sa garde optionnelle permet par défaut (S35).
[JUDGMENT] Le futur dossier sur le moteur MCP devra examiner la proposition du SDK officiel **dans mcp-platform**, avec compatibilité
des enveloppes/routes actuelles vers un dispatch unique. Alternative :
compléter le routeur actuel sans imposer ce framework. §13 réserve le choix au
PRINCIPAL ; cette annexe ne choisit ni version npm ni moteur à sa place.
Les modules MCP encore gated ne sont promus qu’après qualification du tuple
réel publié, avec peers et garde de topologie. Aucun registre extrait directement
de mcp-broker privé vers npm.

### J2. Modèle relationnel, DB/S3 et migrations

Le fournisseur artefacts possède le schéma logique et ses évolutions ; l’hôte
retenu en est l’unique autorité d’exécution pour le pilote. Les entités proposées ne
remplacent pas les types /apps ni le catalogue sans étude de compatibilité.

| Entité proposée | Invariants | S3 |
|---|---|---|
| StorageScope | UUID opaque ; mapping org/tenant/workspaces vérifié/versionné, P1 mono-org. | `artifacts/<storageScopeId>/` ; aucune identité de tenant dans la clé. |
| Artifact | artifactId, workspaceId, ownerSub, state, currentReleaseId ; FK courante vers une release ready du même artefact/portée. | `…/<artifactId>/`. |
| ArtifactBinding | S2 : unicité (org/tenant vérifié, ownerSub, bindingKey), délégation CI exacte. | Aucun. |
| ArtifactRelease | releaseId, digest canonique, version, manifestKey, état ; unicité partielle sur pending/ready selon C. | `…/<artifactId>/releases/<releaseId>/manifest.json`, immuable. |
| ArtifactFile / BlobRef | Chemin normalisé unique, taille/MIME/classe ; FK même portée ; références workspace. | `…/blobs/sha256/<digest>`. |
| ArtifactSource | Base Git réelle ou provenance hors Git, digest, droit source distinct, filiation. | `…/<artifactId>/sources/<sourceDigest>/…`. |
| ArtifactAcl / réservation d’hôte | Droits/état en DB ; hôte commun artefact/release unique, jamais réattribué. | Aucune ACL dans les objets. |
| Upload / BlobPin / ObjectIntent | Idempotence, quota, expiration, pin et verrou deleting ; intention avant PUT/DELETE. | `…/uploads/<uploadId>/…` et clés finales inventoriées. |

La DB fait autorité pour droits, état, bindings et pointeur ; S3 pour les octets
immuables validés. Pending/intention/pins DB → S3 vérifié → transaction ready,
références et CAS du pointeur. Pas de transaction distribuée prétendue.
Reprise : sauvegarde DB + inventaire/intention, accès fermé jusqu’à réconciliation.
Un manifeste valide ne recrée ni ACL ni décision de retrait.
C/F détaillent purge concurrente, références de fork et reçus distincts.

[FACT] ArtifactStorePort et son binding S3 sont un stockage physique dans api/src,
sans domaine relationnel de publication (S37).
[JUDGMENT] Extraire vers le fournisseur serveur dédié, puis qualifier listing borné,
écritures conditionnelles et vérification physique. Aucun import retour vers api/src.
Bucket/credentials/quotas artefacts séparés des documents ; aucune copie des
documents existants. Le GC utilise le même domaine, en Node/TS et images validées.

[FACT] r13 interdit une deuxième migration **dans son programme de migration
des namespaces** (S43), pas toute évolution de domaine future.
[JUDGMENT] Les tables artefacts appartiennent à un lot séparé hors r13, migration
additive versionnée, exécuteur unique de l’hôte, verrou et restauration à qualifier.
La v5 proposait un troisième journal : cette décision est retirée. Le lot choisira
le journal compatible avec l’outillage existant ; ni auto-DDL à l’import, ni
réécriture de la migration r13. Aucun endpoint avant succès de sa migration.

### J3. Sérialisation et namespace de l’API

Commande entrante, manifeste canonique et fiche autorisée sont trois schémas
versionnés. Domaine/client/HTTP/MCP réemploient les codecs ; ORM, secrets et
connexions restent hors fil. Les contrats neutres partagés ne dépendent ni du
provider serveur ni du plugin.

Le digest porte les clés triées, chemins normalisés uniques, fichiers/digests/tailles,
entrypoint/routing/presentation, MIME/cache, provenance et **profil demandé
versionné** validé. UTF-8, nombres bornés ; dates/retry/upload/UUID serveur exclus.
L’enveloppe stockée inclut artifactId/releaseId et a son empreinte d’intégrité.
Profil effectivement accordé en DB/grants après droits/consentement, jamais
importé du manifeste. Profil inconnu/forgé et incohérence DB/S3 refusés.
Un hash ne prouve ni autorisation de réemploi ni consentement.

[FACT] CLUSTER_MESH_NAMESPACES a 29 entrées et aucune /artifacts (S43).
[JUDGMENT] **Revue des contrats et du namespace à préparer (ancien Q16) :**

- N1, préférence à éprouver : /apps pour gabarits/instances, /transfers pour
  transports bornés, /resources pour projections/références autorisées.
  /documents est aussi à examiner pour ses responsabilités de contenu ; aucune
  de ces routes ne devient un fourre-tout. Les droits admin actuels de /apps ne
  sont pas les droits propriétaire attendus.
- N2 : /artifacts autonome si N1 force les domaines ; amendement CM-D13,
  inventaire/union/registre/version de contracts et compatibilité D11/ARCH-12.
  **Une version mineure n’est pas présumée suffisante** pour tous les consommateurs.

Dans les deux cas la bibliothèque expose son API de domaine et cluster-mesh
la compose. Les commandes D restent create/ensure, upload/commit, get/list/fork,
ACL, sources/guide, retrait/purge ; MCP appelle les mêmes opérations.
Aucun troisième journal ni namespace nouveau n’est décidé implicitement.

### J4. Configuration Immo, quatre objets distincts

[FACT] Les types AppMcpProviderManifest/AppConnectorProviderAdapter et le
montage connector-host existent ; McpCatalogSource ingère un serveur MCP via
URL/filtres hors bande. P5 et E4 réservent résidence/promotion du registre
produit (S41). Ce ne sont pas quatre noms pour un registre à réinventer.

| Objet | Autorité / fonction |
|---|---|
| Manifeste du provider Immo | Radar définit tools, schémas, scopes, mutability, redactionClass, idempotency et gates selon le contrat plateforme ; handlers en code versionné. |
| Registre d’adaptateurs connector-host | Instances/adaptateurs injectés, montage par workspace deny-by-default ; ne décide pas la résidence du registre produit P5. |
| /catalog et McpCatalogSource | Projection de découverte des tools, URL et filtres hors bande ; pas source d’ACL ni preuve d’une distribution de configuration. |
| Registre produit / configuration approuvée | Autorité Sentropic proposée conformément au message 6 ; résidence contrôle/Resource-Plane et exposition/distribution sous P5 avec BR-70. |

**Au pilote : configuration versionnée dans le code, sans appel au registre pendant le fonctionnement.** Le registre Sentropic / cluster-mesh reste l’autorité qui approuve la liste des outils, leurs schémas et leurs règles (message 6). Au pilote, cette configuration approuvée est écrite dans le code d’Immo, validée par relecture et embarquée dans le nœud. Aucun téléchargement, aucune copie expirante et aucune fermeture des outils en cas de panne du registre : une indisponibilité de plus d’un jour du registre ne doit pas arrêter les outils actuels, ce qui contredirait tes deux premières décisions. Les handlers restent locaux et versionnés, jamais une ligne de base exécutable.

Une distribution par copie signée et expirante reste une piste ultérieure, hors pilote, à instruire séparément si un besoin de mise à jour sans redéploiement apparaît. Elle ne conditionne pas le fonctionnement du pilote. McpCatalogSource (découverte) ne réalise ni l’une ni l’autre. Aucun paquet de registre n’est publié sur la foi de ce dossier. La surface commune cluster-mesh peut composer les paquets déjà qualifiés, sans imposer le registre produit privé à l’installation Immo.

### J5. Envelopper le MCP Immo sans impact utilisateur

[FACT] Les messages 10–11 fixent le nœud cluster-mesh dans Immo. La bibliothèque
artefacts y reçoit les connexions DB/S3 dédiées. Le point d’entrée MCP actuel
vérifie le principal humain, puis le socle composé distribue l’appel vers les
handlers Immo conservés ou les commandes locales de gestion des artefacts.
Il n’y a pas de délégation Immo → service artefacts central au pilote.

[FACT] Les sources étudiées déclarent douze outils : search_lots, get_lot_card,
search_signals, get_opportunity_dossier, list_documents, read_document_excerpt,
get_reglement_provenance, query_zoning_events, get_zones_geojson, get_lots_geojson,
get_grille_pdf et get_pv_pdf. Parmi les six premiers, seul search_signals est
raccordé ; les cinq autres répondent not_wired_yet (S36/S46). Ces noms, paramètres,
réponses et erreurs sont à conserver, y compris les réponses non raccordées.

**Contrat de bascule.** Même URL publique MCP, même connexion et mêmes comptes,
sans reconnexion ni réglage dans claude.ai. Conserver la découverte OAuth,
les inscriptions clients, les publics concernés et les droits actuels, pour que la connexion reste valide
existants. Qualifier les transports actuels HTTP et stdio et les schémas outils.
Les nouveaux outils s’ajoutent sans collision de nom ni changement des anciens.
Un mécanisme transitoire de compatibilité côté serveur est possible s’il conserve
une autorité et une seule exécution par commande ; son détail reste à concevoir. L’adresse de découverte de la connexion demande un réglage d’équipe : la version utilisée par Immo la publie sous /mcp, la version actuelle à la racine, alors que l’entrée ne route que /mcp ; sans règle ajoutée, un client qui la redécouvre tombe sur l’interface. Les sessions MCP vivent en mémoire d’un seul pod redémarré à chaque déploiement et sont déjà rouvertes par le client : l’exigence est la validité de la connexion (émetteur, public, droits, découverte), pas une conservation des sessions.

[FACT] Le code Immo transmet actuellement le bearer du lecteur à Radar (S42).
Le socle MCP de Sentropic interdit de transmettre un jeton brut ; le moyen conforme, l’échange de jetons, reste verrouillé dans cluster-mesh. [JUDGMENT] Ce point demande ton accord (question du §5 du dossier) ; l’annexe ne le tranche pas. Voies : A garder la transmission actuelle au pilote par exception écrite limitée à Immo vers Radar (recommandée) ; B faire reconnaître par Radar un appel du MCP au nom de la personne vérifiée ; C attendre l’échange de jetons. Dans tous les cas, résoudre cette
évolution côté serveur avec identité utilisateur vérifiée à chaque appel,
sans faire payer une nouvelle connexion au client. Un token de service ou un
tenant seul ne prouve pas l’utilisateur. Aucun compte partagé, ownerSub libre
ou élargissement de droits ne remplace cette preuve. Le contrat de continuité
n’autorise pas à supprimer la vérification d’identité.

**Périmètre du pilote.** Qualification du socle commun, enveloppement du MCP
actuel, configuration versionnée dans le code (registre comme source d’approbation), puis ajout des fonctions artefacts
dans ce même montage. Les étapes peuvent être livrées séparément en interne ;
le pilote est complet seulement quand anciens outils et nouvelles fonctions
coexistent avec la connexion existante. Une publication seule ne suffit pas.

**Retour arrière.** Comparaison des lectures avant bascule ; aucune double
écriture ni double appel métier. Préserver les identifiants de vues, les UUID et les
données lors d’un retour à la version précédente. Vérifier la bascule puis le
retour avec un client déjà connecté, sans lui demander de se reconnecter.

**Réemploi futur.** Un autre produit pourra composer la même bibliothèque.
Un éventuel hébergement central demanderait sa propre migration et la preuve
d’identité distante ; il n’est ni engagé ni requis par le pilote Immo.

Toutes les recettes de cette annexe sont futures. Aucun test du service,
d’infrastructure ou de validité de connexion n’a été exécuté pour ce dossier.

## K. Glossaire et vues déplacées

**Autorisation temporaire** (grant) : permission courte, liée à une vue, une version et un lecteur, vérifiée localement par le service de contenu. **Code à usage unique** (ticket) : code court consommé une fois pour établir la session d’une vue. **Connexion sécurisée de l’agent** (PKCE, state, nonce) : protections de la redirection de connexion, détaillées en E2. **Cookie protégé** (__Host-) : cookie limité à son hôte exact, sans domaine parent. **Service de contenu** (edge, BFF) : service déployé par Immo, sur le domaine séparé des vues, qui sert les fichiers et relaie les appels vers Radar et Geo. **Empreinte** (hash, digest, CAS) : résumé SHA-256 des octets, pour vérifier et réutiliser un fichier ; ce n’est ni une identité ni un droit. **Appel de service** (S2S) : appel d’un service à un autre avec sa propre identité, distinct de l’appel au nom d’une personne. **Échange de jetons** : moyen conforme de transformer le jeton de connexion en jeton pour l’API aval sans transmettre le jeton brut ; verrouillé dans cluster-mesh à ce jour. Les noms de code et de types (par exemple les contrats de composition) restent dans les sources citées, pas dans les cinq vues.

**Vues déplacées hors des onglets Focus.** *Ouverture d’une vue* : ouvrir l’adresse, se connecter sur la page de confiance d’Immo (le service d’identité reste dans la préproduction Sentropic, hors du nœud Immo), activer la version, obtenir l’autorisation temporaire, puis appeler Radar avec les droits du lecteur ; fermeture à l’échéance (objectif 60 s depuis un retrait, à mesurer). *Publication et retrait* : envoyer le manifeste, déposer les fichiers manquants autorisés, valider, mettre en ligne en privé, partager, retirer (accès fermés à l’échéance), annuler avant effacement, puis effacer les fichiers inutilisés en respectant les copies indépendantes. *Première maquette sur le poste* : modifier les sources sur le poste autorisé avec un relais local qui garde le jeton hors de la page ; elle prépare la publication sans la remplacer. *Briques déjà présentes* : serveur de développement, gabarits, transferts et stockage existent dans les sources ; leur adoption par Immo reste à construire. *Ancienne alternative centralisée* : Sentropic aurait hébergé le service ; elle est conservée dans les archives, hors du pilote, et ne conditionne pas la publication depuis Immo.

