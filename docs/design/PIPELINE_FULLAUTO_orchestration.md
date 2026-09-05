# PIPELINE_FULLAUTO_CLUSTER_MESH — Volet ORCHESTRATION / DÉPLOIEMENT / QUOTAS / GOUVERNANCE (i-infra)

> Section contributeur i-infra pour la consolidation i-cond (track 01M1S25MVCND04YZN76KTVNGAE).
> Complète — ne duplique pas — la section k8s (run/shard/cluster-mesh ops) et la section i-arch (writer PG + canonical-merge). Mon périmètre = le **comment-c'est-déployé-gouverné-séquencé** sur le cluster.

## 0. Périmètre
- **Moi (i-infra)** : desired-state git-sourcé + réconcilié, gouvernance des quotas, séquençage CD, déploiement de l'atomic-writer (côté ops/RBAC), egress par composant, Argo-vs-CronJob, Q3 serving per-cluster-vs-mesh.
- **Hors** : archi du merge canonical + contrat writer (i-arch) ; exécution/sharding runtime + mesh-ops (k8s) ; contrat de serving geo (geo-cond).

## 1. Principe directeur : desired-state réconcilié, git-sourcé, FAIL-LOUD
Le full-auto ne tient que si TOUT l'état est en git + réconcilié (GitOps), jamais impératif/drifté. Deux dettes de la session PROUVENT le risque et sont des **pré-requis P0** :
- **Drift SCRAPE_S3 (#629)** : un patch overlay index-based a clobbé silencieusement POSTGRES_DB/S3_ACCESS_KEY après une insertion env → path-style OFF (MinIO ENOTFOUND) au nightly, masqué car les runs manuels utilisaient un env séparé. **Leçon** : les manifestes doivent être *fail-loud sur drift* (rendu + validé en CI, pas découvert à 3h du matin). Patchs index-based bannis → name-based/test-op.
- **Drift quota preprod-cap** : la ResourceQuota vit HORS git ; les valeurs live = desserrages de session → un apply CD naïf les reverterait. **Le full-auto ne peut PAS s'armer sur un quota drifté.**

## 2. Gouvernance des quotas (fondation — bloquant tant que driftée)
1. **Réconcilier live→git — mais chez l'OPÉRATEUR, pas ici** (confirmé de mon read `deploy/k8s/00-namespace.yaml:19-22`) : la ResourceQuota préprod (+ Namespace + LimitRange + baseline NetworkPolicy) est OWNED BY THE CLUSTER OPERATOR (repo poc-k8s, github.com/rhanka/poc-k8s) — « the operator's copy wins » ; le manifeste radar-immobilier n'est gardé que pour rendre un bundle kustomize auto-suffisant/kind-review. Donc : (a) un app-CD radar-immobilier NE revert PAS le quota (rien à appliquer côté app) ; (b) le vrai drift = les desserrages LIVE (session k8s) vs la source poc-k8s → à réconcilier DANS poc-k8s (cross-tenant, owner/opérateur), sinon un reconcile poc-k8s les revert. Le git-source du quota = job de l'opérateur poc-k8s, PAS du repo app.
2. **Dimensionner sur ÉVIDENCE, pas au doigt** : refresh-pod = req.cpu 100m / lim.cpu 500m (run r4 : 528 villes/80min <<7200s) ; mem 3Gi (worst-case ville doc-lourde saint-henri : OOM@512Mi→3Gi). Tient dans le quota standing (co-check : req 350<400, lim 2100<2300, lim.mem 5376<6144).
3. **Marge rollout-surge** : à 350m standing il reste 50m ; un rollout maxUnavailable:0 coïncidant tripperait 400m (race nightly-vs-rollout). Politique de marge quota à intégrer (req.cpu +~100m) — mais **après** réconciliation git (sinon on empile du drift).
4. **Multi-tenant** : node allocatable = 3×1840m=5520m PARTAGÉ (matchid/openerp/geo/sentropic…). Contrat de gouvernance : Σ(caps par tenant) ≤ allocatable, sans affamer les voisins. Un relèvement de quota namespace = décision shared-infra, pas lane-locale.

## 3. Orchestration : CronJob self-driver (+ contrôleur reconcile léger) — Argo ÉCARTÉ (s3-dag ratifié)
- **Tranché (ratification s3-dag)** : Argo Workflows = **NON**. L'orchestration = *CronJob self-driver + reconcile desired-state* — un pilote qui réconcilie « quelles villes sont fraîches / à rafraîchir » plutôt qu'un cron qui re-scrape aveuglément tout. Réutilisable, footprint minimal, natif.
- **Pourquoi pas Argo** : DAG / fan-out / retries séduisants, mais +operator, +surface RBAC, +empreinte cross-tenant (install cluster-wide = SPOF/ownership comme Traefik). Écarté par s3-dag au profit du CronJob-self-driver.
- **Mon lean, étagé** :
  - **P0 (quick-win, sans IA/mesh)** = CronJob-self-driver + reconcile → E4 merge + E5 atomic-writer shippables MAINTENANT.
  - **Phase reconcile/mesh** = si le SLA fraîcheur l'exige, un **contrôleur reconcile LÉGER** (contrôleur/CronJob maison event-driven, footprint contenu — **PAS Argo**). Le seul gate cross-tenant restant côté orchestration = **install cluster-mesh** (lié à la décision hosting owner).

## 4. Séquençage CD (le mécanisme apply-k, certifié #617)
- La CD applique via `kustomize build --load-restrictor LoadRestrictionsNone <overlay> | kubectl apply -f -` (apply-k sur overlay ; **jamais** `apply -f deploy/`, jamais set-image-seul — c'était la cause racine de #617). Le full-auto DOIT passer par ce même chemin réconcilié (sinon on re-crée du drift SCRAPE_S3/quota).
- **Ordre d'apply idempotent** : quota (fondation) → RBAC/SA → composants pipeline (writer, feeders, merger) → CronJob/contrôleur pilote. Rien de suspendu-puis-oublié.
- **Placeholder fail-loud** : garder le pattern du tag image `PINNED-BY-CI…DO-NOT-APPLY-UNEDITED` (un apply non-pinné échoue visiblement au lieu de tourner du code stale).

## 5. Déploiement de l'atomic-sole-writer (mon input archi central, côté ops)
Fondation archi (= §9 i-arch) : worker-live est **ADDITIF** (upsert) précisément parce qu'un writer atomique overwrite **clobbererait le graphe groundé** (le grounding écrit `graph/<ville>/latest.json` que worker-live ne produit pas). Course grounding-vs-scrape à supprimer.
- **Contrat** : tous les producteurs (scrape, grounding, graphify) écrivent des **staging prefixes** ; un **MERGE stage** produit le canonical ; **UN SEUL writer atomique** commit le canonical (transaction PG / écriture d'objet atomique MinIO). Zéro writer concurrent → zéro race.
- **Ops/RBAC (mon volet)** : le writer = singleton (Deployment 1-replica + leader-election si HA, ou single-replica + PDB) ; **RBAC sole-write** : seul le SA du writer a le write sur le canonical (PG + `graph/*` canonical) ; les producteurs n'ont le write que sur leurs staging prefixes. C'est la même discipline least-priv/blast-radius que le cred dédié LOT-1 (ne pas donner le write-canonical au cred de capture).
- **P0** = E4 merge + E5 atomic-writer → résout orphelins + fraîcheur SANS IA/mesh. i-arch cadre merge/writer ; je cadre deploy/RBAC/séquençage.

## 6. Egress par composant (open question k8s, CNI=Calico)
- **scrape** → sites PV externes (egress internet large, domaines par ville) → policy egress scopée (ou default-allow-egress namespace scrape = tradeoff sécu à arbitrer avec auth).
- **LLM/grounding** → si llm-mesh EN-cluster : 0 egress externe (netpol-contenu, préféré) ; si LLM externe : egress scopé à l'endpoint (pattern geo single-ipBlock S3-BHS).
- **atomic-writer** → egress **in-cluster only** (PG + MinIO), netpol serré (comme geo-api A2 : kube-dns + store, default-deny).
- **Reco** : netpol par rôle (least-priv), pas une policy globale permissive.

## 7. Q3 — Serving per-cluster vs single+mesh-routed (geo-cond m'engage direct)
Question frontière mesh, domaine ops :
- **Per-cluster** : isolation (outage d'un cluster n'affecte pas les autres), netpol local simple ; mais N× ressources + N× cert/quota/ops + data-locality (chaque cluster a besoin de la donnée).
- **Single + mesh-routed** : une serving, le cluster-mesh route ; moins de ressources, source unique ; mais le mesh = SPOF + egress cross-cluster + latence + **son install est une question ownership/gouvernance (comme Traefik)**.
- **Mon lean (pending contrat serving geo-cond)** : le serving immo/geo est READ-mostly (descripteur, tuiles, SPA) + CDN-frontable → single + mesh-routed avec **cache per-cluster** pourrait équilibrer ; MAIS SPOF/ownership du mesh = gate owner-direct + call ops joint avec geo-cond. À trancher ensemble.

## 8. Fail-loud + observabilité + certif (la discipline)
- Chaque composant réconcilié = fail-loud sur drift ; CI rend + valide (dry-run=server) AVANT apply.
- **Certif sur OUTCOME mesuré, pas manifeste** : done + PG feed:ON + created_at + fraîcheur directement comptés — jamais Job=Complete ni « manifeste appliqué » (discipline mesure≠manifeste ; cf le SPOF = 2 pods sur 2 nodes MESURÉ, pas replicas:2 desired).

## 9. Open questions / gates (owner / cross-tenant)
- ~~Install Argo cluster-wide~~ = TRANCHÉ **NON** (ratification s3-dag).
- Install cluster-mesh + routing serving = owner-direct + joint geo-cond — **le seul gate cross-tenant restant** (lié à la décision hosting).
- Contrat de gouvernance quota (caps par tenant sous allocatable) = shared-infra/owner.
- Policy egress scrape internet-large = revue sécu (auth).
- Réconciliation quota preprod-cap live→git = pré-requis P0 (je confirme l'emplacement de mon read + route track [7dbf2a]).

## 10. Frontière mesh — réponses à geo-cond (Q3 + netpol cross-cluster + singleton)
Intègre les invariants geo-socle : (1) capture/jobs = S3 substrat partagé cross-cluster = déjà mesh-natif ; (2) netpol A2 à étendre cross-cluster ; (3) atomic-PG-writer = singleton exactement-1 mesh-wide ; (4) SEAM : i-infra=substrat mesh, geo-socle=workload-manifests.

### (a) Q3 serving geo-api : per-cluster vs single+mesh-routed → LEAN PER-CLUSTER
Révision de §7 à la lumière de l'invariant « données déjà mesh-partagées » : le substrat data est mesh-partagé (S3 cross-cluster + writer singleton = source unique) → le serving geo-api est un LECTEUR STATELESS de la donnée partagée. Donc :
- **Per-cluster répliqué = mon lean** : chaque cluster fait tourner son geo-api (stateless, lit PG/S3 partagé) → isolation (outage cluster n'affecte pas les autres), 0 SPOF serving-mesh-routing, pas de latence cross-cluster sur le chemin chaud tuiles. Coût marginal FAIBLE (compute-only, geo-api léger non-root 1-replica ; donnée NON dupliquée, déjà partagée).
- single+mesh-routed ajouterait un SPOF de routage cross-cluster + latence POUR 0 gain data (donnée déjà partagée).
- Réserve : touche l'ownership mesh → call joint geo-cond + gate owner-direct sur toute install cluster-mesh. Mais l'invariant data-partagée fait pencher NET vers per-cluster.

### (b) Modèle netpol cross-cluster (extension A2)
A2 (egress kube-dns + S3-BHS only, default-deny) PRÉSERVÉ + allows cross-cluster PAR RÔLE :
- writer → PG partagé + MinIO partagé (seuls egress writer) ; geo-api per-cluster → PG/S3 partagé en READ.
- Implémentation selon substrat : SI cluster-mesh installé (Cilium ClusterMesh / Istio) → netpol par IDENTITÉ de service mesh + mTLS ; SI réseau plat cross-cluster → ipBlock scopé (pattern S3-BHS 54.39.60.208/32 étendu aux endpoints cross-cluster). Default-deny maintenu dans les deux cas.
- Install d'une feature CNI cluster-mesh = décision cross-tenant owner-gated (comme Traefik/Argo). Je designe le modèle ; l'install substrat = gate owner.

### (c) Singleton exactement-1 mesh-wide (dispo ou à créer ?) → DISPO via PG
Pas besoin d'un nouveau primitif cluster-mesh : le writer écrit dans le PG PARTAGÉ → le PG EST le point de coordination cross-cluster naturel. Exactement-1 = **verrou consultatif PG (pg_advisory_lock) ou lease-row transactionnelle** : le writer acquiert le lock avant d'écrire → un seul writer effectif à travers TOUS les clusters, self-heal (lock relâché à la déconnexion/crash).
- Deploy (mon volet) : writer déployable PER-CLUSTER (1 réplique/cluster) mais seul le porteur du lock PG écrit → exactement-1 mesh-wide SANS lease cluster-mesh externe. 0 perte grounding (le lock sérialise merge+write). RBAC sole-write inchangé.
- Un k8s Lease natif est cluster-scoped (pas cross-cluster) → verrou PG plus simple ET déjà-partagé. Reco : pg_advisory_lock. (Logique = immo E5 upsertGraphAtomic, i-arch.)

### SEAM adopté (invariant 4)
i-infra = SUBSTRAT mesh (targeting cluster/ns, service-discovery cross-cluster, netpols mesh, choix du primitif de coordination, quotas) ; geo-socle = WORKLOAD-MANIFESTS (base/overlays/netpols-appliqués/jobs/CronJobs). Je fournis modèle+primitives, geo-socle câble les manifests.

### SPEC_LLM_CLUSTER_MESH #627 (draft manquant, dépendance couche IA P1)
PAS à moi de drafter (c'est la spec couche IA/llm-mesh, pas mon volet orchestration-substrat). Lead = llm-mesh (i-arch lead du chantier, ou session mesh [8f35d4]) + owner llm-mesh. MON apport à #627 = volet SUBSTRAT : deploy pods LLM (scheduling, resource/GPU quotas, netpol egress mesh-ou-scopé, isolation) — contributeur quand le draft existe. Reco : i-cond assigne le lead #627.

## 11. OQ orchestration tranchées (D1/D2 + A1 sole-writer deploy) — aligné section writer i-arch
Lu la section writer i-arch (immo-section.md) : E4 merge (layers/* → canonical S3 via le writer gardé existant If-Match/archive/read-anchor `canonical-graph-writer.ts:366-408`) + E5 `upsertGraphAtomic` sole PG writer. Mes réponses orchestration :

### OQ-D1 — merge-step owner : CronJob DÉDIÉ (convergence immo/i-arch/moi)
Un composant DÉDIÉ, PAS un post-step worker-live. Raison ops dure : un post-step ferait de CHAQUE pod scrape un writer canonical potentiel → N writers → race (contredit sole-writer). Le dédié = un seul détenteur de lock, cadence découplée du scrape.
- **P0** = CronJob dédié faisant E4-merge + E5-atomic-write en UN composant tenant le lock (cadence post-scrape).
- **Phase reconcile** (plus tard, si SLA fraîcheur l'exige) = contrôleur long-running event-driven (+operator, +footprint → gate). P0 CronJob d'abord.
- Deploy : 1 CronJob (ou Deployment leader-élu en mode reconcile) ; RBAC canonical-write EXCLUSIF à son SA.

### OQ-D2 — ordering + garantie sole-writer À L'ÉCHELLE
Ordering (aligné B.7 i-arch) : scrape→layers/detection · grounding→layers/grounding · geo→layers/geo · E4-merge (→ canonical S3, writer gardé) · E5-atomic (canonical → PG). Contraintes B.7 respectées : pas E5 avant E4 ; direct-feed interim en DUAL-WRITE jusqu'à E4+E5 validés ; retrait direct-feed en DERNIER.
Garantie sole-writer mesh-wide = **3 couches** (mon volet) :
1. **RBAC** : SEUL le SA du merge+write a le canonical-write (clé S3 `graph/<city>/latest.json` + write PG canonical) ; producteurs (scrape/grounding/geo) = write UNIQUEMENT sur leur `layers/*` prefix. Least-priv = blast-radius (même discipline que le cred dédié LOT-1).
2. **Sérialisation exactement-1 mesh-wide** : `pg_advisory_lock` (PG partagé = point de coordination cross-cluster, §10c) tenu par le merge+write pour toute la passe → un seul actif à travers tous les clusters, self-heal.
3. **Safety net** : le writer canonical S3 a DÉJÀ un CAS If-Match + archive + read-anchor ETag (`canonical-graph-writer.ts:366-408`) → pas de lost-update même si la sérialisation faille. Le lock sérialise, le CAS protège. (Ceinture + bretelles.)

### A1 / OQ-D4 — folder les 2 shell-writers (discipline sole-writer = supprimer les bypass)
i-arch cadre le fold (code) ; MON volet deploy/RBAC : `tools/graphify-v23/gate.sh:155` + `tools/grounding/publish-citation-grounding.sh:52` publient aujourd'hui le canonical via s5cmd en BYPASSANT la garde (`canonical-graph-writer.ts:30-34`, limite déclarée). Tant qu'ils existent = 3 writers, pas 1 → invariant sole-writer VIOLÉ. Deploy-fix :
- **RÉVOQUER** le canonical-write du contexte d'exécution de ces shell (creds/SA qui lancent gate.sh + publish-citation-grounding.sh) → ils ne PEUVENT plus écrire la clé canonical (défense en profondeur : même si le code oublie, le RBAC/policy S3 refuse).
- Les re-router en **producteurs de layer** (`layers/grounding/*` seulement) → le merge-step les subsume (B.4 : « subsume these five paths into a single owner »).
- Pré-condition DURE, à séquencer AVANT d'activer E5-at-scale (sinon un shell-write concurrent clobbe pendant l'atomic). PAS un nice-to-have.

---
*Frontière : je DESIGN ce volet + co-val + certifie les composants au déploiement ; je n'exécute pas (k8s applique) ; je ne provisionne pas de cred (writer SA = k8s/owner) ; keyString jamais dans mon canal.*
