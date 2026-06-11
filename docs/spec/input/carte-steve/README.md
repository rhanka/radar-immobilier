# Rétro-ingénierie — Carte interactive de Steve (« Outil de développement »)

> Rétrospective exhaustive de l'outil carto fait par/pour le client (Steve / Guillaume Chaperon),
> hébergé sur Netlify : <https://thriving-kleicha-89b7ef.netlify.app/>
> Date de l'analyse : 2026-06-11. Captures dans [`screens/`](screens/), code source et
> analyse technique dans [`tech/`](tech/).

## Vue d'ensemble

C'est une **plateforme de prospection foncière** pour développeurs immobiliers, centrée sur la
Rive-Sud de Montréal. Pour chaque ville : tous les lots cadastraux (polygones MERN) enrichis du
rôle d'évaluation 2022, croisés avec le zonage municipal (zones 4+ logements) et les périmètres
TOD (Transit-Oriented Development). L'équipe marque les lots (favori / non retenu / en vente /
sollicité / lettre), prend des notes, pose des « pastilles » d'événements réglementaires, et
exporte des CSV de sollicitation postale. **La synchronisation d'équipe temps réel (Firebase
Firestore) est active** — les compteurs observés montrent un usage réel intensif (voir plus bas).

Footer du site : « Plateforme privée — Guillaume Chaperon · Données cadastrales : MERN Québec ».

## Villes couvertes (4 — découvertes via `data/cities.json`)

| Ville | slug | Lots | Zones | TOD | Boundary | Particularités |
|---|---|---:|---:|---|---|---|
| **Delson** | `delson` (défaut si pas de `?ville=`) | 3 213 | 101 | 4 polygones | oui (CSDUID 2467025) | La plus complète : 278 lots 4+, 1 443 TOD, **130 « priorité max » (4+ ∩ TOD)**, descriptions de zones hardcodées (Règlement 901, fév. 2024) |
| **Sainte-Catherine** | `sainte-catherine` | 5 615 | 193 (fichier séparé `data/sainte-catherine-zones.json`, dessinées via l'éditeur) | 0 | non | 868 lots 4+ ; grilles PDF par préfixe (H/C/I/M/P) ; Règlement 2009-Z-00 ; **données équipe : 5 favoris, 5 043 non retenus, 1 sollicité, 204 lettres, 1 pastille PPCMOI** |
| **Saint-Constant** | `saint-constant` | 11 261 | 265 | 1 polygone (5 287 lots dans TOD) | non | Rôle le plus riche (utilisation, année, étages, valeurs) ; grilles PDF par mapping `_fallback_map` |
| **Candiac** | `candiac` | 7 190 | 0 | 0 | non | Données brutes : lots + rôle seulement, aucun zonage ni TOD (zones-json → 404) |

Total : **27 279 lots**. Statut `ready` pour les 4 ; le dashboard prévoit un statut `pending`
(« ⏳ En préparation ») pour les villes futures.

## Paramètres d'URL

| Page | Paramètre | Effet |
|---|---|---|
| `carte.html` | `?ville=<slug>` | Charge `data/<slug>.json` ; défaut `delson` ; slug inconnu → écran d'erreur (capture 61) |
| `carte.html` | `&v=<timestamp>` | Cache-busting ajouté par le dashboard |
| `editeur-zones.html` | `?ville=<slug>` | Défaut `sainte-catherine` |

Aucun autre paramètre d'URL (pas d'état de carte dans l'URL — zoom/filtres non partageables, à
améliorer chez nous).

---

## Inventaire exhaustif des écrans et features

### A. Tableau de bord (`/`, capture [00](screens/00-index-dashboard.png), [01](screens/01-index-recherche-filtre.png))

- **Grille de cartes-villes** : nom, région, nb lots, population, badge ✅ Disponible / ⏳ En
  préparation, bouton « Ouvrir la carte → ». Source : `data/cities.json` avec fallback hardcodé.
- **Recherche de ville** (filtre live sur nom/région).
- *Intégration radar-immobilier* : équivalent de notre sélecteur de municipalité ; nos `sources`
  couvrent déjà ~150 villes — prévoir le même statut ready/pending par ville selon la
  disponibilité des couches (lots, zonage, TOD).

### B. Carte (`carte.html`) — écran principal

#### B1. Chargement & stats (captures [10](screens/10-stecatherine-vue-globale.png), [30](screens/30-delson-vue-globale-tod-boundary.png), [40](screens/40-stconstant-vue-globale.png), [50](screens/50-candiac-vue-globale.png), [61](screens/61-erreur-ville-inexistante.png))
- Overlay de chargement (spinner, nom de ville, étape : récupération / parsing / init carte).
- **Panneau droit** : titre ville + règlement de zonage, 4 stats : Lots total, Zones 4+
  logements, Dans périmètre TOD, ⭐ Priorité max (4+ & TOD). Fermable (✕), lien retour dashboard.
- fitBounds automatique sur l'ensemble des lots.

#### B2. Couche lots — palette de couleurs (légende, capture 30)
Priorité d'affichage (marquage équipe > données) :

| Couleur | Signification |
|---|---|
| `#f1c40f` jaune | ⭐ Favori (marque équipe) |
| `#e74c3c` rouge | ❌ Non retenu / vérifié (marque équipe) |
| `#2980b9` bleu | 📬 Sollicité (marque équipe) |
| `#9b59b6` violet | ✉️ À lettre (marque équipe) |
| `#e67e22` orange | 🏷️ En vente (marque) **ou** ⭐ priorité (4+ ∩ TOD) |
| `#27ae60` vert | Zone 4+ logements |
| `#2980b9` bleu pâle (op. .25) | Dans périmètre TOD |
| `#bdc3c7` gris | Autres lots |

Contours : pointillé rouge = limite de ville ; pointillé bleu foncé + remplissage léger =
périmètre TOD ; pointillé gris + **labels permanents de codes de zones, visibles à zoom ≥ 14**
(capture [14](screens/14-stecatherine-zoom15-labels-zones.png)). Les lots `is_rue` sont exclus.

#### B3. Fiche lot (clic ; captures [12](screens/12-stecatherine-fiche-lot-zoom18.png), [13](screens/13-stecatherine-fiche-lot-panneau.png), [32](screens/32-delson-fiche-lot-priorite-banniere.png), [42](screens/42-stconstant-fiche-lot-role-complet.png))
Lot sélectionné surligné orange. Contenu (champs masqués si vides) :
- Bannière « ⭐ Opportunité prioritaire — Zone 4+ dans périmètre TOD » (si priorité).
- N° de lot, adresse, **code postal** (champ éditable + lookup auto geocoder.ca avec cache).
- **5 boutons de marquage** (favori / non retenu / sollicité / lettre / en vente) — toggle,
  sync Firestore + localStorage.
- « ❌ Marquer toute la zone X comme Non retenu » (batch par code de zone, avec confirm).
- Si « En vente » : mini-formulaire **prix demandé + lien Centris/Realtor** (+ lien cliquable).
- Zone (badge coloré selon 4+/TOD/priorité) + **description hardcodée de la zone** (Delson
  seulement : ex. « Min 16 log · 6 étages · Mixte »).
- Catégorie, Périmètre TOD (badge), Multifamilial 4+, superficie (m² / ha), façade et
  profondeur estimées, utilisation actuelle, année de construction, logements au rôle 2022,
  nb étages, valeur totale / bâtiment / terrain (rôle 2022).
- **Lien « Voir la grille <zone> » → PDF de la grille de zonage** (3 stratégies de résolution,
  voir tech/ARCHITECTURE.md) ; lien Google Maps (adresse, sinon Street View au centroïde).
- **Notes libres par lot** (textarea, sauvegarde sync).

#### B4. Panneau gauche « 🔍 Filtres & Outils » (sections collapsibles, badge « EN DIRECT » si sync Firebase OK ; capture [26](screens/26-stecatherine-panneau-filtres-reduit.png) replié)

1. **Recherche** (capture [11](screens/11-stecatherine-recherche-adresse.png)) : adresse / n° de
   lot / code de zone, dropdown 10 résultats max avec pictos de marquage, navigation clavier
   (↑↓ Enter Esc), zoom + ouverture de fiche au clic.
2. **📍 Pastilles** (capture [23](screens/23-stecatherine-modal-pastille.png)) : marqueurs
   manuels posés au clic sur la carte. Modal : catégorie (⚡ PPCMOI, 📋 Dérogation mineure,
   🗺️ Changement de zonage, ⭐ Opportunité, 🔍 À analyser, 📌 Autre — couleur/icône par
   catégorie), titre, notes ; édition / déplacement / suppression ; liste latérale ; sync équipe.
3. **🔍 Zonage / Potentiel** (captures [16](screens/16-stecatherine-filtre-4plus.png),
   [17](screens/17-stecatherine-filtre-non-retenus-donnees-equipe.png),
   [18](screens/18-stecatherine-filtre-lettres.png),
   [31](screens/31-delson-filtre-priorite-4plus-tod.png),
   [41](screens/41-stconstant-filtre-tod.png)) : filtres exclusifs Tous / 🟢 4+ / 🔵 TOD /
   ⭐ Priorité / ⭐ Favoris / ❌ Non retenus / 🏷️ En vente / 📬 Sollicités / ✉️ À lettre, avec
   compteurs. Statut du flux d'annonces + bouton refresh ↺.
   - **✉️ Exporter lettres → CSV** : 20 colonnes (lot, adresse, code postal, zone, rôle,
     valeurs, 4+/TOD/priorité, notes, lien Google Maps), BOM UTF-8 pour Excel.
   - **💾 Exporter / 📂 Importer toutes mes données** (JSON : marks, listings, notes,
     pastilles, caches postal/overpass).
   - **✏️ Éditeur de zones** (ouvre `editeur-zones.html`).
   - **☑ Sélection multiple** (captures [24](screens/24-stecatherine-selection-multiple.png),
     [25](screens/25-stecatherine-multi-select-3lots-actions-batch.png)) : clic-à-clic, puis
     application batch d'une marque aux N lots, ou export CSV de la sélection.
4. **🏗️ Usage actuel** (capture [19](screens/19-stecatherine-filtre-usage-vacant-min1000m2.png)) :
   filtre additif Résidentiel / Multi-logements (CUBF 5xxx) / Commercial / Industriel / Mixte /
   Public / Vacant + **slider superficie min (0–10 000 m²)** avec compteur « n / total lots ».
5. **🌿 Couches environnementales** :
   - Milieux humides — MELCC (esri-leaflet dynamicMapLayer, couche 2) et Zones inondables BDZI
     (couche 22) (capture [20](screens/20-stecatherine-couches-env-humides-inondables.png)),
     avec message de diagnostic de connectivité.
   - Vue satellite Esri World Imagery (capture [21](screens/21-stecatherine-vue-satellite.png)).
   - Zones agricoles CPTAQ (WMS) (capture [22](screens/22-stecatherine-zones-agricoles-cptaq.png)).
   - **N° civiques** : labels des numéros au centroïde, zoom ≥ 15
     (capture [15](screens/15-stecatherine-numeros-civiques.png)).
6. **🗺️ Légende** (couleurs ci-dessus + couches env, note « Règlement 901 · Valider avec la Ville »).

#### B5. Annonces Realtor.ca (auto-sync)
Fonction Netlify `/.netlify/functions/listings?ville=<slug>` interrogée au chargement puis
toutes les 30 min ; matching adresse-annonce → marque automatiquement les lots « en vente » +
stocke prix/URL/MLS. **Actuellement cassée : Realtor.ca renvoie HTTP 403** (anti-bot) — le
statut d'erreur s'affiche dans le panneau.

#### B6. Mobile (captures [27](screens/27-stecatherine-mobile-390x844.png), [28](screens/28-stecatherine-mobile-fiche-lot-bottomsheet.png))
< 768 px : la fiche lot devient un **bottom-sheet** (55 vh) ouvert via un FAB « 📋 Fiche lot »
ou au clic sur un lot ; panneau filtres rétréci.

### C. Éditeur de zones (`editeur-zones.html`, capture [60](screens/60-editeur-zones-stecatherine.png))
Outil interne de **numérisation manuelle du zonage** : lots en filigrane gris, Leaflet.draw
(polygones), modal code de zone (H-308…) + type (8 types → couleurs), labels permanents, liste
latérale, persistance `localStorage` (`<slug>_zones_edit`), **export/import JSON**
(`[{id, code, type, geojson}]`), liens directs vers le plan de zonage PDF et les grilles de la
ville (hardcodés Sainte-Catherine). Le workflow réel : dessiner → exporter → déposer
`data/<slug>-zones.json` sur Netlify (c'est ainsi que les 193 zones de Sainte-Catherine existent).

### D. Écran d'erreur (capture [61](screens/61-erreur-ville-inexistante.png))
`?ville=` inconnu → « ❌ Erreur — Fichier introuvable : data/<slug>.json ».

---

## Architecture technique (résumé — détail dans [tech/ARCHITECTURE.md](tech/ARCHITECTURE.md))

- **100 % statique** (Netlify) + 1 fonction serverless (`listings`). Aucun build : HTML unique
  avec JS inline (~1 900 lignes), non minifié.
- **Carto** : Leaflet 1.9.4 + esri-leaflet 3.0.12 (couches MELCC) + Leaflet.draw 1.0.4
  (éditeur) ; fonds CARTO light / Esri World Imagery ; WMS CPTAQ ; lib XLSX chargée mais
  non utilisée (exports en CSV maison).
- **Données** : 1 gros JSON par ville (6–24 Mo !) `{meta, lots, zones, tod, boundary}` en
  GeoJSON WGS84. Schéma lot : 22 propriétés (cadastre MERN + rôle 2022 + flags calculés
  `multifamilial_4plus`/`tod`/`priorite` + `is_rue`). Voir
  [tech/analyse-donnees.json](tech/analyse-donnees.json).
- **Collaboration** : Firebase Firestore, 1 document par ville (`plateforme/<slug>`), champs
  `marks`, `lot_notes`, `pastilles_v2`, `listings`, `postal` ; écoute temps réel `onSnapshot`,
  fallback localStorage. ⚠️ Config API en clair côté client, écriture apparemment ouverte
  (aucune auth) — toute personne ayant l'URL peut modifier les données de l'équipe.
- **Services externes** : geocoder.ca (codes postaux), Google Maps/Street View (liens),
  Realtor.ca via fonction Netlify (403 actuellement).
- Logique « zone 4+ » : ensemble hardcodé de codes de zones (Delson) **ou** flag précalculé
  dans le JSON ; descriptions de zones hardcodées pour Delson uniquement.

---

## FEATURES À INTÉGRER dans radar-immobilier (exhaustif, priorisé)

Mapping vers nos vues : **Signaux** (événements réglementaires), **Opportunités** (scoring
lots), **Évaluation** (fiche lot/rôle), **Sources** (ingestion).

### P0 — cœur de valeur, à reprendre
1. **Carte cadastrale lots + zonage + TOD avec scoring visuel** (couleurs par potentiel,
   « priorité = 4+ ∩ TOD ») → vue Opportunités. C'est LA proposition de valeur de l'outil ;
   chez nous le scoring doit devenir multi-critères et data-driven (pas de hardcode par ville).
2. **Fiche lot complète** (cadastre + rôle + zone + grille PDF + Google Maps + notes) → vue
   Évaluation. Nos sources rôle/cadastre couvrent déjà la matière ; ajouter façade/profondeur
   estimées et le lien direct grille de zonage.
3. **Workflow de prospection : marques d'équipe** (favori / non retenu / en vente / sollicité /
   lettre) + notes par lot + **filtres par marque avec compteurs** → statuts de pipeline sur nos
   Opportunités. L'usage réel le prouve (5 043 lots triés à Sainte-Catherine, 204 lettres).
4. **Export CSV « lettres de sollicitation »** (adresse + code postal + valeurs + notes) et
   export de sélection → action sur une liste d'opportunités filtrée.
5. **Filtres combinés** : potentiel (exclusif) × usage actuel (additif) × superficie min
   (slider) — modèle de filtres simple et efficace à reprendre.

### P1 — différenciateurs rapides
6. **Pastilles / annotations géolocalisées par catégorie réglementaire** (PPCMOI, dérogation
   mineure, changement de zonage…) → c'est exactement nos **Signaux** : chez nous elles doivent
   être générées automatiquement depuis les PV de conseils (sources `proces-verbaux-*`), avec
   le CSS `ev-popup`/`ev-marker` de Steve comme inspiration (popup résumé + gains + analyse) —
   le code contient d'ailleurs des styles d'« événements réglementaires » prévus pour ça.
7. **Couches environnementales** : milieux humides MELCC, zones inondables BDZI, zones
   agricoles CPTAQ, satellite — simples tuiles/WMS publics, contraintes critiques d'un terrain.
8. **Recherche adresse / n° lot / zone** avec dropdown + zoom + ouverture fiche.
9. **Sélection multiple + actions batch** (marquage, export).
10. **Labels de zones et n° civiques dépendants du zoom** (lisibilité).
11. **Sync temps réel multi-utilisateurs** — à refaire proprement (notre backend + auth),
    PAS en Firestore ouvert. Inclure export/import JSON de secours.

### P2 — compléments
12. **Flux annonces en vente** (Realtor/Centris) matché sur le cadastre → enrichissement de nos
    Opportunités ; leur implémentation est cassée (403), prévoir un vrai connecteur côté Sources.
13. **Lookup code postal** (geocoder.ca + cache + saisie manuelle) pour le publipostage.
14. **Éditeur de zonage manuel** (Leaflet.draw) comme outil de bootstrap quand une ville n'a
    pas de zonage numérique — utile à notre pipeline d'ingestion (fallback humain), avec export
    GeoJSON versionné.
15. **Marquer toute une zone comme non retenue** (batch par code de zone).
16. **Mobile bottom-sheet** pour la fiche (usage terrain).
17. **Dashboard multi-villes** avec statut de couverture des données par ville.

### Anti-features (à ne pas reproduire)
- JSON monolithique de 24 Mo par ville (→ tuiles vectorielles / PMTiles ou API paginée).
- Firestore sans auth ni règles + clés en clair.
- Hardcode par ville (codes de zones 4+, descriptions, grilles) dispersé entre HTML et data.
- Pas d'état d'URL partageable (zoom/filtres/lot sélectionné).
- localStorage comme stockage primaire (perte de données, pas multi-device sans Firestore).

## Données d'usage réelles observées (Firestore, 2026-06-11)

- Sainte-Catherine : 5 favoris, **5 043 non retenus**, 1 sollicité, 204 « à lettre »,
  1 pastille PPCMOI (test). Le tri de masse zone-par-zone a manifestement servi.
- Delson / Saint-Constant / Candiac : aucune marque d'équipe au moment de l'analyse.
- NB : l'analyse a été faite en **lecture seule** (aucune écriture Firestore/localStorage).
