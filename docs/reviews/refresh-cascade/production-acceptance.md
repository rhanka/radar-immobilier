# Cascade Gemini low puis Astra low : acceptation et promotion

Refs #703 et #697. La politique est `gemini / gemini-3.8-flash / low` en principal, avec `REFRESH_PRIMARY_QUALITY_ATTEMPTS=2`. Un refus du contrat v9 (profil ou provenance) est rejoué une fois sur Gemini ; le refus persistant bascule vers `openai / gpt-6-astra / low`. Transport, quota/429, délai ou flux vide basculent immédiatement vers Astra. `REFRESH_FORCE_FALLBACK=1` reste une recette contrôlée et contourne Gemini.

Chaque reçu `documentModels[docSha][]` porte modèle, `attempt` (ordinal document), `transition` (`primary`, `same-model-retry` ou `fallback`) et motif redacted. Le disjoncteur passe directement à Astra après trois bascules quota/429 consécutives. La réservation durable prévoit trois appels par fragment (deux Gemini, un Astra).

## Validation préproduction (lane k8s)

1. Après fusion par i-cond et CD préproduction, relever SHA, digest immuable, deux enrôlements sous le même owner scope, PVC inscriptible et CronJob PV seul actif. Aucun Secret ni octet de keyring ne va dans les preuves.
2. Purger l'état de rafraîchissement `refresh/018/*` du stockage préproduction avec la procédure propriétaire approuvée, puis lancer le cycle complet. Ne pas lancer simultanément le CronJob planifié.
3. Archiver les reçus sûrs et mesurer : modèle par document, nombre de tentatives, transitions, taux de récupération Gemini (acceptés après rejeu / refus initiaux), bascules Astra, quota/429 et signaux B′ publiés.
4. Vérifier les liens de signaux B′ sur `https://preprod.immo.sent-tech.ca/…`, les documents scrapés et les six étapes durables (corpus, profil, candidate, enriched, published, projected). Consigner les documents publics effectivement traités et leurs URLs, sans sélectionner a posteriori selon le résultat.
5. Exécuter séparément une recette `REFRESH_FORCE_FALLBACK=1`; le reçu doit montrer Astra, `transition=fallback`, `fallbackReason=forced` et aucun appel Gemini. Cette recette ne remplace pas le cycle normal.

## Promotion production

1. Avec le GO owner, confirmer les mesures préproduction, les enrôlements et le digest exact.
2. Positionner la variable GitHub `REFRESH_CRONJOB_PROD_ENABLED=true`, créer le tag `v*` sur le commit fusionné et approuver la porte production selon le workflow.
3. Vérifier le rendu production : PV actif, autres CronJobs suspendus, Gemini low + deux essais qualité et Astra low de repli. Exécuter le Job autorisé puis archiver les mêmes mesures et les liens `https://immo.sent-tech.ca/…`.

## Retour arrière

Suspendre d'abord le CronJob PV et traiter le Job actif. Restaurer ensemble le digest et la politique précédemment acceptés, puis remettre `REFRESH_CRONJOB_PROD_ENABLED` à sa valeur antérieure si nécessaire. Une image restaurée ne restaure ni état S3 ni projection PostgreSQL : employer uniquement la sauvegarde canonique et le reçu d'application approuvés pour récupérer des données.
