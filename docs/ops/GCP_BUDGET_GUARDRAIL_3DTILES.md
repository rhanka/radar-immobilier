# Garde-fou budget hard-cap Google Cloud — §5 VOIE A (Photorealistic 3D Tiles)

**But** : la dépense Google Cloud **ne PEUT PAS** dépasser **~50€/mois**, garde-fou posé **AVANT que la clé API soit active**.

**Statut / autorité** : design + co-val = i-infra (measure/design). **Exécution = owner + auth** dans le compte GCP owner. **login GCP + activer facturation = owner-direct** (owner-réservé). La clé API = **secret** (créée par owner/auth, jamais imprimée/committée). i-infra **co-val/assert** chaque étape sans imprimer la clé ; ne crée ni la clé ni ne touche le billing.

## Fait fondateur : un « budget cap » GCP ≠ hard-cap
Un budget GCP **ALERTE**, il ne **stoppe pas** la dépense. Le seul vrai hard-cap = **couper le billing programmatiquement**. Design = 4 couches, la couche 2 (Cloud Function billing-disable) étant le hard-cap réel.

## Méthode d'exécution : gcloud CLI (pas Playwright-console)
Le déploiement par clics-console (surtout la Cloud Function) est fragile ; **gcloud CLI = scriptable, reproductible, vérifiable**. Owner-auth respecté :
- **[owner-direct, console]** créer/confirmer le **compte de facturation + moyen de paiement** (inévitable en console).
- **[owner-direct]** `gcloud auth login` interactif (via `!` dans la session conductrice).
- **[i-cond drive gcloud, owner présent, i-infra co-val chaque commande+output]** étapes A–H.
- **[k8s/auth]** stockage du secret (étape I).
- **[i-infra assert]** vérif + test hard-cap (étape J).

> ⚠ Ordre NON-négociable : garde-fous A–G **AVANT** la clé (H). Vérifier les noms de service / la syntaxe exacte au moment de l'exécution (co-val live). `BILLING_ACCT_ID` = fourni par l'owner.

### A. Projet dédié + lien billing (billing = owner-direct)
```
gcloud projects create radar-3dtiles-preprod
gcloud config set project radar-3dtiles-preprod
# [owner-direct] lier la facturation :
gcloud billing projects link radar-3dtiles-preprod --billing-account=BILLING_ACCT_ID
```
🔍 projet isolé (budget/quota/kill n'affectent que lui).

### B. Activer les APIs d'infra (PAS Map Tiles ici)
```
gcloud services enable cloudbilling.googleapis.com cloudfunctions.googleapis.com \
  pubsub.googleapis.com cloudbuild.googleapis.com run.googleapis.com
```

### C. Topic Pub/Sub (canal budget→kill)
```
gcloud pubsub topics create billing-guardrail
```

### D. Budget 50€ + alertes → topic
```
gcloud billing budgets create \
  --billing-account=BILLING_ACCT_ID \
  --display-name="3dtiles-50eur-hardcap" \
  --filter-projects="projects/radar-3dtiles-preprod" \
  --budget-amount=50EUR \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
  --notifications-rule-pubsub-topic="projects/radar-3dtiles-preprod/topics/billing-guardrail"
```
🔍 budget en **EUR** (seuil = 50€ réels), 3 seuils, topic câblé.

### E. Service account least-priv pour la Function
```
gcloud iam service-accounts create cap-billing-sa
gcloud projects add-iam-policy-binding radar-3dtiles-preprod \
  --member="serviceAccount:cap-billing-sa@radar-3dtiles-preprod.iam.gserviceaccount.com" \
  --role="roles/billing.projectManager"
```
🔍 rôle **sur CE projet uniquement** (jamais org/billing-account-wide) ; suffit à **détacher** le billing du projet.

### F. HARD-CAP RÉEL — déployer la Cloud Function billing-disable (source = `./cap-billing/`, ci-dessous)
```
gcloud functions deploy cap-billing --gen2 --runtime=nodejs20 --region=europe-west1 \
  --trigger-topic=billing-guardrail --entry-point=capBilling \
  --service-account=cap-billing-sa@radar-3dtiles-preprod.iam.gserviceaccount.com \
  --source=./cap-billing
gcloud functions describe cap-billing --region=europe-west1   # vérif déployée+trigger
```
🔍 **CRITIQUE : Function déployée + abonnée au topic AVANT l'étape H (la clé).** Le hard-cap doit exister avant tout appel facturable.

### G. Quota Map Tiles API (2e ceinture, cap journalier)
- Cap **~250–300 requêtes/jour** (borne la dépense avant le kill mensuel).
- Via `gcloud services` (Service Usage / quota override) OU console si l'override CLI n'est pas dispo — **vérifier au moment**. Math : $6 CPM, 1000 gratuites/mois, ~9 000 payantes ≈ 50€ → ~300/j laisse une marge.

### H. Map Tiles API + clé restreinte (EN DERNIER)
```
gcloud services enable tile.googleapis.com    # Map Tiles API (VÉRIFIER le nom de service au moment)
gcloud services api-keys create --display-name="3dtiles-preprod-key" \
  --api-target=service=tile.googleapis.com \
  --allowed-referrers="https://*.sent-tech.ca/*"
```
🔍 clé **Map-Tiles-API-only + referrer** (domaine app) ; **créée en dernier**, jamais imprimée.

### I. Stockage de la clé (k8s/auth ; clé = client-side → referrer = frontière sécu)
```
KEY_ID=$(gcloud services api-keys list --filter="displayName=3dtiles-preprod-key" --format="value(name)")
# [k8s/auth] récupérer la keyString et la poser en k8s secret SANS l'imprimer :
gcloud services api-keys get-key-string "$KEY_ID" --format="value(keyString)" \
  | <k8s/auth : kubectl create secret generic gmaps-3dtiles-key --from-file=... -n <ns-app-preprod>>
```
🔍 **k8s secret ns app préprod**, injecté runtime UI, **jamais committé/imprimé, rotatable** ; préprod-first, prod = go séparé.

### J. TEST hard-cap (i-infra assert, AVANT de s'y fier)
```
gcloud pubsub topics publish billing-guardrail \
  --message='{"costAmount":51,"budgetAmount":50,"currencyCode":"EUR"}'
gcloud billing projects describe radar-3dtiles-preprod   # attendu : billingEnabled=false
# puis RÉ-ATTACHER pour restaurer :
gcloud billing projects link radar-3dtiles-preprod --billing-account=BILLING_ACCT_ID
```
🔍 prouve que la Function **coupe réellement** le billing à 100%.

## Source de la Cloud Function — `./cap-billing/`
`index.js` :
```js
const {google} = require('googleapis');
exports.capBilling = async (pubsubEvent) => {
  const data = JSON.parse(Buffer.from(pubsubEvent.data, 'base64').toString());
  if (!(data.costAmount >= data.budgetAmount)) return; // seuil non atteint → no-op
  const auth = await google.auth.getClient({
    scopes: ['https://www.googleapis.com/auth/cloud-billing'],
  });
  const billing = google.cloudbilling({version: 'v1', auth});
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  await billing.projects.updateBillingInfo({
    name: `projects/${projectId}`,
    requestBody: {billingAccountName: ''},   // détache = coupe TOUT appel facturable
  });
  console.log(`cap-billing: billing détaché de ${projectId} (spend ${data.costAmount}>=${data.budgetAmount})`);
};
```
`package.json` :
```json
{ "name": "cap-billing", "version": "1.0.0", "main": "index.js",
  "dependencies": { "googleapis": "^140.0.0" } }
```
Réactivation = **manuelle owner** (ré-attacher le billing) → un dépassement force une décision humaine.

## Frontière d'autorité (récap)
- **i-infra** : ce spec + co-val/assert config posée (sans imprimer la clé). Ne crée ni la clé ni ne touche le billing.
- **owner** : login + activer/lier billing (owner-direct).
- **auth/owner (i-cond drive gcloud, owner présent)** : projet/budget/Function/quota/clé.
- **k8s/auth** : stockage du secret (étape I).
