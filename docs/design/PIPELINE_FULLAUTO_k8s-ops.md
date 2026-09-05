# Pipeline full-auto — Volet K8S / OPS

*Contribution de la lane k8s/ops au design consolidé `PIPELINE_FULLAUTO_CLUSTER_MESH.md`
(track 01M1S25MVCND04YZN76KTVNGAE). Consolidation : i-cond. Sections sœurs : writer/data-model (i-arch),
orchestration/ops partagé (i-infra), couches (geo).*

*Fondé sur les faits mesurés de la session refresh préprod (r2→r4, quota, overlay #633, graph-survey,
cross-check fraîcheur). Les chiffres sont des mesures RO, pas des estimations, sauf mention explicite.*

---

## 0. Leçons dures (contraintes de design, à NE PAS reproduire)

- **Overlay env index-fragile** — le patch JSON6902 index-based de l'overlay refresh a cassé après #629
  (les `POSTGRES_*` insérés aux indices 2-4 ont décalé `SCRAPE_S3_*` → clobber de `POSTGRES_DB`/`S3_ACCESS_KEY`,
  doublons `SCRAPE_S3_ENDPOINT/BUCKET` shadowés last-wins, `FORCE_PATH_STYLE` false shadow true → MinIO
  ENOTFOUND, #592 ressuscité). **Le full-auto n'utilise que des patches name-based (strategic-merge par nom
  d'env), jamais d'index.** (fix #633, branche `infra/nightly-refresh-mem-3gi`, validé rendu + dry-run=server.)
- **Projection S3→PG input-starved** — `project-graph-from-s3` lit `graph/{city}/latest.json`. En préprod ce
  prefix contient **1 seul fichier** (sainte-martine, publié par le grounding) ; `worker-live` n'écrit que
  `raw/`+`parsed/`, jamais `graph/`. ⟹ la projection est quasi-vestigiale. **Le full-auto bâtit sur le
  direct-PG-feed (`worker-live` #629 + code #626) + le canonical-writer atomique (i-arch), PAS sur la projection.**
- **Quota `preprod-cap` = DRIFT (hors git)** — les valeurs live (req.cpu 400m, lim.cpu 2300m, req.mem 2560Mi,
  lim.mem 6Gi, storage 50Gi, pods 20) ne sont dans aucun manifeste (ni poc-k8s tenants, ni radar-immo
  deploy/k8s). **Prérequis full-auto : git-sourcer le quota (reconcile live→git) avant toute gestion auto —
  sinon un apply CD revert les desserrages.**
- **Pic mémoire per-city = octets bruts des PV dans le tableau `records`** (`worker-live`), NON borné par
  `--chunk` (qui est du city-sharding, pas un borneur mémoire) ni par le callback `onCity` (observabilité only).
  Ville dense (saint-henri, 199 docs) OOM à 512Mi, OK à 3Gi. **Limite mémoire per-pod dimensionnée au pic
  ville-dense, pas à la moyenne.**
- **Fraîcheur** — toute la préprod est de la donnée de **juin 2026** (dernier scrape 14 juin ; plafond séance
  juin ; 0 séance postérieure ; retard ~3 mois vs aujourd'hui). Confirmé sur 2 angles indépendants (mtime raw
  côté ingestion = extraction ; max(meetingDate) côté contenu = mesure RO). **Seul le re-scrape automatisé
  comble — re-projeter/re-exploiter reproduit juin. C'est la raison d'être du full-auto.**

## 1. Orchestration — CronJob monolithe → pipeline étagé + shardé

**Actuel** : 1 CronJob nocturne, 1 pod séquentiel, ~528 villes, ~80 min (r4 : 12:05→13:25Z), sizing
r4 (req.cpu 100m / lim.cpu 500m / mem 3Gi / heap 2560). **Limites** : SPOF (une ville dense OOM ou une
erreur-disque tue tout le run — cf. r4 exit=1 sur saint-henri), pas d'isolation per-ville, pas de reprise
partielle.

**Proposé** — 3 étages, fan-out shardé, orchestré :

| Étage | Rôle | Notes |
|---|---|---|
| A. SCRAPE | `worker-live --chunk k/N` sur N pods shardés | `--chunk` = découpe déterministe de la liste villes ; chaque shard reste à 3Gi (pic ville-dense). `--chunk` ≠ borneur mémoire. |
| B. DÉTECTION/IA | repliée dans `worker-live` exploit (`LIVE_SCRAPE_EXPLOIT=1`) | à sortir en étage propre si l'IA devient lourde (budget mémoire/temps distinct). |
| C. CANONICAL-WRITE | direct-PG-feed (#629) via le writer atomique i-arch | supersède le legacy juin de la ville en 1 tx (gate3, K2 fail-close pour groundé, baseline sainte-martine préservée). Porte `intendedRemovals` → évite la ré-accumulation des ~33k orphelins legacy `type-slug-ref` vs `type::slug::ref`. |

- **Trigger** : CronJob pour la baseline périodique (nocturne) ; event-driven (Argo Events / queue de
  work-items per-ville) pour l'on-demand. Démarrer CronJob-orchestré fan-out (N Jobs shardés) pour le
  déterminisme ; event-driven en v2.
- **Handoff durable** : S3 `raw/`+`parsed/` = intermédiaire durable (survit aux restarts, permet re-exploit
  sans re-scrape ; le HEAD-skip évite de re-télécharger les PV déjà fetchés).

## 2. Cluster-mesh ops

- **Node pool OVH** = 3 × 1840m = 5520m allocatable, **PARTAGÉ tous tenants** (immo, geo, matchid, openerp…).
  Le burst full-auto (N shards scrape) entre en concurrence avec geo + les autres pour le physique.
- **In-cluster** : parallélisme borné (≤ ce que le quota mem 6Gi tient), scheduling off-peak, ou burst-pool
  autoscale (l'autoscaler a ajouté un 3e node en r4). NetworkPolicy **per-étage explicite** (Calico, pas
  d'egress FQDN) : scrape = egress sites municipaux + S3 ; canonical-write = PG ; pas d'egress large.
- **Multi-cluster (recommandé à l'échelle, = WP6 « L6 — SCW Serverless Jobs + Cron, 40→1000 villes sans
  OOM »)** : sortir le SCRAPE en **SCW Serverless Jobs** (enveloppe ressources propre, hors quota OVH), garder
  le canonical-write in-cluster (léger). Le « mesh » = le pont S3 (handoff durable) + identité/secrets
  per-namespace + egress S3-BHS (netpol `54.39.60.208/32:443`). Résout d'un coup le plafond quota in-cluster
  ET le scale.

## 3. Quotas

- `preprod-cap` actuel vs standing : req.cpu **250m/400m**, lim.cpu **1600m/2300m**, req.mem **694Mi/2560Mi**,
  lim.mem **2304Mi/6Gi**, pods **5/20**. Standing = radar-api 100m/500m, mcp 50m/150m, minio 30m/250m,
  postgres 40m/600m, ui 30m/100m.
- Burst full-auto in-cluster : N shards × (req 100m, lim 500m, mem 3Gi). **N=2 dépasse déjà lim.mem 6Gi**
  (2304+6144). ⟹ in-cluster, N=1 séquentiel est le plafond mémoire sauf relèvement — **driver WP6** (sortir le
  scrape off-cluster). Le sizing r4 (100m/500m CPU) tient dans le quota actuel sans bump (150m req / 700m lim
  de marge).
- **Prérequis** : git-sourcer `preprod-cap` (fin du drift) avant toute gestion auto de quota.
- **Rétention `raw/`** : accumulation irréversible (PVC 40Gi, ~64% avant re-scrape). Politique nécessaire :
  archive cold-S3 ou prune post-canonical-write.

## 4. Reprise / observabilité

- **Isolation per-ville** : un OOM/404 d'une ville ne doit PAS tuer le run (anti-pattern r4 exit=1
  saint-henri). Le sharding donne ça (un shard tombe, les autres finissent). `backoffLimit` + canonical-write
  idempotent (ON CONFLICT) = retry safe.
- **Idempotence** : `worker-live --reexploit` + canonical-write = ON CONFLICT DO UPDATE. Re-runs safe. MAIS le
  writer doit **superséder** le legacy (`intendedRemovals`), pas accumuler un 2e schéma d'id (cause des ~33k
  orphelins).
- **KPI fraîcheur MESURABLE** : chaque run diffe son sha-set vs le baseline t0
  (`docs-preprod/baseline-shaset-20260905/raw-pdf-shaset.txt`, sha256 `be4a80f5…`, 19906 shas / 436 villes)
  → {nouveaux, disparus, inchangés} per-ville. Corroborer par `max(meetingDate)` per-ville (récence contenu)
  vs mtime raw (récence scrape). Le source-gap fraîcheur (non-mesurable rétro) devient mesurable en avant.
- **Cert = log-based** : `worker-live` done (cities/seen/errors) + `PG feed: ON` (upserted) + created_at
  échantillon + preuve S3/MinIO (raw/parsed écrits, pas d'ENOTFOUND, path-style effectif) + pas d'OOM.
  **PAS `Job=Complete`** (r4 était Failed sur l'erreur-disque saint-henri mais 527/528 avaient landé).

## 5. Séquençage scrape → IA → canonical-write

```
scrape (worker-live, egress externe) → S3 raw/parsed (handoff durable)
   → exploit/détecte (LIVE_SCRAPE_EXPLOIT) → canonical-write (writer atomique i-arch : PG direct,
   supersède legacy, sm-protégé, gate3)
```
Le canonical-write est la **SEULE mutation PG**, atomique per-ville, gatée (K2 fail-close pour groundé,
baseline sainte-martine préservée). **Pas d'étage projection S3→PG** (input-starved, vestigial).

## Questions ouvertes (à trancher avec i-infra / i-arch / geo)

1. **Argo Workflows/Events vs CronJob-fan-out natif** pour l'orchestration ? *(i-infra + k8s/ops)*
2. **SCW Serverless (WP6) maintenant** vs après stabilisation in-cluster N=1 ? *(décision phase/plateforme,
   potentiellement owner à l'échelle)*
3. **Canonical-writer** (i-arch) : delete-old+write-new en 1 tx, ou soft-supersede (flag stale) + GC async ?
4. **Egress scrape** : ipBlock par site municipal (ingérable à 1000) vs proxy sortant mutualisé ? *(i-infra + k8s/ops)*

## Garde purge (transverse, mesuré cette session)

Le servi-stale n'a **aucune cible de suppression** : les 953 nœuds « stub » (18 villes servi-stale sans
`props.refs`) portent tous du contenu réglementaire réel dans `props.properties` (etape/etape_date/title/objet)
= legacy **non-cité**, pas contentless. **Test purge = `props.properties` vide ET refs schéma-complet
(`hasServableSource`), JAMAIS `props.refs` seul** — sinon faux-safe → data-loss. Seule cible delete = les
orphelins Q1 (villes ayant une projection `::` qui supersède), gatés sur ces deux dimensions + vérif
couverture docSha (recette). sainte-martine préservée par construction (hors filtre, 0 projection `::`).
