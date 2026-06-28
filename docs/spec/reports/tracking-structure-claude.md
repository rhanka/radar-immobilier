# Structure de suivi projet — radar-immobilier (proposition d'architecture Track)

> **Statut** : proposition décisionnelle, **lecture seule sur Track** (aucune écriture `.track`).
> **Date** : 2026-06-28. **Perspective** : architecte de suivi (Opus). **À fusionner** dans un
> *decision dossier* `orientation` une fois ratifié.
> **Mandat** : rendre le tracking STABLE et IMMUABLE dans ses grands axes, présentable au client,
> capable à tout moment de répondre : (a) on travaille sur quoi maintenant ; (b) semaine fait/à faire ;
> (c) mois fait/à faire ; (d) depuis le début fait + reste à faire. Les **WP sont stables**, les **todos
> internes progressent**.
> **Sources** : `track report/query --format json` (111 items), `.track/events.jsonl` (437 events),
> `docs/spec/data-division-immo-geo.md` (RACI), specs Steve (`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`,
> `SPEC_CONTROLE_PARITE_VILLES_STEVE.md`, `SPEC_EVOL_PROCESS_E2E.md`, `SPEC_REORIENTATION_GRAND_FILET.md`,
> `SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md`), `api/src/services/track/track-reader.ts`,
> `ui/src/lib/backlog/*`.

---

## 0. TL;DR — décisions proposées

1. **Le « bordel » a une cause unique et mesurable** : le backlog Track est **100 % plat** —
   **0 item `role:workpackage`, 0 item avec `parent`** (vérifié sur les 437 events). Le seul
   regroupement est un champ `workspace` **texte-libre à 14 valeurs incohérentes** où se superposent
   **4 générations de nommage** (`WP4/WP5` ère pipeline ; `WP A.1/A.2/A.3 + WP B` ère grand-filet ;
   `CS-L*/CS-P*` ère parité Steve ; `P1-P5` DS/admin ; `L1-L6` persistance). `track report` ne peut donc
   pas produire la vue conducteur %·WP : il **déverse 111 lignes à plat** → illisible.
2. **La cible structurelle = 6 WorkPackages pérennes** (par concern durable, pas par jalon), qui
   **recouvrent 100 % des 111 items Track ET la cible Steve** (17 features S-1..S-17, 4 vues, 6 phases
   de réconciliation, parité 4 villes). Chaque WP = `role:workpackage` + charte 1 ligne + frontière de
   scope + RACI geo/immo explicite + critère de complétude (acceptance).
3. **Le modèle de « todo interne » se mappe presque entièrement sur les champs Track natifs** :
   `realization` (statut fermé) + aggregate `blocker` (bloqué) + `acceptance` criteria/run (signoff) +
   `decision` dossier (signoff fort). Restent **2 conventions légères de tag** : `focus` (golden4 /
   proof33 / filet150 / qc1106) et `horizon` (now / week / month / later). Les **axes de focus chiffrés
   sont des TAGS orthogonaux, PAS des branches de l'arbre WP** (sinon la structure explose).
4. **Source de vérité** : Track (sidecar `.track/events.jsonl`, append-only, single-writer CLI) =
   vérité du **PILOTAGE** (WP / lot / todo / statut / signoff). PostgreSQL = vérité du **DOMAINE**
   (Signal / Lot / Zone / ProspectMark / JournalEntry). Le kanban UI lit le sidecar *folded* par
   l'API (`track-reader.ts`), **jamais Postgres**. Une petite évolution du reader (honorer `parentId` +
   `role`) suffit à rouler les % par WP dans l'UI.
5. **Rendu client** = la **méthode focus** : un *decision dossier* `orientation` « Structure WP » dont
   les targets sont les 6 WP ; `track focus <decision-id> --workspace <w> --format html` produit la page
   présentable ; `track report` (table conducteur depuis 0.19.1) donne FAIT / À-FAIRE %·WP / ATTENDUS.

---

## 1. Diagnostic de l'état réel (chiffré)

**Inventaire Track** (`track report --format json`, baseline `f678149`) : 111 items —
`DONE 68 · TO-DO 35 · AWAITED 6 · DROPPED 2`. Réalisation : `done 70 · in-progress 17 · to-do 22 ·
cancelled 2`. Kind : `feature 85 · bug 15 · chore 11`. **Decisions : 0** dans le report (1 aggregate
`decision` existe dans le log mais sans target WP).

**Le log** (`.track/events.jsonl`, 437 events) :

| Constat | Valeur | Conséquence |
|---|---|---|
| Items avec `role:workpackage` | **0** | Aucun WP n'a jamais été formalisé ; `track report` n'a pas d'arbre à rouler. |
| Items avec `parent` | **0** | Hiérarchie **totalement plate** ; pas de rollup possible. |
| Valeurs distinctes de `workspace` | **14** | Regroupement par champ texte-libre, multi-générationnel, instable. |
| Aggregates `decision` | 1 (sans target) | La méthode focus est **disponible** mais inexploitée. |
| `acceptance.criterion.added` / `.run` | 68 / 26 | La machinerie de signoff **est déjà vivante**. |
| `blocker.opened` | 9 | Le « bloqué » est modélisé hors `realization` (bon). |
| `branch.imported` | 6 | L'import BRANCH.md est utilisé. |

**Les 14 workspaces et leur charge** : `reorientation 25 · wp5-ontology 18 · frontA-viz 15 ·
frontA-data 12 · frontA-infra 8 · frontB-geo 8 · wp4-sources 8 · evdoc-branch-… 8 · wp4-pipeline 3 ·
wp6-platform 2 · infra 1 · meta-track 1 · WP A.3 1 · WP B 1`. Trois pathologies :

- **`workspace` confond thème durable ET namespace de branche/agent** : `evdoc-branch-feat-evidence-doc-cards`
  est un nom de branche, pas un concern. Le thème (preuve) y est noyé.
- **`reorientation` est un fourre-tout** : il mélange des features produit (`CS-L*`, `CS-P*`), de la
  scale (`L1-L6`, persistance S3-first), et de l'extraction (`Parsing graphify PV`). C'est l'exemple
  type de l'échec du regroupement plat.
- **Aucune réponse aux 4 questions de pilotage** : sans arbre WP ni horizon temporel, impossible de dire
  « maintenant / semaine / mois / depuis le début » autrement qu'en relisant 111 lignes.

---

## 2. Critique de la proposition du principal (WP1 DATA / WP2 RÉCONCILIATION / WP3 FONCTIONNEL / WP4 INFRA)

Bonne ossature 4-WP, mais **4 défauts de stabilité/recouvrement** à corriger :

1. **TROU MAJEUR — l'extraction des signaux est noyée dans DATA.** Le principal met
   « signaux (extraction entités v2.2/v2.3) » comme un *sujet* de WP1 DATA. Or sa propre contrainte dit
   « à terme **TOUT est geo SAUF l'extraction des signaux** ». L'extraction sémantique (détection
   avis-motion→n°règlement→zonage, ontologie temporelle, graphify, grounding/preuve) est **LE seul
   concern 100 % immo indélégable** et **le différenciateur produit** (« prouver que l'IA fait les
   liens », critère de décision de Steve). La noyer dans DATA **casse le seam d'ownership geo/immo** :
   le jour où toute l'acquisition géo migre chez geo, WP1 DATA se vide… sauf l'extraction qui n'aurait
   rien à y faire. **→ Extraction = WP autonome (mon WP2).** *C'est ma divergence principale.*

2. **TROU — la SCALE / industrialisation n'a pas de maison.** `L1-L6`, persistance S3-first, serverless
   jobs SCW, orchestration remote des 4 agents, db-rebuild/replay, golden fixtures : ~12 items d'un
   concern durable distinct (« passer de 4 villes/40 fixtures → 1106 sans OOM » = le rôle « industrialiser
   autour » de Fabien). Le principal les éparpillerait entre DATA et INFRA → DATA redevient fourre-tout.
   **→ SCALE = WP autonome (mon WP5).**

3. **RECOUVREMENT — la PREUVE (citation/PDF/grounding) chevauche DATA, RÉCONCILIATION et le « transverse
   pdf » de WP3.** Il faut trancher le seam **production vs restitution** (cf. skill `propose-workpackages` :
   record ≠ render) : la **production** de la preuve (citations exhaustives, ontologie, grounding) ∈
   **WP2 Extraction** ; la **restitution** (viewer PDF, overlay carto, route document) ∈ **WP4 App** ; le
   « **ownership geo** de la preuve » est une **frontière RACI**, pas un WP.

4. **INSTABILITÉ — versions et mailles comme structure.** (a) « v2.2 / v2.3 » sont des **jalons datés**,
   pas des WP (le skill interdit de clusterer par version) → sous-lots internes datés. (b) Le principal
   **duplique le continuum de maille** (québec/ville/zone/lot) dans WP2 ET WP3 ; ce sont deux concerns
   différents (moteur back vs projection carto front) — la maille doit être un **axe de sous-lots commun**,
   pas la définition du WP. (c) Les **axes de focus chiffrés** (30 / 33 / 1105) risquent de devenir
   structurels (« double focal ») → ils doivent être des **tags**, sinon chaque WP se dédouble.

Items orphelins de la proposition à reloger explicitement : bugs DS header/font (→ plateforme),
filtres Signaux (→ app), backlog↔track (→ plateforme/pilotage), recalage meta-track (→ véhicule de
migration, pas WP), « geo propriétaires Loi 25 » (→ DATA acquisition, bloqué).

**Note de réconciliation des axes chiffrés** : les specs n'ancrent pas « 30 villes » ; elles ancrent
**4 villes golden** (delson, sainte-catherine, saint-constant, candiac — parité contrôle, 27 279 lots),
**33 opportunités** (preuve E2E `report-opportunity-proof.ts --limit 33`), **~150 villes** (grand filet,
rayon 50 km MTL), **1106 villes** (Québec cible). Le « 30 » du principal = périmètre de travail
prioritaire ; je recommande de l'aligner sur ces nombres ancrés (golden4 / filet150) plutôt que sur un
30 non sourcé.

---

## 3. La structure cible — 6 WorkPackages pérennes

> Règle : un WP = **un concern durable / artefact possédé**, qui existera encore dans un an — **pas un
> jalon**. Le **slug** (`wp:*`) est la clé durable non-positionnelle ; le **code** (WP1..WP6) est un
> simple label d'affichage, sans ordre imposé. Chaque WP porte un **critère de complétude** matérialisé
> en `acceptance criterion`.

### WP1 — DATA & ACQUISITION DU SUBSTRAT · `wp:data`
**Charte** : recueillir tout le substrat brut — registre des villes, scraping PV/avis publics/YouTube
séances, sources géo (zonage, cadastre, rôle d'évaluation MAMH, adresses Québec), persistance S3-first
du `raw/`.
**RACI geo/immo** : **MIXTE, délégation maximale à geo.** geo = acquisition géo générique réutilisable
hors immo (cadastre, zonage CKAN/ArcGIS, rôle MAMH, adresses, registre municipalités, OCR/géoréf de plans
PDF). immo = scraping de **texte municipal** (PV/avis/YouTube) + **infra anti-bot dure** (Obscura SPA/403/WAF)
que geo ne peut pas porter.
**NON ici** : l'extraction sémantique des signaux (→ WP2) ; l'exécution scalée des jobs (→ WP5) ; la
projection carto (→ WP4).
**Critère de complétude** : pour chaque ville du périmètre actif, chaque source a un `ScrapeStatus`
{status, coveragePct} traçable et le `raw/` est sur S3 (CAS pur).

### WP2 — EXTRACTION DES SIGNAUX & ONTOLOGIE (cœur immo) · `wp:extraction`
**Charte** : la **sémantique métier** — détection `avis_de_motion(n°règlement) → suivi → adoption →
changement de zonage`, graphify (ontologie temporelle Zone/Lot/Bylaw/DesignationEvent/Valuation),
réconciliation cross-source, et la **production** de la preuve (citations exhaustives, grounding,
rawRef/page/bbox). v2.2/v2.3 = sous-lots datés à l'intérieur.
**RACI geo/immo** : **100 % IMMO. Indélégable.** C'est le « SAUF » de la règle « tout est geo sauf
l'extraction des signaux » et le différenciateur produit.
**NON ici** : l'acquisition du substrat (→ WP1) ; la **restitution** de la preuve dans le viewer (→ WP4) ;
la jointure géo lot↔zone rendue (→ WP3).
**Critère de complétude** : un `Signal` porte type + description + citation **verbatim** + lien preuve
résolvable ; couverture grounding sans reliquat bloqué non-tracé.

### WP3 — RÉCONCILIATION GÉO E2E (signal → zone → grille → lot = opportunité) · `wp:reconciliation`
**Charte** : le **moteur** qui transforme un signal en **opportunité localisée** — résolution
`zone_ref`/`no_lot`/`etape`, jointure géométrique `lot ∩ zone` (clé `NO_LOT` verbatim, API OGC geo),
application de la **grille de zonage** → lots éligibles, `OpportunityDossier` (6 phases d'`EvidenceItem`),
scoring 0-5 (potentiel 30 / risque 20 / timing 20 / faisabilité 15 / marché 15). Les « niveaux 1/2/3 »
du principal = sous-lots.
**RACI geo/immo** : **MIXTE.** geo livre les couches géo (lots/zones GeoJSON via OGC, cadastre, TOD) ;
immo possède le **mapper de résolution** + le **scoring** + le **dossier d'opportunité**.
**NON ici** : la production des signaux (→ WP2) ; l'affichage carto (→ WP4) ; l'acquisition (→ WP1).
**Critère de complétude** : la preuve E2E des **33 opportunités** (`report-opportunity-proof.ts`) passe
sur les villes pilotes, chaque opportunité reliant signal → zone → grille → ≥1 lot confirmé.

### WP4 — APPLICATION & FONCTIONNEL (carte-first, vues Steve) · `wp:app`
**Charte** : le **produit** — les 4 vues **Signaux / Opportunités / Évaluation / Sources** sur le
continuum **Québec → ville → zone → lot**, les **17 features Steve** (S-1 scoring carte par lot, S-2 fiche
lot, S-3 marques d'équipe, S-4 export CSV lettres, S-5 filtres combinés, S-6 pastilles auto, S-7 couches
env, S-8 recherche, S-9 batch, S-10 labels, S-11 sync, S-12 annonces, S-13 code postal, S-14 éditeur
zones, S-17 dashboard couverture), le **viewer de preuve PDF** (restitution), les buckets de sélection.
Tests **CS-L** (lots/maquette) et **CS-P** (P1/P2/P3).
**RACI geo/immo** : **100 % IMMO** (consomme les GeoJSON/PMTiles de geo pour le rendu).
**NON ici** : le moteur de réconciliation (→ WP3) ; l'extraction (→ WP2) ; le DS/auth/chat plateforme (→ WP6).
**Critère de complétude** : parité visuelle/fonctionnelle avec l'app de Steve sur les 4 villes golden
(compteurs S-1b, fiche S-2, marques S-3, export S-4) ; aucun écran hors des 4 vues.

### WP5 — SCALE & INDUSTRIALISATION · `wp:scale`
**Charte** : passer de **4 villes / 40 fixtures → 1106 villes sans OOM** — persistance S3-first (SCW
source de vérité, Postgres index reconstructible par replay), **SCW Serverless Jobs + Cron**, orchestration
**remote** des 4 agents de scraping/graphify, golden fixtures + `fixture promote`, `radar db rebuild`.
**RACI geo/immo** : **MIXTE.** immo = plateforme d'exécution immo ; geo = ses propres jobs géo à l'échelle.
**NON ici** : la logique de scraping/extraction elle-même (→ WP1/WP2) ; les vues (→ WP4).
**Critère de complétude** : `radar db rebuild` (replay S3 → Postgres) prouvé en CI sur MinIO ; un run
cron 1106 villes ne fait pas OOM ; backlog des jobs piloté via track.

### WP6 — PLATEFORME & SOCLE (auth, DS, chat, MCP, pilotage) · `wp:platform`
**Charte** : les fondations non-métier — **auth durable Sentropic** (session 15 j, autorisation persistée),
**design-system** (AppHeader canonique, @font-face, tokens), **chat-ui / llm-mesh / MCP**, **déploiement
k8s / CD**, admin & validation des users, **data-quality views**, et le **pilotage** lui-même
(backlog UI ↔ track, recalage/gouvernance).
**RACI geo/immo** : **100 % IMMO.**
**NON ici** : les vues produit (→ WP4) ; le moteur (→ WP3).
**Critère de complétude** : `SESSION_TTL_SECONDS` prod = 1 296 000 sans redemande permanente ; header =
AppHeader DS canonique ; backlog UI roule les % par WP depuis le sidecar.

> **Auto-audit (checklist `propose-workpackages`)** : 4–7 WP ✅ (6) · aucun « misc »/single-ticket ✅ ·
> aucun nom de jalon (v2.3/L6/CS-L sont des sous-lots) ✅ · seams d'owner préservés (extraction immo ≠
> acquisition geo ; production preuve ≠ restitution ; moteur back ≠ app front) ✅ · aucun item orphelin
> (cf. §7) ✅ · cross-cutting traité en **split**, pas en multi-home ✅.

---

## 4. Le modèle de « todo interne » (statut fermé + signoff + focus + horizon)

Les WP sont stables ; **les todos internes progressent**. Le modèle demandé se mappe **presque
intégralement sur Track natif** — donc stable, sans champ inventé :

| Dimension demandée | Valeurs | Porté par (Track natif) |
|---|---|---|
| **Statut fermé** | `planned` | `realization = to-do` |
| | `in_progress` | `realization = in-progress` |
| | `blocked` | `realization = in-progress` **+ aggregate `blocker`** (`blocker raise --kind decision\|dependency`) — le bloqué est une **dimension orthogonale**, pas un état de réalisation (bon design) |
| | `needs_review` | `realization = in-progress` **+ `acceptance criterion` posé sans `run pass`** (spec `specified`) |
| | `done` | `realization = done` (**+ `acceptance.run pass`** pour valider) |
| | `dropped` | `realization = cancelled` |
| **Signoff** | `not_required` | `decision disposition … not-applicable` / pas de criterion |
| | `pending` | `acceptance criterion` posé, aucun `run` |
| | `signed` | `acceptance.run pass` **ou** `decision outcome go` |
| | `rejected` | `acceptance.run fail` **ou** `decision outcome no-go` |
| **Focus (axe)** | `golden4` · `proof33` · `filet150` · `qc1106` | **TAG** (convention `focus:<v>` en body, ou `--engagement-ref`) — **orthogonal aux WP** |
| **Horizon (temps)** | `now` · `week` · `month` · `later` | **TAG** (convention `horizon:<v>` en body) — posé par le conducteur |

**Pourquoi focus & horizon sont des tags, pas de la structure** : ce sont des **vues transverses** qui
coupent tous les WP. Les promouvoir en branches de l'arbre (« WP1×golden4 », « WP1×qc1106 ») **double
chaque WP** et détruit la stabilité — exactement l'écueil « cluster by milestone/focal » que le skill
interdit. Un même todo « scraper PV » est `golden4` aujourd'hui et `qc1106` demain : seul le **tag**
change, le WP reste. *(Limite : Track n'a pas de champ `label` natif → convention de body ; une évolution
Track `--label` serait l'idéal — à signaler à @sentropic/track.)*

**Sous-lots** : entre le WP et le todo-feuille, un niveau de **lot** (`role` non-workpackage, simple
parent) matérialise l'axe de découpage **commun** : les **mailles** (Québec/ville/zone/lot) pour WP3/WP4,
les **phases** (T1..T3, 6 phases) pour WP3, les **sources** (PV/avis/YouTube/rôle/zonage) pour WP1, les
**versions** (v2.2/v2.3) pour WP2. Le lot progresse ; le WP ne bouge pas.

---

## 5. Comment Track porte la structure + relation Track ↔ PostgreSQL

### 5.1 Représentation Track (écrite via CLI uniquement, sidecar single-writer)

1. **6 items `role:workpackage`** (un par WP) :
   `track item new --kind chore --role workpackage --title "<charte>" --workspace <wp-slug>`.
   La WP-ness vient de `role:'workpackage'`, **jamais** du `kind` ni du préfixe de titre.
2. **Reparentage** de chaque feuille sous son WP (et sous son lot intermédiaire) :
   `track item reparent <itemId> --parent <wpId|lotId>`. Un WP ne niche que sous un WP ; une feuille sous
   un WP ou un lot.
3. **Critère de complétude** par WP : `accept criterion <wpId> --statement "<critère §3>"`, relié à une
   preuve (`accept link --kind e2e --locator <test>`).
4. **Decision dossier** porteur de la structure :
   `track decision new --kind orientation --title "Structure WP radar-immobilier" --workspace meta-track
   --targets <wp1..wp6>` puis `decision dossier <id> --context docs/spec/reports/tracking-structure-claude.md`.
5. **Rendu client (méthode focus)** : `track focus <decision-id> --workspace <w> --format html` → page
   présentable ancrée sur le dossier (arbre WP + état). `decision add-artifact <id> --kind rendered-view`
   trace la vue livrée au client.

### 5.2 Réponse native aux 4 questions de pilotage

| Question | Commande / source |
|---|---|
| **(a) Maintenant on travaille sur quoi** | `track query --realization in-progress` (le WIP) ; filtrer `horizon:now`. |
| **(b/c) Semaine / mois — FAIT** | fold des `realization.transition` du log par `at` (le sidecar **horodate chaque transition** ; `track-reader.ts` lit déjà `at`). « fait cette semaine » = transitions `→done` dont `at ∈ [lundi, …]`. |
| **(b/c) Semaine / mois — À FAIRE** | `track query` filtré `horizon:week|month`. |
| **(d) Depuis le début — FAIT + RESTE** | `track report` (table conducteur 0.19.1) : **FAIT / À-FAIRE %·WP / ATTENDUS**, % roulé depuis les feuilles — n/a tant qu'il n'y a pas de WP, **opérationnel dès le reparentage**. |

### 5.3 Track ↔ PostgreSQL — qui est source de vérité de quoi

```
Track sidecar .track/events.jsonl   ── source de vérité du PILOTAGE
  (append-only, single-writer CLI)     (WP / lot / todo / statut / signoff / décisions)
        │  fold (api/src/services/track/track-reader.ts, pur, sans I/O hors loader)
        ▼
  GET /api/backlog  ──►  ui/src/lib/backlog (BacklogView, poller)   ── le KANBAN lit le sidecar
        ▲                                                              JAMAIS Postgres
        │
PostgreSQL  ── source de vérité du DOMAINE
  (Signal / Lot / Zone / ProspectMark / JournalEntry / graphe)        reconstructible par replay S3 (WP5)
```

- **Track = vérité du pilotage** ; **Postgres = vérité du domaine** ; aucun recouvrement. Une marque
  d'équipe (`ProspectMark`) est une donnée **domaine** (Postgres/S3, journalisée), **pas** un todo Track.
- Le kanban (`backlog.ts`) groupe déjà par `workspace` et dérive `code = workspace.toUpperCase()`.
  **Évolution minimale** (1 todo WP6) : faire lire `parentId` + `role` au `track-reader` (aujourd'hui
  ignorés) pour rendre l'**arbre WP + % conducteur** dans l'UI, au lieu du regroupement plat par workspace.
- **Garde-fou** : MCP track = **lecture seule** ; toute écriture passe par le **CLI `track` depuis la
  racine** ; `.track/events.jsonl` jamais édité à la main (`track validate` avant/après).

---

## 6. Table de migration — thème existant → WP cible

> Chaque famille d'items existante (workspace + préfixe de titre) est reparentée. **Splits** = items qui
> servent deux concerns → coupés en deux (jamais multi-homé).

| Thème / workspace existant (n) | Exemples d'items | → WP cible | Note |
|---|---|---|---|
| `frontA-data` acquisition (≈10) | A.2.1 villes, A.2.2 scraper PV, A.2.3 YouTube, Source avis/PV/youtube/zonage/rôle | **WP1 data** | sous-lots par **source** |
| `wp4-sources` (8) | sources #2-5, recueil substrat, investigation multi-villes | **WP1 data** | |
| `wp4-pipeline` (3) | ciblage CiblagePlan, recueil, executor multi-source | **WP1 data** | |
| `frontA-data` A.2.4 + `frontA-infra` A.3.2 | 4 agents remote, orchestration scraping remote | **WP5 scale** | **split** de frontA-data/infra |
| `frontB-geo` Loi 25 | Geo propriétaires de lots (acquisition contrôlée) | **WP1 data** | bloqué par design |
| `wp5-ontology` (≈14) | ontologie v1, citations/grounding, evidence contract, v2.3, reconciliation, llmesh, reliquats grounding | **WP2 extraction** | sous-lots **version** |
| `reorientation` Parsing graphify PV | parsing graphify, entités additionnelles, eval extraction déterministe | **WP2 extraction** | **split** de reorientation |
| `evdoc-branch-…` production (≈5) | evidence doc cards, evidence DTO/route, metadata repair, publishedAt | **WP2 extraction** | **split** record/render |
| `evdoc-branch-…` + `wp5` restitution | UI signal card + PDF overlay, geo PDF overlay integration | **WP4 app** | **split** (restitution) |
| `frontB-geo` réconciliation (≈6) | zones/lots incorporation, WPB-E2E 33, P3 geo display, geo selection (WP B) | **WP3 reconciliation** | sous-lots **niveau/maille** |
| `reorientation` CS-L1/L1b | scoring visuel lots data-driven 4+∩TOD | **WP3 reconciliation** | moteur de score (la **carte** = WP4) |
| `frontA-viz` vues (≈11) | A.1.1-A.1.4 (Signaux/Opportunités/Évaluation/Sources), geo URL/router, filtres Signaux, P1/P2 selection bucket | **WP4 app** | sous-lots **vue** |
| `reorientation` CS-L*/CS-P* + grand filet (≈13) | CS-L2..L6, CS-P1/P2/P2-S13/P3, DS redesign buckets, « Grand filet » | **WP4 app** | CS-P3 (auth/sync) → voir split |
| `reorientation` CS-P3 part auth/sync | backend sync temps réel + AUTH | **WP6 platform** | **split** de CS-P3 |
| `reorientation` persistance/scale (≈8) | L1-L6, WP Persistance S3-first, orchestration agentique remote, bootstrap simulation scripts | **WP5 scale** | **split** de reorientation |
| `wp5-ontology` provincial graph | partition par MRC à l'échelle | **WP5 scale** | |
| `frontA-viz` DS bugs (≈3) | header non-canonique, @font-face manquant, fonts bespoke panneau | **WP6 platform** | DS-as-platform (≠ bug de filtre = WP4) |
| `frontA-infra` (≈6) | A.3.1 graph DB, A.3.3 UI gestion (chat-ui), admin validation users, auth durable 15j, deploiement tracking, chat.test | **WP6 platform** | |
| `wp6-platform` (2) | backlog↔track, backlog live | **WP6 platform** | pilotage |
| `infra` / `meta-track` / `WP A.3` | déploiement k8s, recalage track, data-quality+admin views | **WP6 platform** | recalage = véhicule de migration |

**Couverture** : les 111 items + les 17 features Steve se reparentent sans reste. Les **splits** à
matérialiser (nouveaux items, une moitié par WP) : reorientation (app/scale/extraction), evdoc-branch
(extraction/app), CS-P3 (app/platform), frontA-data·A.2.4 + frontA-infra·A.3.2 (→ scale).

---

## 7. Risques de stabilité & garde-fous

- **Risque : la maille/le focus repassent en structure.** Garde-fou : maille = sous-lot ; focus/horizon =
  tags. Aucun WP ne se dédouble par périmètre.
- **Risque : `workspace` reste un namespace de branche.** Garde-fou : après migration, `workspace` = slug
  WP **stable** ; les noms de branche/agent ne touchent plus `workspace`.
- **Risque : clôturer un WP global sur preuve locale non stabilisée** (cf. drift 2026-06-23). Garde-fou :
  `done` d'un WP exige `acceptance.run pass` sur preuve mergée `origin/main`, pas un artefact `tmp/`.
- **Risque : double écriture Track (MCP vs CLI vs édition main).** Garde-fou : MCP read-only, CLI seul
  writer, `track validate` encadrant chaque batch.
- **Risque : confondre pilotage (Track) et domaine (Postgres).** Garde-fou : un `ProspectMark`/`Signal`
  n'est jamais un item Track ; un WP n'est jamais une table Postgres.

---

## 8. Prochaines actions (read-only → ratification → write)

1. **Ratifier** la structure (6 WP + slugs + critères + splits) — ce document, via *modal-ask* ou
   `present-decision` (restructuration conséquente : 111 items, cross-owner geo/immo).
2. **Écrire** (CLI, depuis la racine) : 6 `item new --role workpackage` → reparentage → `accept criterion`
   par WP → splits → `decision new orientation` + `decision dossier`.
3. **Vérifier** : `track report` (la vue conducteur %·WP doit apparaître) + `git diff -- .track`.
4. **Rendre** : `track focus <decision-id> --format html` = livrable client ; `decision add-artifact
   --kind rendered-view`.
5. **Évoluer l'UI** (1 todo WP6) : `track-reader.ts` lit `parentId`+`role` → kanban arbre WP + %.

---

## Annexe — les 6 WP en une ligne (slug · titre · RACI)

- **WP1 `wp:data`** — Data & acquisition du substrat — *MIXTE, max délégué à geo (cadastre/zonage/rôle/
  adresses/registre/OCR plans) ; immo = PV/YouTube + anti-bot*.
- **WP2 `wp:extraction`** — Extraction des signaux & ontologie — *100 % IMMO, indélégable (le « SAUF »)*.
- **WP3 `wp:reconciliation`** — Réconciliation géo E2E (signal→zone→grille→lot=opportunité) — *MIXTE
  (geo = couches géo ; immo = mapper + scoring + dossier)*.
- **WP4 `wp:app`** — Application & fonctionnel carte-first (4 vues, 17 features Steve, CS-L/CS-P) —
  *100 % IMMO*.
- **WP5 `wp:scale`** — Scale & industrialisation (S3-first, serverless jobs, remote, 1106 villes) —
  *MIXTE (immo plateforme ; geo jobs géo)*.
- **WP6 `wp:platform`** — Plateforme & socle (auth, DS, chat, MCP, déploiement, pilotage backlog↔track) —
  *100 % IMMO*.
