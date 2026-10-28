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
