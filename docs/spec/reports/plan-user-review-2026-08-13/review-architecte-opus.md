# Revue d'architecture indépendante — Plan de vagues (revue owner) 2026-08-12
## Architecte Immo (Opus) — angle distinct de la passe Sol

> Passe complémentaire à la revue Sol (§10.3). Lecture seule, aucune mutation.
> Base lue au checkout `lane/conductor`, spec brute et plan au commit `8b85003`/`615007c`.
> Vérifications faites contre le code réel ; ce qui n'est pas vérifiable localement
> (refs remote) est signalé comme tel, jamais supposé.

---

## 1. COUVERTURE §1–§11

Sur le papier, la couverture nominale est large : presque chaque section a un ID. Le problème n'est pas l'absence d'ID, c'est la **sous-spécification par ignorance de l'existant**.

| Section | Porté par | Verdict |
|---|---|---|
| §1 Release safety / infra | S00, D01, D05, S01, S02, S03, S05, G-P0..P9 | COUVERT (structure solide) |
| §2 Domaine collaboratif + UI | D02, C01–C04, SNT1, M02 | **SOUS-SPÉCIFIÉ** |
| §2.5 chat-ui + MCP feedback | C04 (chat-ui), M02 (feedback), M01 (confirmation) | COUVERT |
| §3.1 Régression evidence signal | P01 (+ D08 repro) | COUVERT |
| §3.2 Recherche lots/zones | P04 | COUVERT |
| §4 Left pane Saint-Stanislas | P02 (+ D08) | COUVERT |
| §5 Vue géographique / contrôles carte | P05 | COUVERT mais collision UI non vue (§2) |
| §6 Fraîcheur / CronJob | F01, F02, D04/B4 | **SOUS-SPÉCIFIÉ** — miscount CronJobs, cron geo actif non couvert |
| §7 Règlements Geo→Immo→MCP | D03, D06, G01, R01 | COUVERT mais re-spécifie l'existant + clé inventée |
| §8 KPI | D04, P03, P06, B4 | COUVERT |
| §9 Couches env. + custom user | D07, G02, L01, G03, L02, L03 | COUVERT (partie la plus aboutie) |
| §10 Planification / gouvernance | tout le plan, §8 H2A, §9 dissents | COUVERT (méta) |
| §11 Preuves d'acceptation | §4 preuves, §5 gates, A01 | COUVERT sur papier — voir §4 (paradoxe « production-rendered ») |

**Le trou de couverture le plus grave est §2.** Le plan affirme (A1) « Radar ne possède actuellement que `account_users` ». C'est faux au sens matériel : il existe déjà tout un sous-système directement sur le sujet §2 — `prospect_marks` (chaîne append-only `supersedes`/`superseded_by`, statut incluant **`ecarte`** = archive/masquage §2.3, ancré **uniquement sur `lot_version_id`**), `prospect_notes` (notes append-only multi-auteurs = précurseur d'annotation §2.4), `prospect_contacts` et `prospect_contact_access_log` (journal d'accès PII, directement pertinent pour §11 « auditable across users »), plus `account_invitations` et `account_status_audit`. C02/C03/C04 sont écrits comme un greenfield : **aucune réconciliation, aucun chemin de migration depuis `prospect_*`**. Double risque : (a) créer exactement le **« parallel comment system » que §2 interdit**, et (b) une **collision de migration** avec le modèle append-only déjà en base.

---

## 2. ARCHITECTURE & SÉQUENCEMENT

Validé : S00-avant-toute-fusion, `BASE_SHA` déclaré après convergence de main, 4 branches actives/vague, ordonnancement des numéros de migration entre F01/C01, seam nav P01/P02 sous lease.

Défauts relevés :

**2.1 Collision UI de la surface carte non vue.** P05 (légende, mesure, satellite, retrait des fills), L01 (rendu couches Warden, légende, attribution) et L03 (custom-layer rendering) touchent **tous** la même surface de contrôle carte. Le code réel a plusieurs vues carte concurrentes — `SignauxMapView.svelte`, `EvaluationMapView.svelte`, `OpportunitesMapView.svelte`, `SignalPdfOverlay.svelte`. Sol n'isole que P05 (via B3) et ne déclare **aucun seam légende/contrôles entre P05, L01, L03**. À traiter comme le seam nav P01/P02.

**2.2 Frontière Radar/Geo brouillée par le cron geo.** Le CronJob `radar-populate-geo-daily` (`deploy/k8s/35b-populate-geo-cronjob.yaml`) vit dans le **repo Immo**, exécute du **code Geo** (`POPULATE_LOTS=1 RUN_RESOLUTION=1`) et écrit la **PG Immo** — il n'est **pas suspendu** et tourne sur `:latest`. La table d'ownership §7 range « orchestration refresh » côté Radar et « données canoniques » côté Geo, mais ce cron traverse la frontière sans que F01/F02 ne le mentionnent.

**2.3 Migration/backup non isolés du chemin prod.** Le job de migration réel `deploy/k8s/36-db-migrate-job.yaml` est un apply manuel hors kustomization, épinglé à une **image ancienne**, **sans backup préalable ni rollback**. Le job CD `deploy` roule les images applicatives **sans exécuter les migrations** → un déploiement peut servir du code neuf sur un schéma non migré. Sol construit la *capacité* (S02/S03) mais ne signale jamais que le chemin de migration prod actuel est lui-même une écriture non gatée.

---

## 3. SÉCURITÉ PROD — le remède S00 est INCOMPLET

Le diagnostic S00 est **exact et vérifié** : dans `build-push-images.yml`, le job `deploy` s'exécute `if: github.ref == 'refs/heads/main'` et fait `kubectl set image` sur le cluster vif, **sans `environment:` à approbateur**. Confirmé : le **seul** `environment:` de tout `.github/workflows/` est `github-pages` — il n'existe **aucun** `environment: production`.

**Mais S00 ne couvre qu'un des quatre chemins d'écriture prod.** Restent non gatés, tous avec le **même secret `KUBE_CONFIG_DATA`** :

1. **`deploy-gh-pages.yml`** — trigger `push: branches:[main]`, **automatique**. Second déploiement prod automatique sur push main, absent du plan Sol.
2. **`run-job.yaml`** — `workflow_dispatch` (mapper / snapshot / projection) : `delete`+`apply` de Jobs qui **écrivent la PG/S3 prod**. Aucun approbateur. « Humain-déclenché » ≠ « gate propriétaire ».
3. **`k8s-apply-mcp.yaml`** — `workflow_dispatch` : `kubectl apply` + `rollout restart` sur le cluster vif, idem sans approbateur.

Le pré-vol positif de cluster (host OVH attendu) est une bonne défense contre le *wrong-cluster* mais **ne remplace pas un gate humain de promotion**. **S00 tel que cadré ne satisfait pas §1** — il laisse trois portes ouvertes. Remède complet : placer les quatre surfaces derrière un `environment: production` à approbateur requis.

**Isolation migrations/backups §1 insuffisante** : pas de backup-avant-migration, pas de rollback rejoué, image de migration obsolète, migrations découplées du deploy sans gate. S02/S03 doivent inclure le **gate backup→migrate→verify→rollback** sur le chemin prod, pas seulement une capacité preprod.

---

## 4. PREUVES §11 — reproductibles vs théâtre vert

Bien posé par Sol : « CI green / PR merged / loop done n'autorisent jamais la prod » ; fraîcheur mesurée pour Saint-Rémi ; remplacement des placeholders `make test-e2e`/`make test-smoke` (S04) — **vérifié**, ces deux cibles sont de purs `echo`.

Théâtre vert résiduel :

- **Paradoxe « production-rendered ».** §11 exige une preuve **« production-rendered »** pour Sutton et le drawer règlement. Mais la sûreté **interdit tout déploiement prod avant acceptation**. Sol route l'acceptation vers **preprod** (A01) — bonne posture — mais **ne résout pas la contradiction**. À arbitrer owner : gate = **preprod-rendered**, preuve **production-rendered** = **post-check post-promotion** (G-P9).
- **Audit broad-city (G01/R01).** Peut virer au théâtre si mesuré à la **couverture**. Le prédicat doit être l'invariant owner : « jamais la couverture municipale comme preuve qu'un signal a un règlement » — compter honnêtement no-zone / no-reglement / no-url / url-inaccessible / relation-non-résolue. Le contrat `SPEC_UI_REGLEMENTS_GEO_LIVE.md` impose déjà « Feature IDs are never a join fallback ».
- **KPI (P03/P06).** Reproductible. OK.

---

## 5. DISSENTS

**Les 10 candidates de Sol** : toutes bien posées et à préserver. Deux défauts d'ancrage : Dissent 1 (Radar a déjà tranché append-only via `prospect_marks`), Dissent 4 (bâti sur un état des lieux faux — 4 CronJobs, 549 villes, pas 1000+). Dissent 7 = le plus important, aligné sur l'invariant owner.

**Dissents d'architecture MANQUÉS par Sol (ajouts) :**

- **D-A — Frontière règlement Immo/Geo (référentiel).** Re-dériver des « classes typées règlement » dans Radar (D03) **vs** se lier au contrat Geo **déjà figé** dans `SPEC_UI_REGLEMENTS_GEO_LIVE.md` (allowlist `REGLEMENT_KEYS` : `reglement_url`, `reglement_numero`, `reglement_millesime`, `reglement_page_source`, jointure par `code_zone` normalisé, « feature IDs never a join fallback »). Re-dériver côté Immo **viole « immo ne re-extrait pas »**.
- **D-B — Réconciliation collaboration.** Migrer `prospect_marks`/`prospect_notes`/`prospect_contacts` vers le modèle multi-cible C02 **vs** construire C02 en parallèle. Matérialise le risque « parallel system » interdit par §2. **Absent** du plan.
- **D-C — Modèle collaboratif Sentropic réutilisé vs parallèle.** `prospect_notes` EST le système de notes parallèle actuel à réconcilier.
- **D-D — Ownership du refresh geo.** `radar-populate-geo-daily` (Immo repo, code Geo, écrit PG Immo, actif, `:latest`) — Immo F01/F02 ou Geo-owned ?
- **D-E — Périmètre du gate prod.** S00 « CD only » suffit-il, ou faut-il aussi `run-job.yaml` + `k8s-apply-mcp.yaml` + `deploy-gh-pages.yml` derrière `environment: production` ?

---

## 6. FAITS INVENTÉS / NON ÉTAYÉS

1. **`zone_ref_canon_v1` (D06)** — **inventé**. Grep exhaustif : cette clé n'existe **QUE dans le plan Sol**. Les clés réelles Geo sont `reglement_numero`/`reglement_url`/`reglement_millesime`, jointure par `code_zone`. Fabriquer un identifiant de contrat canonique jamais publié tombe sous l'invariant anti-invention.
2. **`reglement_number` (D06/R01)** — nom de champ **inexact** : le réel est `reglement_numero`.
3. **« les deux CronJobs suspendus » (F02)** — **inexact**. **Trois** CronJobs suspendus (`radar-refresh-scrape`, `radar-refresh-projection`, `radar-consistency-snapshot`), **plus** un quatrième **actif** (`radar-populate-geo-daily`). Tous `:latest`. F02 rate le seul cron actif.
4. **« Radar ne possède que `account_users` » (A1)** — trompeur : occulte `prospect_marks`/`prospect_notes`/`prospect_contacts`/`prospect_contact_access_log`/`account_invitations`/`account_status_audit` (migrations 0004→0010).
5. **« 1 000+ villes »** — repris de l'owner, mais le code réel scrape **549 villes** ; jointure complète = **30 munis**. Présenté comme scope accepté sans réconcilier l'écart 549↔1000+↔30.

**Non vérifiable localement (déclaré, non supposé) :** numéros de PR, refs loops H2A Geo, SHA `origin/main 1710301`, « 158 commits behind », version Sentropic. **Confirmés localement :** `@sentropic/chat-ui: ^0.5.0`, stream Track = 787 lignes, `8b85003` = commit de la spec, placeholders `test-e2e`/`test-smoke`.

---

## VERDICT : **CONVERGE-AVEC-RÉSERVES**

Colonne vertébrale saine : NO-GO structurel S00-avant-fusion, séparation preprod/prod, préservation des dissents, ownership globalement correct, gates G-P0..P9 sérieux, refus du théâtre « CI green = prod ». **Divergence sur la complétude** : le plan sous-estime l'existant (collaboration, règlement, crons) et sous-cadre le périmètre du gate prod. Deux de ces points touchent des invariants explicites du propriétaire.

### BLOCAGES DURS (à lever avant ratification)

1. **S00 incomplet — 3 autres chemins d'écriture prod non gatés** : `deploy-gh-pages.yml` (auto push main), `run-job.yaml`, `k8s-apply-mcp.yaml`. Aucun `environment: production` n'existe. §1 non satisfaite tant que les quatre surfaces ne sont pas derrière un gate à approbateur.
2. **La vague collaboration crée le « système parallèle » interdit par §2** : C01–C04 ignorent `prospect_marks`/`prospect_notes`/`prospect_contacts`. Exiger un dissent + chemin de migration/réconciliation **avant** toute nouvelle migration collaborative.
3. **Fabrication de contrat Geo + re-spécification de l'existant figé** : `zone_ref_canon_v1` inventé, `reglement_number` inexact ; D03/D06/G01/R01 doivent se **lier** à `SPEC_UI_REGLEMENTS_GEO_LIVE.md` au lieu de re-dériver — sinon violation de « immo ne re-extrait pas ».
4. **CronJob refresh : état des lieux faux + cron geo actif sur `:latest`** : F01/F02 doivent partir de la topologie réelle (4 crons, 3 suspendus + `radar-populate-geo-daily` actif, tous `:latest`, 549 villes).

### 3 points à porter à l'arbitrage owner

1. **Périmètre du gate prod = les quatre surfaces**, pas seulement le CD k8s — sinon le NO-GO S00 est cosmétique.
2. **Réconciliation vs parallèle pour la collaboration ET le règlement** : migrer `prospect_*` (§2 « no parallel system ») ; se lier à l'allowlist règlement Geo figée (§7 « immo ne re-extrait pas »).
3. **Résoudre le paradoxe « production-rendered » de §11** : gate = **preprod-rendered** ; preuve production-rendered = **post-check post-promotion** (G-P9).
