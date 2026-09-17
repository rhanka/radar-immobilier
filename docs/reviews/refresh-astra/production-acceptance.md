# Rafraîchissement Astra low : préproduction puis production

Refs #703 et #697. Décision owner : 2026-09-17 04:40Z. La lane code prépare la livraison ; i-cond fusionne et la lane k8s exécute le déploiement autorisé.

## Contrat d’exécution

Primaire : `openai / gpt-6-astra / low`, transporté par `CodexRuntimeClient`. Repli : `gemini / gemini-3.8-flash / low`, via Cloud Code. `@sentropic/llm-mesh-refresh` reste exactement en 0.19.2. Son `dist/codex.js:53` retire `max_output_tokens`; le test unitaire à la frontière HTTP vérifie son omission même lorsque l’extraction demande 32768 jetons. La limite Gemini reste 32768. `REFRESH_MAXIMUM_ATTEMPTS` doit valoir 1 : Graphify peut réessayer les refus de validation avec des budgets de route supérieurs.

`REFRESH_TIMEOUT_MS=900000` est une échéance distincte par tentative modèle. L’échéance Job est 2100 secondes, laissant la place aux deux fenêtres modèle plus acquisition/publication. Un gros document multi-fragments peut atteindre l’échéance ; les fragments terminés reprennent durablement au cycle suivant.

Les erreurs de transport, quota/429, 5xx, compte actif absent, délai et texte vide déclenchent le repli. Les refus JSON, profil et provenance s’arrêtent sans repli. Le repli reste attaché aux fragments restants du document. Après trois documents distincts repliés consécutivement pour quota/429, les suivants ignorent Astra. Un document primaire entièrement réussi remet ce compteur à zéro ; les fragments intermédiaires réussis ne le font pas. Le circuit se réinitialise au cycle suivant ; les documents partiels restaurent le repli depuis les reçus durables. L’acquisition courante sélectionne un PDF par cycle ville ; utiliser deux cycles distincts pour l’acceptation à deux documents.

`state.json` contient les deux modèles et le mode forcé dans `identity.modelPolicy`. `documentModels[docSha][]` conserve `modelUsed`, statut, latence, `failureReason` et/ou `fallbackReason` pour chaque tentative. Un document mixte conserve donc les deux modèles. Les fragments terminés reprennent sans génération dupliquée. Le fournisseur/modèle/statut retournés sont contrôlés avant enregistrement ; une identité retournée différente arrête avec `modelUsed: null`. Les refus d’intégrité/statut portent `terminalFailure: true` entre redémarrages. L’échéance est appliquée même pour un client non coopératif. Les réponses tardives ne peuvent ni valider ni écraser le fichier choisi. Les journaux n’émettent que les métadonnées sûres de `refresh-pv: model receipt` ; aucun message fournisseur, prompt, identifiant ou matière de compte.

## Prérequis keyring et principal

Employer les clés Secret existantes `REFRESH_PRINCIPAL_REF` et `REFRESH_OWNER_SCOPE_REF` de `radar-refresh-runtime` pour les deux transports. Mesh 0.19.2 installé, `dist/service/local-account-transport-service.js` lignes 334–358, filtre les comptes de route par owner scope et expose séparément cible/transport. Un principal est l’identité appelante, pas un identifiant fournisseur unique. Aucune clé Secret spécifique au repli n’est nécessaire si les deux comptes sont enrôlés sous ce même owner. Ne pas copier le compte d’un autre owner.

### Enrôlement owner et import PVC existant

1. Sur le poste de l’owner, avec le keyring source qui contient sa `.key`, enrôler ChatGPT/Codex sous **la même** valeur `REFRESH_OWNER_SCOPE_REF` que Cloud Code :
   ```sh
   make -f deploy/k8s/refresh-cronjobs/refresh-018.mk enroll-codex LOCAL_IMAGE=<image-locale> KEYRING_SOURCE_DIR=<keyring-source> REFRESH_OWNER_SCOPE_REF=<owner-scope> ENV=test-refresh-018
   ```
   L’URL de consentement et le code à usage unique s’affichent uniquement dans ce terminal. La sortie finale ne contient que le pseudonyme et `codex`.
2. Pour un PVC déjà initialisé (préprod), créer hors journal l’unique Secret temporaire `radar-refresh-keyring-account-import` à partir du keyring source complet, puis rendre le Job sans l’appliquer :
   ```sh
   make -f deploy/k8s/refresh-cronjobs/refresh-018.mk import-keyring-account IMPORT_IMAGE_REF=<digest-immuable> IMPORT_RENDER_OUT=<fichier.yaml> ENV=preprod
   ```
   La lane k8s applique ce manifeste une seule fois, attend le Job, vérifie sa sortie pseudonymisée, puis supprime Job et Secret temporaire. Le Job prend `flock` sur `.refresh.lock` puis `.bootstrap.lock`, vérifie que les `.key` source/runtime sont identiques, ajoute uniquement l’enveloppe et le record public Codex à l’index runtime, et ne remplace ni l’index Gemini ni les credentials rafraîchis. Aucun `apply` n’est fait par la lane code.
3. Pour un PVC neuf (production), préparer le Secret bootstrap avec le keyring qui contient **les deux** comptes avant le premier démarrage. Le bootstrap ne copie que si `.key` est absent : remplacer `radar-refresh-keyring-bootstrap` ne modifie donc pas un PVC déjà initialisé. Ne jamais inclure des octets de keyring dans les reçus.

## Acceptation préproduction (lane k8s)

1. Vérifier cluster/namespace OVH préprod, noms des clés runtime, deux transports enrôlés, PVC inscriptible et limite workload 1536Mi. Le kubeconfig cert-ro de la lane code est en lecture seule.
2. Fusionner la PR verte via i-cond, attendre CD préprod et consigner SHA de livraison et digest API immuable. Le rendu doit montrer uniquement PV actif, six variables modèle et images init/runtime correspondantes.
3. Après l’import Codex si le PVC existe déjà, créer via la cible k8s un Job unique depuis `radar-refresh-pv`. Respecter le `flock`, éviter 05:17 UTC et choisir des PDF publics aux identités d’entrée inutilisées, ou consigner les skips durables.
4. Conserver, par document, modèle réellement employé, acceptations JSON/profil/provenance, six étapes durables terminées, projection PG, durée et issue Job. L’acceptation primaire exige un appel réel `gpt-6-astra / low`.
5. Créer un second Job unique avec `REFRESH_FORCE_FALLBACK=1` sur ce seul Job. Conserver son reçu : Gemini low, raison `forced`, zéro appel Astra. L’identité de politique modifiée évite la réutilisation de l’extraction primaire.
6. Collecter les preuves e2e demandées : modèle par document, acceptés/refusés, durée, liens vers les nouveaux signaux filtre B′ sur immo-preprod puis immo-prod, et logs du Job. Un refus qualité est une acceptation échouée, jamais un motif de relance silencieuse avec un autre modèle.

## Promotion production (lane k8s et i-cond)

1. Avec GO owner, vérifier/créer les Secrets runtime et bootstrap production, PVC `radar-refresh-keyring` inscriptible, deux enrôlements, identifiants S3 dédiés et marge 768Mi. Vérifier le contexte OVH production réel ; un inventaire Scaleway historique ne prouve rien.
2. Mettre `REFRESH_CRONJOB_PROD_ENABLED=true`, créer le tag `v*` sur le commit fusionné accepté et approuver la porte `production` si nécessaire. `promote-prod` déploie le digest API exact de la release.
3. Vérifier PV actif, scrape/projection historiques suspendus, six valeurs modèle Astra/Gemini low et images identiques. Exécuter l’acceptation unique autorisée puis inspecter le Job planifié suivant ; conserver clés d’état, reçus sûrs, comptes acceptés/refusés et durées.

## Retour arrière et suivi quota

Critères : mauvaise release/modèle, secret exposé, Jobs échoués répétés, perte d’application provenance/qualité, divergence canonique/PG ou impossibilité d’utiliser Gemini après erreur Astra. K8s suspend d’abord PV et traite explicitement tout Job actif. Restaurer ensemble digest CronJob et politique acceptés précédents. `rollback.yml` ne restaure que les Deployments, pas les CronJobs, graphes S3 publiés ni données PG. Employer la sauvegarde canonique/le reçu d’application pour une récupération approuvée owner si publication ; un rollback image ne restaure pas les données.

Mesure owner : 79 % du quota Codex hebdomadaire consommé au 2026-09-17 04:15Z ; reset `2026-09-22T13:12Z`. Rafraîchir cette mesure avant promotion et surveiller quotidiennement les reçus quota/429. Attendre Gemini quand Codex est indisponible ; alerter sur échec de repli ou refus qualité. L’acceptation benchmark Gemini mesurée est 85/100, pas les 100/100 d’Astra.
