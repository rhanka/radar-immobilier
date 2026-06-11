# Architecture technique — carte Steve (thriving-kleicha-89b7ef.netlify.app)

Rétro-ingénierie du 2026-06-11. Le code est servi **non minifié** (JS inline dans les pages
HTML) — copies brutes dans ce dossier : [`index.html`](index.html) (dashboard, 130 lignes),
[`carte.html`](carte.html) (~1 900 lignes), [`editeur-zones.html`](editeur-zones.html)
(~520 lignes), [`cities.json`](cities.json).

## Stack

| Brique | Choix | Détail |
|---|---|---|
| Hébergement | Netlify (site statique) | + 1 fonction serverless `listings` |
| Carto | **Leaflet 1.9.4** (CDN cloudflare) | pas de framework JS, DOM direct |
| Couches ArcGIS | esri-leaflet 3.0.12 | `dynamicMapLayer` MELCC (gère la projection EPSG:32198) |
| Dessin | Leaflet.draw 1.0.4 | éditeur de zones uniquement |
| Export | xlsx 0.18.5 chargé **mais non utilisé** | exports réels en CSV maison (BOM UTF-8) |
| Temps réel | Firebase 9.22.2 compat (app + firestore) | projet `plateforme-quebec` |
| Fond de carte | CARTO light_all (`{s}.basemaps.cartocdn.com`) | satellite : Esri World_Imagery |

## Pages & flux

```
/                      → dashboard villes (data/cities.json, fallback hardcodé)
/carte.html?ville=S    → fetch data/S.json (no-store) → initMap()
                         ├─ si zones vides → fetch data/S-zones.json
                         ├─ si encore vides → localStorage S_zones_edit (éditeur)
                         ├─ Firestore plateforme/S → onSnapshot (marks, notes, pastilles, listings)
                         └─ /.netlify/functions/listings?ville=S (au load + 30 min)
/editeur-zones.html?ville=S → lots en filigrane + Leaflet.draw → localStorage S_zones_edit
                              → export/import JSON manuel (→ déployé en data/S-zones.json)
/grilles/<...>.pdf     → grilles de zonage statiques (PDF)
```

## Schéma `data/<slug>.json`

```jsonc
{
  "meta": {
    "nom", "slug", "region", "population",
    "bbox": [latMin, lngMin, latMax, lngMax],
    "centre": [lat, lng], "zoom_initial",
    "reglements": "Règlement 901 · Fév. 2024",   // affiché sous le titre
    "postal_prefix": "J5B",
    "grilles": {                                   // optionnel — 3 formats :
      "H": "grilles/ste-catherine-H.pdf", ...,     // 1) par préfixe de zone
      "_fallback": ["C-646", ...],                 //    + liste des zones couvertes
      "_fallback_map": {"H-228": "grilles/saint-constant-H200plus.pdf", ...} // 2) mapping direct
    }                                              // 3) défaut: grilles/<slug>-<zone>.pdf
  },
  "lots":     { /* FeatureCollection, Polygon/MultiPolygon WGS84 */ },
  "zones":    { /* FeatureCollection {zone: "H-104", nom: "Résidentielle"} */ },
  "tod":      { /* FeatureCollection {nom|id} — périmètres TOD */ },
  "boundary": { /* FeatureCollection {name, CSDUID} — limite municipale */ }
}
```

### Propriétés d'un lot (22 clés)

| Clé | Type | Source probable | Notes |
|---|---|---|---|
| `NO_LOT` | string | cadastre MERN | parfois avec espaces (« 2 181 127 ») |
| `OBJECTID` | int | cadastre (Delson seulement) | |
| `adresse` | string | rôle | « 296 Rue GRENADIER » |
| `zone` | string | zonage municipal | « H-110 », « N/D » ou « » |
| `categorie` | string | dérivé | Résidentiel / Mixte / Industriel / Commercial / Public / Institutionnel / Récréatif / Conservation / Autre |
| `cubf` | string | rôle | code CUBF ; `5xxx` ⇒ multi-logements |
| `utilisation` | string | rôle | « Résidentiel 1 log. », etc. |
| `annee_construction` | string | rôle 2022 | |
| `nb_logements_role` | int | rôle 2022 | |
| `nb_etages` | string | rôle | |
| `val_totale` / `val_terrain` / `val_batiment` | int | rôle 2022 | $ |
| `superficie_m2_calculee` | float | calcul géométrique | |
| `facade_m` / `profondeur_m` | float | estimé | |
| `multifamilial_4plus` | bool | **précalculé** (zonage) | |
| `tod` | bool | précalculé (∈ périmètre TOD) | |
| `priorite` | bool | précalculé = `4plus && tod` | |
| `zone_desc` | string | souvent vide | |
| `tier` | int | Delson seulement | |
| `is_rue` | bool | exclut les emprises de rue de l'affichage | 42 à Delson |

Stats par ville (calculées sur les données réelles) : voir
[`analyse-donnees.json`](analyse-donnees.json). Tailles : delson 6,2 Mo · sainte-catherine
10,3 Mo · saint-constant 24,2 Mo · candiac 12,3 Mo — chargés d'un bloc, `cache: no-store`.

## Logique métier clé (carte.html)

- **Couleur/opacité lot** : `getLotColor`/`getLotOpacity` — marque équipe > priorité > 4+ >
  TOD > gris (l.929-952). Bordure épaissie si marqué/priorité.
- **Visibilité** : `isVisible` (l.953-977) = `!is_rue` ∧ superficie ≥ slider ∧ usage (matching
  par `utilisation`/`categorie`/préfixe CUBF) ∧ filtre courant (exclusif).
- **Zones 4+ Delson hardcodées** : `Z4` (Set de 25 codes) + `ZD` (descriptions par code,
  l.574-575) — pour les autres villes, le flag est dans la data.
- **Grilles PDF** : `getGrilleUrl` (l.600-617) — `_fallback` (préfixe) → `_fallback_map`
  (direct, null = pas de grille) → `grilles/<slug>-<zone>.pdf`.
- **Labels de zones** : tooltips Leaflet permanents `className: zone-label`, opacité 0 si
  zoom < 14 (l.622-647). **N° civiques** : divIcons aux centroïdes, zoom ≥ 15 (l.1537-1584).
- **Recherche** : filtre en mémoire sur adresse/NO_LOT/zone, debounce 180 ms, 10 résultats
  (l.1708-1808).
- **Annonces** : `chargerAnnonces` → fonction Netlify → `_matchAdresse` (n° civique + dernier
  mot de rue) → marque `envente` + `listingsData` (l.667-721). Réponse actuelle :
  `{"error":"Realtor.ca HTTP 403","listings":[],"total":0}`.
- **Code postal** : geocoder.ca (`?locate=<adresse, ville, QC>&json=1`), file d'attente avec
  400 ms entre requêtes, cache validé regex `[A-Z]\d[A-Z] \d[A-Z]\d`, champ éditable (l.785-858).
- **Exports** : `exportLettresCSV` (l.860-907, 20 colonnes), `exporterSelectionCSV`
  (l.1679-1706, 8 colonnes), `exporterDonnees`/`importerDonnees` (l.1608-1665, dump JSON des 6
  clés localStorage).

## Synchronisation Firebase

```js
// carte.html l.444-495 — config EN CLAIR dans la page publique
FIREBASE_CONFIG = { apiKey: "AIzaSyCXcffXVz4pQzLHGBjheJm...", projectId: "plateforme-quebec", ... }
cityDoc = db.collection('plateforme').doc(villeSlug);
syncSave(field, data)  // localStorage + cityDoc.set({field: data}, {merge: true})
initSync()             // onSnapshot → met à jour marks/lot_notes/pastilles_v2/listings + restyle
```

- 1 document Firestore **par ville**, champs-dictionnaires indexés par NO_LOT.
- Aucune authentification visible ; l'écriture client fonctionne (badge « EN DIRECT » vert).
  ⚠️ **Risque** : n'importe qui avec l'URL peut lire/écraser le travail de l'équipe ; pas
  d'historique ni de résolution de conflits (last-write-wins par champ entier).
- Modèle de marque : `marks[NO_LOT] = 'favori'|'verifie'|'sollicite'|'lettre'|'envente'`
  (une seule marque par lot) ; `lot_notes[NO_LOT] = string` ;
  `pastilles_v2 = [{id, lat, lng, titre, notes, categorie, date}]` ;
  `listings[NO_LOT] = {prix, url, mls?, postal?, date, auto?}`.

## Services externes

| Service | Usage | État observé |
|---|---|---|
| `servicesgeo.enviroweb.gouv.qc.ca` (ArcGIS MapServer `Themes_publics`) | couche 2 = milieux humides, couche 22 = BDZI | OK via esri-leaflet |
| `carto.cptaq.gouv.qc.ca` (WMS `zone_agricole`) | zones agricoles | OK |
| `server.arcgisonline.com` World_Imagery | satellite | OK |
| `geocoder.ca` | codes postaux | OK (gratuit, throttlé 400 ms) |
| `/.netlify/functions/listings` → Realtor.ca | annonces en vente | **HTTP 403** (anti-bot) |
| Google Maps / Street View | liens sortants | OK |
| Firebase Firestore | sync équipe | OK, ouvert |

## Sources de données amont (déduites)

- **Cadastre** : MERN Québec (mention footer), polygones de lots avec NO_LOT.
- **Rôle d'évaluation 2022** : valeurs, CUBF, logements, année, étages (jointure par lot).
- **Zonage** : règlements municipaux (Delson 901, Sainte-Catherine 2009-Z-00) — numérisé soit
  en amont (Delson, Saint-Constant), soit **à la main via l'éditeur** (Sainte-Catherine,
  193 polygones dans `data/sainte-catherine-zones.json`).
- **TOD** : périmètres dessinés/importés (4 polygones à Delson, 1 à Saint-Constant).
- **Grilles de zonage** : PDF découpés depuis les sites municipaux, déposés dans `/grilles/`.

## Fichiers de ce dossier

| Fichier | Contenu |
|---|---|
| `carte.html` | Source complet de la carte (JS inline annoté par n° de lignes ci-dessus) |
| `index.html` | Source du dashboard |
| `editeur-zones.html` | Source de l'éditeur de zones |
| `cities.json` | Index des villes (copie de `data/cities.json`) |
| `analyse-donnees.json` | Stats calculées par ville : schéma effectif, catégories, utilisations, compteurs 4+/TOD/priorité, échantillons de lots |

Les `data/<slug>.json` complets (6–24 Mo) ne sont **pas** committés ; ils restent
téléchargeables : `https://thriving-kleicha-89b7ef.netlify.app/data/<slug>.json`.
