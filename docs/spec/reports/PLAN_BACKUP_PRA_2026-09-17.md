# Plan de sauvegarde et de reprise après sinistre — 2026-09-17

## Mesures et classement

| Donnée | Mesure | Classement et mécanisme |
|---|---:|---|
| PostgreSQL/PostGIS Radar production | 1 002 MiB ; PVC 5 GiB | Critique : dump logique quotidien `pg_dump -Fc`, SHA-256 et manifeste JSON dans S3. |
| PostgreSQL/PostGIS Radar préproduction | 950 MiB ; PVC 5 GiB | Critique pour le rehearsal : même mécanisme ; CronJob actif. |
| PostgreSQL/PostGIS Geo | 139 MiB ; PVC 5 GiB | Dérivé de `normalized/` : pas de dump ou de snapshot dédié. |
| Bucket `sentropic-geo` (bhs) | ~48,9 GB, 45 378 objets | Couche autoritaire. Aucun DR Geo existant. |
| `sources/qc-zonage-grilles/` | taille incluse dans le bucket, N-A par préfixe | Irremplaçable : synchro S3→S3 sans expiration. |
| `raw/`, `capture/_runs/` | 0 objet aujourd'hui | Irremplaçables dès leur création : synchro S3→S3 sans expiration. |
| `normalized/`, `exports/immo/`, `pmtiles/`, PostGIS | tailles individuelles N-A | Re-dérivables : pas de backup dédié ; versioning et lifecycle du bucket seulement. |

Les PVC ne sont pas une capacité de sauvegarde : une restauration isolée exige
une PVC dédiée, à créer après GO owner. La mémoire disponible en préproduction
est ~4 GiB pour Radar et ~3,3 GiB pour Geo.

## Rétention, volume et coût de stockage

La rétention des dumps Radar est **daily 7, weekly 4, monthly 1**, appliquée par
une règle lifecycle S3 sur les préfixes `postgres/<env>/daily|weekly|monthly/`,
pas par le Job. Le Job ne fait que créer un jeu complet (dump, SHA-256,
manifeste). C'est obligatoire : le pgbackup du tenant sentropic a accumulé 67
dumps entre le 2026-07-30 et le 2026-09-16 (~346 MiB, ~1,5 MiB/dump), avec
versioning activé mais sans lifecycle ; l'accumulation n'est pas bornée.

Estimation de capacité Radar, avant mesure d'un vrai dump : hypothèse de
compression prudente de 50 % du volume PostgreSQL. Production : ~0,49 GiB par
dump et ~5,87 GiB retenus (12 jeux). Préproduction : ~0,46 GiB par dump et
~5,57 GiB retenus. Les écritures mensuelles estimées sont donc ~29,3 GiB/mois
(30 dumps quotidiens par environnement, jeux weekly/monthly inclus) et le
palier retenu est ~11,4 GiB, hors versions non courantes, manifests et requêtes
S3. Le ratio réel de compression, le prix OVH et les tailles Radar documents
restent N-A ; mesurer le premier dump remplace cette hypothèse.

Pour Geo, la première copie ne peut pas dépasser le bucket entier connu :
~48,9 GB (~45,5 GiB) et 45 378 objets. Le volume facturé de la synchro est N-A
tant que les tailles des préfixes irremplaçables ne sont pas listées. Aucun
coût mensuel incrémental ne peut être chiffré sans le taux de changement. La
cible ne doit conserver sans expiration que les versions de
`sources/qc-zonage-grilles/`, puis `raw/` et `capture/_runs/`; lifecycle des
versions non courantes et versioning protègent les préfixes re-dérivables.

## Contrat attendu pour geo-cond

Geo-cond crée dans la région bhs un bucket de reprise distinct
`sentropic-geo-pra` (ou le nom owner validé), privé et versionné. Une identité
lecture seule sur `sentropic-geo` et une identité écriture seule sur la cible
exécutent une synchro S3→S3 idempotente avec inventaire (clé, taille, ETag ou
SHA-256 quand disponible, date de synchronisation). Le périmètre est
`sources/qc-zonage-grilles/` aujourd'hui, complété dès existence par `raw/` et
`capture/_runs/`. Les objets restent dans leur format source (PDF/octet brut,
manifeste JSONL ou JSON), sans transcodage, et sans expiration ni suppression
lifecycle sur ces préfixes. `normalized/`, `exports/immo/`, `pmtiles/` et
PostGIS restent hors copie PRA dédiée : versioning + lifecycle du bucket
source, puis re-dérivation depuis les données capturées.

La synchronisation existante `normalized/` production→préproduction reste une
réplication de service, pas une sauvegarde PRA.

## Cibles et rehearsal Radar

RPO Radar : **24 h** (job quotidien à 02:15 UTC). RTO Radar : **4 h** pour
restaurer et remettre le service ; il sera mesuré lors du premier rehearsal.
RPO Geo : **24 h** après mise en place de la synchro quotidienne. RTO Geo :
**N-A** : le volume de 45,5 GiB est borné mais le débit de copie et de
restauration n'est pas mesuré. Aucun PITR n'est prévu.

`radar-db-backup` interdit les chevauchements, produit le dump custom,
SHA-256 et le manifeste ; il est actif en préproduction et suspendu en
production jusqu'au GO owner. Le Job de restauration isolé vérifie le hash,
exécute `pg_restore --exit-on-error` vers `radar_restore_verify` et compare les
comptes de tables. Il ne modifie ni ne remplace la base source.

## Questions owner (réponse en un mot)

1. Versioning de `sentropic-geo` confirmé : oui/non ?
2. Bucket Geo PRA `sentropic-geo-pra` validé : oui/non ?
