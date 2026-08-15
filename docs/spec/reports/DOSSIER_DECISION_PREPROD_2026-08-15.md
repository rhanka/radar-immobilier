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
