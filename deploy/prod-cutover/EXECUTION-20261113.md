# Bascule prod v1.2.20 — relevé du 13 novembre 2026

Heures de Montréal (EST, UTC−5). Arrêt après échec du déploiement privé.
RUN : `0434e640-1356-4b69-8bf0-4d50c48b2ed5`.
Candidat : `b7724bdd9015a4f26319897bf240baaf9ee636ae`.

## Étapes

| Étape | Heure | Durée | Résultat / code |
| --- | --- | --- | --- |
| window-start, essai 1 | 22:57:05 | 5 s | 2 ; entrée SQL perdue dans le lanceur |
| window-start, essai 2 | 22:58:54 | 2 s | 2 ; gh installé ne connaît pas --slurp ; verrou acquis |
| window-start, essai 3 | 23:02:55 | 24 s | 2 ; NetworkPolicy allow-bascule-to-postgres absente |
| Règle réseau canonique | Avant 23:04:39 | 0,691 s | 0 ; dry-run serveur, création seule, relecture conforme |
| window-start, reprise | 23:04:39 | 42 s | 0 ; même RUN, capture terminée |
| window-configure | 23:05:25 | 3 s | 0 |
| window-close | Fin : 23:06:14 | Non capturée | close=completed ; code make non capturé ; chronomètre local : 2 |
| window-evidence | 23:06:28 | 4 s | 0 ; trois instances ; preuve reportée dans APPROVAL, writersStopped=true |
| backup | 23:06:40 | 111 s | 0 ; sauvegarde finale et relecture S3 conformes |
| restore-test | 23:08:35 | 79 s | 0 ; base jetable 25435 ; 13 empreintes |
| accept-final-restore | 23:09:56 | < 1 s | 0 |
| artifact-roles | 23:10:01 | 10 s | 0 |
| migrate | 23:10:21 | 94 s | 0 ; 31 nouvelles migrations commitées ; total 44 |
| transition | 23:11:58 | 13 s | 0 ; open-success, scoped, zéro non résolu, barrière ouverte |
| verify | 23:12:18 | 5 s | 0 ; 44 empreintes et six comptes conformes |
| window-deploy | 23:12:28 | 100 s | 2 ; délai de rollout MCP dépassé |
| HTTPS privé, smoke et recette artefacts | Non lancés | — | Arrêt après échec de window-deploy |
| window-reopen | Non lancé | — | Décision réservée à i-cond et à l’owner |

Le script local de chronométrage a été modifié pendant window-close.
Cette erreur a interrompu son relevé après la fermeture. La preuve indépendante
de drain donne 23:06:14. Le verrou confirme close=completed et exécuteur arrêté.
Le code de sortie de make window-close ne peut pas être reconstitué.

## État conservé

Le point de non-retour est franchi. Les 31 nouvelles migrations sont commitées.
Aucune restauration n’a été lancée. Aucun retour d’images, tag ou merge effectué.
Le site reste fermé, HTTP 404. Le verrou reste présent avec le même RUN.
L’exécuteur est arrêté. manual-deploy n’est pas marqué completed.

À 23:15:35 : API 1/1 prête, UI 1/1 prête, MCP 0/1 prêt.
Les cinq CronJobs sont suspendus. Aucun conteneur opérateur du RUN ne subsiste.
Le smoke privé du contrôleur n’a pas été atteint. Aucun HTML de recette publié.
Les lectures HTTPS et MCP du même artefact restent à faire.

Sauvegarde finale :
`s3://radar-immobilier-backup/v1220-cutover/646f23c56198b3c664aabc95c8d7164d36e993a946a8f385eb507180d08844da.dump`.
SHA-256 : `646f23c56198b3c664aabc95c8d7164d36e993a946a8f385eb507180d08844da`.
Les reçus complets restent dans le répertoire opérateur privé prod-window-v1220.

## Correctifs et vérifications

- `54741019e`, déjà poussé avant cette reprise : UUID pré-verrou et lecture conditionnelle d’EVIDENCE.
- `32dd7fb64`, fourni par i-cond : garde CORS comportementale retenue sans remise en cause.
- `888e9b2f3`, commité et poussé : préserver stdin dans le client Docker supervisé.
  Le test reproduit une sortie vide avant correction. Après correction : quatre tests Docker passent,
  dont les interruptions TERM/KILL et le proxy TLS. Syntaxe et diff vérifiés.
- `f5d6d5b16`, commité et poussé : pagination gh portable avec jq -s.
  Treize tests de fenêtre passent. Le refus d’un run actif sur une page suivante est conservé.
- Prérequis réseau restauré avec le manifeste versionné : allow-bascule-to-postgres.
  Aucun élargissement ni suppression de garde. Aucun changement du manifeste nécessaire.

## Relève i-cond / k8s

MCP termine au démarrage avec le message fixe
`Connection terminated due to connection timeout`. Aucun journal brut affiché.
Les NetworkPolicies relevées comprennent default-deny-ingress.
Aucune règle ne permet au pod component=mcp de joindre component=postgres sur TCP 5432.
Le bundle versionné ne contient pas non plus cette règle MCP vers PostgreSQL.

k8s doit traiter ce chemin réseau avec une règle limitée aux sélecteurs concernés.
L’acceptation exige MCP Ready, puis reprise de window-deploy avec le RUN conservé,
smoke privé et recette artefacts HTTPS/MCP. Le compte prod autorisé pour cette recette
reste à fournir par une session opérateur ou un fichier privé, sans jeton dans les messages.
La recette Product Owner et toute décision de réouverture restent à i-cond et à l’owner.
Après le premier COMMIT DDL, aucune restauration autonome.
