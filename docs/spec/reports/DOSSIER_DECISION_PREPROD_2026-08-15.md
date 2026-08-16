# Dossier de décision — Sûreté de release & pré-production (§1)

> Spec : `SPEC_EVOL_PREPROD_RELEASE_SAFETY_2026-08-15.md`. Revue **Fable 5** = PRÊTE-AVEC-RÉSERVES
> (inventaire vérifié ligne à ligne, zéro invention). Décisions owner prises le 2026-08-15.

## 1. Contexte
Le déploiement production part **automatiquement** sur push `main` ; **12 charges** tournent sur
`:latest`/`Always` dont **`radar-populate-geo-daily`, un CronJob quotidien ACTIF hors kustomization**.
Le seul `environment:` du repo est `github-pages`. C'est le blocage NO-GO n°1 (§1 Steve).

## 2. Décisions owner ratifiées (2026-08-15)
- **Modèle d'approbation** : agents/CI **initient/poussent** ; l'**owner est l'unique approbateur**
  de `environment: production`. L'invariant « initiateur ≠ seul approbateur » vise les **agents**
  (jamais un agent n'approuve son propre déploiement), pas l'owner. **Prérequis** : vérifier hors
  repo que le plan/visibilité GitHub supporte les *required reviewers* (sinon gate de substitution :
  repo public, upgrade, ou artefact d'autorisation signé hors GitHub).
- **Politique de release pendant S00→S05** : **gel total + break-glass** tracé et borné. Aucun
  déploiement prod pendant la mise en place ; hotfix uniquement par procédure break-glass auditée.
- **CronJob 35b** : **suspendre maintenant** (avant S00). Règle de fond : aucune charge planifiée
  de prod sur `:latest` — pipeline data **figé, version maîtrisée CI/CD, image `:<sha>`**, réintégré
  au bundle kustomization. Action déléguée à i-infra (owner réveille i-infra pour l'exécuter).

## 3. Blocages externes (à lever avant S00, non vérifiables en lecture repo)
1. **Plan/visibilité GitHub** : disponibilité réelle des *required reviewers* sur environments
   (indice : le préflight Pages gère « unavailable for this repository plan »). Pilier n°1 du gate.
2. **Approbateur owner-unique** : résolu par la décision 1 (invariant reformulé : s'applique aux agents).

## 4. Reste ouvert (décisions O-series de la spec §9)
Namespace partagé vs isolé · digest OCI immuable vs tag · portée exacte du gate · sort de Pages ·
définition break-glass · rollback de schéma · périmètre backup (RPO/RTO) · gouvernance/anti-rejeu des
preuves (tant qu'ouvert, la non-falsifiabilité reste un objectif) · autorité d'acceptation preprod
(distincte de l'autorité d'autorisation prod).

## 5. Suite
- Vérification externe des 2 blocages (plan GitHub, scope secrets) — routée i-infra.
- Exécution 35b (suspend live) — i-infra au réveil.
- Séquence S00 (geler → autorité externe → drainer runs → fermer refs → épingler le live → merger →
  prouver → rouvrir) — après levée des blocages externes.

## 6. Décision cross-repo — PREPROD JOINTE SYNCHRONISÉE (owner 2026-08-15)
La preprod n'est PAS immo-seule : un **tier preprod cross-repo unique** (immo + geo + poc-k8s).
- **immo-preprod consomme geo-preprod** (données servies : zones, règlements, couches) — jamais geo-prod.
- **Promotion coordonnée** ; **un seul `PREPROD_ACCEPTANCE` cross-repo** prouvant le produit de bout en bout.
- Implique un design manquant : **geo n'a pas de preprod de serving** aujourd'hui → à concevoir (geo-cond) ;
  et la **topologie du tier joint** (namespaces, isolation, câblage immo-preprod↔geo-preprod, promotion
  coordonnée) → poc-k8s.
- **Suite** : co-design geo-cond + poc-k8s → spec de cadrage cross-repo → double revue → dossier de décision
  du modèle de sync détaillé (contrat de données preprod, ordre de promotion, acceptation conjointe).
  La spec preprod immo actuelle reste valide comme volet Radar de ce tier.

### 6.1 Cycle de récupération des données de prod (owner 2026-08-15)
La preprod doit rester FIDÈLE dans le temps : prévoir un **cycle récurrent, contrôlé et assaini** de
récupération des données de production vers la preprod (pas un one-shot).
- **Sources** : PG prod immo (signaux, lots, prospect_*, account_*) + serving prod geo (S3 normalized /
  graph projection / règlements / zones).
- **Assainissement OBLIGATOIRE (Loi 25)** : anonymiser/retirer la PII (prospect_contacts, access_log,
  identités) avant tout chargement en preprod ; « production-shaped » ≠ « données prod réelles ».
- **Sens unique STRICT** : lecture prod → écriture preprod uniquement ; **aucun** chemin d'écriture vers
  la prod depuis ce cycle (cohérent avec le gate S00).
- **Cadence + fraîcheur** : périodique (watermark de fraîcheur preprod), rejouable, idempotent.
- **Cross-repo synchronisé** : immo-preprod et geo-preprod rafraîchis de façon COHÉRENTE (même point de
  cohérence) pour que la jointure immo↔geo tienne en preprod.
- **Propriété** : extraction prod = infra/extraction (mon kubectl ne voit pas l'OVH prod → jamais
  self-extract) ; assainissement = contrat spec ; chargement preprod = poc-k8s. Réutiliser l'acquis
  recette/replay existant plutôt que réinventer.
- Nourrit directement les « fixtures production-shaped nettoyées » exigées par §5.2 (tests de migration).

### 6.2 Relevé cluster poc-k8s (2026-08-16, lecture seule OVH BHS)
Réf : `tmp/handoff/geo-immo-preprod/topologie-tier-joint-35b.md`.
- **Tier joint = NetworkPolicy** `allow-radar-api-to-geo` (ns geo) : `radar-api` → `geo-api` **TCP 8787**,
  sens **immo→geo**. geo n'appelle pas immo. C'est le point de jonction (pas une variable d'env).
- **35b CLOS** : `radar-immobilier` a **0 CronJob** sur le cluster vivant → `radar-populate-geo-daily`
  n'a **jamais été appliqué**. Risque de manifeste latent seulement (jamais en `:latest`, sinon `:sha` +
  kustomization). geo = 5 CronJobs `geo-pv-backlog-*` **tous suspendus**. Corrige la lecture « actif quotidien ».
- **Cycle de capture geo** = Jobs `geo-capture-*` créés **hors cluster** (pas de CronJob, run-stamp) →
  le cycle §6.1 se modélise comme un **déclencheur externe idempotent** (run-stamp = clé) écrivant dans un
  **bucket preprod assaini résident BHS**.
- **Preprod** : **aucun ns `geo-preprod` / `radar-immobilier-preprod`** n'existe (seul `sentropic-preprod`).
  Pose des ns **HELD** : gel design geo-archi + **GO owner** (aucune création sans gate) — poc-k8s pose en
  fenêtre au GO conducteur.
- **Loi 25 (3 signaux → critères d'acceptation du cycle assaini)** : (a) images registre fr-par (miroir BHS ?) ;
  (b) région du bucket `sentropic-geo` à confirmer → bucket résident BHS assaini ; (c) egress email TEM
  Scaleway → router vers `radar-maildev`, jamais la clé TEM prod en preprod.

## 7. Décisions owner ratifiées 2026-08-16 (double revue cross-repo complète : geo-archi + poc-k8s)
- **Création namespaces preprod (`geo-preprod` + `radar-immobilier-preprod`)** : **GO conditionné au gel design geo-archi** ;
  poc-k8s pose en fenêtre au GO conducteur (aucune création avant le gel).
- **Manifeste 35b `radar-populate-geo-daily`** (latent, jamais appliqué) : **épingler `:sha` + réintégrer kustomization**
  si le populate reste utile ; sinon bascule vers le cycle déclencheur-externe idempotent. Fin du piège dormant.
- **Modèle de sync RATIFIÉ** : tier joint = immo-preprod(`radar-api`) → geo-preprod(`geo-api` TCP 8787) ; cycle data =
  **déclencheur externe idempotent** (run-stamp) → **bucket BHS assaini** ; critères **Loi 25** (miroir registre fr-par,
  région bucket → BHS, egress email → `radar-maildev` jamais la clé TEM prod). **Spec de cadrage formelle cross-repo à
  produire au retour du gateway** (passe 5.6 Sol) — double revue déjà acquise (geo-archi + poc-k8s convergents).

## 8. CORRECTION owner 2026-08-16 — preprod = données PROD FULL, PAS d'assainissement + GO preprod minimal
- **Données preprod = SNAPSHOT PROD FULL, SANS assainissement** (owner). Raison : l'assainissement **casse le rejeu /
  la reproductibilité** — on ne peut pas rejouer un bug prod sur des données modifiées. **⇒ annule le « assainissement
  OBLIGATOIRE » de §6.1** (le cycle §6.1 charge la donnée prod telle quelle).
- **La PII reste RÉELLE** en preprod → l'isolation se fait au niveau **ENVIRONNEMENT, pas de la donnée** :
  - accès preprod **verrouillé comme la prod** (mêmes restrictions — la preprod contient de la vraie PII, Loi 25 gérée par
    le contrôle d'accès, pas par la mutation) ;
  - **aucun egress réel** : email → `radar-maildev` (jamais la clé TEM prod), pas de paiement/SMS/notif réels ;
  - **aucune écriture vers la prod** (sens unique) ; **secrets preprod distincts** de la prod.
- **GO PREPROD MINIMAL (conducteur → poc-k8s, 2026-08-16)** : poser un ns preprod isolé + DB + secrets + déployer les
  images `:sha` existantes, chargées d'un **snapshot prod FULL** (extraction = lane extraction, jamais self-extract OVH).
  On l'évolue vers le tier joint (immo↔geo-preprod) ensuite. Rework faible sur un ns.

### 8.1 Exécution (poc-k8s, GO owner DIRECT — 2026-08-16)
- **Gouvernance** : poc-k8s a **refusé mon GO relayé** (anti-blanchiment de permission : création ns/DB/secrets + réplication PII prod
  RÉELLE = décision data-protection exigeant le GO **direct** de l'owner). ✅ **Bonne posture.** L'owner a donné le **GO direct** dans la
  session poc-k8s (« preprod complet avec PII prod »).
- **En construction** : ns `radar-immobilier-preprod` + ResourceQuota + NetworkPolicies default-deny → **secrets DISTINCTS générés à neuf**
  (zéro copie prod, pas de clé TEM prod, SMTP→`radar-maildev`) → StatefulSets postgres/minio → Deployments api/ui/mcp/maildev/obscura sur
  `:a132d4a`. **Dry-run serveur avant chaque apply.**
- **Footprint** : snapshot ≈ **1.2 GB** (PG réel) ; +175m CPU / 566Mi req. **⚠️ Capacité tendue** : 2 nœuds, ~409m CPU libres → preprod tient
  mais laisse ~230m ; un burst/HPA exigerait un **3e nœud**. ResourceQuota (cap 1600m/2304Mi) pour ne jamais affamer la prod.
- **ETA** : env vide ~5 min ; complet avec données prod ~20–40 min, **gaté sur la livraison du snapshot par la lane extraction** (poc-k8s
  restaure, ne self-extract pas).
- **DÉPENDANCE OAuth** : sans client OAuth preprod dédié, le login preprod est **fail-closed** (PII inaccessible — acceptable au départ pour
  verrouiller la PII). À suivre : enregistrer un **client OAuth preprod dédié** (lane auth), **jamais réutiliser le client prod**.

### 8.2 Packet OAuth preprod (lane auth — 2026-08-16)
- **Ratifié** : client dédié, jamais le client prod (une compromission preprod ne doit pas fuiter la crédential prod ; ajouter des
  redirect URIs preprod au client prod couple la prod vers un host de moindre confiance). **Fail-closed = bon défaut**, à garder.
- **CORRECTION (bloquante)** : Traefik + forward-auth = client **CONFIDENTIEL serveur** → `token_endpoint_auth_method=client_secret_basic`
  avec un **vrai secret généré** (PAS public+PKCE `token_auth=none`, qui donnerait un client sans secret devant de la PII).
- **Enregistrement via le script qui SHIPPE dans l'image prod** (PR #497 mergée : `dist/scripts/oauth-register-client.js`, plus de SQL
  manuel) — `npm run oauth:register-client:dist` avec : `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_NAME="… (preprod)"`,
  `OAUTH_CLIENT_REDIRECT_URIS=<https absolu, le script refuse http/localhost>`, `OAUTH_CLIENT_SCOPES=openid,profile,email`,
  `OAUTH_CLIENT_TOKEN_AUTH=client_secret_basic`, `OAUTH_CLIENT_SECRET=<fort ; seul le sha256 est stocké, le clair jamais persisté>`.
  Upsert idempotent sur `client_id`. Pas de `OAUTH_CLIENT_RESOURCE_INDICATORS` (absent = default-deny RFC 8707). **Le clair du secret vit
  dans le Secret k8s de notre ns, JAMAIS en messagerie.**
- **auth NE PEUT PAS l'enregistrer seul** : `auth.sent-tech.ca` = IdP PROD → écrire un client = **écriture prod** ; auth n'a aucun credential
  cluster (refuse tout override KUBECONFIG) et une écriture IdP prod ouvrant l'accès à de la PII passe par **son conducteur** (pas pair-à-pair).
  auth remonte la demande dans sa lane (bon circuit, pas un refus).
- **3 INPUTS À FOURNIR (sinon packet non figeable)** : (1) **URL callback preprod exacte** (scheme+host+path) — de **poc-k8s** ; (2) **tenant**
  (`oauth_clients.tenant_id` défaut `'sentropic'` ; si immo = tenant distinct, la ligne doit le porter) — **owner/i-arch** ; (3) **`client_id`**
  (durable, atterrit dans la config Traefik) — **owner valide**. ETA packet relu < 1h après les 3 inputs ; exécution = accès poc-k8s + GO conducteur auth.
- **⚠️ VIGILANCE poc-k8s** : `K8S_NAMESPACE ?= sentropic` dans le Makefile = **PROD** ; `make k8s-bundle-secret` **réécrit le Secret `sentropic-api`
  EN ENTIER** depuis `.env` (toute clé absente → chaîne vide en PROD). Pour poser un secret dans le ns preprod : `kubectl patch --type=merge`
  ciblé, **namespace écrit en toutes lettres**, JAMAIS cette cible make.
- **INPUTS OWNER RÉSOLUS (2026-08-16)** : (2) **tenant = `sentropic`** — l'OAuth immo est **déjà sous `sentropic`** (client_id prod
  `radar-immobilier` @ IdP sentropic) ; j'avais mal présenté « immo tenant distinct » : c'est le **déploiement/DB** immo qui est séparé
  (i-arch), PAS le tenant IdP OAuth. Corrigé. (3) **`client_id = radar-immobilier-preprod`** (= client_id prod `radar-immobilier` +
  suffixe `-preprod`). **Reste (1)** : URL callback preprod exacte → **poc-k8s** (demandée).

### 8.3 Packet OAuth FIGÉ + garde SQL + 3 pièges déploiement (auth — 2026-08-16)
- **Packet (seule la callback manque)** : `OAUTH_CLIENT_ID=radar-immobilier-preprod` · `OAUTH_CLIENT_NAME="Radar Immobilier (preprod)"` ·
  `OAUTH_CLIENT_REDIRECT_URIS=<callback poc-k8s>` · `OAUTH_CLIENT_SCOPES=openid,profile,email` · `OAUTH_CLIENT_TOKEN_AUTH=client_secret_basic`
  · `OAUTH_CLIENT_SECRET=<généré cluster-side, cf piège 1>` · `npm run oauth:register-client:dist`. Ligne `id` = `client-radar-immobilier-preprod`
  (préfixe script) ; `tenant_id` non passé ⇒ défaut `sentropic` ; upsert idempotent sur `client_id`, rejouable.
- **Garde SQL à l'exécution** (auth ne voit pas le repo immo — prend ma vérif `radar-immobilier`@sentropic comme la mienne, à confirmer sur la vraie donnée) :
  `SELECT client_id, tenant_id, token_endpoint_auth_method FROM oauth_clients WHERE client_id='radar-immobilier';` → si `tenant_id='sentropic'`,
  confirmé ; si rien, **STOP avant d'écrire**.
- **PIÈGE 1 — secret généré 2× = `invalid_client`** : l'IdP ne stocke que le **sha256** ; générer la valeur **UNE fois** et l'utiliser **DEUX fois**
  (Secret k8s du ns preprod que le RP présente + `OAUTH_CLIENT_SECRET` à l'enregistrement). Ordre sûr : générer dans le pod → poser le Secret →
  enregistrer avec la même valeur → oublier le clair. `SECRET_ENCRYPTION_KEY` **n'intervient pas** (haché, pas chiffré).
- **PIÈGE 2 — callback protégée par sa propre protection = boucle infinie** : si le forward-auth Traefik couvre `/` sur tout le host, le chemin de
  callback (et `/oauth2/*` selon impl) doit être **EXCLU** de la règle. À cadrer avec poc-k8s en même temps que l'URL.
- **PIÈGE 3 — redirects multiples** : `OAUTH_CLIENT_REDIRECT_URIS` = liste séparée par virgules ; si la preprod expose plusieurs hosts (app + api),
  **tous** doivent y figurer ; le script refuse non-`https://` / `localhost` / `127.0.0.1` ; un redirect non listé → `redirect_uri_mismatch` au 1er login.
- **Exécution** : dès la callback, auth remplit + relit + remonte le packet à **son conducteur** pour le GO d'écriture IdP prod (accès PII). Pas sauté.

### 8.4 Callback URL livrée + résolution des 3 pièges (poc-k8s — 2026-08-16)
- **CALLBACK URL preprod** (https absolu, unique) : **`https://immo-preprod.sent-tech.ca/api/v1/auth/oauth/callback`**. Host unique UI+API
  (comme prod `immo.sent-tech.ca` → `immo-preprod.sent-tech.ca`), **un seul redirect**. poc-k8s a déjà patché `SENTROPIC_OAUTH_REDIRECT_URI`
  dans ses 2 configMaps preprod (radar-sentropic-auth + radar-api) + corrigé un reliquat pointant encore le host PROD. Il mettra
  `SENTROPIC_OAUTH_CLIENT_ID=radar-immobilier-preprod` quand le packet sera live.
- **Piège 1 (secret 1×/2×)** — poc-k8s applique MAIS refuse le chat pour le clair. **Question ouverte de canal d'appariement** : (a) poc-k8s
  écrit le secret dans son Secret k8s `radar-sentropic-auth/SENTROPIC_OAUTH_CLIENT_SECRET` et le script d'enregistrement auth **le lit
  in-cluster** (⚠️ exige un accès OVH à auth — or auth a dit n'avoir aucun credential cluster) ; (b) auth génère à l'enregistrement et **dépose
  le clair dans le ns preprod** via `kubectl create secret`/patch (namespace en toutes lettres). poc-k8s penche (a). → **à trancher entre auth + poc-k8s**
  (probable : poc-k8s, qui a l'accès cluster, EXÉCUTE le script avec le packet auth + le GO conducteur auth ; secret généré une fois côté cluster).
- **Piège 2** — poc-k8s n'a **pas encore d'ingress public preprod** (délibéré : PII en-cluster only tant que l'accès n'est pas verrouillé). À la
  pose de l'ingress+forward-auth (étape gatée DNS + client live), il exclura `/api/v1/auth/oauth/callback` (et `/oauth2/*`).
- **Piège 3** — un seul host preprod → une seule URL. Host api distinct éventuel → il listera tous, https only.
- **Geste sûr tenu** : tout via `kubectl -n radar-immobilier-preprod` explicite, jamais `make k8s-bundle-secret`. Login preprod fail-closed en
  attendant (PII verrouillée, pas urgent). Enregistrement IdP prod gaté sur le GO conducteur d'auth.

### 8.5 Runbook d'exécution OAuth (auth — 2026-08-16)
- **Montage = (c)** (ni (a) ni (b)) : **poc-k8s détient les DEUX accès et fait les DEUX écritures avec la MÊME valeur** — le Secret dans le ns
  `radar-immobilier-preprod`, la ligne `oauth_clients` depuis un pod du ns **sentropic** (c'est là que vit la base IdP). (a) est impossible même
  avec accès : un pod ne lit pas un Secret d'un autre namespace sans RBAC inexistant.
- **PRÉCONDITION BLOQUANTE à vérifier AVANT** : `npm run oauth:register-client:dist` n'existe que depuis **PR #497** (mergée aujourd'hui). Le repli
  tsx `oauth:register-client` ne marche pas en prod (tsx = devDep, `npm prune --omit=dev`). Vérif : **`kubectl -n sentropic exec <api-pod> -- ls dist/scripts/`**
  → si `oauth-register-client.js` présent = jouable ; sinon **repli SQL** (ne PAS redéployer la prod juste pour ça).
- **⚠️ PIÈGE HASH (coûte une soirée)** : le hash doit porter sur EXACTEMENT les octets que le RP présentera. Le script fait
  `sha256(secret.trim())`. Donc **`printf '%s' "$SECRET" | sha256sum`** (correct) — **JAMAIS `echo "$SECRET" | sha256sum`** (ajoute `\n` →
  hash différent → `invalid_client`, indiscernable d'un mauvais client_id). Le Secret k8s ne doit porter **aucun newline final**
  (`kubectl create secret --from-literal` n'en ajoute pas ; un heredoc mal fermé si). Clair haché = clair présenté, à l'octet près.
- **Repli SQL** (si image périmée) — client CONFIDENTIEL : `INSERT INTO oauth_clients (id='client-radar-immobilier-preprod',
  client_id='radar-immobilier-preprod', client_secret_hash='<sha256 hex du clair>', name='Radar Immobilier (preprod)',
  redirect_uris={https://immo-preprod.sent-tech.ca/api/v1/auth/oauth/callback}, allowed_scopes={openid,profile,email},
  grant_types={authorization_code}, response_types={code}, token_endpoint_auth_method='client_secret_basic', require_pkce=true,
  resource_indicators='{}') ON CONFLICT (client_id) DO UPDATE …` (tenant_id non passé ⇒ défaut sentropic).
- **GO** : auth remonte l'ensemble à **son conducteur** pour le GO d'écriture IdP prod ; auth ne l'accorde pas seul, ma validation ne le remplace
  pas. Fail-closed tient pendant ce temps (PII verrouillée) → rien d'urgent.
