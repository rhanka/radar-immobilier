# Clarification décisionnelle — Scraping des procès-verbaux (PV) : articulation `immo` ↔ `geo` + sort de la PR #190

> **Statut** : clarification décisionnelle (analyse en lecture seule du repo + reco). Aucun code.
> **Date** : 2026-06-21. **Auteur** : rhanka.
> **Question du conducteur** : « pour les PV, articulation avec `geo` qui est censé reprendre le
> scraping PV, à confirmer » + que faire de la PR #190 (`feat/pv-cities-mz-hard`) ?
> **Contrainte d'enquête** : h2a est DOWN au moment de la rédaction → impossible de pinger `geo`
> en live. La synthèse s'appuie sur le repo + les docs ; les points qui exigent une confirmation
> de `geo` sont listés explicitement en §5.

---

## 0. TL;DR (décisions proposées)

1. **Le scraping des PV reste `immo`.** Aucun document du repo n'attribue les procès-verbaux /
   séances de conseil municipal à `geo`. Au contraire, le découpage `geo`↔`immo` et la
   réorientation « grand filet » placent les PV au **cœur métier d'`immo`**
   (« procès-verbaux-centric »). `geo` reprend l'acquisition **géo générique** (zones / lots /
   contraintes / registre municipalités) — **pas** les PV.
2. **L'affirmation « geo reprend le scraping PV » est très probablement un malentendu de
   vocabulaire.** Dans les messages de coordination h2a, le mot « geo » désigne le **registre**
   `packages/radar-sources/src/geo/municipalities.qc.json` (la liste des 1106 villes, univers de
   scraping), **pas** le projet `@sentropic/geo` (#56). C'est l'origine probable de la confusion.
3. **PR #190 → ROUVRIR comme chantier ré-extraction, pas merger en l'état, ne pas laisser
   mourir.** Son contenu PV (manifeste 38 villes M-Z dures + 30 configs vérifiées HTTP 200 +
   stratégies SPA/Modellium/Googlebot + 4 raw déjà sur SCW) est **un gisement réel et absent de
   `main`** ; mais la branche est très divergée (52 commits de retard, beaucoup de bruit non-PV).
   → en extraire le PV-only sur une branche fraîche issue de `main`.

---

## 1. Architecture actuelle du scraping PV — qui possède quoi

Le scraping PV est **intégralement possédé par `immo`** (repo `radar-immobilier`), réparti entre le
package de sources et le service API. Flux de bout en bout :

```
WORKER LIVE → RECUEIL (raw → S3 CAS) → EXPLOITATION (parse pdftotext) → graphify (tool séparé) → graph/<ville>/latest.json → API lecture
```

| Étape | Fichier(s) | Rôle |
|---|---|---|
| **Adapter PV générique** | `packages/radar-sources/src/sources/proces-verbaux-generic.ts` | `ProcesVerbauxGenericAdapter` (`SourceAdapter`, `kind:"pv"`). `list()` (index → refs), `fetch()` (download bytes), `hash()`. Paramétré par `PvCityConfig` (slug + `pvIndexUrl` + sourceId). Registre `ALL_PV_CITIES` = source de vérité du câblage (**564 configs sur `main`**). |
| **Parser PV (sémantique métier)** | `packages/radar-sources/src/sources/proces-verbaux-parser.ts` | `parsePvIndex` (énumère l'index) + `detectZonageChange` (chaîne « avis de motion → n° règlement → changement de zonage », strictement anti-invention, déclenche sur verbatim) + `detectIndexRenderMode` (SPA vs static → route vers obscura). |
| **RECUEIL** (orchestration scrape→raw) | `api/src/services/sources/recueil.ts` | `runRecueil()` / `runRecueilWithManifest()` : `adapter.list()` → `adapter.fetch()` → écriture bytes bruts en S3 **avant** toute extraction (idempotent par sha256, HEAD-skip) + run-manifest. |
| **Orchestrateur multi-villes** | `api/src/services/sources/live-scrape.ts` | `runLiveScrape()` : itère `ALL_PV_CITIES`, instancie l'adapter, appelle RECUEIL ; option `exploit:true` enchaîne l'exploitation. |
| **CLI / entry point** | `api/src/scripts/worker-live.ts` (cible Makefile `worker-live`) | `npx tsx src/scripts/worker-live.ts $(CITIES)`. |
| **EXPLOITATION** (parse après recueil) | `api/src/services/sources/exploit-scrape.ts` | Relit les bytes par `storageKey` (jamais de re-fetch), parse via pdftotext/poppler. |
| **Registry d'adapters** | `api/src/services/pipeline/adapter-registry.ts` | Mappe les kinds gérés par le pipeline immo : **PV**, avis-publics, rôle d'évaluation MAMH, adresses-Québec. **Aucune entrée geo / zonage / cadastre.** |
| **Voie HTTP à la demande** | `api/src/routes/sources.ts`, `api/src/routes/ciblage.ts` | POST → RECUEIL ; plan CIBLAGE pilote RECUEIL→EXPLOITATION par ville×source. |
| **Stockage raw (clé CAS)** | `packages/radar-sources/src/RawDocument.ts` | `rawStorageKey()` → `raw/<source>/cas/<sha256>.<ext>` (ex. `raw/proces-verbaux-<ville>/cas/…`) + sidecar `.meta.json`. |
| **Boundary S3** | `api/src/storage/s3-object-store.ts`, `api/src/config.ts` | `S3ObjectStore` (AWS SDK v3). Local : `radar-immobilier-raw` (MinIO). **Prod PV bruts** : store `SCRAPE_S3_*` → bucket SCW `radar-immobilier-docs` (`radar-immobilier-docs-pocs` en POC), endpoint `s3.fr-par.scw.cloud`. |
| **graphify** (raw → graphe) | `tools/graphify-v23/` (`runner.sh`, `worker.sh`, `gate.sh`) + skill `graphify` externe | **Outil bash SÉPARÉ** (pas du code applicatif). `gate.sh` publie `s3://$BUCKET/graph/<CITY>/latest.json` (backup history avant écrasement atomique). Contrat normatif : `radar/ontology/graphify-output-contract.md` (v2.3). |
| **Lecture API du graphe** | `api/src/services/graph/graph-store.ts`, `api/src/routes/graph.ts`, `graph-signals.ts` | Lit `graph/<city>/latest.json`, dérive signaux/étapes/zonage. |

**Conclusion d'ownership** : le scraping PV (collecte → raw → exploitation → graphe) est un pipeline
**100 % `immo`**. `geo` n'apparaît nulle part dans la chaîne PV.

---

## 2. « `geo` reprend-il le scraping PV ? » → **NON** (indéterminé : non ; preuves convergentes)

Réponse : **NON.** Aucun document n'attribue les PV / séances de conseil à `geo`. Plusieurs disent
explicitement le contraire. Preuves :

| # | Source | Citation / fait |
|---|---|---|
| 1 | `docs/spec/cadrage-zones-lots-acquisition.md` L.185, L.192-198, L.202 | Tableau de découpage : ce que `geo` owne = **LOTS, ZONES, inventaire géo, contraintes** ; **aucune ligne PV**. « Détection de changement de zonage (avis de motion → n° règlement) → **`immo`** — Signal métier (grand filet) » (c'est exactement la matière des PV). « `immo` ne scrape jamais lui-même la **géo** » → la frontière porte sur la géo, **pas** sur les PV. |
| 2 | `docs/spec/SPEC_REORIENTATION_GRAND_FILET.md` L.10, L.14, L.19 | Radar « grand filet » multi-villes, **« procès-verbaux-centric »** ; « Opportunité n°1 = changement de zonage repéré dans les **procès-verbaux** » ; « Phase 1 = scraper **procès-verbaux** sur le territoire le plus large ». Le PV est le **cœur produit `immo`**. |
| 3 | `docs/spec/SPEC_PLAN_SCRAPING.md` titre L.1 | « Plan de scraping **`radar-immobilier`** ». Sources « PV conseil » / « YouTube conseil » décrites comme appartenant à `radar-sources` (immo). |
| 4 | `docs/spec/cadrage-geo-integration-mapper.md` L.45, L.62, L.431 | Les PV y sont traités comme **texte source** d'où le **mapper immo** extrait `zone_ref`/`no_lot` ; jamais comme une collecte transférée à `geo`. |
| 5 | `docs/spec/brainstorm-industrialisation-refresh-data.md` (§ « Place de geo ») | La géo « sert l'**exploitation** (enrichir un signal à l'affichage) », « consommée au moment de la requête, **pas pendant la collecte** ». |
| 6 | `.h2a/inbox/…` (messages de coordination) | Le scraping PV est exécuté par les sous-agents **immo**. Le mot « geo » y désigne le **registre** `municipalities.qc.json` (univers de villes), p. ex. « geo 1106 - 550 config » = villes restantes à câbler. **C'est l'origine probable du malentendu** : « geo » = le fichier registre, pas le projet `@sentropic/geo`. |

**Distinction nette** :
- (a) Acquisition **géo générique** (zones / lots / contraintes / registre municipalités) → **`geo`**
  owne (confirmé, et déjà en cours : `@sentropic/geo` est consommé pour zones/lots).
- (b) Scraping des **PV / séances de conseil** → **reste `immo`**. `geo` ne reprend **pas** les PV.

Le **mapper de résolution** (texte PV → `zone_ref`/`no_lot`/`etape`) reste lui aussi côté `immo`
(`docs/study/acquisition-zones-lots-suivi.md` : « le mapper reste côté immo »). `geo` ne fournit que
les **couches géo** (polygones zones/lots) que le mapper immo joint au texte des PV.

---

## 3. Sort de la PR #190 (`feat/pv-cities-mz-hard`)

### 3.1 Ce que contient #190 (vérifié)

- **Statut PR** : `CLOSED`, non mergée, branche **préservée**. Fermée le **2026-06-21** (le jour même
  de cette clarification).
- **Contenu PV-spécifique** (le gisement réel) :
  - `packages/radar-sources/src/sources/pv-cities-hard.json` — manifeste **38 villes M-Z dures**
    (slugs : marieville, oka, namur, papineauville, mont-joli, roberval, quebec, … M→R), classées
    par stratégie (`static-curl`, `spa-playwright`, `spa-modellium-backdoor`, `obscura-403`,
    `calameo`, `ocr`, `irreductible`) et par statut (`config-ready`, `spa-needs-render`,
    `scraped-raw`, `scraped-0docs`, `blocked`, `irreductible`).
  - **30 villes câblées config-only** dans `ALL_PV_CITIES` (`proces-verbaux-generic.ts`, +226 l.)
    avec `pvIndexUrl` vérifiés HTTP 200 (anti-invention).
  - **Smoke test** `proces-verbaux-mz-hard.test.ts` (+69 l.).
  - **RECUEIL live validé end-to-end** : raw scrapés sur SCW pour **mont-joli, metabetchouan,
    oka, rapide-danseur** (`raw/proces-verbaux-<ville>/cas/`).
  - **Stratégies dures vérifiées** : SPA Marieville (Playwright/rendu navigateur) ; back-door
    Modellium vplus (sitemap `api/<slug>/sitemap/xml` + PDF S3 `vplus-documents`) ; bypass WAF
    403 Papineauville via UA Googlebot ; visualiseur Calameo (Oka).
- **Reste à faire (selon le body PR)** : **graphify NON exécuté** (skill absente de l'env subagent)
  → les raw sont prêts, graphify à faire ; **7 villes irréductibles** (sites absents / 0 PV public /
  NXDOMAIN).

### 3.2 État vis-à-vis de `main`

- Le manifeste `pv-cities-hard.json` **existe sur `main` mais y est VIDE** (placeholder 0 ville, non
  commité dans l'historique) ; la version peuplée (38 villes) n'existe **que** dans la branche #190.
- **Aucune** des villes M-Z dures (marieville, oka, namur, papineauville, mont-joli, roberval,
  quebec…) n'est câblée dans `ALL_PV_CITIES` sur `main`.
  → **Le travail de #190 est intégralement hors-`main` et préservé uniquement dans la branche.**
- La branche est **fortement divergée** : ~52 commits de retard sur `main`, et son diff contient
  beaucoup de **bruit non-PV** (auth/admin, UI maps, router SPA, ontology v2, data-prep polygones —
  déjà mergés autrement sur `main`). Un merge direct de la branche serait dangereux.

### 3.3 Classification : (b) **gisement à revivre** — partiellement (c) à **refondre**

- **PAS (a) superseded par geo** : `geo` ne reprend pas les PV (§2) → le contenu PV de #190 reste
  pertinent et nécessaire.
- **(b) gisement réel** : le manifeste + les 30 configs vérifiées + les 4 raw SCW + les stratégies
  dures sont du **travail d'investigation coûteux et non reproduit sur `main`**. À récupérer.
- **(c) à refondre dans la forme** : ne **pas** merger la branche telle quelle (divergence + bruit).
  Extraire **uniquement les 4 fichiers PV** (`pv-cities-hard.json`, le delta `proces-verbaux-generic.ts`
  des 30 configs, le smoke test, et le pointeur vers les raw SCW) sur une **branche fraîche issue de
  `main`**, re-vérifier les URLs HTTP 200 (certaines datent du 2026-06-14), puis enchaîner le
  **graphify manquant** des raw déjà sur SCW.

### 3.4 Reco #190

> **ROUVRIR comme chantier ré-extraction PV M-Z dures** (pas merger la branche, pas laisser
> fermé-mort). Concrètement :
> 1. Nouvelle branche `feat/pv-mz-hard-replay` **depuis `main`** (worktree isolé).
> 2. Cherry-pick / port **PV-only** : `pv-cities-hard.json` (38 villes) + les 30 configs
>    `ALL_PV_CITIES` + `proces-verbaux-mz-hard.test.ts`. Ignorer tout le reste du diff (déjà sur
>    `main` ou hors sujet).
> 3. Re-vérifier les `pvIndexUrl` HTTP 200 (anti-invention ; les marquages datent du 14/06).
> 4. **graphify** les 4 raw déjà sur SCW (mont-joli, metabetchouan, oka, rapide-danseur) →
>    `graph/<ville>/latest.json` (contrat v2.3), puis étendre aux villes `config-ready`.
> 5. Traiter les stratégies dures en lots séparés (SPA via obscura, Modellium back-door, Googlebot)
>    et **acter les 7 irréductibles** (notés + passés).
> 6. Rattacher ce chantier à l'audit « villes graphifiées sans signal » (cf. §4).

---

## 4. Note : audit `audit-villes-sans-signal.md` introuvable

Le brief mentionne `docs/spec/audit-villes-sans-signal.md` (~295 villes graphifiées sans signal,
dont ~50-105 à ré-extraire). **Ce fichier n'existe nulle part dans le repo** — ni sur `main`, ni
dans la branche #190, ni dans `docs/`. À confirmer : soit il porte un autre nom / vit ailleurs
(autre repo, doc externe), soit il reste à créer. Le chantier ré-extraction de #190 (villes M-Z
dures) est **un sous-ensemble cohérent** de ce chantier « villes sans signal » et devrait s'y
rattacher.

---

## 5. Points à confirmer avec `geo` (h2a DOWN — à valider dès réouverture)

> Ces points n'ont **pas** pu être confirmés en live (h2a indisponible). Ils sont à poser à `geo`
> dès que le canal est rétabli. Aucun ne remet en cause la reco §0 (le repo est clair), mais ils
> verrouillent la frontière.

1. **Confirmer le périmètre `geo` = géo générique uniquement.** `geo` (`@sentropic/geo`, #56) owne
   **zones / lots / contraintes / registre municipalités**, et **NON** les PV / séances de conseil.
   → demander une confirmation explicite que `geo` **ne prévoit pas** d'absorber la collecte PV.
2. **Lever l'ambiguïté de vocabulaire « geo ».** Acter que dans les échanges, « geo » a deux sens :
   (i) le **registre** `municipalities.qc.json` (univers de villes à scraper, possédé par
   `radar-sources`/immo) ; (ii) le **projet** `@sentropic/geo`. Le scraping PV référence (i), pas (ii).
3. **Interface de livraison des couches géo** (rappel du cadrage, non tranché) : format de couche
   (GeoJSON paginé vs PMTiles) + clé de jointure (`NO_LOT` normalisé) que `geo` livrera à `immo`
   pour que le **mapper immo** joigne le texte des PV aux polygones.
4. **Calendrier `geo`** : `geo` a-t-il la capacité/le calendrier pour livrer les couches zones/lots
   à temps pour le chantier ré-extraction PV ? (Sinon le repli du cadrage s'applique : `immo` héberge
   temporairement, `geo` absorbe plus tard — mais cela **ne concerne que la géo**, pas les PV.)
5. **Buckets SCW partagés** : confirmer que `radar-immobilier-docs` / `…-docs-pocs` (raw PV +
   graphes) restent **owned par immo**, et que `geo` publie ses couches dans un **espace distinct**
   (pas de collision de clés `raw/` ↔ couches géo).
6. **Rendu headless / obscura** : le sidecar obscura (rendu SPA, bypass 403) est-il un service
   **immo** ou un service partagé que `geo` pourrait aussi consommer pour ses propres scrapers de
   plateformes (ArcGIS/JMap derrière auth) ? À aligner pour éviter deux implémentations.

---

## 6. Réponses directes au conducteur

- **Architecture PV actuelle (qui possède)** : `immo` possède **tout** le pipeline PV — adapter +
  parser dans `packages/radar-sources/src/sources/proces-verbaux-{generic,parser}.ts` ; RECUEIL /
  orchestration / exploitation dans `api/src/services/sources/` ; graphify = tool bash séparé
  `tools/graphify-v23/` ; raw + graphes sur SCW `radar-immobilier-docs`. `geo` n'y figure pas.
- **`geo` reprend-il les PV ?** → **NON.** 6 preuves convergentes (cadrage, réorientation, plan
  scraping, mapper, brainstorm, h2a). `geo` reprend la **géo générique** (zones/lots/contraintes),
  pas les PV. Le « geo » des messages h2a = le **registre de villes**, d'où le malentendu.
- **Sort de #190** → **ROUVRIR comme chantier ré-extraction** (gisement réel hors-`main`),
  **ne pas merger la branche** (divergée + bruit non-PV), **ne pas laisser mourir** : porter le
  PV-only sur une branche fraîche, re-vérifier les URLs, graphifier les 4 raw SCW, traiter les
  stratégies dures par lots, acter les 7 irréductibles.
- **Points à confirmer avec `geo`** : voir §5 (6 points ; le principal : confirmer noir sur blanc
  que `geo` n'absorbe pas la collecte PV).
