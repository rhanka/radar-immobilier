# Dossier de décision — PRA / bascule iso-prod : restore complet applicatif consistant prod→préprod (immo + geo, DB+S3), orchestré par immo

- **Date** : 2026-09-24 — **actualisé le 2026-09-26** (faits mesurés dans la nuit du 2026-09-25 au 2026-09-26)
- **Décideur** : owner (principal, tous tenants)
- **Orchestrateur / maître PRA** : i-cond (tenant immo)
- **Statut** : **RATIFIÉ (owner 2026-09-24)** — vague 1 : restore iso-prod **par tenant** démontré (immo + geo) ; restore **coordonné** immo+geo **non démontré** (reporté en vague 2) ; backup quotidien immo en place, backup quotidien geo mergé mais **non armé**.
- **Antécédents ratifiés** :
  - `DOSSIER_DECISION_PREPROD_2026-08-15.md` §6–§7 — « PREPROD JOINTE SYNCHRONISÉE » (tier cross-repo unique immo+geo, même point de cohérence).
  - `DRAFT_CIRCUIT_RB_PREPROD_PROD_2026-09-06.md` §4.2 — retour de données : extraction coordonnée PG/objets GEO, watermark par jambe, contrôles de jointure avant/après, re-capture si dérive. (Draft, mécanisme cohérent, à ratifier globalement.)
  - Mesure couplage geo↔immo (2026-09-24, ci-dessous).

---

## 0. Actualisation du 2026-09-26 — synthèse pour décision

Convention : **FAIT** = constaté, avec identifiant de run ou de PR ; **JUGEMENT** = appréciation d'i-cond.

1. **Démontré (FAIT)** : restore iso-prod prod→préprod de chaque tenant, séparément — immo (run `bascule-preprod.yml` 36215473088, de bout en bout, smoke OK) et geo (run 36198909160, PG + S3, opéré par geo-cond).
2. **Non démontré (FAIT)** : la restauration **coordonnée** immo+geo au même point de cohérence (e2e). Reportée en vague 2 (carte #769).
3. **Écart découvert (FAIT)** : il n'existait **aucun backup quotidien**, ni immo ni geo. La vague 1 avait livré une copie prod→préprod, pas des sauvegardes.
4. **Corrigé côté immo (FAIT)** : backup quotidien en place (PR #771 + correctif #772, mergées) — bucket dédié verrouillé 7 j, 3 identités séparées, contrôle de fraîcheur quotidien. Premier backup du 2026-09-26 : **SUCCÈS, statut `complete`** (dump PG 270 MB intègre, 59 017 docs = la source, verrou 7 j) — détail §8.4.
5. **geo (FAIT)** : même dispositif mergé (rhanka/geo#402), bucket provisionné ; **non armé** tant que 3 SealedSecrets geo ne sont pas committés (décision owner).
6. **Décision owner appliquée** : « un restore c'est un restore » — le refresh sort de la bascule (PR #767 prête, non mergée) et devient un CronJob séparé, démontré après restore (run 36218358113 : 528/528 villes, 0 erreur).
7. **Attendu de l'owner** : 5 décisions, listées au §0.2.

### 0.1 Tableau récapitulatif

| # | Élément | État au 2026-09-26 | Preuve (FAIT) | Remarque |
|---|---|---|---|---|
| 1 | immo — restore PG | **Démontré** | run 36215473088 : dump prod → restore préprod → migration | — |
| 2 | immo — restore S3 (docs) | **Démontré** | même run : copie des docs, recon `dest ⊇ src` | — |
| 3 | immo — PG + S3 ensemble | **Démontré** | même run : flip de service + smoke `db.ok` + `objectStore.ok` | restore d'un seul tenant |
| 4 | geo — PG | **Démontré** | run geo 36198909160 (opéré par geo-cond) | contrat §5 : PG geo = archive DR re-dérivable |
| 5 | geo — S3 | **Démontré** | même run | — |
| 6 | geo — PG + S3 ensemble | **Démontré** | même run | restore d'un seul tenant |
| 7 | e2e immo + geo coordonné (même point de cohérence) | **Non démontré** | aucun run | vague 2 (#769) : orchestrateur #764 (draft, en conflit), PAT cross-repo, endpoint des références servies (O1) |
| 8 | Refresh PV + signaux après restore | **Démontré** (hors bascule) | run `bascule-refresh.yml` 36218358113 (CronJob `radar-refresh-pv`) : 528/528 villes, sortie 0, 0 erreur | 37 villes en échec, cause lisible en base seulement |
| 9 | Backup quotidien immo | ✅ **En place, 1er backup `complete`** | PR #771 + #772 + #773 mergées ; `BACKUP_DAILY_CD_ENABLED` armée ; Job `radar-backup-manual-20260926065729` (08:21Z, sortie 0, sha256 relu OK, 59 017 docs) | contrôle de fraîcheur 06:53 UTC ; canal d'alerte à choisir |
| 10 | Backup quotidien geo | **Mergé + bucket provisionné ; non armé** | rhanka/geo#402 mergée ; bucket `geo-backup` ; RBAC du CD appliqué | attend le commit des 3 SealedSecrets geo |

### 0.2 Décisions en attente de l'owner

| Décision | Contexte (FAIT) | Effet tant que non tranchée |
|---|---|---|
| Commit des 3 SealedSecrets geo | commit bloqué par un classifieur de permissions | FAIT : geo reste sans backup quotidien |
| Canal d'alerte du contrôle de fraîcheur | `radar-backup-freshness` échoue si le backup est trop ancien (§8.4) | JUGEMENT : un échec n'est visible qu'en consultant le cluster |
| Merge #765 | correctif d'injection dans les workflows GitHub Actions (entrées utilisateur interpolées dans des blocs shell) ; PR en draft | JUGEMENT : l'exposition corrigée par #765 reste ouverte |
| Merge #767 | retrait de tout refresh de la bascule (étape S6 + job force-refresh) ; PR prête, en pause | FAIT : la bascule sur `main` contient encore S6 |
| Suppression du bucket orphelin `radar-immobilier-p3-backup` | bucket vide, sans usage | FAIT : aucun effet sur les données (ménage) |

### 0.3 Sections mises à jour

§4 (note d'état), §5 (note d'état), §6 (tableau), §7 (application au backup quotidien), §8 (réécrit : vague 1, refresh, backups quotidiens, vagues 2 et 3), §9 (nouveaux risques), Suites immédiates. §1 à §3 : inchangés.

---

## 1. Décision demandée

Fixer le périmètre et le mécanisme de la bascule « iso-prod » prod→préprod quant à **geo** : que doit couvrir « sauvegarder / restaurer geo », qui orchestre, et quelle garantie de synchronisation immo↔geo.

## 2. Décision owner (verbatim + interprétation)

> « dans la premiere vague, on veut un restore complete applicatif. donc tout le tenant geo doit être restoré de prod a preprod avec les migration db+s3 aussi. les deux tenant sont sur le meme k8s et cette consistance est amenée a persister pour le DR complet mais il n'est pas dûr pour l'étape 1. »
>
> « les backup restore doivent être quand meme sync entre immo et geo, db+s3. si ce n'est pas un PRA complet il faut pouvoir restorer l'ensemble des app de facon consistance si demandé »

**Interprétation retenue :**
1. **Étape 1 = restore complet applicatif consistant prod→préprod pour LES DEUX tenants** (immo **et** geo), incluant **DB + S3** de chacun et **les migrations post-restore** (SQL **et** S3).
2. **immo orchestre les deux jambes** (immo + geo) au **même point de cohérence** → restore synchronisé.
3. **La consistance immo↔geo (DB+S3) est DURE en étape 1** : à tout instant on doit pouvoir restaurer **l'ensemble des applications de façon consistante** si demandé.
4. **Le PRA prod complet** (restaurer la PROD depuis un backup) est la **direction** (les deux tenants sur le même k8s, la consistance est faite pour persister vers ce DR) **mais n'est PAS un requis dur de l'étape 1**.

## 3. Contexte mesuré (faits, 2026-09-24)

Mesure code (worktree `lane/conductor`) — références vérifiées :

- **Postgres immo** : un seul StatefulSet `radar-postgres` (ns `radar-immobilier`, image `postgis`, base `radar`). Les tables geo **dérivées** qu'immo référence (`zone_versions`, `lot_versions`, `geo_resolutions`, `geo_unresolved`) vivent **dans** `radar-postgres` (`api/drizzle/0007_geo_mapper.sql`, `api/src/db/schema.ts:134-191`) → **le dump immo capture déjà le geo dérivé qu'immo utilise.**
- **Couplage** : sens **immo→geo** uniquement. Un hard-FK **intra-base** `prospect_marks.lot_version_id → lot_versions.id (restrict)` (`api/src/db/schema.ts:425-427`). Jointures cross-système par **`canonical_id` texte déterministe** (`ogc:lots:<ville>:<no_lot_norm>`, `ogc:zones:<ville>:<code_norm>`). geo→immo : aucune référence.
- **Sémantique geo** : **append-only / upsert, id déterministe, zéro DELETE** vérifié (`api/src/services/geo/ogc-pull.ts`, `resolve-refs.ts`). → cohérence par **sur-ensemble** (geo ≥ point de cohérence), pas par snapshot atomique.
- **Système geo externe** : `geo-quebec` / `api.geo.sent-tech.ca`, **ns `geo` sur le MÊME cluster k8s** (service `geo-api`). L'application immo n'y accède qu'en **HTTP OGC** ; mais l'être-sur-le-même-cluster rend le **Postgres + S3 propres de geo joignables in-cluster par un job orchestré** (avec creds/RBAC geo).
- **Préprod** : ns immo `radar-immobilier-preprod` ; le rendu geo live repointe `/api/geo/collections` vers `geo-preprod` (owné par geo). geo dispose d'une primitive de miroir préprod (`packages/geo/src/preprod/mirror.ts`, `planFullMirror`).
- **Atomicité** : `DRAFT_CIRCUIT §4.2` acte que **l'atomicité PG+S3 distribuée n'est pas atteignable** → la garantie livrable est la **cohérence prouvée**, pas le snapshot distribué.

## 4. Périmètre

### 4.1 DUR en étape 1
- **Jambe immo** : dump prod (Postgres `radar` + S3 docs) → restore préprod (`--clean`, wipe) → **migrations post-restore SQL + S3**.
- **Jambe geo** : dump prod du **Postgres propre de geo + S3 propre de geo** → restore geo-préprod → **migrations post-restore DB + S3** (tout le tenant geo restauré prod→préprod).
- **Synchronisation immo↔geo** : les deux jambes capturées/restaurées au **même point de cohérence** (`coherence_id` + watermark par jambe) ; **contrôle de jointure immo↔geo fail-closed** ; **re-capture si dérive** sous fenêtre coordonnée.
- **Orchestration** : **immo (i-cond) déclenche les deux jambes** ; geo fournit la primitive in-cluster + creds.
- **Capacité « restore-tous-apps-consistant à la demande »** : un déclenchement unique restaure les deux tenants à un état consistant.

> **État au 2026-09-26** — FAIT : jambes immo et geo démontrées **séparément** (§8.1). La synchronisation immo↔geo et le déclenchement unique ne sont **pas démontrés** ; ils sont portés par la vague 2 (carte #769). FAIT : c'est un écart par rapport au §2 point 3, qui voulait cette consistance dure dès l'étape 1.

### 4.2 Direction (NON dur en étape 1)
- **PRA prod complet** : restaurer la **PROD** depuis un backup (pas seulement prod→préprod). Même mécanisme de consistance, persisté. À armer en étape ultérieure.

> **État au 2026-09-26** — FAIT : jusqu'au 2026-09-26, aucun backup quotidien n'existait (§8.4) ; un PRA prod depuis un backup n'était donc pas possible. Le backup quotidien immo est désormais en place, celui de geo en attente d'armement.

## 5. Mécanisme de synchronisation (garantie livrable) — raffiné avec geo-cond 2026-09-24

Pas de snapshot distribué atomique (acté impossible). Garantie = **cohérence prouvée**. Raffinement clé (expertise geo-cond) : **la cohérence est assurée par l'ORDRE, pas par un gel des deux tenants** — le S3 geo est append-only content-addressed (cohérent sans gel).

1. **Quiesce = PG IMMO UNIQUEMENT** (primitive PR #753). **Aucun quiesce des writers geo** : les objets geo sont immuables/append-only (CAS), cohérents sans gel ; seules de nouvelles clés apparaissent.
2. **`CYCLE_ID` (=coherence_id) généré par immo à T0** (ouverture fenêtre quiesce), injecté par env dans la jambe geo.
3. **Ordre garant de cohérence** : dump immo (T0) **PUIS** capture geo **≥ T0** (append-only ⇒ geo est un sur-ensemble de ce qu'immo référence) → pas de skew d'intégrité.
4. **Reçu / manifestes** (bucket `radar-immobilier-backups-preprod`, `sets/<CYCLE_ID>/`) : `cycle.json` (tête immo : cycleId, snapshotAt, confirm, status open|captured|restored|verified) + `immo.json` + `geo.json` (1 objet/tenant, écritures disjointes). `geo.json` distingue **servi** (`normalized/`, preuve = verify-through-API) et **irremplaçable** (`raw/cas`+captures, preuve = réconciliation sha256).
5. **Restore** : restore immo complet (PG+S3, migrations) → restore geo **S3-only** vers geo-préprod (le PG geo n'est PAS restauré en préprod ; `geo.dump` = archive DR re-dérivable).
6. **Join-verify avant flip, fail-closed** : tout `canonical_id`/`lot_version_id` référencé par immo doit résoudre dans le **servi geo-préprod** au CYCLE_ID (diff ensembliste `immo_refs ⊆ served`, surface = `served-canonical-ids.json` du cycle, à confirmer geo-cond). ≥1 pendant = die.
7. **Redo-on-drift** : dérive prod pendant la capture (watermark pré/post immo) ⇒ re-capturer ou reprendre.

> **État au 2026-09-26** — FAIT : ce mécanisme n'a pas encore été exécuté de bout en bout. Seule la brique quiesce (#753) est mergée (2026-09-25). `CYCLE_ID`, join-verify et redo-on-drift relèvent de l'orchestrateur #764 (draft, en conflit) → vague 2.

## 6. Architecture d'exécution

Répartition ratifiée : **geo authore sa jambe en autonomie** (geo-cond), immo authore le top-level.

| Jambe | Propriétaire | Contenu |
|---|---|---|
| immo DB | immo (existant) | dump/restore/migrate (`deploy/ci/bascule-preprod/`) ; hook migration S3 post-restore = #751 (ticket ouvert au 2026-09-26) |
| immo S3 | immo (existant) | copy server-side + recon |
| **geo S3 (servi + irremplaçable)** | **geo-cond (autonome)** | entrypoint committé backup→reconcile→restore-verify ; **CAS dédupliqué** `geo-objects/cas/<sha256>` + `inventory.json`/cycle ; restore préprod **S3-only** ; preuve servi=verify-through-API, irremplaçable=sha256 |
| **geo PG** | **geo-cond** | `geo.dump` = **archive DR re-dérivable, NON restauré préprod** (préprod geo = S3-only) |
| **Top-level / coordination** | **immo (à construire — orchestrateur #764, draft en conflit ; vague 2)** | `CYCLE_ID`/`cycle.json` ; quiesce **PG immo seul** (#753) ; **dispatch de la jambe geo** (CYCLE_ID en env) ; **join-verify fail-closed** ; redo-on-drift ; ~~refresh index~~ retiré de la bascule (décision « un restore c'est un restore », §8.2) |
| Refresh PV + signaux | immo | CronJob `radar-refresh-pv`, **hors bascule**, déclenchable à la main via `bascule-refresh.yml` (§8.3) |
| Backup quotidien immo | immo | CronJobs `radar-backup-daily` + `radar-backup-freshness` (`deploy/ci/backup/`), bucket `radar-immobilier-backup` (§8.4) |
| Backup quotidien geo | geo-cond | rhanka/geo#402, bucket `geo-backup` ; non armé (§8.4) |

## 7. Gouvernance — pattern d'AUTONOMIE (directive owner 2026-09-24)

**Correction vs une 1re rédaction** : le « GO owner-direct par acte » est **remplacé** par le pattern d'autonomie (règle CLAUDE.md « périmètre backups », confirmé par l'owner via geo-cond) :

- **Tenant-opéré, pas k8s** : le backup/restore DB+bucket est opéré par les tenants (immo/geo) ; k8s = gouvernance transverse seulement.
- **Creds via CYCLE de rotation documenté → `.env`** : le mint (prod-RO, backup, préprod) est gouverné entre k8s/immo/geo avec **rotation explicite**, **stocké `.env` + DOCUMENTÉ** (immo : `CRED_CYCLE.md` ; geo : `GEO_CRED_CYCLE.md` créé par geo-cond) → un opérateur (immo/geo/owner/IA) **vérifie la reprise en tout temps, SANS GO acte-par-acte**. Les jobs lisent leurs creds du `.env`/secret, pas d'injection k8s par-run ni d'attente owner point-par-point.
- **geo-cond dédié + autonome** (directive owner) : authore sa moitié en autonomie, PR dédiée → merge, garde max-2-PR.
- **Séparation transverse** : le mint reste gouverné entre i-cond et geo-cond (et k8s pour la gouvernance) ; l'autonomie porte sur l'EXÉCUTION, pas sur l'invention de nouveaux droits.
- **Application au backup quotidien (2026-09-26, FAIT)** : 3 identités immo séparées (writer, purger, reader) en SealedSecrets, rotation 90 j documentée dans `deploy/ci/bascule-preprod/CRED_CYCLE.md` ; RBAC du CD ré-appliqué par k8s. Côté geo, le commit des 3 SealedSecrets attend une décision owner (§0.2).

## 8. Plan d'exécution (vagues) & état — actualisé 2026-09-26

### 8.1 Vague 1 — restore iso-prod par tenant : DÉMONTRÉ

- **immo (FAIT)** — run `bascule-preprod.yml` **36215473088** (2026-09-26 ~03:39Z), succès de bout en bout : dump prod → restore préprod → migration → copie des docs → recon `dest ⊇ src` → flip de service → smoke (`db.ok` + `objectStore.ok`).
- **geo (FAIT)** — run geo **36198909160**, opéré par geo-cond : succès PG + S3.
- **Lots prévus au 2026-09-24 — état (FAIT)** :
  - Lot A (immo) : PR #753 (quiesce tolérant) **mergée le 2026-09-25** ; hook de migration S3 post-restore = ticket #751, **ouvert**.
  - Lot B (geo) : jambe geo livrée et exécutée par geo-cond (run ci-dessus).
  - Lot C (sync : `CYCLE_ID`, join-verify fail-closed, redo-on-drift, dispatch des 2 jambes) : **non livré** → vague 2.
- **JUGEMENT** : la vague 1 prouve que chaque tenant sait se restaurer iso-prod en préprod. Elle ne prouve ni la cohérence croisée immo↔geo, ni la restauration depuis une sauvegarde datée (il n'en existait pas, §8.4).

### 8.2 Décision owner « un restore c'est un restore »

- Plus aucun refresh dans la bascule. L'étape S6 et le job force-refresh sont retirés par la **PR #767** (prête, non mergée, en pause ; merge = décision owner, §0.2).
- Le refresh devient un **CronJob séparé** (`radar-refresh-pv`), déclenchable à la main via `bascule-refresh.yml`.

### 8.3 Refresh PV + signaux après restore — démontré (FAIT, run 36218358113)

Déclenché manuellement via `bascule-refresh.yml` sur le CronJob `radar-refresh-pv`, après le restore immo.

- **Couverture** : 528/528 villes en 1 h 55 min 53 s ; sortie 0 ; 0 erreur.
- **Résultat par ville** : 155 publiées, 293 à jour, 38 sans entrée, 37 en échec, 5 sans baseline.
- **Signaux** : 308 levés, dont 6 nouveaux matérialisés (le reste existait déjà dans la base restaurée).
- **LLM** : primaire astra en échec (106 transport, 87 quota, 24 circuit ouvert) → bascule sur gemini-3.8-flash.
- **Documents** : 9 mis de côté (3 échecs ; plus retentés automatiquement).
- **Limite** : la cause exacte d'un échec n'apparaît pas dans les logs ; elle n'est qu'en base (`refresh_document_outcomes.reason`).

### 8.4 Backups quotidiens — écart découvert et correction

**Écart (FAIT)** : il n'existait **aucun backup quotidien**, ni immo ni geo.
- Les CronJobs de dump étaient suspendus par design : ce n'étaient que des déclencheurs de la bascule.
- Les crons GitHub ne se déclenchaient quasiment jamais : 1 seul run planifié de la bascule immo dans l'historique (en échec) ; 0 côté geo.
- La vague 1 avait donc livré une copie prod→préprod, pas des backups.

**Correction immo (FAIT)** — PR #771 + correctif #772, mergées le 2026-09-26 ; RBAC du CD ré-appliqué par k8s ; variable `BACKUP_DAILY_CD_ENABLED` armée. Manifestes : `deploy/ci/backup/`.

| Composant | Contenu |
|---|---|
| Bucket `radar-immobilier-backup` (OVH BHS) | versioning ; object-lock gouvernance 7 j ; lifecycle : versions non courantes 7 j sur `pg/`, `manifests/`, `docs-inventory/`, 190 j sur `docs/` ; propriétaire sans clé |
| 3 identités séparées (SealedSecrets, rotation 90 j dans `CRED_CYCLE.md`) | **writer** sans aucun droit de suppression ; **purger** limité par préfixe aux dossiers datés (delete-marker seulement, sans lecture) ; **reader** de restauration |
| CronJob `radar-backup-daily` (02:23 UTC) | `pg_dump` avec contrôles (`pg_restore --list`, sha256 relu, taille minimale, globals) ; copie incrémentale côté serveur des docs + inventaire du jour ; manifeste daté + `latest.json` / `latestComplete` ; purge de rétention dans une étape séparée ; garde source (refus si 0 objet ou < 50 % du précédent) ; rétention : quotidien 7 j, hebdo 4 semaines, mensuel 6 mois |
| CronJob `radar-backup-freshness` (06:53 UTC) | échoue si aucun backup de moins de J−1, ou si aucun backup complet depuis plus de 3 jours |

- Premier backup lancé le **2026-09-26 à 06:57Z** (Job `radar-backup-manual-20260926065729`).
- **Résultat du premier backup (FAIT, vérifié en lecture par l'identité reader) : SUCCÈS, statut `complete`**, Job terminé à 08:21:41Z (1 h 24), les 3 conteneurs en sortie 0 :
  - PG : `pg/2026-09-26/radar.dump` 270,0 MB, 189 entrées (`pg_restore --list`), globals présents ; SHA-256 recalculé en relisant l'objet = valeur du `.sha256` → intègre ; 11 migrations de schéma ; code prod `a4a2c00` ;
  - verrou object-lock GOVERNANCE sur la version du jour, conservée jusqu'au 2026-10-03T06:58:49Z ;
  - docs : 59 017 objets / 12,53 GB copiés = les 59 017 objets de la source ; inventaire `docs-inventory/2026-09-26.json` (18,7 MB) ;
  - manifeste `manifests/2026-09-26.json` + `manifests/latest.json` (`status: complete`, `latestComplete` = 2026-09-26) ;
  - purge : OK, rien à purger (premier jour).
  - Correctif CD associé : #773 (plus de ré-application du bundle en parallèle d'un lancement manuel ; request CPU explicite du Job de provisionnement du rôle RO), après un conflit de CPU observé pendant ce premier lancement, sans impact sur le rôle ni sur le dump.
  - Prochain passage automatique : chaque nuit à 02:23 UTC. Reste à faire (vague 2) : test de restauration automatique depuis ce backup.

**Défauts attrapés en route (FAIT)** :
- un CronJob refusé par l'API Kubernetes (`podFailurePolicy` sans `status`) → corrigé par #772 ;
- une faille de conception relevée en relecture croisée par geo-cond : le writer pouvait poser des delete-markers et donc effacer l'historique → corrigée **avant armement** (writer sans suppression + identité purger séparée).

**geo (FAIT)** : même dispositif ; PR rhanka/geo#402 mergée (relue par geo-cond) ; bucket `geo-backup` provisionné (~119 GB / 116 584 objets en source ; amorce étalée sur plusieurs nuits ; archive figée de 49 GB traitée à part) ; RBAC du CD appliqué. **Armement en attente** du commit des 3 SealedSecrets geo (bloqué par un classifieur de permissions ; décision owner, §0.2).

**JUGEMENT** : le premier backup est constaté complet et intègre ; le dispositif immo sera pleinement « prouvé » après un premier passage vert du contrôle de fraîcheur et une première restauration réussie. Aucune restauration depuis `radar-immobilier-backup` n'est encore démontrée (portée par la vague 2).

### 8.5 Vague 2 — carte #769 (ouverte)

- **e2e immo+geo coordonné**. Prérequis identifiés (FAIT) : orchestrateur #764 (draft, en conflit) ; PAT cross-repo (décision owner : option A ; durcissement geo fait : rhanka/geo#400, #401) ; endpoint des références servies côté immo (O1).
- **Mode snapshot coordonné instantané** : étude `docs/spec/reports/STUDY_COORDINATED_INSTANT_SNAPSHOT_RPO_RTO.md` — faisable avec caveats ; point dur = support CSI VolumeSnapshot.
- **Refonte de la bascule en MODE** `backup` / `restore` / `list`, avec restore depuis un backup choisi.
- **Secret éphémère** monté par la bascule.
- **Verrou par palier** (PutObjectRetention, supporté par OVH).
- **Test de restauration automatique**.
- **Canal d'alerte** du contrôle de fraîcheur.

### 8.6 Vague 3 — carte #770 (ouverte)

- **k8s complet** : isolation des tenants par les droits (identités séparées, RBAC, VAP, élévation JIT, audit) ; autorité de déclenchement in-cluster.

**JUGEMENT** : le PRA prod complet (§4.2) reste la direction ; les briques des vagues 2 et 3 (backups datés, restore depuis un backup choisi, test de restauration, isolation des droits) en sont les prérequis. Aucune échéance n'est fixée dans ce dossier.

## 9. Risques / limites explicites

- **Pas d'atomicité distribuée** : la garantie est la cohérence prouvée (watermark + join-verify + redo), pas un snapshot instantané des 4 stores.
- **Skew de fraîcheur** borné par la fenêtre coordonnée + le contrôle de jointure ; append-only geo ⇒ pas de risque d'intégrité référentielle si geo ≥ point de cohérence.
- **Dépendance geo-cond** : la jambe geo est authored par geo-cond en autonomie (creds via cycle `.env` documenté, pas de GO acte-par-acte). Non bloquant tant que les 2 côtés respectent le contrat ratifié.
- **RISQUE DE COHÉRENCE LATENT (mesuré 2026-09-25) — normalisation canonical_id divergente** : immo calcule `code_norm`/`no_lot_norm` avec des fonctions LOCALES (`normalizeZoneCode` `api/src/services/geo/zones.ts:119`, `normalizeNoLot` `ogc-pull.ts:255`) ≠ les canonicalizers `@sentropic/geo` (`canonicalizeZoneCodeForJoin`, testé C408→C-408/22A→A-22) qui définissent la clé de jointure SERVIE par geo. ⇒ **la jointure immo↔geo n'était PAS byte-garantie**. Mesure fine (2026-09-25) : **LOTS quasi-identiques** (`normalizeNoLot` ogc-pull.ts:120-122 = `replace(/\s+/g,"")` ≈ `canonicalizeNoLotForJoin` = `replace(/ /g,"")` ; seule nuance `\s+` vs espace littéral, cadastre-safe) ; **ZONES = vraie divergence** (`normalizeZoneCode` ≠ `canonicalizeZoneCodeForJoin`, ex. A1336 vs A-22) ; **registre municipalités = BYTE-IDENTIQUE vérifié** (sha256 `1c12c9ab…`, 1106 slugs, `comm` vide, 2026-09-25) → aucune divergence city_slug ; **lots alignés** (geo `canonicalizeNoLotForJoin` figé sur `/\s+/`, commit 4d8dbb7 = prouvé identique à `normalizeNoLot`). ⇒ **la seule divergence résiduelle = les ZONES** (`normalizeZoneCode`) pour le lot de suivi. Traitement à 2 niveaux : (a) BASCULE — le join-verify re-canonicalise les refs immo depuis le BRUT via les MÊMES fonctions `@sentropic/geo` → byte-identique par construction, **sans migration prod** ; (b) MIGRATION DE SUIVI (lot séparé, hors bascule) — remplacer les normaliseurs locaux immo à l'écriture par `@sentropic/geo` + re-normaliser les `code_norm`/`no_lot_norm`/`canonical_id` stockés. À trancher owner.
- **Python** : les jobs geo doivent respecter « 0 python » (pg_dump/pg_restore + binaires natifs + Node/TS ; pas de script ni image Python).
- **Consistance immo↔geo non prouvée (2026-09-26)** : FAIT — les deux tenants ont été restaurés par deux runs indépendants, sans `CYCLE_ID` commun ni join-verify. JUGEMENT : la préprod actuelle n'est pas garantie cohérente immo↔geo au sens du §5.
- **geo sans backup quotidien** : FAIT — tant que les 3 SealedSecrets geo ne sont pas committés, le CronJob geo n'est pas armé.
- **Backup immo non éprouvé en restauration** : FAIT — aucune restauration depuis `radar-immobilier-backup` n'a été exécutée ; le test de restauration automatique est en vague 2.
- **Contrôle de fraîcheur sans canal d'alerte** : FAIT — le canal n'est pas choisi. JUGEMENT : un backup manquant n'est détecté que par une consultation active du cluster.
- **Refresh** : FAIT — 37 villes en échec dont la cause n'est lisible qu'en base (`refresh_document_outcomes.reason`) ; primaire LLM astra en échec pendant tout le run (repli sur gemini-3.8-flash).
- **Correctif #765 non mergé** : JUGEMENT — l'exposition à l'injection dans les workflows GitHub Actions corrigée par #765 reste ouverte tant que la PR n'est pas mergée.
- **Bucket orphelin** `radar-immobilier-p3-backup` : FAIT — vide ; suppression sur décision owner.

---

### Suites immédiates (actualisées 2026-09-26)
1. Constater le premier passage de `radar-backup-freshness` (06:53 UTC) et le premier backup planifié (02:23 UTC) ; le premier backup manuel est fait et vérifié (§8.4).
2. Obtenir les 5 décisions owner (§0.2).
3. Armer le backup geo dès le commit des 3 SealedSecrets geo (geo-cond).
4. Vague 2 (#769) : résoudre le conflit de #764, livrer l'endpoint des références servies (O1), puis exécuter un premier e2e coordonné immo+geo.

### Suites du 2026-09-24 — état au 2026-09-26
1. Merge PR #753 (quiesce, brique de sync) → **fait** (2026-09-25).
2. Coordination geo-cond (primitive/creds geo, in-cluster) → **faite** ; le « GO owner-direct session geo » est remplacé par le pattern d'autonomie (§7).
3. Jobs geo (dump/restore/migrate PG+S3) → **livrés** par geo-cond (run 36198909160).
4. Contrôle de jointure fail-closed + `coherence_id` partagé + redo-on-drift → **non livré** ; vague 2 (#769, orchestrateur #764).
