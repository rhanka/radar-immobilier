# Astra medium refresh with Gemini low verification: preproduction and production

Refs #703 and #697 established Astra extraction with Gemini fallback. The prepared v101b
precision-cascade change uses Astra medium and Gemini low verification. This is not a
deployment receipt: i-cond reviews and commits; the release lane deploys only when authorized.

## Contrat d’exécution

Primary: `openai / gpt-6-astra / medium` through `CodexRuntimeClient`. Fallback and verification:
`gemini / gemini-3.8-flash / low` through Cloud Code. `@sentropic/llm-mesh-refresh` stays pinned
to 0.19.2; Codex omits `max_output_tokens`, with a boundary test for that behavior. Gemini
retains the 32768-token cap. `REFRESH_MAXIMUM_ATTEMPTS=1` prevents hidden Graphify route retries.

`REFRESH_TIMEOUT_MS=900000` is a separate deadline per extraction or verification attempt.
The Job deadline remains 2100 seconds: it does not cover four worst-case attempt windows.
A slow or multichunk document may reach that deadline; completed chunks resume durably.
A verifier timeout preserves the primary extraction. Cycle cancellation and storage errors
still stop durable completion rather than falsely recording success.

Transport, quota/429, 5xx, missing active account, timeout, and empty output trigger fallback.
JSON, profile, and provenance refusals receive one same-primary retry, then Gemini fallback.
Fallback sticks to the document's remaining chunks. Three consecutive distinct quota-failed
documents cause subsequent documents to bypass Astra. A wholly successful primary document
resets that counter; intermediate chunks do not. The circuit resets each cycle; partial
documents restore extraction affinity from durable receipts. Acquisition selects one PDF
per city cycle; use distinct cycles for acceptance with two documents.

With `REFRESH_VERIFY_ENABLED=1`, each accepted primary chunk is verified by
`REFRESH_VERIFY_PROVIDER=gemini`, `REFRESH_VERIFY_MODEL=gemini-3.8-flash`,
`REFRESH_VERIFY_REASONING_EFFORT=low`. Fallback output is never verified (`skipped-fallback`).
The frozen filter only removes eligible act groups on explicit `non_soutenu` with a non-empty
reason, together with all edges incident to removed nodes. Other nodes and surviving edges
remain unchanged. Missing/invalid decisions keep the act;
ungrounded supported excerpts also keep it. Invalid JSON or a failed verification preserves
the accepted primary output. See the [cascade contract](../refresh-cascade/production-acceptance.md)
for grouping, counters, and the frozen instruction hash. `REFRESH_VERIFY_ENABLED=0` disables
verification without rebuilding the image and records `disabled` on primary receipts.

`identity.modelPolicy` includes primary, fallback, verification model or disabled state, and
forced mode. `documentModels[docSha][]` persists safe per-call receipts and verification
counters under `transition=verification`. The budget reserves four calls per chunk when
enabled, three otherwise. Completed chunks resume without duplicate calls. Verification
failures never restore extraction fallback affinity or affect the quota circuit. Extraction
identity/status integrity failures remain terminal; verifier integrity failures preserve
the accepted extraction. Deadlines apply to non-cooperative clients and reject late responses.
Logs contain only safe receipt metadata, never supplier messages, prompts, or account material.

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
2. After i-cond merges and preproduction CD completes, record the release SHA and immutable API digest. Check PV alone is active, Astra medium, Gemini low fallback, all four verification variables, and matching init/runtime images.
3. Après l’import Codex si le PVC existe déjà, créer via la cible k8s un Job unique depuis `radar-refresh-pv`. Respecter le `flock`, éviter 05:17 UTC et choisir des PDF publics aux identités d’entrée inutilisées, ou consigner les skips durables.
4. Retain actual models, JSON/profile/provenance acceptance, verification receipts/counters, six durable stages, PostgreSQL projection, duration, and Job result. Primary acceptance requires a real `gpt-6-astra / medium` call followed by Gemini low verification.
5. Exercise a separate authorized Job with `REFRESH_FORCE_FALLBACK=1`: Gemini low, reason `forced`, `skipped-fallback`, zero Astra and verification calls. Also test verification disabled. Policy identities separate those results without a state purge.
6. Collect model, accepted/refused counts, duration, safe Job logs, and B′ links on `https://preprod.immo.sent-tech.ca`, then `https://immo.sent-tech.ca`. Extraction quality retries and Gemini fallback must carry their explicit transitions; verifier failure is recorded while the primary output is retained.

## Promotion production (lane k8s et i-cond)

1. Avec GO owner, vérifier/créer les Secrets runtime et bootstrap production, PVC `radar-refresh-keyring` inscriptible, deux enrôlements, identifiants S3 dédiés et marge 768Mi. Vérifier le contexte OVH production réel ; un inventaire Scaleway historique ne prouve rien.
2. Mettre `REFRESH_CRONJOB_PROD_ENABLED=true`, créer le tag `v*` sur le commit fusionné accepté et approuver la porte `production` si nécessaire. `promote-prod` déploie le digest API exact de la release.
3. Verify PV active, historical scrape/projection suspended, Astra medium, Gemini low fallback and verification, and matching images. Run the authorized acceptance and inspect the next scheduled Job; retain state keys, safe receipts/counters, and durations.

## Retour arrière et suivi quota

Critères : mauvaise release/modèle, secret exposé, Jobs échoués répétés, perte d’application provenance/qualité, divergence canonique/PG ou impossibilité d’utiliser Gemini après erreur Astra. K8s suspend d’abord PV et traite explicitement tout Job actif. Restaurer ensemble digest CronJob et politique acceptés précédents. `rollback.yml` ne restaure que les Deployments, pas les CronJobs, graphes S3 publiés ni données PG. Employer la sauvegarde canonique/le reçu d’application pour une récupération approuvée owner si publication ; un rollback image ne restaure pas les données.

Mesure owner : 79 % du quota Codex hebdomadaire consommé au 2026-09-17 04:15Z ; reset `2026-09-22T13:12Z`. Rafraîchir cette mesure avant promotion et surveiller quotidiennement les reçus quota/429. Attendre Gemini quand Codex est indisponible ; alerter sur échec de repli ou refus qualité. L’acceptation benchmark Gemini mesurée est 85/100, pas les 100/100 d’Astra.
