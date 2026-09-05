# PIPELINE_FULLAUTO_CLUSTER_MESH — design doc consolidé (canonique)

> **Statut** : consolidation i-cond de 7 sections co-designées geo↔immo (track
> `01M1S25MVCND04YZN76KTVNGAE` ; item LLM in-cluster `01M197X0076A87ZS8KEVT426VF`).
> **Rôle de ce doc** : assembler + harmoniser + expliciter décisions/questions ouvertes.
> Co-design déjà convergé — pas de re-conception.
> **Grounding** : `[FAIT source=…]` = vérifié code ; `à confirmer`/`source-gap`/`unverified` = non prouvé, jamais inventé.
> **Sources fusionnées** (attribution par note `⟨src⟩` en fin de section) :
> `⟨immo⟩` backbone architecte · `⟨i-arch⟩` writer/canonical-merge · `⟨i-infra⟩` orchestration/deploy/quotas ·
> `⟨k8s⟩` k8s/ops (mesures r2→r4) · `⟨geo-zones⟩` acquisition · `⟨geo-socle⟩` deploy/plumbing · `⟨geo-archi⟩` satellite+extraction.
> **Contradictions inter-sections** : réunies au §11 (non masquées).

## 1. Résumé exécutif

**Le problème.** Le rafraîchissement est **manuel** (runs `worker-live --reexploit` au poste, CronJobs
`suspend: true` depuis le FinOps 2026-07-01) et la préprod est **plafonnée juin 2026** : dernier scrape
~14 juin (818/821 villes), 0 séance postérieure, retard ~3 mois, confirmé sur 2 angles indépendants
(mtime raw = extraction ; `max(meetingDate)` = contenu) `[FAIT source=k8s §0, immo §1]`. **Re-projeter/
re-exploiter reproduit juin** : seul un **re-scrape automatisé** rafraîchit.

**La cible.** Un pipeline **100 % automatisé sur k8s/cluster-mesh** (IA comprise), **réduit aux seuls
composants nécessaires**, dont l'orchestrateur est **`@sentropic/s3-dag`** (D-moteur-1 **ratifié** —
**PAS Argo, PAS un nouveau moteur**) : un **CronJob self-driver in-cluster** + **chaînage reconcile
desired-state** (« quelles villes/couches sont stale ? »), généralisé par-lane (Refresh Controller)
`[FAIT source=geo-archi §SD2(ii), i-infra §3]`.

**Débloqué maintenant (P0, sans IA / sans mesh / sans décision owner).** **E4** (merge canonique
déterministe : détection ∪ grounding ∪ geo) + **E5** (`upsertGraphAtomic`, écrivain PG **unique**) :
résout la **dette orphelins** par construction (self-heal) et **dé-starve la projection**, sans IA, sans
vision, sans cluster-mesh `[FAIT source=i-arch §0, immo §9]`.

**Gaté (P1+).** La couche IA dépend de **2 décisions owner** : **GATE #1** route VISION d'extraction
(ADR-0024, remplaçant du vision Mistral inopérant) ; **GATE #2** hosting **+ egress** du moteur LLM
(confirmer la direction « cluster-mesh », trade-off exposé — **egress NON tranché**, dossier à
re-piloter, §6/§9.1). Socle = **SPEC_LLM_CLUSTER_MESH #627** (draft à bâtir, lead à confier par l'owner)
`[FAIT source=geo-archi entête, i-infra §10, cadrage-transverse]`.

⟨immo, i-arch, i-infra, k8s, geo-archi⟩

## 2. Périmètre — 4 couches de données + principe only-necessary

1. **Signaux immo** (couche 1, le cœur) : scrape municipal → détection → grounding → graphe canonique
   mergé → PostgreSQL. Périmètre = **config-528 villes** `[FAIT source=i-arch B.1]`.
2. **Vue satellite / 3D-tiles** (geo) : **couche VUE (display)**, pas un pipeline de refresh de données —
   2D live navigateur→Google (activation GO#2 owner-gated, budget-guardrail owner-manuel) ; 3D **hors
   scope full-auto** (track PHOTOREAL séparé, non-ratifiable) `[FAIT source=geo-archi §SD1]`.
3. **Couches environnementales** : CPTAQ **servi** (4 villes préprod, agricole-only) ; BDZI (zones
   inondables) + GRHQ (hydrographie) = **NOT_ACQUIRED**, **serving GATÉ** sur audit tier-2 (runner G02)
   `[FAIT source=geo-zones (iii), immo §2]`.
4. **Zones réglementaires en vigueur** : acquisition SIG geo (ArcGIS/WFS) → OGC servi ; **868/1106**
   collections servies, 238 absentes ; **zone_code = code bylaw RÉEL verbatim source** (jamais dérivé
   H/R). **Directive owner** : zones réglementaires réelles + vrai numéro ; l'environnement = **couches
   overlay**, PAS des nœuds Zone `[FAIT source=geo-zones (iii)/(iv), i-arch C.4]`.

**Principe « seuls composants nécessaires »** (transverse) : `s3-dag` + `cascade-extract-minimal` +
`feeding-contract`. **0 Argo**, **0 nouveau moteur-LLM** si un service central est tranché, **0 vision**
si le résidu mesuré est nul. Un **écrivain PG unique atomique** ; pas de second chemin d'écriture ; les
**6 manifests plats géo** (CD-unused mais doc-entangled) = consolidés en `base/`+overlays avec repoints
de citations (design PR bornée, pas suppression unilatérale) `[FAIT source=geo-archi §SD2(ii), geo-socle prune-audit]`.

**Asymétrie du feed geo→graphe** : satellite/3D = **feed MINCE** (consomme le graphe, produit peu :
provenance-de-vue) ; extraction + zones = **feed RICHE** (produit zones/normes/constraints/effet-densifiant)
`[FAIT source=geo-archi §SD1(iii)/§SD2(iii)]`.

⟨immo, i-arch, geo-zones, geo-archi⟩

## 3. Architecture cible bout-en-bout

Chaîne de **5 étapes immo (E1→E5)** + **branches geo** (points d'intégration). Chaque étape lit/écrit S3
(source de vérité), **idempotente par hash des entrées** (self-heal : rejouer = converger) — alignée sur
geo A.1 (DAG-first) `[FAIT source=immo §3, geo-socle (ii)]`.

| # | Étape | Composant | IA | Idempotence / self-heal |
|---|-------|-----------|----|--------------------------|
| **E1** | Scrape + parse + exploit déterministe → `layers/detection/<city>/latest.json` | `worker-live` (nouvelle écriture S3 ; aujourd'hui écrit seulement `ontology/…/project-state.json`, jamais `graph/`) | — | HEAD-skip CAS ; ré-exécution sûre |
| **E2** | Détection LLM → sous-graphe détection (fold dans layer détection, tag `{kind:llm}`) | `semantic-extract` en Job in-cluster (OFF par défaut) | **llm-mesh** | `[]` si off/erreur ; provenance-tag |
| **E3** | Grounding LLM → refs citations → `layers/grounding/<city>/latest.json` | worker-grounding (stage LLM) in-cluster | **llm-mesh** | plafond `MAX_LLM_CALLS` ; fail-closed |
| **E4** | **Merge canonique** `MERGE(détection, grounding, geo)` → `graph/<city>/latest.json` | **[cible]** merge-step, **seul appelant** du writer gardé `canonical-graph-writer.ts` | — | writer gardé (archive + read-anchor ETag + `If-Match`) |
| **E5** | **Écriture atomique PG (unique)** | `project-graph-from-s3` → `upsertGraphAtomic` sur la config-528 | — | upsert + delete orphelins (`step-3`) + gates ; rollback per-ville |
| serving | geo-api sert S3 LIVE (OGC/tuiles) ; SPA immo projette/score/affiche | per-cluster stateless | — | un deposit servi sans rollout |

- **E4 = la pièce clé manquante.** Aujourd'hui `graphify-34-enrich` « phase A » **re-lit l'état PG déjà
  pollué** (`subgraphForCity`, `graphify-34-enrich.ts:67`) et le re-projette — ce **n'est pas un merge** et
  ne peut pas soigner les orphelins ni introduire de détection fraîche. E4 **remplace la relecture PG par un
  vrai merge** d'entrées S3 explicites (détection + grounding + geo), chacune lue depuis sa propre couche
  `layers/*/<city>/latest.json`, jamais depuis PG `[FAIT source=i-arch A2/B.4]`.
- **Règle de merge (id = clé naturelle `::`)** : `props.refs` → **UNION** dédupliquée provenance-préservante
  (pattern `#616`, `graph-store.ts:877-893`) — aucune citation jamais perdue ; `props.properties` → chaque
  couche **OWNS** un jeu de clés **disjoint** (détection : `etape`/`instrument`/`effet_densifiant` ;
  grounding : refs `page`/`excerpt` ; geo : props zone/constraint) ; `label`/`type` → last-writer par
  **rôle** (grounding/geo > détection). Précédence **fixe et nommée** dans le merge-step, jamais émergente
  de l'ordre d'écriture `[FAIT source=i-arch B.9 OQ-D3]`.
- **grounding ⊥ freshness (2 axes orthogonaux, ne pas confondre)** : la **fraîcheur** vient **uniquement**
  d'un re-scrape → re-exploit (E1) ; le **grounding** applique un candidat pré-certifié (0 scrape) et
  laisse la **date inchangée**. Une ville peut être fresh-but-ungrounded, grounded-but-stale, les deux, ou
  aucune. E4 ne doit **pas** traiter « re-projeter un raw stocké » comme un « refresh » `[FAIT source=i-arch B.4a]`.
- **Où tourne l'IA** : **E2/E3 uniquement**, via le **mesh in-cluster** (compte dédié), jamais ailleurs
  `[FAIT source=immo §3]`.
- **Le seam geo→E4** (voir §7) : geo **dépose** en S3 + **sert** ses contrats existants ; un **adapter
  geo→graph immo** (sous-step de E4, extension de `run-geo-mapper.ts` + Job 35) lit le deposit + les
  contrats servis et **émet `layers/geo/<city>/latest.json`** ; geo **n'écrit JAMAIS `graph_nodes`**
  `[FAIT source=i-arch C, geo-socle SEAM]`.

⟨immo, i-arch, geo-socle⟩

## 4. Orchestration k8s

- **Moteur = `@sentropic/s3-dag` (D-moteur-1 ratifié).** Lib testée (dag / executor-k8s / quota /
  reconcile / lease / identity ; PV canary câblé) mais **gate 4-preuves pending → PAS promue en moteur
  prod** ; à **promouvoir** (canary PV) puis généraliser par-lane (**Refresh Controller**) `[FAIT source=geo-archi §SD2(i), geo-socle (i)]`.
- **Primitive concrète réutilisable** : le **CronJob self-driver** `pv-probable-backlog-cronjob.yaml`
  (schedule + `concurrencyPolicy: Forbid` + lease-lock `coordination.k8s.io` + état-sur-S3 +
  self-suspend-terminal + lance des child Jobs depuis une worklist S3) = **la primitive full-auto prouvée**.
  Le seed de reconcile déclaratif = `acquisition/src/s3dag/{pv-dag,reconcile-run,canary-node-run,emit-manifests}.ts`
  `[FAIT source=geo-socle (i)]`.
- **Chaîne reconcile** : `[schedule] CronJob orchestrator → [decide] s3dag diff (quelles couches/slugs
  stale) → [work] lance capture→extract→deposit (chacun écrit S3 + met à jour l'état S3) → [serve] geo-api
  sert S3 + atomic-PG-writer projette S3→PG → [verify] served_count + set_hash fail-closed → marque frais`
  `[FAIT source=geo-socle (ii)]`.
- **Sharding & quotas (r4 mesuré)** : refresh-pod = **req.cpu 100m / lim.cpu 500m / mem 3Gi (heap 2560)**,
  528 villes en **~80 min** (r4 12:05→13:25Z) ; le pic mémoire per-ville = octets bruts des PV dans
  `records` (ville dense saint-henri 199 docs : OOM@512Mi, OK@3Gi) — **non borné par `--chunk`** (city-
  sharding, pas borneur mémoire). **N=2 shards dépasse déjà lim.mem 6Gi** → in-cluster **N=1 séquentiel =
  plafond** sauf relèvement `[FAIT source=k8s §1/§3]`.
- **Driver d'échelle (WP6, 40→1000 villes sans OOM)** : sortir le **SCRAPE en SCW Serverless Jobs**
  (enveloppe ressources propre, **hors quota OVH**), garder le canonical-write in-cluster (léger). Le
  « mesh » = le pont S3 (handoff durable) + identité/secrets per-namespace + egress S3-BHS
  (`54.39.60.208/32:443`) `[FAIT source=k8s §2, i-infra §2]`.
- **Quotas — pré-requis P0 DUR** : `preprod-cap` **vit HORS git** (valeurs live = desserrages de session) ;
  un apply CD naïf les reverterait. **Réconcilier live→git AVANT toute gestion auto** (candidats read :
  `deploy/k8s/00-namespace.yaml`, `deploy/overlays/preprod/kustomization.yaml` `à confirmer`). Node pool OVH
  = 3×1840m = 5520m **PARTAGÉ tous tenants** (immo/geo/matchid/openerp) `[FAIT source=i-infra §2, k8s §0/§3]`.
- **Séquençage CD** : apply via `kustomize build --load-restrictor LoadRestrictionsNone <overlay> | kubectl
  apply` (**jamais** `apply -f deploy/`, jamais set-image-seul — cause racine #617) ; ordre idempotent
  **quota → RBAC/SA → composants pipeline → CronJob pilote** ; patchs **name-based** uniquement (les
  index-based bannis, cause du drift SCRAPE_S3 #629 → MinIO ENOTFOUND) ; placeholder image fail-loud
  `PINNED-BY-CI…DO-NOT-APPLY-UNEDITED` `[FAIT source=i-infra §4, k8s §0]`.
- **Reprise / observabilité** : `backoffLimit` + isolation per-ville (un OOM/404 ne tue pas le run —
  anti-pattern r4 exit=1 saint-henri) ; E2/E3 fail-closed ; **cert = OUTCOME mesuré** (`worker-live done`
  cities/seen/errors + `PG feed: ON` + created_at + preuve S3 path-style + pas d'OOM), **jamais
  `Job=Complete`** (r4 était Failed mais 527/528 avaient landé) `[FAIT source=k8s §4, i-infra §8]`.
- **KPI fraîcheur MESURABLE (vs baseline t0)** : chaque run diffe son sha-set vs
  `docs-preprod/baseline-shaset-20260905/raw-pdf-shaset.txt` (**sha256 `be4a80f5…`, 19906 shas / 436
  villes**) → {nouveaux, disparus, inchangés} per-ville ; corroboré par `max(meetingDate)` (récence contenu)
  vs mtime raw (récence scrape). Le source-gap fraîcheur (non-mesurable rétro) devient mesurable en avant
  `[FAIT source=k8s §4]`. **Rétention `raw/`** (PVC 40Gi ~64%) : politique archive cold-S3 / prune
  post-canonical-write nécessaire `[FAIT source=k8s §3]`.

⟨i-infra, k8s, geo-socle, geo-archi⟩

## 5. Writer canonique + atomic-sole-writer (résolution de la dette)

**Dette (code-vérifiée) : deux écrivains PG → orphelins.**
- `worker-live` → `upsertGraph` **PUR additif** (`ON CONFLICT (id)`, union `#616`, opt-in creds
  `decidePgFeed` #626/#628) : ne supprime jamais les nœuds disparus ⟹ accumulation d'orphelins
  `[FAIT source=i-arch B.3, immo §6]`.
- `upsertGraphAtomic` **supprimerait** les orphelins (REPLACE + `step-3` delete + `materializeSeveredSources`)
  MAIS ses gates aborteraient : gate3 (`findMissingSourceRefs`, identité = **`docSha` seul**) verrait les
  docShas du grounding **manquants** dans un re-emit détection-only et **aborterait toute la ville** — d'où
  le maintien de l'additif `[FAIT source=i-arch A3/B.3, immo §6]`.

**Fix cible** : E4 produit un canonical **déjà mergé** (détection ∪ grounding ∪ geo) ; E5 = **seul**
écrivain via `upsertGraphAtomic`. Alors : **(1)** orphelins **auto-résolus** (l'atomic supprime les nœuds
absents du nouveau canonical — self-heal natif) ; **(2)** grounding **préservé** (il est **dans l'entrée**
E3→E4 ⟹ gate3 ne détecte plus de régression) ; **(3)** projection **dé-starvée** (E4 peuple `graph/…` pour
les 528 villes) `[FAIT source=i-arch B.1/B.5, immo §6]`.

**Adapter, ne pas reconstruire** : le writer gardé du canonical **existe déjà** (`canonical-graph-writer.ts`
— archive pré-image + read-anchor ETag + refus `ConcurrentCanonicalWrite`/`If-Match`). E4 **est la nouvelle
source du `body`** ; le manquant = (a) le merge lui-même, (b) le **fold des 2 shell-writers**, (c) les
entrées S3 par couche (worker-live n'en écrit aucune aujourd'hui) `[FAIT source=i-arch A1/B.4]`.

**Fold des 2 shell-writers (pré-condition DURE de E5-at-scale).** `tools/graphify-v23/gate.sh:155` et
`tools/grounding/publish-citation-grounding.sh:52` publient le canonical via `s5cmd` en **bypassant** la
garde (`canonical-graph-writer.ts:30-34`) ⟹ 3 écrivains, invariant sole-writer **VIOLÉ**. Fix : (code, immo)
re-cibler leur PUT vers `layers/grounding/` → producteurs de couche ; (deploy/RBAC, i-infra) **révoquer**
le canonical-write de leur SA. **À séquencer AVANT E5-at-scale** — sinon un write concurrent clobbe pendant
l'atomic `[FAIT source=i-arch A1/B.9 OQ-D4, i-infra §11]`.

**Garantie sole-writer mesh-wide = 3 couches (i-infra)** : (1) **RBAC** canonical-write exclusif au SA du
merge+write ; (2) **`pg_advisory_lock`** sur le PG partagé (point de coordination cross-cluster) tenu pour
toute la passe = exactement-1 mesh-wide, self-heal (un k8s `Lease` est cluster-scoped → rejeté) ; (3)
**CAS `If-Match`** existant = filet anti-lost-update (ceinture + bretelles) `[FAIT source=i-infra §10c/§11 OQ-D2]`.

**Merge-step owner = CronJob DÉDIÉ** (convergence immo/i-arch/i-infra), **pas** un post-step `worker-live`
(qui ferait de chaque pod scrape un writer canonical potentiel → N writers → race) `[FAIT source=i-arch OQ-D1, i-infra §11 OQ-D1]`.

**Pont legacy one-shot** (`CLEANUP_LEGACY_ORPHANS.md`, réutilisé, non-récurrent) : le backlog `-`-scheme
(Q1 = **10 234** orphelins supersédés / 479 villes) n'est pas dans le canonical `::` → l'atomic le
supprimerait mais les gates lisent la disparition comme data-loss et abortent. `upsertGraphAtomic(…,
intendedRemovals = safePurgeIds)` avec `safePurgeIds` = nœuds legacy dont `refs ⊆ ⋃ refs(:: nodes)` (gate
couverture docSha/rawRef ; gate2 complétude **non exempté** → rollback si mis-scopé, pas data-loss)
`[FAIT source=i-arch B.6]`. **Garde purge** : test = `props.properties` **vide** ET refs schéma-complet,
**JAMAIS `props.refs` seul** (sinon faux-safe → data-loss) ; sainte-martine préservée par construction
`[FAIT source=k8s §Garde-purge]`.

**Transition PHASÉE #626 (retrait EN DERNIER)** : le feed PG direct additif de `worker-live` **reste en
dual-write** pendant P0 (PG jamais starvé) ; il n'est retiré (`decidePgFeed→{feed:false}`) **qu'à P3**,
après E4+E5 (et la voie mesh) live ET validés ; repli = réactiver le flag `[FAIT source=i-arch B.7, immo §6]`.

⟨i-arch, i-infra, k8s, immo⟩

## 6. Intégration cluster-mesh / llm-mesh (#627)

**Terme critique à graver (convergence backbone + geo-archi)** : le package `@sentropic/cluster-mesh`
**EXISTANT = fédération d'identité, ne route AUCUN LLM** (`git grep cluster-mesh` geo = 0 ; seule occurrence
= doc-comment `packages/s3-dag/src/identity.ts:31`). ⟹ « cluster-mesh LLM-hosting » **ne réutilise pas ce
package** : c'est un **NOUVEAU mesh inter-cluster LLM à construire**. Ce fait informe le **coût** de l'option
(a), il ne re-litige pas la direction `[FAIT source=geo-archi GATE #2, immo §4]`.

**Ce qui EXISTE** : le mesh = **librairie in-process** (`mesh-runtime.ts`) avec clés par-provider + HTTP
provider direct ; **aucun endpoint gateway** ; extraction sémantique OFF par défaut (`RADAR_LLM_EXTRACTION=1`
+ clé) ; **jamais câblée in-cluster** (jobs 33/34/41 n'injectent ni flag ni clé) ; grounding tourne sur le
**HOST** (`worker-grounding.sh` → gpt-5.6-luna) ; Job 41 = **publish-only** `[FAIT source=immo §2]`.

**Ce qui est à BÂTIR (source-gap, socle #627 draft)** :
- le **contrat gateway** lui-même : aucun endpoint HTTP inbound ni contrat de token n'existe
  (`LLM_MESH_BOUNDARY.md` = frontière de package, pas contrat réseau) ;
- les **clés de config** `LLM_MESH_GATEWAY_URL` + `LLM_MESH_ACCOUNT_TOKEN` (noms à ratifier) absentes de
  `config.ts` ; le **client gateway** (`ProviderAdapterClient`) + provisioning compte + Secret k8s ;
- le **service déployable** : dans **AUCUNE option il n'existe** — `llm-mesh`/`llm-gateway` = bibliothèques,
  seul runtime = **h2a-runtime host-side** ; différenciateurs = **frontière d'identité** (qui appelle) +
  **qui opère** `[FAIT source=immo §4, cadrage-transverse]` ;
- **BUDGET/QUOTA par appelant = exigence first-class** (sinon full-auto = facture galopante ; historique
  €480 Mistral / €50 §5) — table identité d'appelant à définir `[FAIT source=cadrage-transverse]`.

**Correction egress (i-cond, à refléter — ne pas confondre avec GATE #2 hosting) : AUCUNE décision
egress n'est rendue.** Le dossier `DECISION_LLM_EGRESS_STANDARD_PATH.md` est un **DOSSIER OUVERT/PENDING**,
pas un arbitrage : son « Option C » (« split-by-mode ») = une **préconisation**, jamais ratifiée. Le
dossier est **PÉRIMÉ** (daté du 19 juillet) et **ORPHELIN** (aucun pilote assigné). Ne pas présenter
« cluster-mesh confirmé » ni « Option C décidée » sur cette base — la seule direction actée est l'énoncé
verbal owner de GATE #2 (§9.1), à CONFIRMER formellement ; l'egress reste **à re-piloter et rafraîchir**
`[FAIT source=cadrage-transverse]`.

**Volet SUBSTRAT (i-infra)** : deploy des pods LLM (scheduling, resource/GPU quotas, netpol egress
mesh-ou-scopé, isolation) = contributeur **quand le draft #627 existe** ; **PAS à i-infra de drafter** la
spec IA. **Lead #627 = à confier par l'owner** (candidats : llm-mesh / i-arch lead, ou session mesh)
`[FAIT source=i-infra §10-#627]`. netpol : si mesh EN-cluster → 0 egress externe (préféré) ; si LLM
externe → egress scopé endpoint `[FAIT source=i-infra §6]`.

⟨immo, i-infra, geo-archi⟩

## 7. Feeding-contract geo→immo

**Frontière ratifiée** : **geo = spatial-join + serve ; geo n'écrit JAMAIS `graph_nodes` ; immo projette**
(`SPEC_GEO_ENV_CONSTRAINTS_S9.md §1`). Le contrat a **2 côtés** : (a) côté **geo** = les contrats natifs
**déjà servis** (`ConstraintHit` env, OGC features + `zone_code`/normes, `BasemapSpec`/tiles) — **0 nouveau
format geo** ; (b) côté **immo** = un **adapter geo→graph** (sous-step E4, extension `run-geo-mapper.ts` +
Job 35) qui lit le deposit `normalized/` + les contrats servis et émet les nœuds `::` dans `layers/geo/`
`[FAIT source=i-arch C, geo-zones (iii), geo-socle SEAM]`.

**Ce que geo PRODUIT (collections servies S3 `normalized/` + OGC `/collections/<id>/items`)** :

| Output | Collection(s) | Clés / statut |
|---|---|---|
| Env CPTAQ | `ca-qc-constraints-<slug>` | `constraint.kind=cptaq-zone-agricole` ; **SERVI** (4 villes, agricole-only) |
| Env BDZI | `qc-bdzi-flood-zones` | zone inondable ; **NOT_ACQUIRED** (couche 22, 621 poly) — serving GATÉ tier-2 |
| Env GRHQ | `qc-grhq-waterbodies`/`-network` | hydro ; **NOT_ACQUIRED** (3,76 M) — serving GATÉ tier-2 |
| Vraies zones | `qc-zonage-<slug>` (2 layouts) | **`zone_code` bylaw RÉEL verbatim** ; **868/1106 servies** ; LOT-1 = 16 prêtes |
| Provenance v2 | par feature | `proof.geometry_source = {url, retrieved_at, sha256}` + provenance règlement |

**Node-types émis par l'adapter (`::` scheme, projection immo)** : `zone::<muni>::[<year>::]<realNumber>`
(realNumber = numéro règlement verbatim, ex. `H-609-4`, jamais dérivé) ; `overlay::<layer>::<muni>::<featureId>`
(env `ConstraintHit`, type **distinct** — jamais un nœud Zone) ; **Lot** = **clé naturelle**
`lot::<canon(cadastre_no, autorité, vintage)>` via un **canonicalizer partagé geo-jointures** (SSOT
`lotZoneJoin.ts`) : détection et adapter dérivent **le même id** ⟹ collision-free ; l'adapter **ne mint pas**
de Lot, il **layer les props geo** sur le nœud Lot existant. Arêtes : `zone_of` (Lot→Zone), `within`
(Lot/Zone→overlay, résultat `EXACT_GEOM`), `governed_by` (Zone→`bylaw::…`) `[FAIT source=i-arch C.1/C.2/C.4]`.

**Provenance / co-sign** : refs geo = même shape `Ref` (`{docSha, rawRef, page?, excerpt?, linkSource:"geo-<layer>"}`),
`docSha` = SHA-256 de l'artefact **tel que servi par geo** ⟹ ref geo first-class sous gate3 (préservée à
travers re-projections comme une ref PV). **geo doit surfacer un content-hash stable + le vrai numéro de
zone** dans son payload servi (item co-sign OQ-G3). **Statut co-sign** : OQ-G1/G2 (jointures) + OQ-G3/G4
(zones) **co-signés geo-cond** ; le co-sign **consolidé** (carte complète node-type-ownership + versioning
de couche) est **pending l'extraction-contract semver geo-archi** (dernier morceau, piloté geo-cond)
`[FAIT source=i-arch C entête/C.3/C.5]`.

**BUILD DEPENDENCY** : le canonicalizer `lot::` **n'existe pas encore** en lib export — geo-jointures le
livre (code + test) après l'écriture de l'**id-format spec** (anti-invention). Il gate **la couche
Lot-enrichment geo seulement**, **PAS le P0 orphan-fix** (qui opère sur les `::` `bylaw`/`event`/`signal`/
`zone` existants) `[FAIT source=i-arch C.2 build-dependency]`.

⟨i-arch, geo-zones, geo-archi, geo-socle⟩

## 8. Phasage — P0 (immédiat, sans owner) → P1+ (gaté 2 décisions IA)

| Phase | Contenu | Dépend d'un owner ? |
|---|---|---|
| **P0** | worker-live écrit `layers/detection/` ; **E4 déterministe** (détection ∪ grounding certifié, 0 scrape/LLM) via writer gardé ; **E5** `upsertGraphAtomic` sur config-528 ; feed PG direct **KEEP en dual-write** ; **fold shell-writers + RBAC revoke** ; réconcilier quota live→git | **NON** (ni IA, ni vision, ni mesh) |
| **bridge** | pont legacy one-shot (`intendedRemovals` = safePurgeIds), non-récurrent | Non |
| **P1** | **E2 détection LLM** in-cluster (L1+L2 #627) derrière flag, fallback clés par-provider | **OUI** (GATE #1 + #2 + #627) |
| **P2** | **E3 grounding LLM** in-cluster (L3 #627), host en fallback | OUI (#627) |
| **P3** | **cutover** + métrage coût/quota, **retrait du feed PG direct** (`decidePgFeed→false`), décommission host/clés (L4), convergence Refresh Controller geo | OUI |
| **geo //** | seams §7 (LOT-1 zones, ConstraintHit CPTAQ, satellite GO#2) + acquisition BDZI/GRHQ (gate tier-2) | cadence indépendante |

**Ordonnancement DUR** (ne pas réordonner) : **pas E5 avant E4** (l'atomic supprimerait de la détection
sans contribution canonical) ; **pas le bridge avant E5** ; **fold shell-writers + RBAC revoke AVANT
E5-at-scale** ; **pas de retrait du feed direct avant P3** (validé). **P0 ne dépend pas de P1–P3**
`[FAIT source=i-arch B.7, immo §9]`.

**Repli (rollback)** : P0 — stopper le merge-step / désactiver le CronJob E5 (le feed direct maintient PG ;
l'atomic est idempotent + gate-guardé → ville abortée laisse PG inchangé) ; bridge — per-ville
transactionnel + archives `graphify-34-backups/` ; P1/P2 — flag off → E4 retombe sur détection/grounding
déterministe ; P3 — réactiver le flag du feed `[FAIT source=i-arch B.7]`.

⟨i-arch, immo⟩

## 9. Décisions owner requises + questions ouvertes résiduelles

### 9.1 — Les 2 gates IA (chemin critique couche IA, cadrés — pas à re-débattre)

- **GATE #1 — route VISION d'extraction (ADR-0024, remplaçant Mistral).** État : route vision **INOPÉRANTE
  par construction** (`grille-vision-extractor.ts:351` throw sans modèle sanctionné ; garde
  `vision-engine-policy.ts` live + CI ; aucun modèle remplaçant câblé ; aucun ADR de suivi). Décision =
  candidat modèle vision fort **via gateway** (a priori `gpt-5.6-terra`/`luna` xhigh, JSON strict par
  cellule), **benchmark sur grilles DÉJÀ extraites** (0 re-paiement Mistral) → double-consensus + ratif
  geo-archi → nouvel ADR. **⚠ Blocker run** : le benchmark exige le gateway/Codex (down →6/09) → design +
  critères **maintenant**, run **post-gateway**. Non-vision avance en // (OCR `mistral-ocr-latest`
  sanctionné). **Owner de résolution** : owner (ratif) + geo-archi (double-consensus) `[FAIT source=geo-archi GATE #1]`.
- **GATE #2 — hosting + egress du moteur LLM (D-moteur-2, « quelle FORME bâtir »).** L'owner a **déjà
  énoncé la direction** (« pipeline basé cluster-mesh », « graphify intégré au cluster-mesh ») ⟹ le
  dossier = **exposer le trade-off fidèlement pour un CONFIRM/override informé, PAS re-litiger de zéro**.
  Trade-off : **(a) cluster-mesh-hosting [direction owner]** vs **(b) service central `sentropic-sentech`**
  — netpol/latence/coût/effort exposés. **Egress — correction (i-cond) : AUCUNE décision rendue.** Le
  dossier `DECISION_LLM_EGRESS_STANDARD_PATH.md` = **PENDING**, **PÉRIMÉ** (19 juillet), **ORPHELIN**
  (aucun pilote) ; son « Option C » (« split-by-mode ») = **préconisation**, pas un arbitrage — ne pas
  présenter « cluster-mesh confirmé » ni « Option C décidée » ; **à re-piloter et rafraîchir** (cf. OQ #2).
  Rappel §6 : le service déployable **n'existe dans aucune option** ; BUDGET/QUOTA par-appelant = first-class.
  **present-decision dossier prêt** (2 faces steelmanées, term-lift gravé). **Owner de résolution** : owner
  (confirm/override) + pilote #627/egress à désigner `[FAIT source=geo-archi GATE #2, cadrage-transverse]`.

### 9.2 — Questions ouvertes résiduelles (owner de résolution entre parenthèses)

1. **Install cluster-mesh CNI + routing** = **seul gate cross-tenant restant** orchestration — owner-direct + call joint geo-cond (lié GATE #2) `[FAIT source=i-infra §9]`.
2. **Lead #627 + pilote egress** (dossier `DECISION_LLM_EGRESS_STANDARD_PATH.md` orphelin/périmé, §6/§9.1) à assigner (owner ; i-cond propose) `[FAIT source=i-infra §10, cadrage-transverse]`.
3. **Contrainte données** : texte PV/règlement traversant le gateway (invariant public-only host) — à trancher dans #627 (lead #627 / owner) `[FAIT source=immo §9]`.
4. **Mesh partagé geo+immo** vs deux consommateurs du même gateway (i-cond + geo-cond + owner) `[FAIT source=immo §8/§9]`.
5. **Gouvernance quota** (caps par tenant sous allocatable, relèvement namespace) = shared-infra/owner `[FAIT source=i-infra §9]`.
6. **Policy egress scrape** internet-large (ipBlock par site vs proxy sortant mutualisé) = revue sécu (i-infra + k8s) `[FAIT source=i-infra §9, k8s Q4]`.
7. **SCW Serverless (WP6) maintenant** vs après stabilisation in-cluster N=1 = décision phase/plateforme `[FAIT source=k8s Q2]`.
8. **Périmètre IA minimal geo** (modèles refresh récurrent vs one-shot) = owner/coût `[FAIT source=geo-zones (iv), geo-archi §SD2(ii)]`.
9. **OQ-D résiduelles i-arch** : ordering couche vs fraîcheur (D2) ; placement `materializeSeveredSources` dans l'atomic (D5) ; confirmer 0 consommateur du back-read PG→S3 (D6, i-cond) `[FAIT source=i-arch B.8/D]`.
10. **OQ-G résiduelles geo** : content-hash stable + numéro zone réel + versioning `layers/geo/` (G3) ; `governed_by` émis vs dérivé (G4) ; overlays contract-ready vs audit-gated (G5, geo-cond) `[FAIT source=i-arch C.5]`.

⟨geo-archi, i-infra, i-arch, immo, k8s, geo-zones⟩

## 10. Composants NÉCESSAIRES vs à retirer/fusionner

**Nécessaires (minimal)** : `worker-live` (E1, + nouvelle écriture `layers/detection/`, sans feed PG à
terme) · Job détection LLM (E2, câblé mesh) · Job grounding LLM (E3, stage LLM in-cluster) ·
**merge-step canonical E4 [cible]** réutilisant `canonical-graph-writer.ts` · `project-graph-from-s3` →
`upsertGraphAtomic` (E5, écrivain unique) · **`@sentropic/s3-dag`** (orchestrateur) + CronJob self-driver
`pv-probable-backlog` · **adapter geo→graph** (sous-step E4) · gateway mesh + Secret compte dédié [cible,
#627] · côté geo : capture→S3, deposit-job on-cluster, coverage-gate, cascade-extract-minimal.

**À retirer / fusionner** :
- **Feed PG direct de `worker-live`** (`upsertGraph`) — retiré **à P3** (interim jusque-là) `[FAIT source=i-arch B.7]`.
- **2 shell-writers** (`gate.sh:155`, `publish-citation-grounding.sh:52`) — re-routés en producteurs
  `layers/grounding/` + canonical-write RBAC-révoqué (pré-condition E5) `[FAIT source=i-arch A1]`.
- **`graphify-34-enrich --apply` manuel** — absorbé par E4 (même écrivain gardé) ; l'enrichissement
  (instrument/etape) RELOCALISÉ dans le producteur détection `[FAIT source=i-arch B.4/OQ-D6]`.
- **CronJob projection dans sa forme input-starved** — remplacé par E5 alimenté par E4 (script conservé,
  source d'entrée changée) `[FAIT source=immo §7]`.
- **Grounding host + Job 41 publish-only** — fusionnés en E3 in-cluster une fois le gateway dispo (host en
  fallback L3/L4) `[FAIT source=immo §7]`.
- **6 manifests plats geo** (`geo-api-{deployment,service,ingress}.yaml`, `deployment-api/service-api/ingress.yaml`) — CD-unused (supersédés par `base/`+overlays, ADR-0028) mais doc-entangled → **design PR bornée** : suppression + repoint citations (`README`, dossiers spec). **KEEP** : `job-fetch.yaml` (capture), `postgis-statefulset.yaml`+`geo-postgis-service.yaml` (jusqu'au writer) `[FAIT source=geo-socle prune-audit]`.
- **Chemin `workflow_dispatch` manuel** geo — retiré une fois l'auto-chaînage en place `[FAIT source=geo-socle (ii)]`.

⟨i-arch, immo, geo-socle⟩

## 11. CONTRADICTIONS / tensions inter-sections (non masquées)

1. **Argo — statut divergent.** `⟨k8s⟩` (commit 9057f23) liste encore « Argo Workflows/Events vs
   CronJob-fan-out » en **question ouverte #1** et évoque « Argo Events / queue » pour l'event-driven v2.
   `⟨i-infra⟩`, `⟨geo-archi⟩`, `⟨immo⟩` : **Argo TRANCHÉ NON** (s3-dag D-moteur-1 ratifié). **Résolution
   retenue = Argo écarté** ; `⟨k8s⟩` prédate la ratification. *(Non-bloquant : simple péremption.)*
2. **Projection S3→PG vs feed PG direct comme écrivain cible.** `⟨k8s⟩` §0/§1/§5 : le full-auto **bâtit sur
   le direct-PG-feed #629/#626 via le writer atomique**, « **PAS d'étage projection S3→PG** (input-starved,
   vestigial) ». `⟨i-arch⟩`/`⟨immo⟩`/`⟨i-infra⟩` : **E5 = `project-graph-from-s3` → `upsertGraphAtomic`**
   (le **script de projection réutilisé** à l'échelle, alimenté par E4), et le **feed direct est l'interim
   additif** retiré **en dernier** (P3). **Tension de framing** : `⟨k8s⟩` traite le feed direct comme la
   destination ; les autres comme le pont à supprimer. **Réconciliation** : les deux décrivent le même
   dual-write P0 ; la cible canonique = E4→E5 (projection alimentée), pas le feed direct. À harmoniser dans
   la comm : le mot « projection » désigne le **script** E5 (conservé), pas la forme input-starved (retirée).
3. **Décompte des orphelins legacy.** `⟨i-arch⟩`/CLEANUP = **10 234** orphelins Q1 / 479 villes ; `⟨k8s⟩` =
   **~33k** orphelins `type-slug-ref` vs `type::slug::ref` (+ 953 nœuds « stub » servi-stale). Périmètres
   probablement différents (Q1 supersédés vs total legacy dé-schéma) mais **non réconciliés** → `source-gap`
   sur le chiffre exact ; le mécanisme de fix (intendedRemovals + garde purge 2-dimensions) est, lui, aligné.
4. **Serving mesh — révision interne i-infra (résolue, pas une contradiction).** `⟨i-infra⟩` §7 penchait
   « single + mesh-routed », puis §10(a) **révise en per-cluster répliqué** (invariant data-déjà-partagée) ;
   `⟨geo-socle⟩` Q3 adopte per-cluster. **Convergé.** *(Signalé pour traçabilité du revirement.)*
5. **« Mistral » à double rôle (nuance, pas contradiction franche).** `⟨geo-zones⟩` liste « Mistral pour
   PDF-normes » en IA réutilisable ; `⟨geo-archi⟩` distingue **OCR `mistral-ocr-latest` sanctionné (gardé)**
   du **vision Mistral inopérant (remplacé, GATE #1)**. À lire ensemble : OCR Mistral reste, vision Mistral
   sort.

⟨k8s, i-arch, i-infra, immo, geo-socle, geo-zones, geo-archi⟩

*Fin — doc consolidé i-cond. Aucun fichier suivi des dépôts modifié (lecture seule sur code/sections).*
