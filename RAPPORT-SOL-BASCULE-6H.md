## Correctifs véhicule après le 28/10

Travail exclusivement local du 28/10/2026, sur la branche
`fix/bascule-6h-vehicle`, dans `tmp/bascule-6h-fix`.
Base récupérée depuis origin/main : `26a78195ad17f8b80907074a91d6cb43ef6ac3dd`.
Le fetch initial a réussi à 17:18 UTC ; les contrôles distants ultérieurs ont
renvoyé EOF. Une tête distante plus récente reste `unverified`.
Les demandes système ont expiré dans la revue automatique des permissions.
La finition a été qualifiée dans la copie locale de livraison
`tmp/bascule-6h/tmp/vehicle-fix-delivery-check` ; la synchronisation du worktree
initial reste bloquée par cet accès système, sans refus de sécurité motivé.
Aucune action en préprod, aucun push, aucune modification de l'authentification,
des cookies, des workflows CD ou de `PREPROD_CD_ENABLED`.

### 1. Route et sonde publique

Le rendu natif de `api_routes` contient déjà `/api/v1/workspaces` avec
`pathType: Prefix` : `projection-revisions` est couvert. La sonde historique
utilisait GET sur le même nom public. L'hypothèse d'un chemin manquant dans ce
rendu est donc réfutée ; aucune route supplémentaire n'a été exposée.
Le reçu de 16:58 conserve seulement `status:0` et `transportError:TypeError`.
Il ne permet pas d'attribuer rétrospectivement l'échec à CORS, une redirection,
un corps JSON ou une panne de transport. Cette cause historique reste `unverified`.

Deux défauts de la sonde historique ont été reproduits en rouge : une réponse
HTTP 200 malformée passait après remplacement silencieux du JSON par `{}` ; une
réponse JSON `null` devenait un faux échec de transport avec statut perdu.
La nouvelle sonde conserve le statut reçu et distingue fetch, redirection,
lecture du corps, MIME, parsing JSON et schéma. Elle refuse les mutations,
les redirections et les schémas incohérents ; elle arrête les lectures après
un échec connu. Aucun corps, cookie, jeton ou message distant brut n'est exporté.

La liste versionnée compte onze contrôles publics. Le test croisé rend le vrai
Ingress et vérifie chaque chemin selon les segments Prefix Kubernetes. Les
anciens contrôles globaux 410, hors profil, ont produit le test rouge ; ils
restent à qualifier séparément via l'accès namespace-admin. Les trois préfixes
publics demeurent exactement `/health`, `/api/v1/auth`, `/api/v1/workspaces`.
La sonde utilise uniquement l'onglet dédié créé par PUT `/json/new`, fermé en
`finally`, et ne consulte pas les autres onglets. Les données de session restent
dans Chrome ; aucune souscription générique aux événements Network n'est requise.

### 2. Horodatages UTC

Cause reproduite : l'identité API recopiait l'annotation Kubernetes
`2026-10-28T12:34:29-04:00` dans la preuve, alors que `fromdateiso8601` du filtre
natif exige UTC Z. Le test rouge retrouvait le refus générique silencieux.
La capture et la relecture de l'identité normalisent désormais cet instant en
`2026-10-28T16:34:29Z`. Une preuve externe avec décalage est refusée explicitement
avec le chemin du champ, notamment `restart.instance.restartedAt`.
Le filtre d'acceptation natif n'a pas été modifié.

### 3. Reprise du rollback

Cause reproduite : l'appel isolé du helper `assert_cd_frozen`, sans
`operator_inputs`, laisse `repo` non initialisé. Le test rouge reproduit
`repo: unbound variable`. Ce n'est pas une preuve que le CD était réellement actif.
L'entrée native `verify-closed` initialise le contexte et relit la fermeture.
Un appel privé hors contexte est refusé explicitement avant toute requête.
La répétition ferme, vérifie et restaure les Ingress exacts au premier appel,
avec leurs UID, préconditions et relectures, y compris après `reopenBy` lorsque
l'accord de gel reste actif. Les actions d'avancement sont alors refusées.
Cette répétition porte sur le véhicule et les routes, pas une restauration réelle
PostgreSQL ; aucune nouvelle sauvegarde ni restauration n'a été exécutée.

### 4. Actions et durée du gel

Cause reproduite : désactiver le workflow de construction ne bloque pas les CI
des branches de PR, et le message natif supprimait l'identité du run bloquant.
Le test rouge retrouve un refus sans id, workflow ni branche. Le message corrigé
nomme chacun de ces champs pour tous les runs non terminaux.
Le préflight exige un accord référencé `maintenance.changeFreeze`,
`noPushOrMerge:true`, un début UTC déjà atteint, une fin UTC future et
`maintenance.reopenBy` entièrement couvert. Les déclarations absentes, futures,
expirées ou trop courtes sont refusées avant action externe. La fenêtre est
relue après l'inventaire et après la pagination Actions ; le test rouge qui
expirait pendant cette lecture passe désormais sans engager l'activation.
Cet accord est opérationnel : il ne prétend pas verrouiller les écritures GitHub.
Le runbook anglais interdit tout push et toute fusion pendant toute la fenêtre,
y compris qualification publique et rollback. Aucune annulation globale ajoutée.

### Validation locale et livraison

Les preuves rouge/vert et les reçus synthétiques sont conservés sous
`tmp/bascule-6h-fix/tmp/vehicle-evidence/`, notamment `utc-*-red.log`,
`rollback-context-red.log`, `rollback-entry-red.log`, `actions-*-red.log`,
`probe-red.log`, `paths-red.log` et `mutations.log`.
La matrice de douze mutations est entièrement rejetée ; les bases avant/après
mutations passent. Les binaires Kubernetes/GitHub sont des fixtures ; les tests
Node tournent sans réseau. Chaque pile Compose propre au test finit par `down -v`.

Validation finale locale à 19:10 UTC : **280 cas natifs**, deux contrôles UTC,
quinze tests Node et le test croisé des onze chemins publics réussissent.
La répétition complète aboutit à `passed:true`, `nativeFilter:true`, Q1 et Q2
simulés réussis, et fermeture des deux onglets dédiés. Les vérifications Bash,
`git diff --check`, branche et périmètre harness passent. L'import d'un bundle
intermédiaire dans un dépôt initialement réduit au commit de base a réussi.
Les mêmes tests ont ensuite réussi dans un import complet du bundle,
sans modification du code testé, avec nettoyage des piles en sortie.
Les preuves finales sont dans
`tmp/bascule-6h/tmp/vehicle-fix-delivery-check/tmp/vehicle-evidence/` :
`delivery-tests.log`, `rehearsal-complete.json`, `harness-check-*.json`.

Le runbook anglais détaille les nouvelles entrées Make, la construction UTC,
les limites des contrôles publics, le gel et le chemin de récupération initialisé.
Le bundle livré est à `tmp/bascule-6h/bascule-6h-vehicle-fix.bundle`, ref
`refs/heads/fix/bascule-6h-vehicle`, sans push. Les revues astra et wonder puis
la fusion restent à la charge du conducteur.

### Ce qui reste unverified

Cause réseau exacte du TypeError historique ; qualifications réelles sur Chrome
et cluster ; écritures métier, replay, SSE, isolation, révocation et contrôles
410 non exécutés ; CI distante et revues externes. Les lectures authentifiées de
la répétition sont simulées et ne qualifient aucune session réelle.
La garde de sauvegarde de 24 heures est conservée : la qualification enregistrée
le 28/10 à 07:29:10 UTC expire le 29/10 à 07:29:10 UTC, avant la fenêtre de
09:00 UTC. Ne pas rafraîchir artificiellement `backup.restoredAt` ; une nouvelle
qualification réelle ou une décision séparée effectivement supportée sera requise.

## Correctifs véhicule, seconde passe

Seconde passe de PR #940, base exacte `ec8670419085098c82b3bb587a7d36f5807838fe`.
Les rapports Fable 5.1 (`fable-940.md`) et astra (`astra-940.md`) ont été lus
intégralement. Corrections exclusivement locales, dans la copie de livraison
`tmp/bascule-6h/tmp/vehicle-fix-delivery-check`, sur `fix/bascule-6h-vehicle`.
Le worktree initial reste au dernier état accessible ; aucun de ses changements
non commités n'a été écrasé. Aucun push, accès préprod, sauvegarde ou restauration
réelle, lecture de fichier d'environnement, export de cookie ou de jeton.

### Blocages Fable et astra : récupération native après réouverture

Le défaut est reproduit en rouge : `close` post-réouverture tentait de recréer
le Service existant (`AlreadyExists`), et l'entrée Make `reclose-api` manquait.
La garde de gel refusait aussi cette récupération après `reopenBy` malgré un
accord encore actif. Preuves : `r2/close-after-reopen-red.log`,
`r2/reclose-missing-red.log` et `r2/freeze-recovery-red.log`.

`close` refuse maintenant le Service existant avant toute écriture et avant
la création d'un nouveau snapshot. Les gardes de réseau et de middleware sont
conservées. Le nouveau `reclose-api` natif :

- exige le snapshot de fermeture lié au même binding et à la même image ;
- vérifie le Service de refus sans endpoints, les identités et les specs ;
- admet uniquement le profil API seule rendu par le véhicule, ou sa fermeture
  exacte déjà appliquée lors d'une récupération interrompue ;
- applique des tests JSON-patch UID, resourceVersion et spec avant remplacement
  par la spec fermée, puis scale `radar-api` à zéro et attend son rollout ;
- exécute `assert_boundary` et `assert_closed`, puis écrit un nouveau snapshot.

Les specs originales restent inchangées ; seules les versions fermées relues
sont actualisées dans `closedIngresses`. `restore-ingresses` consomme ce nouveau
snapshot, jamais les versions périmées du premier snapshot. Le filtre natif
et les trois préfixes publics restent inchangés ; aucun garde applicatif,
de réseau ou de sauvegarde n'a été désactivé.

Les actions `reclose-api`, `verify-closed` et `restore-ingresses` sont classées
récupération : elles restent autorisées après `reopenBy` tant que le gel est
actif. Activation, fermeture initiale et réouverture tardives restent refusées.
Un gel expiré refuse aussi la récupération. `verify-closed` reste un constat,
et les helpers privés ne sont pas des entrées opérationnelles.

### Câblage du contexte et fractions de seconde

`base-preprod-context.test.sh` est maintenant exécuté par la cible `test`, via
`test-context`. Le refus avant tout appel gh d'un helper non initialisé passe.
Les trois tests rouges du gel reproduisent le rejet des fractions Z, le message
sans champ et le refus de récupération tardive. Ils passent après correction.
Les fractions sont conservées dans la comparaison des instants ; les dates
invalides nomment `maintenance.changeFreeze.startsAt`, `.endsAt` ou
`maintenance.reopenBy`. Les décalages, y compris `+00:00`, restent refusés : les
entrées exigent UTC `Z`, contrat rendu explicite dans l'exemple et le runbook.

### Répétition et refus qualifiés localement

La répétition exécute le véhicule natif sur fixtures, jusqu'au filtre natif exact
et à `reopen-api`, puis les sondes CDP authentifiées simulées Q1/Q2. Elle produit
ensuite un reçu de sonde simulée en échec, observé après l'échéance de fixture,
puis enchaîne `reclose-api → verify-closed → restore-ingresses` avec succès.
L'échéance est déplacée dans le passé dans l'owner-input privé de fixture après
réouverture ; aucune horloge ni preuve de qualification réelle n'est modifiée.

La matrice refuse sans écriture snapshots étrangers, fermetures incomplètes,
UID ou specs divergents, activation/réouverture tardives et gel expiré. Une course
resourceVersion fait échouer le patch avant scale. Une interruption du scale
laisse les routes fermées ; la même action reprend sans helper et sans recréer
le Service. Les tests contrôlent les quatre opérations du patch, les versions,
les replicas et le SHA-256 inchangé du snapshot original. Les copies de fixture
sont réinitialisées entre la matrice de fautes et le parcours nominal.

Validation locale verte : **280 cas natifs, 15 tests Node, deux contrôles UTC,
trois modes de contrôle du gel, le test de contexte et onze chemins publics**.
La répétition donne `nativeFilter:true`, Q1/Q2 simulés réussis, `lateQ1:false`
attendu, puis `reclosed:true`, `verifiedClosed:true`, `restored:true`.
Les mêmes cibles passent depuis un import propre du bundle r2, basé uniquement
sur ec867041. Les contrôles harness de branche et de périmètre passent ; le
runtime épinglé est Node 24.22.1 avec WebSocket global, sans contact Chrome.
Les trois mutations ciblées (scale, validation du snapshot, test resourceVersion)
sont rejetées ; les exécutions avant/après passent et les sources sont inchangées.
Contrôles Bash et diff propres. Journaux sous
`tmp/bascule-6h/tmp/vehicle-fix-delivery-check/tmp/vehicle-evidence/` :
`r2/full-green.log`, `r2/reclose-mutations.log`, `r2/reclose-mutations/`,
`rehearsal-native.log` et `rehearsal-complete.json`.
Chaque pile Compose propre aux tests finit par `down -v` ; Node reste sans réseau.

### Prérequis ferme pour le 29/10 à 09:00 UTC

La qualification existante du dump de 07:16, achevée le 28/10 à 07:29:10 UTC,
expire le **29/10 à 07:29:10 UTC**, avant la fenêtre de 09:00. La garde de
24 heures est inchangée et aucune dérogation de sauvegarde n'a été ajoutée.

Marche à suivre avant toute maintenance, non exécutée dans cette passe : vérifier
la disponibilité et le SHA-256 du dump immuable choisi ; via la procédure Make
d'administration PostgreSQL approuvée, le restaurer réellement dans une base
temporaire isolée avec arrêt sur erreur ; comparer schéma et comptes par table
au reçu de référence ; conserver les sorties de succès, l'heure UTC réelle de
fin et la preuve de suppression de la base temporaire. Produire le nouveau SHA-256
du reçu, puis un owner-input immuable dont `backup.reference` et `backup.sha256`
désignent ce dump, `backup.restoredAt` cette fin réelle et
`backup.restoreReceiptSha256` le nouveau reçu. Exécuter ensuite les entrées natives
`operator.mk validate`, puis `operator.mk preflight`, chacune avec un OUTPUT neuf.
Le véhicule ne fournit aucune action de restauration PostgreSQL : ces validations
acceptent le prérequis qualifié, elles ne le réalisent pas. Si la requalification
réelle manque, NO-GO avant fermeture. Un nouvel horodatage seul est invalide.

### Livraison et unverified

Bundle r2 demandé : `tmp/bascule-6h/bascule-6h-vehicle-fix-r2.bundle`, ref
`refs/heads/fix/bascule-6h-vehicle`, strictement au-dessus d'`ec867041`.
Le runbook anglais décrit la re-fermeture native et le snapshot à transmettre.
Restent `unverified` : Chrome et cluster réels, restauration réelle, cause exacte
du TypeError historique, CI distante et revues de cette seconde passe. Les autres
remarques non demandées sur le véhicule CDP demeurent hors de cette correction.
