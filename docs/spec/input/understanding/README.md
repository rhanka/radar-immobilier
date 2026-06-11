# Doc de compréhension — chaque vue de l'app de Steve ↔ notre spec radar

> **But.** Donner à l'utilisateur **un seul endroit** où, pour **chaque écran** (capture) de
> l'outil de prospection foncière de Steve / Guillaume Chaperon, il voit côte à côte : (1) ce que
> montre la vue, (2) la (les) **feature(s) S-N** correspondante(s), (3) **notre couverture** radar
> (écran cible + section de spec précise + comment on la reproduit), et (4) **l'écart** s'il y en a.
> C'est l'artefact que l'utilisateur lit pour dire **« oui, on a bien compris »** ou **« non,
> revoyez ça »**.
>
> **Lecture seule sur les specs.** Ce dossier ne modifie aucune spec ni aucun code ; il **cite** ses
> preuves : la rétrodoc [`../carte-steve/README.md`](../carte-steve/README.md) (inventaire des
> features **S-1..S-17**) et l'archi [`../carte-steve/tech/ARCHITECTURE.md`](../carte-steve/tech/ARCHITECTURE.md),
> et la spec d'intégration **mergée** [`../../SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`](../../SPEC_EVOL_INTEGRATION_CARTE_STEVE.md)
> (mapping feature→écran, §2 S-1..S-17, `ProspectMark`, source TOD A13, décision MapLibre) avec les
> specs d'écran référencées : [`../../SPEC_EVOL_SOCLE_STATES_SCORING.md`](../../SPEC_EVOL_SOCLE_STATES_SCORING.md),
> [`../../SPEC_EVOL_OPPORTUNITES_T2.md`](../../SPEC_EVOL_OPPORTUNITES_T2.md),
> [`../../SPEC_DESIGN_DATA_MODEL.md`](../../SPEC_DESIGN_DATA_MODEL.md),
> [`../../SPEC_REORIENTATION_GRAND_FILET.md`](../../SPEC_REORIENTATION_GRAND_FILET.md).

## Comment lire ce dossier

Chaque capture est décrite **d'après l'image** (anti-invention : on décrit ce qu'on voit, pas le
nom de fichier). Les vues sont regroupées par contexte, dans un fichier par groupe :

| Fichier | Contenu |
|---|---|
| [`00-dashboard.md`](00-dashboard.md) | Tableau de bord multi-villes (captures 00, 01) |
| [`01-sainte-catherine.md`](01-sainte-catherine.md) | Carte principale + fiche + filtres + couches + pastilles + sélection + mobile (captures 10–28) |
| [`02-delson.md`](02-delson.md) | Vue la plus complète : TOD + boundary + priorité (captures 30–32) |
| [`03-saint-constant.md`](03-saint-constant.md) | Rôle le plus riche + TOD (captures 40–42) |
| [`04-candiac.md`](04-candiac.md) | Cas « données brutes » : ni zonage ni TOD (capture 50) |
| [`05-outils-et-erreur.md`](05-outils-et-erreur.md) | Éditeur de zones + écran d'erreur (captures 60, 61) |

### Légende — statut de couverture

| Symbole | Sens |
|---|---|
| ✅ **couverte** | feature mappée sur un écran radar **existant** avec spec précise ; geste équivalent défini |
| 🟡 **partielle** | spec définie, mais dépend d'une donnée pas encore branchée (rôle MAMH, TOD, code postal) ou d'un lot `track` en aval |
| 🔭 **planifiée** | mappée et spécifiée, mais explicitement en aval (P1/P2, infra, ou décision produit en attente) |
| ❌ **non** | volontairement **non reproduite** (anti-feature, ou source interdite type Centris DO-NOT-SCRAPE) |

> Note importante sur le score : la spec bannit le score legacy `/100`. La couche lots coloriée est
> pilotée par le **score de potentiel par lot** (dérivé `ZoneVersion.densiteLogHa`/usages ∩ TOD ∩
> pré-filtres physiques, calculable sur 100 % des lots), **distinct** du **score T2 de dossier** 0-5
> (`OpportunityDossier`, qui n'existe qu'à la maille dossier, né d'un signal). Voir
> `SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` §2 S-1 et `SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.1/§3.3.

## Nos 4 vues radar (cibles d'intégration — aucun nouvel écran)

La thèse d'intégration (`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` §0) : l'outil de Steve est une
**prospection foncière manuelle** sur **4 villes hardcodées** ; le radar **automatise le même
geste** sur ~150 villes. **Tout** ce que fait Steve tombe dans l'une des **4 vues déjà prévues** :

| Vue radar | Composant | Rôle | Ce que Steve y projette |
|---|---|---|---|
| **Signaux** | `SignauxMapView.svelte` | événements réglementaires / ville (PV de conseil) | les **pastilles** réglementaires de Steve, mais **générées auto** (S-6) |
| **Opportunités** | `OpportunitesMapView.svelte` | couche lots scorée + statuts de pipeline + filtres | carte lots coloriée, marques d'équipe, filtres, export CSV (S-1, S-3, S-4, S-5, S-9, S-15) |
| **Évaluation** | `EvaluationMapView.svelte` | fiche lot (cadastre + rôle + zone) | la fiche lot complète + notes + code postal + mobile (S-2, S-10, S-13, S-16) |
| **Sources** | `SourcesMapView.svelte` | maturité de recueil par ville | le **dashboard multi-villes** + éditeur de zonage + statut connecteur annonces (S-17, S-14, S-12) |

## Tableau récap — capture → feature → écran radar → spec → statut

| Capture | Ce que montre la vue | Feature(s) S-N | Notre écran radar | Spec (fichier · §) | Statut |
|---|---|---|---|---|---|
| **00** dashboard | grille 4 cartes-villes (lots/pop, badge Disponible), bouton « Ouvrir la carte » | S-17 | **Sources** | `INTEGRATION` §2 S-17 / §3 | 🟡 |
| **01** recherche ville | filtre live « saint » → 2 villes | S-17 (recherche) | **Sources** | `INTEGRATION` §2 S-17 ; recherche S-8 | 🟡 |
| **10** Ste-Cath vue globale | mer de lots **rouges « non retenu »** + panneau stats | S-1, S-1b, S-3 | **Opportunités** | `INTEGRATION` §2 S-1/S-1b/S-3 | 🟡 |
| **11** recherche adresse | dropdown résultats (route 132…) | S-8 | contrôle **Opp/Éval** | `INTEGRATION` §2 S-8 | ✅ |
| **12** fiche lot zoom18 | lot orange sélectionné + mini-fiche | S-2 | **Évaluation** | `INTEGRATION` §2 S-2 | 🟡 |
| **13** fiche lot (panneau) | stats + n° lot + code postal + **5 boutons marque** + batch zone | S-2, S-3, S-13, S-15 | **Évaluation** + **Opp** | `INTEGRATION` §2 S-2/S-3/S-13/S-15 ; §4.1 `ProspectMark` | 🟡 |
| **14** labels zones zoom15 | codes de zone permanents (M-660…) | S-10 | couches **Opp/Éval** | `INTEGRATION` §2 S-10 | ✅ |
| **15** n° civiques | numéros aux centroïdes (zoom ≥15) | S-10 | couches **Opp/Éval** | `INTEGRATION` §2 S-10 | 🟡 |
| **16** filtre 4+ | seuls lots zones 4+ en vert | S-1, S-5 | **Opportunités** | `INTEGRATION` §2 S-1/S-5 | 🟡 |
| **17** filtre non-retenus | lots rouges (donnée équipe réelle) | S-3, S-5 | **Opportunités** | `INTEGRATION` §2 S-3/S-5 ; §4.1 | 🟡 |
| **18** filtre lettres | sous-ensemble « à lettre » (204) | S-3, S-4 | **Opportunités** | `INTEGRATION` §2 S-3/S-4 | 🟡 |
| **19** usage vacant + min 1000 m² | filtre usage additif + slider superficie | S-5 | **Opp/Éval** | `INTEGRATION` §2 S-5 ; `SOCLE` §2.1 `minLotAreaM2` | ✅ |
| **20** couches env humides/inondables | overlay bleu (MELCC + BDZI) | S-7 | couches **Opp/Éval** | `INTEGRATION` §2 S-7 ; `SOCLE` §3.2 risque | 🟡 |
| **21** satellite | fond Esri World Imagery + lots | S-7 | couches **Opp/Éval** | `INTEGRATION` §2 S-7 | ✅ |
| **22** zones agricoles CPTAQ | overlay WMS CPTAQ | S-7 | couches **Opp/Éval** | `INTEGRATION` §2 S-7 (source A8) | 🟡 |
| **23** modal pastille | catégories PPCMOI/Dérogation/Chgt zonage/… + titre + notes | S-6 | **Signaux** | `INTEGRATION` §2 S-6 | 🟡 |
| **24** sélection multiple | lots cliqués surlignés bleu | S-9 | **Opp/Éval** | `INTEGRATION` §2 S-9 | 🔭 |
| **25** multi-select 3 lots + batch | 3 lots bleus + actions batch | S-9, S-15 | **Opportunités** | `INTEGRATION` §2 S-9/S-15 | 🔭 |
| **26** panneau filtres réduit | panneau gauche replié + badge EN DIRECT | S-11 (sync) | transverse | `INTEGRATION` §2 S-11 ; §9.2 CS-P3 | 🔭 |
| **27** mobile 390×844 | header « Filtres & Outils » + FAB « Fiche lot » | S-16 | **Évaluation** (responsive) | `INTEGRATION` §2 S-16 | 🔭 |
| **28** mobile bottom-sheet | fiche lot en feuille basse | S-16, S-2 | **Évaluation** | `INTEGRATION` §2 S-16/S-2 | 🔭 |
| **30** Delson global TOD+boundary | stats 3171/278/1443/**130 prio**, TOD bleu, boundary rouge, lots orange | S-1, S-1b | **Opportunités** | `INTEGRATION` §2 S-1/S-1b ; §4.0 source A13 TOD | 🟡 |
| **31** Delson filtre priorité 4+∩TOD | seuls les 130 lots priorité (orange) | S-1, S-5 | **Opportunités** | `INTEGRATION` §2 S-1/S-5 | 🟡 |
| **32** Delson fiche lot priorité | **bannière « Opportunité prioritaire »** + rôle complet | S-1, S-2 | **Évaluation** | `INTEGRATION` §2 S-1/S-2 | 🟡 |
| **40** St-Constant global | stats 11261/642/5287/0, 2 périmètres TOD bleus | S-1, S-1b | **Opportunités** | `INTEGRATION` §2 S-1/S-1b ; §4.0 A13 | 🟡 |
| **41** St-Constant filtre TOD | seuls lots dans TOD (2 cercles bleus) | S-1, S-5 | **Opportunités** | `INTEGRATION` §2 S-1/S-5 | 🟡 |
| **42** St-Constant fiche lot rôle complet | rôle riche (usage, année, façade, valeurs) | S-2 | **Évaluation** | `INTEGRATION` §2 S-2 ; §4 (rôle A5) | 🟡 |
| **50** Candiac global | stats 7190/**0/0/0**, lots gris seuls (ni zonage ni TOD) | S-1, S-17 | **Opportunités**/**Sources** | `INTEGRATION` §2 S-1 ; §6.3 `partial`/`non-disponible` | 🟡 |
| **60** éditeur de zones | dessin polygones de zone + export/import JSON | S-14 | **Sources** (bootstrap) | `INTEGRATION` §2 S-14 | 🔭 |
| **61** erreur ville inexistante | « Erreur — Fichier introuvable » | (robustesse) | n/a (sélecteur ville) | `INTEGRATION` §5 (anti-feature URL) | ✅ |

## Synthèse de couverture (30 vues documentées)

- **30 / 30** captures décrites et appariées à au moins une feature S-N + une section de spec.
- **17 / 17** features S-1..S-17 de Steve adressées par la spec d'intégration (+ S-1b panneau stats),
  **0 nouvel écran** (`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` §3, couverture 17/17).
- Statuts par **vue** (capture) :

| Statut | Nb vues | Captures |
|---|---:|---|
| ✅ couverte | 5 | 11, 14, 19, 21, 61 |
| 🟡 partielle | 18 | 00, 01, 10, 12, 13, 15, 16, 17, 18, 20, 22, 23, 30, 31, 32, 40, 41, 42, 50 *(19 lignes → cf. détail ci-dessous)* |
| 🔭 planifiée | 6 | 24, 25, 26, 27, 28, 60 |
| ❌ non reproduite | 0 vue dédiée | *(S-12 flux annonces Centris = DO-NOT-SCRAPE — pas de capture isolée ; voir `03-saint-constant.md` et `05-outils-et-erreur.md`)* |

> **Décompte exact (30 captures)** : ✅ = **5** (11, 14, 19, 21, 61) · 🔭 = **6** (24, 25, 26, 27,
> 28, 60) · 🟡 = **19** (00, 01, 10, 12, 13, 15, 16, 17, 18, 20, 22, 23, 30, 31, 32, 40, 41, 42, 50).
> Soit **5 + 6 + 19 = 30**. **❌ = 0** au niveau « vue » : aucun écran de Steve n'est rejeté en
> bloc ; le seul refus net est la **source** Centris/Realtor (S-12, DO-NOT-SCRAPE), qui n'a pas de
> capture dédiée (l'implémentation de Steve est de toute façon cassée en 403).

**Pourquoi tant de 🟡 ?** La plupart des vues sont **architecturalement couvertes** (écran + spec +
geste équivalent définis) mais **🟡 partielles** car elles attendent une **donnée pas encore
branchée** : le **rôle MAMH** (A5) pour les valeurs de la fiche, le **zonage extrait** (A2/B2) pour
la couche scorée, la **couche TOD A13** (`aires-tod-pmad-cmm`, source ajoutée au plan par
`INTEGRATION` §4.0), et le **code postal** (S-13, A7 IGO). La spec prévoit une **maquette** (§6) qui
charge le **substrat réel** des 4 villes de Steve (JSON Netlify, `mode:"simulation"`) pour valider
l'UX **avant** ces sources — voir le détail dans chaque fiche ville.

## Écarts transverses honnêtes (ne pas sur-promettre)

| Sujet | Réalité Steve | Notre position (spec) |
|---|---|---|
| **Score « priorité »** | booléen hardcodé `4plus && tod` par ville | remplacé par un **score de potentiel par lot** data-driven (≠ score T2 dossier ; jamais le `/100` legacy) — `INTEGRATION` §2 S-1 |
| **Couche TOD** | `tod` FeatureCollection dans le JSON | **source A13 `aires-tod-pmad-cmm`** (open data CMM) ajoutée au plan ; hors CMM → `non-disponible` (≠ « pas de TOD ») — `INTEGRATION` §4.0 |
| **Code postal** | lookup geocoder.ca, cache Firestore | **vide en maquette** (le JSON Netlify n'exporte pas le cache) ; rempli par S-13 (A7 IGO) hors maquette — `INTEGRATION` §6.3 |
| **Marques d'équipe** | Firestore ouvert, last-write-wins, sans auth | **`ProspectMark` append-only + auth backend** ; export/import JSON conservé en filet — `INTEGRATION` §4.1 / §9.2 (CS-P3) |
| **Flux annonces (en vente)** | Realtor.ca → **403** (cassé) | connecteur Sources **honnête** ; **Centris = DO-NOT-SCRAPE** (Tier C) ; prix/lien = saisie humaine `ProspectMark` (vérité), `Valuation` = dérivée — `INTEGRATION` §2 S-12 / §4.1 |
| **Éditeur de zones** | dessin → export JSON → dépôt Netlify | outil de **bootstrap d'une source zonage** dans la vue **Sources**, export GeoJSON **versionné** (S3) — `INTEGRATION` §2 S-14 |
| **Rendu carto** | Leaflet (~11 k lots OK) | notre SVG plafonne à 200 lots → **MapLibre GL** dès CS-L1/CS-L6 ; SVG gardé pour la maille Québec (Signaux/Sources) — `INTEGRATION` §8 |
| **État d'URL** | seulement `?ville=` | état partageable `?ville=&view=&zoom=&filtres=&lot=` — `INTEGRATION` §7 |
