# Convergence des revues — plan (revue owner) 12-août

> Réconciliation conducteur des deux revues indépendantes (§10.3). On préserve les
> désaccords, on ne les lisse pas. Plan revu : `615007c`. Spec : `8b85003`.

## Verdicts

| Relecteur | Modèle | Verdict d'en-tête |
|---|---|---|
| Passe archi Immo (1re) | GPT-5.6 Sol xhigh | plan candidat `615007c` |
| Second review | GPT-5.6 Sol xhigh | **DIVERGE** |
| Architecte Immo | Opus | **CONVERGE-AVEC-RÉSERVES** |

Les en-têtes divergent, mais **les deux relecteurs convergent sur les mêmes blocages durs**. Le plan a une colonne vertébrale saine (NO-GO S00-avant-fusion, séparation preprod/prod, dissents préservés, refus du théâtre « CI green = prod ») **mais n'est PAS ratifiable en l'état** : plusieurs réserves touchent des invariants owner.

## Blocages durs — CONSENSUS des deux revues

1. **S00 incomplet.** Le gate proposé ne couvre que le CD k8s. Chemins d'écriture prod NON gatés confirmés par les deux : `deploy-gh-pages.yml` (auto push main), `run-job.yaml` et `k8s-apply-mcp.yaml` (dispatch sans approbateur), + images `:latest`/`imagePullPolicy: Always` (un pod CronJob peut tirer du code non autorisé sans aucun `kubectl`). **Aucun `environment: production` n'existe dans le repo** (seul `github-pages`). ⇒ §1 non satisfaite.

2. **Anti-invention violée DANS le plan lui-même.** `zone_ref_canon_v1` est **inventé** (grep : n'existe que dans le plan) ; `reglement_number` est inexact (réel = `reglement_numero`). Le plan re-dérive un contrat règlement déjà **figé** dans `SPEC_UI_REGLEMENTS_GEO_LIVE.md` (allowlist `REGLEMENT_KEYS`, jointure `code_zone`) ⇒ viole « immo ne re-extrait pas ». Signalé par les DEUX.

3. **Paradoxe « production-rendered » §11.** La spec exige une preuve rendue-en-prod (Sutton, drawer règlement) ; la sûreté interdit tout déploiement prod avant acceptation. Les deux : le gate doit être **preprod-rendered**, la preuve prod-rendered devenant un **post-check post-promotion** (G-P9). Décision owner requise.

4. **Inventaire CronJob refresh faux.** Réel : 4 CronJobs (3 suspendus + `radar-populate-geo-daily` **actif** sur `:latest`, 549 villes), pas « 2 suspendus / 1000+ villes ». F01/F02 ratent le seul cron actif et s'arrêtent à la preprod (aucune branche d'activation prod). Signalé par les deux.

5. **Preuves §11 majoritairement narratives / contournables** + **baseline périmé** (`origin/main` n'est plus `1710301`, checkout 162 commits derrière) + **§10.4/10.5 non assignés** (Track, PR du plan convergé). Signalé par les deux.

## Réserve spécifique architecte (Opus, non vue par Sol)

- **Vague collaboration = système parallèle interdit par §2.** C01–C04 sont écrits en greenfield et **ignorent le sous-système existant** `prospect_marks` (append-only, statut `ecarte` = archive §2.3), `prospect_notes` (annotations multi-auteurs §2.4), `prospect_contacts`/`prospect_contact_access_log` (PII auditée §11). Risque : créer exactement le « parallel comment system » interdit + collision de migration. Exiger un chemin de réconciliation `prospect_*` avant toute nouvelle migration collaborative.

## Désaccord à trancher entre relecteurs

- **« Fusionner S00 est-il lui-même un déploiement auto ? »** Sol (1re passe) l'affirme et en fait une condition owner. Le second review Sol **diverge** : pour un `push`, GitHub évalue le workflow présent dans le commit poussé, donc une S00 correctement auto-neutralisante peut empêcher son propre déploiement — il faut néanmoins drainer les runs en cours + autorisation owner. → à vérifier techniquement avant de cadrer S00.

## Dissents : les deux revues KILL le #7

Dissent #7 (« contrat règlement représentatif par signal » vs relation signal→zone→règlement) est un **faux dissent** selon les DEUX : la preuve municipale indirecte est explicitement interdite par la spec, une option non conforme ne doit pas être conservée comme choix équilibré. Nouveaux dissents ajoutés : Sol #11–#20, Opus D-A–D-E (frontière règlement Immo/Geo, réconciliation collaboration, ownership refresh geo, périmètre gate prod).

## Recommandation conducteur

Le plan n'est pas mûr pour la boucle H2A ni la négociation geo-cond. Séquence proposée :

1. **Corrections mécaniques** (pas des décisions owner — ce sont des erreurs à réparer) : élargir S00 aux 4 surfaces + `:latest` ; retirer `zone_ref_canon_v1`/`reglement_number` et lier D03/D06 à l'allowlist Geo figée ; corriger l'inventaire cron ; recalculer le baseline.
2. **Obtenir la validation archi Geo** (D06/D07, geo-cond) — toujours en attente.
3. **Arbitrage owner** sur les points structurels (voir décisions ci-dessous).
4. **Puis seulement** : plan convergé committé + PR (§10.5), Track des vagues (§10.4), négociation geo-cond, boucle H2A (§10.6).

### Décisions owner à prendre

- **A — Périmètre du gate prod** : gater les 4 surfaces (`environment: production` à approbateur) ou seulement le CD k8s ?
- **B — Collaboration §2** : migrer/réconcilier `prospect_*` vers le nouveau modèle, ou construire en parallèle et déprécier ?
- **C — Règlement §7** : lier Immo à l'allowlist Geo figée (geo = référentiel) — confirmer et supprimer toute re-dérivation Immo.
- **D — Preuve §11** : acter gate = preprod-rendered, prod-rendered = post-check post-promotion.
