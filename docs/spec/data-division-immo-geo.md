# Division du travail DATA — `immo` ↔ `geo` (RACI par flux)

> **Statut** : proposition décisionnelle (analyse en lecture seule du repo + reco). Aucun code.
> **Date** : 2026-06-21. **Auteur** : rhanka.
> **Mandat du conducteur** : « déléguer le **MAXIMUM de DATA à `geo` tant que ça fait sens** ».
> **Contrainte d'enquête** : h2a est DOWN/quiet (dernier message inbox 2026-06-14, drumbeat figé
> au 2026-06-18). Cette proposition **n'a pas été validée en live avec `geo`** ; le §6 est un
> message prêt à poster dès réouverture du canal, et le §5 liste les questions ouvertes.
> **Antécédents** : prolonge `docs/spec/cadrage-zones-lots-acquisition.md` §4 (frontière géo déjà
> tracée) et `docs/spec/clarif-pv-scraping-geo.md` (les PV restent `immo`). Ce document **étend la
> RACI à TOUS les flux d'acquisition**, pas seulement zones/lots.

---

## 0. TL;DR (décisions proposées)

1. **Principe de partage** : `geo` = **infrastructure d'acquisition/harvest de données géo
   génériques et réutilisables hors immo** (cadastre, zonage, contraintes, registre municipalités,
   open-data géoréférencé) **+ les primitives de traitement géo lourdes qu'il maîtrise déjà**
   (OCR/vision + géoréférencement déterministe de plans PDF). `immo` = **la SÉMANTIQUE métier**
   (détection avis-motion→n° règlement→changement de zonage, ontologie temporelle zonage/lots,
   signaux, scoring) **+ l'infra de scraping DUR anti-bot** (sites municipaux protégés/SPA/403),
   que `geo` ne possède pas et ne veut pas posséder.
2. **À déléguer à `geo` (max raisonnable)** : (a) déjà fait — lots + zones + cadastre via l'API OGC
   `api.geo.sent-tech.ca` (immo consomme, ne scrape plus) ; (b) **le registre municipalités**
   (`municipalities.qc.json`) comme source de vérité géo ; (c) **l'inventaire des sources géo**
   (`GeoSourceInventory`) + le **recensement** des plateformes municipales ; (d) les **contraintes
   géo** (CPTAQ, BDZI, milieux humides) ; (e) **l'acquisition du rôle d'évaluation MAMH** et des
   **adresses Québec** (open-data CKAN/terrAPI génériques, géoréférencés, non-immo) ; (f) **l'OCR /
   géoréférencement de plans de zonage PDF** (geo le fait déjà mieux qu'immo).
3. **À garder `immo` (la valeur métier + ce que `geo` ne peut pas porter)** : (a) la **détection
   sémantique** avis-motion→règlement→zonage (cœur produit) ; (b) le **scraping des PV / séances**
   (texte municipal, pas de la géo) ; (c) le **mapper de résolution** (texte → `zone_ref`/`no_lot`/
   `etape`) ; (d) l'**ontologie temporelle** Zone/Lot/Designation/Valuation ; (e) le **scoring** et
   les **signaux/opportunités** ; (f) **l'infra de scraping DUR** (sidecar Obscura anti-bot/SPA/403)
   — `geo` n'a aucune brique anti-bot et adopte une posture explicitement polie.
4. **Tranche #190 (villes M-Z dures)** : **l'infra de scraping dur reste `immo`** (Obscura).
   `geo` ne peut PAS la porter (pas de capacité anti-bot, posture « pas de retry 403 »). Ce que
   `geo` *pourrait* absorber dans #190 = uniquement l'**OCR des PV scannés** (une fois le PDF
   récupéré par l'infra immo) et la **géoréf** si un plan de zonage est joint. Argument en §4.

---

## 1. Cartographie de la surface d'acquisition (état réel du repo)

Architecture en deux étages côté `immo` : adapters+parsers dans `packages/radar-sources/src`,
orchestration (RECUEIL → EXPLOITATION) + registre d'adapters dans `api/src/services`. Le harvest
géo générique est désormais **délégué à `@sentropic/geo`** (les adapters d'acquisition géo immo ont
été **supprimés**) ; `immo` consomme l'API OGC `api.geo.sent-tech.ca`.

| # | Flux | Possesseur **actuel** (repo) | État |
|---|---|---|---|
| a | **Scraping PV générique** | `radar-sources` (`proces-verbaux-{generic,parser}.ts`) + `api` (`sources/recueil.ts`, `exploitation*.ts`, `live-scrape.ts`, `exploit-scrape.ts`) | Actif (flux le plus mature) |
| b | **Villes M-Z dures #190** (SPA/403/Modellium/Calameo) | `radar-sources` (`pv-cities-hard.json`, logique VPlus/SPA) + **`obscura/`** (sidecar CDP headless, déployé K8s `deploy/k8s/35-obscura.yaml`) + `api` (flag `viaObscura`) | VPlus graphifié ; ~63 irréductibles |
| c | **Registre des villes** (`municipalities.qc.json`, 1106) | `radar-sources/geo/municipalities.qc.json` + loader `municipalities.ts` ; génération `radar/data-prep/fetch-municipal-polygons.ts` (GeoNames + MAMH + haversine) | Actif (statique régénérable) |
| d | **Zones / lots / cadastre** | **`@sentropic/geo`** (acquisition) → `api/src/services/geo/ogc-pull.ts` + `populate-geo.ts` (immo CONSOMME) ; schémas `radar-domain/src/schemas/ontology/geo.ts` ; mapper `extract-refs.ts`/`resolve-refs.ts` (immo) | Actif (PR #239, adapters immo supprimés) |
| e | **Rôle d'évaluation MAMH / Données Québec** | `radar-sources` (`role-evaluation-mamh.ts` + parser RLUEx) + `api` (registre) | Actif |
| f | **Adresses Québec** (terrAPI) | `radar-sources` (`adresses-quebec.ts` + parser) + `api` (registre) | Actif |
| g | **OCR des PV scannés** | `radar-sources` (`pdf-ocr.ts`, tesseract+poppler) | **Stub prêt, NON câblé** au pipeline |
| h | **Identification propriétaire** (captcha/registre foncier) | `radar-sources/_spikes/registre-foncier-qc/` (doc only) + champs PII gardés (`seed-ontology.ts`, `patches.ts`) | **Absent par design** (Loi 25 + payant 1,50 CAD/doc) |
| i | **YouTube séances** | `radar-sources` (`youtube-seances.ts` + `voxtral-transcriber.ts` Mistral) + `api` (registre) | Actif mais **off par défaut** (gated clé API) |

**Capacités `geo` réelles** (repo séparé `geo-quebec` + API OGC, d'après specs + h2a) :
- **Harvester OGC/cadastre industrialisé** : API OGC `api.geo.sent-tech.ca`, collections
  `qc-lots-<slug>` / `qc-zonage-<slug>`, GeoJSON→PostGIS. `crawlQcCadastreLots` (4,6 M lots QC),
  `acquireCkanGeoJson` (11 manifestes CKAN zonage confirmés). **C'est la partie stable consommée
  en prod par immo.**
- **Atelier OCR/vision + géoréférencement déterministe de plans PDF** : extraction de plans de
  zonage AutoCAD/PDF (mutool/OCG layers), géoréf par intersections de rues OSM (RANSAC/ICP), avec
  garde-fous anti-fausse-précision (IoU<0.90 → non déposé). **Opérationnel** (par ville, pipeline
  Python ad-hoc, pas encore packagé en service).
- **Playwright (MCP)** : présent mais pour **automatiser des UIs légitimes** (config DNS Cloudflare),
  **PAS** pour contourner de l'anti-bot.
- **Anti-bot / WAF / 403 / captcha** : **AUCUNE capacité**. Posture explicitement polie
  (« pas de retry sur 403/404 », « pas de scraping de viewers authentifiés »).

---

## 2. RACI proposée par flux (biais « max à `geo` si sensé »)

Légende : **R** = Responsible (exécute) · **A** = Accountable (owner/décide) · **C** = Consulted ·
**I** = Informed. La colonne « Owner cible » donne le possesseur **proposé** après délégation.

| # | Flux | Owner **actuel** | Owner **cible** | R | A | C | I | Justification (pourquoi ce partage fait sens) |
|---|---|---|---|---|---|---|---|---|
| a | Scraping PV générique (collecte texte) | immo | **immo** | immo | immo | geo | — | Texte municipal, pas de la géo. Cœur du « grand filet ». `geo` n'a aucune brique PV. |
| a' | **Détection sémantique** avis-motion→règlement→zonage | immo | **immo** | immo | immo | — | geo | LA valeur produit immo. Strictement métier, anti-invention. Indélégable. |
| b | Infra scraping **dur** (Obscura anti-bot/SPA/403) | immo | **immo** | immo | immo | geo | — | `geo` n'a NI la capacité NI l'appétit (posture polie). Cf. §4. |
| c | Registre municipalités (slug, mrc, lat/lon, pop, distance) | immo (`radar-sources`) | **geo** | geo | geo | immo | — | Donnée géo pure (MRC/coordonnées/population). `geo` = source de vérité ; immo consomme. Seuls `priorityRank`/`excluded`/`deprioritized` restent une **vue immo** (overlay métier). |
| d | Acquisition LOTS (cadastre allégé) | **geo** | **geo** | geo | geo | immo | — | Couche provinciale générique, aucune sémantique immo. **Déjà délégué** (adapters immo supprimés). |
| d' | Acquisition ZONES (CKAN/ArcGIS/JMap) | **geo** | **geo** | geo | geo | immo | — | Scrapers de plateformes géo génériques, réutilisables hors immo. **Déjà délégué.** |
| d'' | Mapper résolution (texte → `zone_ref`/`no_lot`/`etape`) | immo | **immo** | immo | immo | geo | — | Sémantique temporelle + jointure as-of-date. Cœur `SPEC_INTENT_DATA_MODEL_ZONING_LOTS`. |
| e | Inventaire sources géo (`GeoSourceInventory`) | immo (`radar-sources/geo`) | **geo** | geo | geo | immo | — | Catalogue d'acquisition géo générique. Le schéma vit déjà dans `radar-sources/geo` → **à migrer** chez geo. |
| f | Recensement plateformes municipales (annuaire/sondage) | — (à faire) | **geo** | geo | geo | immo | — | Savoir « qui est scrapable » est un travail d'infra géo réutilisable (S3 du cadrage). |
| g | Contraintes géo (CPTAQ, BDZI, milieux humides) | — (spikes) | **geo** | geo | geo | immo | — | Couches WMS/REST provinciales partagées, sans sémantique immo. |
| h | Rôle d'évaluation MAMH (acquisition open-data) | immo (adapter) | **geo** (acquisition) / **immo** (sémantique) | geo | geo | immo | — | Acquisition = open-data CKAN/MAMH générique, géoréférencé (NO_LOT), réutilisable hors immo → délègue. **Mais la jointure rôle↔lot + enrichissement valeur/usage = immo** (scoring). |
| i | Adresses Québec (acquisition terrAPI) | immo (adapter) | **geo** | geo | geo | immo | — | Couche d'adresses provinciale géoréférencée, générique. Aucune sémantique immo dans l'acquisition. |
| j | **OCR / géoréf de plans de zonage PDF** | immo (`pdf-ocr` stub) + geo (atelier) | **geo** | geo | geo | immo | — | `geo` le fait DÉJÀ (vision/RANSAC/ICP) mieux qu'immo. Le stub `pdf-ocr.ts` immo n'est même pas câblé. Délègue. |
| k | OCR **de PV scannés** (texte, pas plan) | immo (`pdf-ocr` stub) | **geo** (primitive) / **immo** (orchestration) | geo | immo | geo | — | Primitive OCR mutualisable côté geo ; mais l'**orchestration** (quel PV, fenêtre temporelle) + la détection sémantique restent immo. Cf. §4. |
| l | Identification propriétaire (registre foncier) | absent | **— (ni l'un ni l'autre)** | — | — | — | — | Bloqué par design (Loi 25, payant, captcha). **Aucune partie ne l'implémente.** À ré-ouvrir seulement via chemin partenaire légal. |
| m | YouTube séances (vidéo→transcript) | immo | **immo** | immo | immo | geo | — | Source d'avis de motion **anticipée** (~15 j avant le PV). Texte municipal, pas géo. La transcription (Voxtral) est une primitive immo ; pas de raison de la mutualiser chez geo (non-géo). |

**Synthèse du sens du partage** :
- **`geo` absorbe tout ce qui est « donnée géo générique géoréférencée, réutilisable hors immo »** :
  cadastre, zonage, contraintes, registre municipalités, inventaire/recensement, rôle (acquisition),
  adresses, **et l'OCR/géoréf de plans PDF** (sa spécialité). C'est le « max raisonnable ».
- **`immo` garde tout ce qui est « sémantique métier » OU « capacité que geo n'a pas »** : détection
  avis-motion→règlement, ontologie temporelle, mapper, scoring, signaux, PV/YouTube (texte municipal),
  **et l'infra de scraping dur anti-bot** (Obscura).

---

## 3. Frontière d'interface (contrat de livraison)

- **Format** : `geo` livre des **GeoJSON normalisés + provenance** via l'**API OGC**
  `api.geo.sent-tech.ca` (collections `qc-lots-<slug>` / `qc-zonage-<slug>`), pagination
  `limit&offset&f=json`. Déjà en place (`api/src/services/geo/ogc-pull.ts`). **PMTiles = plus tard.**
- **Clé de jointure** : `NO_LOT` **verbatim** (autoritaire) + `no_lot_norm` (normalisé sans espaces,
  cf. caveat « 2 181 127 »). Côté zonage : `code_affiche`. La normalisation/jointure temporelle
  reste **immo** (mapper).
- **Pour les flux nouvellement délégués (rôle, adresses, OCR plans)** : à aligner — soit `geo`
  les expose aussi en collections OGC géoréférencées (préférable, cohérent), soit en fichiers
  normalisés + provenance dans un espace SCW **distinct** des `raw/` PV immo (pas de collision de clés).
- **Registre municipalités** : `geo` devient source de vérité (slug/mrc/lat/lon/pop/distance) ;
  `immo` conserve un **overlay** `priorityRank`/`excluded`/`deprioritized` (vue stratégique métier)
  joint au registre geo par `slug`.

---

## 4. Tranche #190 (villes M-Z dures) — qui porte l'infra de scraping dur ?

**Décision : l'infra de scraping dur reste `immo`. Argument.**

1. **Capacité** : le scraping dur de #190 = contournement **anti-bot / WAF 403 / SPA / viewers
   protégés** (Marieville SPA, Papineauville WAF 403, Modellium back-door, Calameo). La seule brique
   qui fait ça dans tout le système est le **sidecar Obscura** (CDP headless), **possédé et déployé
   par `immo`** (`obscura/`, `deploy/k8s/35-obscura.yaml`). **`geo` n'a aucune brique anti-bot** :
   son Playwright sert à configurer du DNS Cloudflare, pas à casser des protections, et sa politique
   est explicitement **polie** (« pas de retry 403/404 », « pas de scraping de viewers authentifiés »).
2. **Appétit / posture** : déplacer l'anti-bot chez `geo` lui imposerait une posture (UA spoofing,
   bypass WAF) **contraire à sa doctrine ToS/robots** assumée. Mauvais fit.
3. **Nature de la donnée** : ce qui est scrapé en dur dans #190 = des **PV (texte municipal)**, pas
   de la géo. Même si l'infra était mutualisable, la donnée cible reste immo.

**Ce que `geo` PEUT absorber dans #190** (le « max raisonnable ») :
- **L'OCR des PV scannés** (flux k) : une fois le PDF récupéré par l'infra immo (Obscura),
  l'extraction texte d'un PV image-only peut appeler une **primitive OCR mutualisée côté geo**
  (geo a déjà tesseract/vision opérationnels). Le stub immo `pdf-ocr.ts` n'est même pas câblé →
  autant consommer la primitive geo. L'**orchestration** (quel PV, fenêtre, détection) reste immo.
- **La géoréf d'un plan de zonage** si un règlement joint un plan PDF (flux j) : déléguée à geo.

**Conclusion #190** : `immo` porte l'**acquisition dure** (Obscura) + la **détection** ; `geo`
fournit, en option, l'**OCR/géoréf** comme primitive consommée par immo. On ne déplace **pas**
l'anti-bot chez geo.

---

## 5. Questions ouvertes à `geo` (h2a DOWN — à valider à la réouverture)

1. **Registre municipalités** : `geo` accepte-t-il d'**owner `municipalities.qc.json`** (slug/mrc/
   lat/lon/pop/distance) comme source de vérité, `immo` gardant un overlay `priorityRank`/`excluded` ?
   Format de livraison (collection OGC ? fichier versionné ?) ?
2. **Rôle d'évaluation MAMH + adresses Québec** : `geo` accepte-t-il d'**absorber l'acquisition**
   (open-data CKAN/MAMH/terrAPI, géoréférencé) et de les exposer en couches normalisées ? La
   **jointure rôle↔lot + enrichissement valeur/usage reste immo** — OK pour cette frontière ?
3. **Inventaire + recensement** des sources géo (`GeoSourceInventory` + sondage plateformes
   municipales) : `geo` les reprend-il (schéma à migrer depuis `radar-sources/geo`) ?
4. **OCR/géoréf de plans PDF** : `geo` packagera-t-il son atelier OCR/vision (actuellement Python
   ad-hoc par ville) en **service/lib consommable** par immo (pour l'OCR des **PV scannés** aussi,
   pas seulement les plans) ? Sous quelle interface ?
5. **Contraintes géo** (CPTAQ/BDZI/milieux humides) : dans le périmètre `geo` ? Calendrier ?
6. **Infra de scraping dur (Obscura)** : `geo` confirme qu'il **ne reprend PAS** l'anti-bot/SPA/403
   (reste immo), et qu'il ne consomme pas Obscura pour ses propres scrapers ? (Sinon, aligner pour
   éviter deux implémentations.)
7. **Buckets/espaces SCW** : les couches nouvellement déléguées (rôle/adresses/OCR) sont publiées
   dans un espace **distinct** des `raw/` PV immo (pas de collision de clés) ?
8. **Calendrier** : `geo` a-t-il la capacité pour absorber rôle/adresses/inventaire/OCR à un
   horizon utile ? Sinon **repli** : `immo` héberge temporairement (les adapters existent déjà),
   `geo` absorbe plus tard.

---

## 6. Message prêt à poster à `geo` (h2a, dès réouverture)

> Voir `§ MESSAGE GEO` ci-dessous — bloc autonome à copier tel quel.

---

## MESSAGE GEO (à poster sur h2a quand le canal est up)

```
DE   : immo (radar-immobilier)
À    : geo (@sentropic/geo / geo-quebec)
OBJET: Proposition de division DATA immo↔geo — pousser la délégation au max raisonnable

Salut geo,

On veut formaliser la frontière DATA et te déléguer le MAXIMUM de données tant que ça fait
sens. Tu owne déjà lots+zones+cadastre (API OGC api.geo.sent-tech.ca, on consomme via ogc-pull,
nos adapters d'acquisition géo sont supprimés). On propose d'étendre la délégation. Reco immo :

CE QU'ON TE PROPOSE DE PRENDRE (donnée géo générique, réutilisable hors immo) :
  1. Registre municipalités (municipalities.qc.json : slug/mrc/lat/lon/pop/distance) comme
     source de vérité. On garde juste un overlay métier (priorityRank/excluded).
  2. Acquisition du rôle d'évaluation MAMH + des adresses Québec (open-data CKAN/MAMH/terrAPI,
     géoréférencé NO_LOT). On garde la jointure rôle↔lot + l'enrichissement valeur/usage (scoring).
  3. L'inventaire des sources géo (GeoSourceInventory, schéma à te migrer) + le recensement
     des plateformes municipales (qui est scrapable).
  4. Les contraintes géo (CPTAQ / BDZI / milieux humides).
  5. L'OCR / géoréférencement de plans de zonage PDF — tu le fais déjà (vision/RANSAC/ICP) mieux
     que nous (notre pdf-ocr.ts n'est même pas câblé). Idéalement packagé en lib/service qu'on
     consomme, et qu'on pourrait aussi appeler pour l'OCR de PV scannés.

CE QU'ON GARDE (sémantique métier OU capacité que tu n'as pas) :
  - La détection sémantique avis-motion → n° règlement → changement de zonage (notre cœur produit).
  - Le scraping des PV / séances de conseil (texte municipal, pas géo) + YouTube séances.
  - Le mapper de résolution (texte → zone_ref/no_lot/etape), l'ontologie temporelle, le scoring,
    les signaux/opportunités.
  - L'infra de scraping DUR anti-bot (sidecar Obscura : SPA/403/WAF des sites municipaux).
    On a noté que tu n'as pas de brique anti-bot et une posture polie (pas de retry 403, pas de
    viewers auth) — donc l'anti-bot reste chez nous, on ne te le refile pas.

SUR LE CHANTIER #190 (villes M-Z dures) :
  L'acquisition dure (Obscura) + la détection restent chez nous. Ce que tu pourrais nous fournir
  en option : l'OCR des PV scannés (une fois le PDF récupéré par notre infra) et la géoréf d'un
  plan si un règlement en joint un. Pas de déplacement de l'anti-bot.

INTERFACE :
  - GeoJSON normalisé + provenance via API OGC (déjà en place). Clé NO_LOT verbatim + no_lot_norm.
  - Pour rôle/adresses/OCR : soit collections OGC géoréférencées (préférable), soit fichiers
    normalisés dans un espace SCW DISTINCT de nos raw/ PV (pas de collision de clés).
  - PMTiles = plus tard, OK.

QUESTIONS OUVERTES (on a besoin de ton OK/contre-proposition) :
  Q1. Tu prends le registre municipalités comme source de vérité ? format de livraison ?
  Q2. Tu absorbes l'acquisition rôle MAMH + adresses Québec ? (jointure reste chez nous)
  Q3. Tu reprends l'inventaire + le recensement des sources géo ?
  Q4. Tu packages ton atelier OCR/géoréf PDF en lib/service consommable (plans ET PV scannés) ?
  Q5. Contraintes géo (CPTAQ/BDZI/humides) : dans ton périmètre ? calendrier ?
  Q6. Tu confirmes que tu NE reprends PAS l'anti-bot/SPA/403 (reste immo) ?
  Q7. Espace SCW distinct pour tes nouvelles couches (pas de collision avec nos raw/ PV) ?
  Q8. Calendrier : capacité d'absorber rôle/adresses/inventaire/OCR à un horizon utile ?
      Sinon repli : on héberge temporairement (les adapters existent déjà), tu absorbes plus tard.

Si un point ne te va pas, contre-propose la frontière. On veut t'en donner le max tant que c'est
de la donnée géo générique sans valeur métier propre.

— immo
```

---

## 7. Inconnues / honnêteté

- **Non validé avec `geo`** : h2a est quiet (dernier message 2026-06-14). Toute la §2/§6 est une
  **reco immo**, pas un accord. `geo` peut contre-proposer (capacité/calendrier).
- **Capacités `geo` déduites** des specs + traces du repo `geo-quebec`, pas d'une démo live de
  bout en bout. L'atelier OCR/géoréf est **opérationnel mais ad-hoc (Python par ville)**, pas encore
  un service packagé — l'effort de packaging (Q4) est une vraie inconnue.
- **Rôle/adresses** : la délégation de l'**acquisition** est nette ; la frontière exacte de la
  jointure rôle↔lot (où s'arrête geo, où commence le scoring immo) reste à border finement.
- **OCR de PV scannés** : techniquement c'est la même primitive que l'OCR de plans, mais
  l'orchestration (fenêtre temporelle, sélection des PV) est intriquée au pipeline immo — la
  frontière « primitive geo vs orchestration immo » (flux k) demande un POC.
```
