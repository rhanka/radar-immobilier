# WP6 GOUVERNANCE — socle de tracking, fichier d'état

> Agent: WP6 (sole Track writer ce tour). Mise à jour incrémentale après CHAQUE étape.
> Démarré: 2026-06-28T09:32-04:00. Track CLI: `@sentropic/track` 0.19.2.

## Décision de référence
6 WP immuables (décision-dossier `tracking-structure-v1`, synthèse double consensus
Claude+Codex, `docs/spec/decision-tracking-structure-v1.md`). Focus = TAGS
(`focus:30`/`focus:33`/`focus:1104`). Échelles = filtres (now/week/month/project).
AWAITED done non signé = needs_review. Track = vérité, PG = projection lecture. Axe couverture = 1104.

## IDs créés (Track)
| Élément | ID | workspace |
|---|---|---|
| Décision-dossier orientation (GO) | `01KW775RC2T3FQD76A3KNNS2FD` | meta-track |
| WP1 · DATA — sources & substrat | `01KW775D02BW0DRNEA8RP6BTG8` | wp1-data |
| WP2 · EXTRACTION — signaux & ontologie | `01KW775D4QVAD4V4Z0JKAME5TZ` | wp2-extraction |
| WP3 · RÉCONCILIATION E2E & PREUVE | `01KW775D96JRBM3RKN6D4CZ8W2` | wp3-reconciliation |
| WP4 · PRODUIT — app radar client | `01KW775DDRD2FE8XRV3CXE7NF6` | wp4-produit |
| WP5 · PLATEFORME & SCALE | `01KW775DJE2BJ28ZKPANYHY3S6` | wp5-plateforme |
| WP6 · GOUVERNANCE — pilotage Track | `01KW775DPR13V8Q1B2GNM7WSDX` | wp6-gouvernance |

## Étape 1 — SAUVEGARDE ✅
- `cp .track/events.jsonl .track/events.jsonl.bak-wp6` fait.
- streamLength initial: **437 events** (sha256:46f6c685…). Après écritures WP6: **458 events**, `track validate` vert.

## Étape 2 — RESTRUCTURE TRACK ✅ (décision + 6 WP) / ⚠️ reparent bloqué par invariant Track
- Décision-dossier `tracking-structure-v1` créé (orientation), contexte `docs/spec/decision-tracking-structure-v1.md` attaché, **outcome GO**, targets = les 6 WP.
- 6 items `role:workpackage` créés (table ci-dessus). `track query --role workpackage` retourne **6** (était `[]`). `track report --wp` affiche la forêt des 6 WP.
- Mapping item→WP **ratifié et vérifié** : **111/111 items** mappés (exactement 1 WP chacun ; 0 doublon ; correspondance exacte avec les 111 items réels). Distribution :
  **WP1=24 · WP2=20 · WP3=8 · WP4=34 · WP5=21 · WP6=4** (= 111).
  Splits à matérialiser (item à cheval rattaché au WP dominant, todo split) : **11 notés** (ex. A.2.3 YouTube part graphify→WP2 ; WP A.2 part agents remote→WP5 ; consolidation preuve part viewer→WP4 ; CS-P3 export/import→WP4). Détail dans `wp6-item-wp-map.json`.

### ⚠️ CONSTAT BLOQUANT (corrigé proprement, pas de hand-edit)
`track item reparent <item> --parent <wp>` **échoue pour les 111** avec
`cannot reparent across workspaces`. Track 0.19.2 impose un **invariant de
containment** : `parent.workspace === item.workspace` (src/track.ts:267). Le
`workspace` est **immuable** (fixé à `item.created` ; aucun event
`workspace.changed` dans `EVENT_TYPES`). Le WP-tree est donc **workspace-contained
par construction** (`report --wp`/`canevas` filtrent la forêt par workspace,
src/read/contract.ts:688). Mes 6 WP sont dans des workspaces neufs → aucun des 111
items (répartis sur 14 workspaces hérités) ne peut être reparenté sous eux.

**Les 2 rapports de migration supposaient un reparent libre cross-workspace : faux en 0.19.2.**

Correction propre retenue (sans hand-edit, sans destruction, validate vert) :
1. Les 6 WP + le décision-dossier RESTENT (déclaration durable du sommet stable, interrogeable `query --role workpackage`).
2. Le rattachement item→WP est porté comme **PROJECTION ratifiée** (`wp6-item-wp-map.json`, fonction item→1 WP), ce qui est exactement la couche que la décision confie à WP6 (« évolution track-reader pour lire parentId+role → rollups %·WP »).
3. Le reparent **physique** dans Track requiert une évolution Track (patch-plan ci-dessous) ; non implémentée ce tour car elle ajoute un **event type** (risque sur l'intégrité/hash + grosse suite de tests) → pas « simple et sûr ».

### Patch-plan Track (proper fix, à faire dans /home/antoinefa/src/track, branche dédiée)
**Besoin** : déplacer un item vers un autre workspace pour exécuter le reparent 6-WP.
**Forme minimale sûre** : `item reassign-workspace <id> --workspace <w>` →
nouvel event `item.reassigned {workspace}`.
- Garde-fous (reject avant tout append) : item existe ; **item DÉTACHÉ** (parentId
  absent) ; **item sans enfant** (sinon containment enfant↔parent rompu). Pour les
  111 items actuels (arbre plat, 0 parent/0 enfant) ces deux gardes sont satisfaites.
- fold : `applyEvent` met à jour `item.workspace`.
- Ripple à traiter+tester : `EVENT_TYPES` (events/types.ts), `applyEvent` (state/fold.ts),
  ingest contract+map (item.reassign), read contract (rejouer), `validate` (intégrité),
  bump READ_CONTRACT_VERSION. Tests : nouveau `reassign.test.ts` + non-régression containment.
- Procédure migration une fois livré : pour chaque item → `item reassign-workspace`
  vers le slug WP cible (`wp6-item-wp-map.json`) → `item reparent --parent <wpId>` →
  matérialiser les 11 splits (nouveaux items, 1 moitié/WP) → `track validate`.
**Alternative** (si l'évolution est refusée) : recréer les items dans les 6 workspaces
(perte des ULIDs/historique acceptance/réalisation) — NON recommandé.

## Étape 3 — REPORTING MULTI-ÉCHELLE / MULTI-TEMPOREL ✅ (projection ; natif insuffisant)
**Capacité native Track 0.19.2** :
- `report [--wp|--flat] [--level spec|plan|wp|lot|task] [--commit <sha>]` : rollup
  par arbre WP (workspace-contained) ; `--commit` borne à l'ÉTAT d'un commit (contenu),
  **pas** à une fenêtre temporelle.
- `query`, `status`, `workspace-activity`, `focus`. **Aucun flag `--since/--until`**
  ni `--scale now/week/month/project`. Donc **borner un rapport à UNE PÉRIODE passée
  ET à UNE ÉCHELLE n'est PAS faisable nativement.**
- `focus <decision-id> --format html|md` : **rend le décision-dossier** (prose +
  outcome + amendment trace) — c'est la vue client présentable (livrable étape 6),
  mais ce n'est PAS un panneau 4-échelles.

**Évolution livrée (projection, lit le log horodaté)** : `docs/spec/reports/wp6-projection.py`
folde `.track/events.jsonl` (timestamps des `realization.transition`) + la projection WP
→ produit les **4 vues × rollups WP** :
- `wp6-rollup.json` (machine) + `wp6-rollup.md` (humain, 4 panneaux).
- Statuts vue client = done / needs_review (AWAITED done) / in_progress / planned / dropped.
- **Cohérence vérifiée vs buckets natifs Track** : done **68**, needs_review **6** (=AWAITED 6),
  dropped **2**, to-do **35** (= wip 16 + planned 19). Aucun chiffre inventé.

**Rollup project (état par WP, %done = done/(total−dropped))** :
| WP | total | done | needs_review | wip | planned | dropped | %done |
|---|--:|--:|--:|--:|--:|--:|--:|
| WP1 DATA | 24 | 19 | 0 | 1 | 3 | 1 | 83% |
| WP2 EXTRACTION | 20 | 12 | 0 | 4 | 3 | 1 | 63% |
| WP3 RÉCONCILIATION | 8 | 1 | 2 | 4 | 1 | 0 | 12% |
| WP4 PRODUIT | 34 | 21 | 4 | 5 | 4 | 0 | 62% |
| WP5 PLATEFORME&SCALE | 21 | 12 | 0 | 1 | 8 | 0 | 57% |
| WP6 GOUVERNANCE | 4 | 3 | 0 | 1 | 0 | 0 | 75% |
| **TOTAL** | **111** | **68** | **6** | **16** | **19** | **2** | **61%** |

**Spec d'évolution Track recommandée** (pour rendre le natif capable) : ajouter
`report --since <iso> --until <iso>` (fenêtre sur `event.at`) et `--scale
now|week|month|project` (préréglages de fenêtre + filtre WIP). Folder déjà présent
côté lecture (`event.at` lu par track-reader) → évolution additive read-only.

## Étape 4 — RETROFIT HEBDO ✅
`wp6-retro-gen.py` rejoue les `realization.transition` horodatées et reconstruit
**3 semaines** (06-08 / 06-15 / 06-22) dans `wp6-retro-hebdo.md` : par semaine et par WP,
créés / faits(→done) / ouverts-en-fin-de-semaine + détail des faits.
- S1 (06-08): 69 créés, 44 done — bootstrap DATA+EXTRACTION+sources.
- S2 (06-15): 12 done — vues PRODUIT + géo + persistance.
- S3 (06-22): 14 done — preuve E2E/réconciliation 33, DS, gouvernance ; reste 39 ouverts (WP3 le moins avancé, 12%).
Cohérence : ouvert fin S3 = 39 = 41 (to-do+AWAITED) − 2 (AWAITED realization=done).

## Étape 5 — VUE KANBAN 4 NIVEAUX (UI) ✅ scaffold fonctionnel
- **Route API de projection** : `GET /api/backlog/wp-projection`
  (`api/src/routes/backlog.ts`) sert le read-model WP : swimlanes WP1-6 × statut ×
  échelles now/week/month/project. Préfère le précalculé `wp6-rollup.json`, sinon
  **fallback live** (fold du sidecar + mapping). Source : `api/src/services/track/wp-projection.ts`.
- **Vue Svelte DS** : `ui/src/lib/components/kanban/KanbanView.svelte` (DS
  `@sentropic/design-system-svelte` : Card/Badge/Button/Alert/EmptyState) — sélecteur
  d'échelle, tableau swimlanes×statut + %fait + TOTAL, panneau fait/ouvert par WP.
  Client : `ui/src/lib/backlog/wp-projection-client.ts`. Câblée dans
  `views.ts` + `router.ts` + `App.svelte` → atteignable `#/kanban`.
- **Vérifs** : API typecheck **0 erreur** ; `wp-projection.test.ts` **7/7** ; backlog
  test inchangé **9/9** ; UI `svelte-check` **0 ERROR** (7 warnings pré-existants hors périmètre).
- Limite documentée : le read-model précalculé (buckets Track via `track query`) est
  l'autorité (done 68 / needs_review 6) ; le fallback live (reader, sans criteria/blocker)
  approxime (done 70 = realization=done ; needs_review uniquement sur acceptance fail).
  Régénérer : `python3 docs/spec/reports/wp6-projection.py`.

## Étape 5bis — Remarque migration physique
Le kanban lit la projection (WP map) car les 6 WP ne peuvent adopter les items
(containment workspace). Une fois `item reassign-workspace` livré (patch-plan ci-dessus),
le reader pourra basculer sur `parentId`+`role` natifs sans changer la vue.

## Étape 6 — VUE DÉCISION (focus) ✅ natif / scaffold UI à venir
- Natif : `wp6-focus-tracking-structure-v1.html` rendu via
  `track focus 01KW775RC2T3FQD76A3KNNS2FD --workspace meta-track --format html`
  (dossier + outcome GO + amendment trace) — vue client présentable.
- Décisions/signoff attendus mesurés : décisions pending **0** (la seule décision est GO) ;
  **needs_review = 6** (items AWAITED done non signés — voir rollup). Reste : page UI qui
  liste décisions attendues + items needs_review + signoff pending, chaque ligne ouvrant le
  rendu focus. Scaffold avec l'étape 5.

## Étape 7 — REMOTE→H2A ✅ (plan + stub)
- `wp6-remote-h2a-plan.md` : architecture seam `track ingest` + médiation h2a, invariants
  (single-writer, workspace containment, **binding gate** : settling exige auth local-user|signed),
  idempotence (dédup `(workspace, clientToken)`), honnêteté (agent non signé ⇒ needs_review).
- `wp6-remote-agent-stub.mjs` : émet un `progress.jsonl` de WorkEvents (realize:in-progress,
  acceptance.criterion, blocker.raise) prêt à `track ingest --workspace <slug>` — testé OK
  (NON ingéré dans le sidecar canonique : format démontré seulement).

## Étape 8 — SOUS-ITEMS WPx.y (niveau 2) ✅ — tour 2026-06-28 (sole writer)
- **Sauvegarde** : `cp .track/events.jsonl .track/events.jsonl.bak-wp6-subitems`. streamLength
  d'entrée de tour : **458 events** ; après création : **487 events** ; `track validate` **vert**.
- **29 sous-items** créés (`kind:chore`), chacun **DANS le workspace de son WP parent**
  (contourne proprement l'invariant containment : le sous-item est physiquement parenté → le WP
  passe ; aucun reparent cross-workspace tenté, aucun hand-edit). Taxonomie figée + IDs :
  `docs/spec/decision-tracking-structure-v1.md` §8. `track item show` confirme `parentId`=WP.
- **Projection item→WPx.y** : `wp6-item-subitem-map.json` (111/111 items, 1 sous-item chacun).
  Distribution par sous-item (29 lanes, dont 3 vides forward-looking : WP5.2 MCP, WP6.2 Reporting, WP6.4 Décisions) :

| WPx.y | n | WPx.y | n | WPx.y | n |
|---|--:|---|--:|---|--:|
| WP1.1 | 4 | WP3.1 | 1 | WP4.6 | 4 |
| WP1.2 | 12 | WP3.2 | 1 | WP4.7 | 5 |
| WP1.3 | 2 | WP3.3 | 5 | WP5.1 | 3 |
| WP1.4 | 6 | WP3.4 | 1 | WP5.2 | 0 |
| WP2.1 | 10 | WP4.1 | 9 | WP5.3 | 10 |
| WP2.2 | 6 | WP4.2 | 6 | WP5.4 | 5 |
| WP2.3 | 3 | WP4.3 | 2 | WP5.5 | 1 |
| WP2.4 | 1 | WP4.4 | 3 | WP5.6 | 2 |
| WP3.x… | — | WP4.5 | 5 | WP6.1/6.3 | 2 / 2 |

  Totaux par WP conservés : **WP1=24 · WP2=20 · WP3=8 · WP4=34 · WP5=21 · WP6=4 = 111**.

### Reporting — 4 dimensions ajoutées (retour principal)
1. **Axes de focus = TAGS de projection** (le CLI Track n'a pas de primitive `tag`) → chaque WPx.y
   taggé, **rollup PAR AXE** dans `wp6-focus-rollup.{json,md}`. Numérateurs **strictement sourcés**
   (`wp1-data-state.md` 2026-06-28 09:01, `2.3-completude-1105-FRESH.md`, `wp3-33-anomalies.json`),
   `—` = non recensé (jamais inventé). Ex. **WP2.1 v2.3 = 25/30 (focus:30) ET 976/1104 (focus:1104)** ;
   **WP3.2 = 5/27 zone_ref (focus:33)** ; focus:5000plus = non recensé (pas de census par-signal).
2. **Passé conservé** : les **68 done** (bucket DONE ; 70 realization=done dont 2 AWAITED) sont
   **tous mappés** à un WPx.y et restent *done* dans chaque snapshot « depuis le début ». Rien d'historique
   n'est cancellé.
3. **Retro 4 semaines** (`wp6-retro-hebdo.md`, regénéré) : S1 06-01→06-07 (pré-tracking, 0), S2 06-08→06-14
   (44 done), S3 06-15→06-21 (12, cumul 56), S4 06-22→06-28 (14, **cumul 70**). Créés/faits/done-cumulés/ouverts
   par WP + détail des faits, depuis les timestamps d'events.
4. **Per-ville** : le rollup WP1 référence l'atome `wp1-atome-par-ville.tsv` (**1104 villes**, `graph_version`) ;
   l'extension `wp1-atome-par-ville-full.tsv` (zones/lots/citations par ville, agent geo/WP1) permettra
   l'agrégation par ville (focus:30 = `priorityRank ≤ 30`, focus:1104 = toutes lignes) comme le fait geo.

### Kanban 2 niveaux (WP > WPx.y) — code livré
- `wp-projection.ts` : `projectSubLanes()` (pur) + `loadSubMap()`/`attachSubLanes()` → chaque swimlane
  WP porte `subLanes: SubLaneRollup[]` (29 lanes ; vides conservées). Attaché aux 2 sources (précalculé + live).
- `KanbanView.svelte` : lignes imbriquées WPx.y (toggle « Sous-items WPx.y »), badges statut + %fait par sous-item.
- **Vérifs** : `wp-projection.test.ts` **9/9** (2 nouveaux tests `projectSubLanes`) ; API `tsc` **0 erreur** ;
  UI `svelte-check` **0 ERROR** ; smoke live = **29 sublanes attachées** (24/20/8/34/21/4, 26 non vides).

## Artefacts produits
**docs/spec/reports/**
- `wp6-socle-status.md` (ce fichier)
- `wp6-item-wp-map.json` (mapping ratifié item→WP, 111, projection)
- `wp6-item-subitem-map.json` (projection item→WPx.y, 111, niveau 2) — **nouveau**
- `wp6-focus-rollup.json` + `wp6-focus-rollup.md` (rollup par axe de focus, sourcé) — **nouveau**
- `wp6-retro-4semaines.json` (retro machine, 4 fenêtres) — **nouveau**
- `wp6-projection.py` (générateur 4-échelles, réexécutable) + `wp6-rollup.json` + `wp6-rollup.md`
- `wp6-retro-gen.py` (générateur retro) + `wp6-retro-hebdo.md` (retro hebdo **4 semaines**)
- `wp6-focus-tracking-structure-v1.html` (vue client focus du décision-dossier)
- `wp6-remote-h2a-plan.md` + `wp6-remote-agent-stub.mjs` (plan + stub remote→h2a)

**Code (API)**
- `api/src/services/track/wp-projection.ts` (+ `.test.ts`, **9 tests**) — projection WP + **sous-lanes WPx.y**
- `api/src/routes/backlog.ts` — route `GET /api/backlog/wp-projection` (sert désormais `subLanes`)

**Code (UI)**
- `ui/src/lib/backlog/wp-projection-client.ts` — client de projection (+ type `SubLaneRollup`)
- `ui/src/lib/components/kanban/KanbanView.svelte` — vue kanban DS (**swimlanes 2 niveaux WP > WPx.y**)
- `ui/src/lib/demo/views.ts`, `ui/src/lib/router/router.ts`, `ui/src/App.svelte` — câblage `#/kanban`

## Récapitulatif final (pour le conducteur)
- **6 WP** créés (IDs en tête) + **décision-dossier GO** `01KW775RC2T3FQD76A3KNNS2FD`.
- **Reparent : 0/111 physique** (invariant containment Track) / **111/111 logique** (mapping ratifié, projection). Splits notés : 11.
- **Reporting** : natif **insuffisant** (pas de borne période×échelle) ; **évolué** via projection (4 échelles × WP, JSON+md), cohérent avec les buckets Track (68/6/2/35).
- **Reste à faire** :
  - É2/migration : livrer `item reassign-workspace` dans `/home/antoinefa/src/track` (patch-plan) puis reparent physique + 11 splits.
  - É3 : option `report --since/--until/--scale` dans le CLI track (spec fournie).
  - É5 : exposer `#/kanban` dans la nav (TopNav) ; brancher le reader natif parentId+role après migration.
  - É6 : page UI « décisions attendues / needs_review / signoff » (données = projection + focus HTML) — focus natif déjà livré.
  - É7 : implémenter le relais h2a→`track ingest` + canal signé (stub fourni).
