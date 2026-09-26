# Dossier de décision — PRA / bascule iso-prod : restore complet applicatif consistant prod→préprod (immo + geo, DB+S3), orchestré par immo

- **Date** : 2026-09-24 — **actualisé le 2026-09-26** (faits mesurés le 2026-09-26)
- **Décideur** : owner (principal, tous tenants)
- **Orchestrateur / maître PRA** : i-cond (tenant immo)
- **Statut** : **RATIFIÉ (owner 2026-09-24)** — backups quotidiens immo et geo en place (un premier backup `complete` chacun ; premiers runs nocturnes à vérifier) ; restore immo + geo **depuis les backups d'une date commune** démontré (D = 2026-09-26 ; côté geo : docs seulement, restore PG geo à venir) ; join-verify vert en **contrôle de fidélité** ; restore planifié prod→préprod **gelé** (décision owner).
- **Antécédents ratifiés** :
  - `DOSSIER_DECISION_PREPROD_2026-08-15.md` §6–§7 — « PREPROD JOINTE SYNCHRONISÉE » (tier cross-repo unique immo+geo, même point de cohérence).
  - `DRAFT_CIRCUIT_RB_PREPROD_PROD_2026-09-06.md` §4.2 — retour de données : extraction coordonnée PG/objets GEO, watermark par jambe, contrôles de jointure avant/après, re-capture si dérive. (Draft, mécanisme cohérent, à ratifier globalement.)
  - Mesure couplage geo↔immo (2026-09-24, ci-dessous).

---

## 0. Actualisation du 2026-09-26 — synthèse pour décision

Convention : **FAIT** = constaté, avec identifiant de run ou de PR ; **JUGEMENT** = appréciation d'i-cond.

1. **Backups quotidiens immo et geo en place (FAIT)**. Chaque tenant a un premier backup `complete` daté du 2026-09-26, dans un bucket dédié verrouillé 7 j (jusqu'au 2026-10-03) :
   - immo (`radar-backup-daily`, 02:23 UTC) : dump PG de 270 Mo (sha256 relu), 59 017 docs (12,53 Go) ;
   - geo (`geo-backup-daily`, 03:23 UTC) : dump PG de 19,4 Mo (sha256 intact), 70 440 objets docs (62,04 Go), 46 144 exclus ;
   - premiers runs nocturnes : cette nuit, à vérifier.
2. **Restore immo + geo depuis les backups démontré (FAIT)**. Run `bascule-e2e` 36255243747 (2026-09-26, 16:22–16:44Z), date de backup D = 2026-09-26 :
   - jambe immo verte (run 36255315042 : PG + docs, migrate, remise en service) ;
   - jambe geo verte (run 36255326915 : docs `normalized/`, rollout).
   C'est le premier restore depuis une sauvegarde datée. Le PG geo n'est pas encore restauré en préprod (branche prête).
3. **Join-verify immo ⊆ geo = contrôle de fidélité (décision owner, FAIT)**. Sur 9 064 références immo, 5 070 sont incluses dans geo. Les 3 994 autres sont des dérives connues, déjà présentes dans la prod sauvegardée. Le rejeu sans restore relève **0 nouvelle dérive** : verdict vert. Les 3 dettes data sont à planifier (§8.5.2).
4. **Identités de restore préprod dédiées (FAIT)**. 4 identités, aucune clé prod en préprod. Chaque clé est à 4 emplacements. Rotation tous les 90 j, échéance le 2026-12-25.
5. **Restore planifié prod→préprod gelé (décision owner, FAIT)**. `BASCULE_SCHEDULE_ENABLED=false` sur immo et geo : restores manuels seulement. #767 est mergée : plus aucun refresh dans la bascule.
6. **Refresh séparé de la bascule (FAIT)**. Un refresh a été lancé après l'e2e, à 16:45Z. Résultats au §8.3.
7. **Correction (FAIT)**. La version précédente de ce dossier affirmait qu'il n'existait aucun backup. C'est inexact : des backups PG pré-release existaient déjà via `build-push-images` (bucket `sentropic-pgbackup-preprod`, rétention 14, secrets repo-level `BACKUP_S3_*`). Ce qui n'existait pas avant le 2026-09-26, c'est le backup quotidien. Dette : passer ces secrets derrière un environment (action A1 de la note commune k8s-ops #73).
8. **Reste à faire** :
   - restore PG geo ;
   - vérification des runs nocturnes ;
   - les 3 dettes data ;
   - alignement des SealedSecrets préexistants des bundles ;
   - A1 pré-release ;
   - remplacement de `GEO_DISPATCH_TOKEN` par un PAT fine-grained.
   Détail dans les Suites immédiates.
9. **Attendu de l'owner** : 4 décisions, listées au §0.2.

**JUGEMENT (i-cond)** :
- L'étape 1 ratifiée (§2) est démontrée une fois, pour D = 2026-09-26, sauf sur un point : le PG geo n'est pas encore restauré en préprod.
- La préprod restaurée est une image **fidèle** de la prod sauvegardée. Elle ne satisfait pas l'inclusion stricte immo ⊆ geo, parce que la prod elle-même porte 3 994 dérives. Ce sont des dettes data de la prod, pas des défauts de la bascule.
- Le dispositif sera acquis quand trois conditions seront remplies : les premiers runs nocturnes constatés verts, le restore PG geo mergé et exécuté, un canal d'alerte pour le contrôle de fraîcheur.
- Tant que le restore planifié reste gelé, la préprod ne suit la prod que par un restore manuel.

### 0.1 Tableau récapitulatif

| # | Élément | État au 2026-09-26 | Preuve (FAIT) | Remarque |
|---|---|---|---|---|
| 1 | immo — restore PG | **Démontré** (copie prod en direct, puis depuis backup) | vague 1 : run 36215473088 ; depuis backup : run 36255315042 (`pg/2026-09-26/radar.dump`, sha256 vérifié) | — |
| 2 | immo — restore S3 (docs) | **Démontré** (copie prod en direct, puis depuis backup) | vague 1 : run 36215473088 ; depuis backup : run 36255315042 (docs à l'état de D, recon) | — |
| 3 | immo — PG + S3 ensemble | **Démontré** | run 36215473088 (smoke `db.ok` + `objectStore.ok`) ; run 36255315042 (remise en service) | — |
| 4 | geo — PG | **Démontré en copie (vague 1)** ; **non restauré depuis backup** | run geo 36198909160 (opéré par geo-cond) | branche `feat/bascule-restore-pg-preprod` prête, PR à ouvrir par geo-cond (avec le postgis préprod) |
| 5 | geo — S3 | **Démontré** (copie, puis depuis backup) | vague 1 : run 36198909160 ; depuis backup : run 36255326915 (docs `normalized/` à l'état de D) | — |
| 6 | geo — PG + S3 ensemble | **Démontré en copie (vague 1)** | run 36198909160 | depuis backup : docs seulement |
| 7 | e2e immo + geo depuis les backups d'une date commune | ✅ **Démontré (D = 2026-09-26)** | run `bascule-e2e` 36255243747 ; jambes 36255315042 et 36255326915 vertes ; PR #777, #778, #781 | run orchestrateur conclu `failure` (join-verify encore strict, avant #781) ; verdict vert au rejeu (ligne 8) |
| 8 | Join-verify immo ⊆ geo | ✅ **Vert en contrôle de fidélité** | 9 064 références ; 5 070 incluses ; 3 994 dérives connues ; 0 nouvelle (rejeu sans restore) | 3 dettes data à planifier (§8.5.2) |
| 9 | Refresh PV + signaux après restore | **Démontré** (hors bascule) ; **refresh post-e2e lancé** | run 36218358113 : 528/528 villes, 0 erreur ; run 36256573263 lancé à 16:45Z | résultats du refresh post-e2e : §8.3, à compléter |
| 10 | Backup quotidien immo | ✅ **En place, 1er backup `complete`** | PR #771, #772, #773, #775, #779 mergées ; Job `radar-backup-manual-20260926065729` (sha256 relu, 59 017 docs) | 1er run nocturne (02:23 UTC) : cette nuit, à vérifier ; canal d'alerte à choisir |
| 11 | Backup quotidien geo | ✅ **En place, 1er backup `complete`** (15:42Z) | rhanka/geo#402, geo#403, geo#409 ; dump 19,4 Mo, 70 440 objets docs | 1er run nocturne (03:23 UTC) : cette nuit, à vérifier |
| 12 | Identités de restore préprod | ✅ **En place** | 4 identités dédiées ; registre `deploy/ci/bascule-preprod/CRED_CYCLE.md` | rotation 90 j, échéance 2026-12-25 |
| 13 | Restore planifié prod→préprod | **Gelé** (décision owner) | `BASCULE_SCHEDULE_ENABLED=false` (immo et geo) ; cron du dimanche 03:17 UTC dans le code (#776) | restores manuels seulement |
| 14 | Backups PG pré-release | **Existants** (correction) | `build-push-images`, bucket `sentropic-pgbackup-preprod`, rétention 14 | dette A1 : secrets repo-level `BACKUP_S3_*` à passer derrière un environment |

### 0.2 Décisions de l'owner

**Prises et appliquées le 2026-09-26 (FAIT)** :

| Décision | Application |
|---|---|
| Join-verify = contrôle de **fidélité** contre une référence de dérive | #781 : référence `deploy/ci/bascule-2tenants/join-verify-baseline.json` (D = 2026-09-26). Une dérive connue est comptée sans échec ; une nouvelle dérive fait échouer. |
| Gel du restore planifié prod→préprod | `BASCULE_SCHEDULE_ENABLED=false` sur immo et geo. Restores manuels seulement. Le cron du dimanche 03:17 UTC reste dans le code (#776). |
| « Un restore c'est un restore » | #767 mergée le 2026-09-26 : plus aucun refresh dans la bascule. |

**Décisions de la version précédente, closes (FAIT)** :
- Commit des 3 SealedSecrets geo : sans objet. Les secrets de backup viennent désormais des GitHub Secrets d'environment + `.env` (immo #775, geo#403) ; les SealedSecrets de backup sont supprimés.
- Merge #767 : fait le 2026-09-26.

**En attente** :

| Décision | Contexte (FAIT) | Effet tant que non tranchée |
|---|---|---|
| Planification des 3 dettes data | §8.5.2 : miroir `zone_versions` immo périmé, écarts de slug, Saint-Hyacinthe servie sans `zone_code` | FAIT : les 3 994 dérives restent dans la référence ; le join-verify ne les signale pas comme nouvelles |
| Canal d'alerte du contrôle de fraîcheur | `radar-backup-freshness` échoue si le backup est trop ancien (§8.4) | JUGEMENT : un échec n'est visible qu'en consultant le cluster |
| Merge #765 | correctif d'injection dans les workflows GitHub Actions (entrées utilisateur interpolées dans des blocs shell) ; PR en draft | JUGEMENT : l'exposition corrigée par #765 reste ouverte |
| Suppression du bucket orphelin `radar-immobilier-p3-backup` | bucket vide, sans usage | FAIT : aucun effet sur les données (ménage) |

### 0.3 Sections mises à jour

- En-tête (statut), §0 (réécrit).
- §4 et §5 (notes d'état), §6 (tableau), §7 (application aux backups et aux restores).
- §8 :
  - §8.1 : jugement corrigé ;
  - §8.2 : #767 mergée, gel ;
  - §8.3 : refresh après restore, réécrit ;
  - §8.4 : correction, backup geo ;
  - §8.5 : réécrit (e2e depuis les backups, join-verify, identités préprod) ;
  - §8.6 : jugement.
- §9, Suites.
- §1 à §3 : inchangés.

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

> **État au 2026-09-26** — FAIT :
> - Un déclenchement unique (`bascule-e2e`, run 36255243747) a restauré les deux tenants depuis les backups d'une même date D = 2026-09-26 (§8.5) : immo PG + docs + migrations, geo docs `normalized/`.
> - Le PG geo n'est pas encore restauré en préprod (branche `feat/bascule-restore-pg-preprod` prête).
> - Le contrôle de jointure est désormais un contrôle de fidélité (décision owner) : 0 nouvelle dérive, 3 994 dérives connues.
> - La re-capture sur dérive est sans objet avec des backups immuables (§5).

### 4.2 Direction (NON dur en étape 1)
- **PRA prod complet** : restaurer la **PROD** depuis un backup (pas seulement prod→préprod). Même mécanisme de consistance, persisté. À armer en étape ultérieure.

> **État au 2026-09-26** — FAIT :
> - Backups quotidiens immo et geo en place, un premier backup `complete` chacun (§8.4).
> - Des backups PG pré-release existaient déjà via `build-push-images` (§8.4).
> - Un restore depuis un backup vers la préprod est démontré (§8.5).
> - Restaurer la PROD depuis un backup n'a pas été exercé.

## 5. Mécanisme de synchronisation (garantie livrable) — raffiné avec geo-cond 2026-09-24

Pas de snapshot distribué atomique (acté impossible). Garantie = **cohérence prouvée**. Raffinement clé (expertise geo-cond) : **la cohérence est assurée par l'ORDRE, pas par un gel des deux tenants** — le S3 geo est append-only content-addressed (cohérent sans gel).

1. **Quiesce = PG IMMO UNIQUEMENT** (primitive PR #753). **Aucun quiesce des writers geo** : les objets geo sont immuables/append-only (CAS), cohérents sans gel ; seules de nouvelles clés apparaissent.
2. **`CYCLE_ID` (=coherence_id) généré par immo à T0** (ouverture fenêtre quiesce), injecté par env dans la jambe geo.
3. **Ordre garant de cohérence** : dump immo (T0) **PUIS** capture geo **≥ T0** (append-only ⇒ geo est un sur-ensemble de ce qu'immo référence) → pas de skew d'intégrité.
4. **Reçu / manifestes** (bucket `radar-immobilier-backups-preprod`, `sets/<CYCLE_ID>/`) : `cycle.json` (tête immo : cycleId, snapshotAt, confirm, status open|captured|restored|verified) + `immo.json` + `geo.json` (1 objet/tenant, écritures disjointes). `geo.json` distingue **servi** (`normalized/`, preuve = verify-through-API) et **irremplaçable** (`raw/cas`+captures, preuve = réconciliation sha256).
5. **Restore** : restore immo complet (PG+S3, migrations) → restore geo **S3-only** vers geo-préprod (le PG geo n'est PAS restauré en préprod ; `geo.dump` = archive DR re-dérivable).
6. **Join-verify avant flip, fail-closed** : tout `canonical_id`/`lot_version_id` référencé par immo doit résoudre dans le **servi geo-préprod** au CYCLE_ID (diff ensembliste `immo_refs ⊆ served`, surface = `served-canonical-ids.json` du cycle, à confirmer geo-cond). ≥1 pendant = die.
7. **Redo-on-drift** : dérive prod pendant la capture (watermark pré/post immo) ⇒ re-capturer ou reprendre.

> **État au 2026-09-26** — FAIT : le mécanisme est exécuté sous la forme « restore depuis les backups d'une date commune ». L'orchestrateur est `deploy/ci/bascule-2tenants/` (#778, qui remplace #764, fermée).
> - **Point 1** : la brique quiesce (#753) est mergée depuis le 2026-09-25.
> - **Point 2** : l'orchestrateur génère le `CYCLE_ID` (`CONFIRM` du jour + T0) et le transmet aux deux jambes ; `cycle.json` est publié (#781).
> - **Point 3** : l'orchestrateur consigne `geo_after_immo` (début du backup geo ≥ début du dump immo).
> - **Point 5** : la jambe geo restaure les docs `normalized/`. Un restore PG geo en préprod est préparé (branche `feat/bascule-restore-pg-preprod`), alors que ce point prévoyait une préprod geo S3-only.
> - **Point 6**, amendé par décision owner : le join-verify juge la **fidélité** contre une référence de dérive (#781) ; seule une dérive absente de la référence fait échouer. Il porte sur les zones (`ogc:zones:`).
> - **Point 7** : pas de boucle de re-capture. Les backups sont immuables, un nouveau run donne la même réponse (README `deploy/ci/bascule-2tenants/`).
>
> JUGEMENT : l'horaire des backups (immo 02:23 UTC, geo 03:23 UTC) place la capture geo après le dump immo, ce qui respecte l'ordre du point 3.

## 6. Architecture d'exécution

Répartition ratifiée : **geo authore sa jambe en autonomie** (geo-cond), immo authore le top-level.

| Jambe | Propriétaire | Contenu |
|---|---|---|
| immo DB | immo (existant) | dump/restore/migrate (`deploy/ci/bascule-preprod/`) ; `MODE=restore|list` depuis un backup quotidien (#777) ; hook migration S3 post-restore = #751 (ticket ouvert au 2026-09-26) |
| immo S3 | immo (existant) | copy server-side + recon ; restore des docs à l'état de D depuis `radar-immobilier-backup` (#777) |
| **geo S3 (servi + irremplaçable)** | **geo-cond (autonome)** | entrypoint committé backup→reconcile→restore-verify ; **CAS dédupliqué** `geo-objects/cas/<sha256>` + `inventory.json`/cycle ; restore préprod **S3-only** ; preuve servi=verify-through-API, irremplaçable=sha256 ; restore préprod depuis un backup quotidien (`MODE=restore|list`, rhanka/geo#408) |
| **geo PG** | **geo-cond** | `geo.dump` = **archive DR re-dérivable** ; restore PG préprod : branche `feat/bascule-restore-pg-preprod` prête, PR à ouvrir par geo-cond (avec le postgis préprod) |
| **Top-level / coordination** | **immo** — orchestrateur `deploy/ci/bascule-2tenants/` + workflow `bascule-e2e.yml` (#778, remplace #764) | `CYCLE_ID`/`cycle.json` ; choix de la date commune D ; dispatch des deux jambes (`GEO_DISPATCH_TOKEN`) ; join-verify de fidélité (#781) ; ~~redo-on-drift~~ sans objet (backups immuables) ; ~~refresh index~~ retiré de la bascule (#767, §8.2) |
| Refresh PV + signaux | immo | CronJob `radar-refresh-pv`, **hors bascule**, déclenchable à la main via `bascule-refresh.yml` (§8.3) |
| Backup quotidien immo | immo | CronJobs `radar-backup-daily` + `radar-backup-freshness` (`deploy/ci/backup/`), bucket `radar-immobilier-backup` (§8.4) |
| Backup quotidien geo | geo-cond | CronJob `geo-backup-daily` (03:23 UTC), bucket `geo-backup` ; rhanka/geo#402, geo#403, geo#409 (§8.4) |

## 7. Gouvernance — pattern d'AUTONOMIE (directive owner 2026-09-24)

**Correction vs une 1re rédaction** : le « GO owner-direct par acte » est **remplacé** par le pattern d'autonomie (règle CLAUDE.md « périmètre backups », confirmé par l'owner via geo-cond) :

- **Tenant-opéré, pas k8s** : le backup/restore DB+bucket est opéré par les tenants (immo/geo) ; k8s = gouvernance transverse seulement.
- **Creds via CYCLE de rotation documenté → `.env`** : le mint (prod-RO, backup, préprod) est gouverné entre k8s/immo/geo avec **rotation explicite**, **stocké `.env` + DOCUMENTÉ** (immo : `CRED_CYCLE.md` ; geo : `GEO_CRED_CYCLE.md` créé par geo-cond) → un opérateur (immo/geo/owner/IA) **vérifie la reprise en tout temps, SANS GO acte-par-acte**. Les jobs lisent leurs creds du `.env`/secret, pas d'injection k8s par-run ni d'attente owner point-par-point.
- **geo-cond dédié + autonome** (directive owner) : authore sa moitié en autonomie, PR dédiée → merge, garde max-2-PR.
- **Séparation transverse** : le mint reste gouverné entre i-cond et geo-cond (et k8s pour la gouvernance) ; l'autonomie porte sur l'EXÉCUTION, pas sur l'invention de nouveaux droits.
- **Application aux backups et aux restores (2026-09-26, FAIT)** :
  - **Backup** : 3 identités immo séparées (writer sans delete, purger, reader). Les secrets viennent des GitHub Secrets d'environment + `.env` ; les SealedSecrets de backup sont supprimés (#775). Même principe côté geo (rhanka/geo#403).
  - **Restore préprod** : 4 identités dédiées, aucune clé prod en préprod — `radar-backup-reader-preprod`, `radar-backup-restore-preprod` (secret `radar-backup-restore-docs`), `geo-backup-reader-preprod`, `geo-backup-restore-preprod`. Chaque clé est à 4 emplacements : secret GitHub d'environment, `.env` central, `.env` du tenant, Secret k8s. Rotation tous les 90 j, échéance le 2026-12-25 (`deploy/ci/bascule-preprod/CRED_CYCLE.md`).
  - **À aligner** : les SealedSecrets préexistants des bundles, côté immo `radar-db-ro-prod` et `radar-pra-admin-prod`, côté geo `geo-db-ro-prod` et `geo-pra-writer-prod`.
  - **À remplacer** : `GEO_DISPATCH_TOKEN`, le jeton de dispatch cross-repo de l'orchestrateur, par un PAT fine-grained. C'est aujourd'hui le jeton OAuth `gh` de rhanka, qui atteint tous ses dépôts ; le besoin réel se limite à `rhanka/geo` (`deploy/ci/bascule-2tenants/README.md`).
  - **Pré-release** : les secrets `BACKUP_S3_*` sont au niveau du dépôt. Les passer derrière un environment est l'action A1 de la note commune k8s-ops #73.

## 8. Plan d'exécution (vagues) & état — actualisé 2026-09-26

### 8.1 Vague 1 — restore iso-prod par tenant : DÉMONTRÉ

- **immo (FAIT)** — run `bascule-preprod.yml` **36215473088** (2026-09-26 ~03:39Z), succès de bout en bout : dump prod → restore préprod → migration → copie des docs → recon `dest ⊇ src` → flip de service → smoke (`db.ok` + `objectStore.ok`).
- **geo (FAIT)** — run geo **36198909160**, opéré par geo-cond : succès PG + S3.
- **Lots prévus au 2026-09-24 — état (FAIT)** :
  - Lot A (immo) : PR #753 (quiesce tolérant) **mergée le 2026-09-25** ; hook de migration S3 post-restore = ticket #751, **ouvert**.
  - Lot B (geo) : jambe geo livrée et exécutée par geo-cond (run ci-dessus).
  - Lot C (sync : `CYCLE_ID`, join-verify, dispatch des 2 jambes) : **livré en vague 2** sous forme de restore depuis les backups (#778, #781, §8.5) ; redo-on-drift sans objet.
- **JUGEMENT** : la vague 1 prouve que chaque tenant sait se restaurer iso-prod en préprod par une copie de la prod en direct. Elle ne prouvait ni la cohérence croisée immo↔geo, ni la restauration depuis un backup quotidien : il n'en existait pas encore (§8.4). Les deux points sont traités au §8.5.

### 8.2 Décisions owner : « un restore c'est un restore », gel du restore planifié

- **Plus aucun refresh dans la bascule (FAIT)**. L'étape S6 et le job force-refresh sont retirés par la **PR #767, mergée le 2026-09-26**. Le refresh reste le CronJob `radar-refresh-pv`, déclenchable à la main via `bascule-refresh.yml`.
- **Source d'un run planifié (FAIT, #767)**. S'il est réarmé un jour, un run planifié est un `MODE=restore` du dernier backup `complete`. Il n'y a plus de dump prod en direct.
- **Gel (décision owner, FAIT)**. Le restore planifié prod→préprod est gelé : `BASCULE_SCHEDULE_ENABLED=false` sur immo et geo. Seuls les restores manuels sont possibles. Le cron hebdo du dimanche 03:17 UTC reste dans le code (#776) ; il est inactif tant que la variable vaut `false`.

### 8.3 Refresh après restore

Le refresh est séparé de la bascule : CronJob `radar-refresh-pv`, déclenchable à la main via `bascule-refresh.yml`.

**Refresh après l'e2e du 2026-09-26 (FAIT)** : lancé à 16:45Z via `bascule-refresh.yml` (run 36256573263), après le restore depuis les backups (§8.5.1).

RÉSULTATS DU REFRESH : à compléter à la fin du run (Job radar-refresh-pv-forced-36256573263)

**Refresh précédent (FAIT, run 36218358113)**, déclenché après le restore immo de la vague 1 :
- **Couverture** : 528/528 villes en 1 h 55 min 53 s ; sortie 0 ; 0 erreur.
- **Résultat par ville** : 155 publiées, 293 à jour, 38 sans entrée, 37 en échec, 5 sans baseline.
- **Signaux** : 308 levés, dont 6 nouveaux matérialisés (le reste existait déjà dans la base restaurée).
- **LLM** : primaire astra en échec (106 transport, 87 quota, 24 circuit ouvert) → bascule sur gemini-3.8-flash.
- **Documents** : 9 mis de côté (3 échecs ; plus retentés automatiquement).
- **Limite** : la cause exacte d'un échec n'apparaît pas dans les logs ; elle n'est qu'en base (`refresh_document_outcomes.reason`).

### 8.4 Backups — correction, backups quotidiens immo et geo

**Correction (FAIT)**. La version précédente de ce dossier affirmait qu'il n'existait aucun backup. C'est inexact.
- **Ce qui existait** : des backups PG pré-release. Le workflow `build-push-images` prend un `pg_dump` fail-closed avant un déploiement (bucket `sentropic-pgbackup-preprod`, rétention 14, secrets repo-level `BACKUP_S3_*`).
- **Dette** : passer ces secrets derrière un environment. C'est l'action A1 de la note commune k8s-ops #73.
- **Ce qui n'existait pas** : un backup quotidien, ni immo ni geo.
  - Les CronJobs de dump étaient suspendus par design : ce n'étaient que des déclencheurs de la bascule.
  - Les crons GitHub ne se déclenchaient quasiment jamais : 1 seul run planifié de la bascule immo dans l'historique (en échec), 0 côté geo.
  - La vague 1 avait donc livré une copie prod→préprod, pas un backup quotidien.

**Backup quotidien immo (FAIT)**. PR #771, #772, #773, #775 et #779, toutes mergées le 2026-09-26. RBAC du CD ré-appliqué par k8s ; variable `BACKUP_DAILY_CD_ENABLED` armée. Manifestes : `deploy/ci/backup/`.

| Composant | Contenu |
|---|---|
| Bucket `radar-immobilier-backup` (OVH BHS) | versioning ; object-lock GOVERNANCE 7 j ; lifecycle : versions non courantes 7 j sur `pg/`, `manifests/`, `docs-inventory/`, 190 j sur `docs/` ; propriétaire sans clé |
| 3 identités séparées | **writer** sans aucun droit de suppression ; **purger** limité par préfixe aux dossiers datés (delete-marker seulement, sans lecture) ; **reader** de restauration. Secrets issus des GitHub Secrets d'environment + `.env`, SealedSecrets de backup supprimés (#775) ; rotation 90 j dans `CRED_CYCLE.md` |
| CronJob `radar-backup-daily` (02:23 UTC) | `pg_dump` avec contrôles (`pg_restore --list`, sha256 relu, taille minimale, globals) ; copie incrémentale côté serveur des docs + inventaire du jour ; manifeste daté + `latest.json` / `latestComplete` ; purge de rétention dans une étape séparée ; garde source (refus si 0 objet ou < 50 % du précédent) ; rétention : quotidien 7 j, hebdo 4 semaines, mensuel 6 mois |
| Durcissement #779 | timeout par requête S3 ; manifeste `partial` toujours écrit (budget épuisé ou SIGTERM) ; délai de grâce 120 s ; budget docs 5 400 s ; `activeDeadlineSeconds` 10 800 s. Valeurs vérifiées par k8s sur l'objet appliqué |
| CronJob `radar-backup-freshness` (06:53 UTC) | échoue si aucun backup de moins de J−1, ou si aucun backup complet depuis plus de 3 jours |

- Premier backup lancé le **2026-09-26 à 06:57Z** (Job `radar-backup-manual-20260926065729`).
- **Résultat du premier backup (FAIT, vérifié en lecture par l'identité reader)** : statut `complete`, Job terminé à 08:21:41Z (1 h 24), les 3 conteneurs en sortie 0.
  - PG : `pg/2026-09-26/radar.dump`, 270 Mo, 189 entrées (`pg_restore --list`), globals présents. Le SHA-256 recalculé en relisant l'objet est égal à la valeur du `.sha256`. 11 migrations de schéma ; code prod `a4a2c00`.
  - Verrou object-lock GOVERNANCE sur la version du jour, conservée jusqu'au 2026-10-03T06:58:49Z.
  - Docs : 59 017 objets (12,53 Go) copiés, soit les 59 017 objets de la source. Inventaire `docs-inventory/2026-09-26.json` (18,7 Mo).
  - Manifeste `manifests/2026-09-26.json` + `manifests/latest.json` (`status: complete`, `latestComplete` = 2026-09-26).
  - Purge : OK, rien à purger (premier jour).
- Ce backup a servi de source à la jambe immo de l'e2e (§8.5.1).
- **Premier run nocturne (02:23 UTC) : cette nuit, à vérifier.**

**Backup quotidien geo (FAIT)**. CronJob `geo-backup-daily` (03:23 UTC), bucket `geo-backup`. PR : rhanka/geo#402 (dispositif, relu par geo-cond), geo#403 (secrets écrits depuis GitHub, plus aucun SealedSecret), geo#409 (timeouts).
- **Premier backup `complete` à 15:42Z** :
  - dump PG de 19,4 Mo, sha256 intact ;
  - docs : 70 440 objets copiés (62,04 Go) et 46 144 exclus, soit 116 584 objets, le nombre relevé précédemment en source ;
  - inventaire de 33,7 Mo ; purge OK ; verrou jusqu'au 2026-10-03.
- **Premier essai** : resté bloqué sur une copie S3 sans timeout. Corrigé par geo#409, même correctif qu'immo #779.
- Ce backup a servi de source à la jambe geo de l'e2e, pour les docs `normalized/` (§8.5.1).
- **Premier run nocturne (03:23 UTC) : cette nuit, à vérifier.**

**Défauts attrapés en route (FAIT)** :
- un CronJob immo refusé par l'API Kubernetes (`podFailurePolicy` sans `status`) → corrigé par #772 (geo : geo#407) ;
- une faille de conception relevée en relecture croisée par geo-cond : le writer pouvait poser des delete-markers et donc effacer l'historique → corrigée **avant armement** (writer sans suppression + identité purger séparée) ;
- un conflit de CPU pendant le premier lancement immo, sans impact sur le rôle ni sur le dump → #773 (plus de ré-application du bundle en parallèle d'un lancement manuel) ;
- le premier essai geo bloqué sur une copie S3 sans timeout → geo#409 (immo : #779).

**JUGEMENT** :
- Les deux premiers backups sont constatés complets et intègres. Chacun a servi de source à un restore réussi (§8.5.1).
- Le dump PG geo, lui, n'est pas encore éprouvé en restauration.
- Le dispositif sera pleinement prouvé après les premiers runs nocturnes verts et un premier passage vert du contrôle de fraîcheur.

### 8.5 Vague 2 — carte #769 (ouverte) : restore immo + geo depuis les backups

#### 8.5.1 E2E depuis les backups (FAIT)

Run `bascule-e2e` **36255243747**, le 2026-09-26 de 16:22 à 16:44Z. Date de backup D = 2026-09-26.

- **Jambe immo** (run 36255315042), **verte** : restore PG depuis `pg/2026-09-26/radar.dump` (sha256 vérifié) → migrate → restore des docs à l'état de D → recon → remise en service.
- **Jambe geo** (run 36255326915), **verte** : restore des docs `normalized/` à l'état de D → recon → rollout.
- **PR** : #777 (bascule `MODE=restore|list`), #778 (orchestrateur, remplace #764), #781 (join-verify en contrôle de fidélité).
- **Conclusion du run orchestrateur** : `failure`. Ses étapes join-verify et publish sont en échec ; à ce moment, le join-verify jugeait encore l'inclusion stricte (avant #781). Le verdict de fidélité vient d'un rejeu sans restore sur les artefacts des deux jambes (§8.5.2).

#### 8.5.2 Join-verify immo ⊆ geo — contrôle de fidélité (décision owner)

- **Nature** : le contrôle prouve que le restore est **fidèle** à la prod sauvegardée ; il ne prouve pas que les données sont propres.
  - Référence de dérive : `deploy/ci/bascule-2tenants/join-verify-baseline.json` (D = 2026-09-26).
  - Une dérive connue est comptée sans échec, une dérive nouvelle fait échouer, une dérive résolue est signalée.
- **Mesure (D = 2026-09-26)** : 9 064 références immo, dont 5 070 incluses dans geo. Les 3 994 dérives connues sont déjà présentes dans la prod sauvegardée :

| Dérive | Références | Détail | Porteur |
|---|---|---|---|
| Miroir `zone_versions` immo périmé | 2 829 | 5 villes où geo a changé de grille : Lévis, Mont-Tremblant, Saint-Eustache, Sutton, Repentigny | immo |
| Miroir `zone_versions` immo périmé | 59 | codes modifiés dans 6 villes | immo |
| Écarts de slug | 19 | `l-epiphanie`, `l-assomption` | immo |
| Saint-Hyacinthe | 1 087 | servie par geo sans `zone_code` | geo-cond |
| **Total** | **3 994** | | |

- **Résultat** : **0 nouvelle dérive**, verdict vert au rejeu sans restore.
- **Suite** : ces 3 dettes data sont à planifier (§0.2). Le contrôle de fidélité ne les corrige pas.

#### 8.5.3 Identités de restore préprod (FAIT)

- 4 identités dédiées, aucune clé prod en préprod : `radar-backup-reader-preprod`, `radar-backup-restore-preprod` (secret `radar-backup-restore-docs`), `geo-backup-reader-preprod`, `geo-backup-restore-preprod`.
- Chaque clé est à 4 emplacements : secret GitHub d'environment, `.env` central, `.env` du tenant, Secret k8s.
- Rotation tous les 90 j, échéance le 2026-12-25.

#### 8.5.4 Vague 2 — livré et reste à faire

- **Livré (FAIT)** :
  - bascule en `MODE=restore|list` (#777 ; geo : rhanka/geo#408) ;
  - références servies (O1) lues depuis la base restaurée (#777) ;
  - orchestrateur e2e (#778) ;
  - join-verify de fidélité (#781) ;
  - jeton cross-repo `GEO_DISPATCH_TOKEN` en place, avec une dette (ci-dessous).
- **Reste à faire** :
  - **Restore PG geo** : la branche `feat/bascule-restore-pg-preprod` est prête ; la PR est à ouvrir par geo-cond, avec le postgis préprod.
  - **`GEO_DISPATCH_TOKEN`** : le remplacer par un PAT fine-grained.
  - **Test de restauration automatique** : l'e2e est démontré à la main, et le restore planifié est gelé (§8.2).
  - **Canal d'alerte** du contrôle de fraîcheur.
  - **Mode snapshot coordonné instantané** : étude `docs/spec/reports/STUDY_COORDINATED_INSTANT_SNAPSHOT_RPO_RTO.md`, faisable avec caveats ; le point dur est le support CSI VolumeSnapshot.
  - **Verrou par palier** (PutObjectRetention, supporté par OVH).
  - **Secret éphémère monté par la bascule** : état non vérifié dans ce dossier.

### 8.6 Vague 3 — carte #770 (ouverte)

- **k8s complet** : isolation des tenants par les droits (identités séparées, RBAC, VAP, élévation JIT, audit) ; autorité de déclenchement in-cluster.

**JUGEMENT** :
- Le PRA prod complet (§4.2) reste la direction.
- Deux de ses prérequis sont désormais en place côté préprod : les backups datés et le restore depuis un backup choisi.
- Restent à faire : le test de restauration automatique (gelé), l'isolation des droits, et une restauration de la PROD, jamais exercée.
- Aucune échéance n'est fixée dans ce dossier.

## 9. Risques / limites explicites

- **Pas d'atomicité distribuée** : la garantie est la cohérence prouvée (watermark + join-verify + redo), pas un snapshot instantané des 4 stores.
- **Skew de fraîcheur** borné par la fenêtre coordonnée + le contrôle de jointure ; append-only geo ⇒ pas de risque d'intégrité référentielle si geo ≥ point de cohérence.
- **Dépendance geo-cond** : la jambe geo est authored par geo-cond en autonomie (creds via cycle `.env` documenté, pas de GO acte-par-acte). Non bloquant tant que les 2 côtés respectent le contrat ratifié.
- **RISQUE DE COHÉRENCE LATENT (mesuré 2026-09-25) — normalisation canonical_id divergente** : immo calcule `code_norm`/`no_lot_norm` avec des fonctions LOCALES (`normalizeZoneCode` `api/src/services/geo/zones.ts:119`, `normalizeNoLot` `ogc-pull.ts:255`) ≠ les canonicalizers `@sentropic/geo` (`canonicalizeZoneCodeForJoin`, testé C408→C-408/22A→A-22) qui définissent la clé de jointure SERVIE par geo. ⇒ **la jointure immo↔geo n'était PAS byte-garantie**. Mesure fine (2026-09-25) : **LOTS quasi-identiques** (`normalizeNoLot` ogc-pull.ts:120-122 = `replace(/\s+/g,"")` ≈ `canonicalizeNoLotForJoin` = `replace(/ /g,"")` ; seule nuance `\s+` vs espace littéral, cadastre-safe) ; **ZONES = vraie divergence** (`normalizeZoneCode` ≠ `canonicalizeZoneCodeForJoin`, ex. A1336 vs A-22) ; **registre municipalités = BYTE-IDENTIQUE vérifié** (sha256 `1c12c9ab…`, 1106 slugs, `comm` vide, 2026-09-25) → aucune divergence city_slug ; **lots alignés** (geo `canonicalizeNoLotForJoin` figé sur `/\s+/`, commit 4d8dbb7 = prouvé identique à `normalizeNoLot`). ⇒ **la seule divergence résiduelle = les ZONES** (`normalizeZoneCode`) pour le lot de suivi. Traitement à 2 niveaux : (a) BASCULE — le join-verify re-canonicalise les refs immo depuis le BRUT via les MÊMES fonctions `@sentropic/geo` → byte-identique par construction, **sans migration prod** ; (b) MIGRATION DE SUIVI (lot séparé, hors bascule) — remplacer les normaliseurs locaux immo à l'écriture par `@sentropic/geo` + re-normaliser les `code_norm`/`no_lot_norm`/`canonical_id` stockés. À trancher owner.
  - **Mesure du 2026-09-26 (FAIT, README `deploy/ci/bascule-2tenants/`)** : aucune des dérives relevées par le join-verify n'est un problème de canonicalisation. 0 des 2 888 codes en `divergent-code` ne correspond à un code geo de sa ville sous une clé souple (casse, séparateurs, zéros de tête, ordre). La règle de pull d'immo appliquée aux features geo du jour donne 100 % d'inclusion.
- **Python** : les jobs geo doivent respecter « 0 python » (pg_dump/pg_restore + binaires natifs + Node/TS ; pas de script ni image Python).
- **Consistance immo↔geo = fidélité, pas inclusion (2026-09-26)**. FAIT : la préprod restaurée depuis D est fidèle à la prod sauvegardée (0 nouvelle dérive). 3 994 références immo ne résolvent pas dans geo ; elles sont héritées de la prod. JUGEMENT : tant que les 3 dettes data ne sont pas traitées, l'inclusion stricte immo ⊆ geo du §5 point 6 n'est pas satisfaite, ni en prod ni en préprod.
- **Join-verify limité aux zones** : FAIT — le contrôle porte sur les `canonical_id` de zones (`ogc:zones:`).
- **PG geo non restauré depuis backup** : FAIT — la jambe geo de l'e2e restaure les docs `normalized/` seulement ; la branche du restore PG geo n'a pas encore de PR.
- **Runs nocturnes non constatés** : FAIT — le premier run nocturne immo (02:23 UTC) et le premier run nocturne geo (03:23 UTC) ont lieu cette nuit ; à vérifier.
- **Restore planifié gelé** : FAIT — `BASCULE_SCHEDULE_ENABLED=false` sur immo et geo. JUGEMENT : la préprod s'écarte de la prod entre deux restores manuels, et aucun restore n'est exercé automatiquement.
- **Contrôle de fraîcheur sans canal d'alerte** : FAIT — le canal n'est pas choisi. JUGEMENT : un backup manquant n'est détecté que par une consultation active du cluster.
- **`GEO_DISPATCH_TOKEN`** : FAIT — c'est le jeton OAuth `gh` de rhanka, qui atteint tous ses dépôts et est invalidé par une déconnexion `gh`. À remplacer par un PAT fine-grained limité à `rhanka/geo`.
- **Secrets pré-release au niveau du dépôt** : FAIT — `BACKUP_S3_*` ne sont pas derrière un environment (action A1, note commune k8s-ops #73).
- **SealedSecrets préexistants des bundles non alignés** : FAIT — immo `radar-db-ro-prod`/`radar-pra-admin-prod`, geo `geo-db-ro-prod`/`geo-pra-writer-prod`.
- **Refresh** : FAIT — 37 villes en échec lors du refresh précédent (run 36218358113), dont la cause n'est lisible qu'en base (`refresh_document_outcomes.reason`) ; primaire LLM astra en échec pendant tout ce run (repli sur gemini-3.8-flash). Résultats du refresh post-e2e : à compléter (§8.3).
- **Correctif #765 non mergé** : JUGEMENT — l'exposition à l'injection dans les workflows GitHub Actions corrigée par #765 reste ouverte tant que la PR n'est pas mergée.
- **Bucket orphelin** `radar-immobilier-p3-backup` : FAIT — vide ; suppression sur décision owner.

---

### Suites immédiates (actualisées 2026-09-26)
1. Vérifier les premiers runs nocturnes : `radar-backup-daily` (02:23 UTC), `geo-backup-daily` (03:23 UTC) et le contrôle de fraîcheur `radar-backup-freshness` (06:53 UTC).
2. Restore PG geo : PR à ouvrir par geo-cond depuis la branche `feat/bascule-restore-pg-preprod`, avec le postgis préprod.
3. Planifier les 3 dettes data (§8.5.2) : miroir `zone_versions` immo, écarts de slug, Saint-Hyacinthe sans `zone_code`.
4. Aligner les SealedSecrets préexistants des bundles : immo `radar-db-ro-prod`/`radar-pra-admin-prod`, geo `geo-db-ro-prod`/`geo-pra-writer-prod`.
5. A1 pré-release : passer les secrets repo-level `BACKUP_S3_*` derrière un environment (note commune k8s-ops #73).
6. Remplacer le jeton `GEO_DISPATCH_TOKEN` par un PAT fine-grained.
7. Compléter les résultats du refresh post-e2e (§8.3).
8. Obtenir les 4 décisions owner en attente (§0.2).

### Suites de la version précédente (2026-09-26 matin) — état
1. Premier backup planifié immo et premier passage du contrôle de fraîcheur → **à vérifier** (Suites 1).
2. 5 décisions owner → **2 closes** (SealedSecrets geo sans objet, #767 mergée) ; 3 toujours en attente (§0.2).
3. Armer le backup geo → **fait** : premier backup `complete` à 15:42Z.
4. Vague 2 : premier e2e immo+geo → **fait** depuis les backups (run 36255243747) ; #764 fermée, remplacée par #778 ; O1 livré (#777).

### Suites du 2026-09-24 — état au 2026-09-26
1. Merge PR #753 (quiesce, brique de sync) → **fait** (2026-09-25).
2. Coordination geo-cond (primitive/creds geo, in-cluster) → **faite** ; le « GO owner-direct session geo » est remplacé par le pattern d'autonomie (§7).
3. Jobs geo (dump/restore/migrate PG+S3) → **livrés** par geo-cond (run 36198909160).
4. Contrôle de jointure + `coherence_id` partagé + redo-on-drift → **livré** sous forme de restore depuis les backups : `CYCLE_ID` partagé et join-verify de fidélité (#778, #781) ; redo-on-drift sans objet (backups immuables).
