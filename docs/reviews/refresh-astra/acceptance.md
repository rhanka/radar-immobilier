# Acceptation locale et périmètre de déploiement

L’acceptation locale utilise deux PDF publics : le procès-verbal municipal de Waterloo du 2026-08-18 et l’ordre du jour de Saint-Polycarpe du 2026-01-19, sélectionnés avant exécution. Leurs URL publiques et valeurs SHA-256 sont conservées dans les reçus JSON. Le premier provient de l’oracle #711 ; le second est le premier document du corpus v101 gelé, non choisi selon le résultat du modèle.

Le harnais exécute le vrai `runPvRefresh`, Poppler, le profil/provenance v9, MinIO et PostgreSQL. Son lecteur keyring en lecture seule utilise le format AES-GCM existant sans chmod, copie ni écriture du keyring source. Les mises à jour de compte restent en mémoire de processus. Seuls les nombres de comptes actifs et l’accord de même owner sont émis. Un compte Codex et un compte Cloud Code étaient disponibles.

Reçu primaire initial à `7bf2d17f` : 2/2 acceptés, Astra low, 144601ms et 122984ms. Il précède le durcissement exact-route et les revues suivantes ; il n’est pas renommé preuve du commit final.

Repli forcé initial : Gemini low a généré et passé profil/provenance pour les deux documents (42003ms, 13660ms ; zéro appel Astra). L’acceptation publication/projection était 0/2 : le harnais local a réinitialisé les bases S3 mais conservé les graphes PG Astra antérieurs, donc le garde de régression existant a arrêté la projection. C’était une erreur d’isolation de test ; aucun garde produit n’a été affaibli. Les campagnes corrigées utilisent des bases de test et buckets S3 initialement vides, séparés pour primaire et repli forcé.

Campagnes réelles corrigées : [reçu primaire](receipt-primary.json) **2/2**, Astra low, 171776ms et 123815ms ; [reçu forcé](receipt-fallback.json) **2/2**, Gemini low, 25018ms et 10707ms, zéro appel Astra. Les six étapes durables sont terminées pour chaque document, y compris publication S3 et projection PG. Ce sont des preuves document/profil/provenance, pas un benchmark F1 d’opportunités municipales ni une preuve d’ordonnancement Kubernetes. Chaque reçu nomme le commit réel au lancement ; le durcissement ultérieur des refus terminaux et compteurs repris est couvert par des tests de régression, sans le présenter comme appels live supplémentaires.

Les commandes de vérification utilisent `ENV=test-astra-703`, sans ports de service hôte, avec API/UI/Maildev réservés à 8893/5393/1193. `make typecheck` et `make lint` réutilisent les volumes Compose de test via `COMPOSE_RUN_API_NODEPS` et exécutent les mêmes scripts workspace que les cibles standard. Les contrôles CLI harness scope/branch sont consultatifs, pas des substituts à l’exécution des tests.

Vérification finale : 131 tests sur huit fichiers ont réussi, dont six tests d’intégration. Typecheck, lint, les deux rendus overlay, harness static/unit et contrôles scope/branch, ainsi que `git diff --check`, ont réussi. La stack Compose de test a été supprimée avec `down -v`, y compris PostgreSQL, MinIO et volumes de dépendances.

Observation préprod en lecture seule au 2026-09-17 : image `3cf4f69`, PV actif, scrape/projection historiques suspendus. L’identité cert-ro ne peut ni créer des Jobs ni lire Secrets/PVC. La variable GitHub `REFRESH_CRONJOB_PROD_ENABLED` était absente. Les ressources production restent non vérifiées par cette lane code ; k8s doit compléter les prérequis et l’acceptation séquentielle du runbook.
