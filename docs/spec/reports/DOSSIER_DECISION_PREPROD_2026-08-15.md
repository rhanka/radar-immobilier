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
