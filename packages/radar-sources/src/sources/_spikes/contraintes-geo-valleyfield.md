# Contraintes géospatiales — Salaberry-de-Valleyfield (Phase 3)

**Date d'investigation :** 2026-05-25
**Agent :** Claude Sonnet 4.6 (claude-sonnet-4-6)
**Zones ciblées :** H-609-4 · U-521→H-521 · H-143/H-143-1 (Grande-Île)

---

## 1. Sources consultées

| Source | URL | Accès le | Résultat |
|--------|-----|----------|---------|
| **BDZI — Données Québec (CKAN API)** | https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=base-de-donnees-des-zones-inondables | 2026-05-25 | OK — 7 ressources listées |
| **BDZI — REST ArcGIS (layer 22 Polygones)** | https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/22/query | 2026-05-25 | OK — requêtes spatiales fonctionnelles |
| **BDZI — REST ArcGIS (layer 71 Études)** | https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/71/query | 2026-05-25 | OK — études répertoriées |
| **BDZI — Téléchargement GPKG** | https://stqc380donopppdtce01.blob.core.windows.net/donnees-ouvertes/Base_donnees_zones_inondables/BDZI_GPK.zip | 2026-05-25 | Non téléchargé (376 MB — requête spatiale REST suffisante) |
| **GRHQ — Données Québec (CKAN API)** | https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=grhq | 2026-05-25 | OK — 9 ressources, dernière maj 2026-05-21 |
| **GRHQ — REST layer 104 (Plans d'eau)** | https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/104/query | 2026-05-25 | OK — requêtes fonctionnelles |
| **GRHQ — REST layer 101 (Strahler/linéaires)** | https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/101/query | 2026-05-25 | OK — requêtes fonctionnelles |
| **GRHQ — WMS (simple)** | https://servicescarto.mern.gouv.qc.ca/pes/services/Territoire/GRHQ_simple_WMS/MapServer/WMSServer | 2026-05-25 | OK — GetCapabilities accessible |
| **CPTAQ — Zone agricole transposée (CKAN API)** | https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=zone-agricole-transposee | 2026-05-25 | OK — 4 ressources (maj 2025-09-26) |
| **CPTAQ — WMS GetCapabilities** | https://carto.cptaq.gouv.qc.ca/cgi-bin/cptaq?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities | 2026-05-25 | OK — layers zone_agricole, zone_limite |
| **CPTAQ — WFS 1.0.0 bbox query** | https://carto.cptaq.gouv.qc.ca/cgi-bin/cptaq?SERVICE=WFS&VERSION=1.0.0&REQUEST=GetFeature&TYPENAME=zone_max&BBOX=... | 2026-05-25 | Vide (null) — WFS bbox ne retourne pas de résultats malgré bbox correcte |
| **CPTAQ — SHP download** | https://carto.cptaq.gouv.qc.ca/data/shapefiles/ZA_transposee.zip | 2026-05-25 | OK (HTTP 200, 34.5 MB, Last-Modified 2026-05-03) — non téléchargé (intersection non confirmable sans géométrie polygone des zones H) |
| **Règlement 150 — Zones-A-Agricoles-150-44.pdf** | https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-codifie-Annexe-A-Zones-A-Agricoles-150-44.pdf | 2026-05-25 | OK — téléchargé et analysé (pdftotext) |
| **Zones-H-Residentielles-150-48.pdf** | https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Zones-H-Residentielles-pvc-et-150-48.pdf | 2026-05-25 | OK — téléchargé et analysé |
| **Feuillet-1.pdf (carte zonage)** | https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Feuillet-1.pdf | 2026-05-25 | OK |
| **Feuillet-2.pdf (carte zonage)** | https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Feuillet-2.pdf | 2026-05-25 | OK |
| **AP_150-49_150-50_assemblee_consultation.pdf** | https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_150-49_150-50_assemblee_consultation.pdf | 2026-05-25 | OK — texte extracté |
| **Avis-public-Approbation-referendaire-150-51.pdf** | https://dua3m7xvptjbw.cloudfront.net/documents/avis/Avis-public-Approbation-referendaire-150-51.pdf | 2026-05-25 | OK — texte extracté |
| **AP_Avis-Registre-150-49-1.pdf** | https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-1.pdf | 2026-05-25 | OK — texte extracté (zones contigues H-143 confirmées) |
| **AP_Avis-Registre-150-49-2.pdf** | https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-2.pdf | 2026-05-25 | OK — texte extracté |
| **ZIS (Zone d'Intervention Spéciale) — neomedia/infosuroit** | https://www.neomedia.com/vaudreuil-soulanges/actualites/valleyfield/379678/inondations-cinq-municipalites-de-beauharnois-salaberry-retirees | 2026-05-25 | OK — Valleyfield partiellement retiré en déc. 2019 |
| **BDZI interactive (CEHQ)** | https://www.cehq.gouv.qc.ca/zones-inond/carte-esri/index.html | 2026-05-25 | Non interrogé (app JS, données REST déjà requêtées directement) |

### Sources non disponibles / bloqueurs

| Source | URL tentée | Résultat | Raison |
|--------|-----------|----------|--------|
| **BDZI 150-49 reglements folder** | https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-49-residuel.pdf | HTTP 403 | CloudFront policy — le dossier `/documents/reglements/` pour les règlements en attente est restreint |
| **CPTAQ WFS bbox (zone_max)** | https://carto.cptaq.gouv.qc.ca/cgi-bin/cptaq?SERVICE=WFS&VERSION=1.0.0&REQUEST=GetFeature&TYPENAME=zone_max&BBOX=... | Vide | GetFeature retourne FeatureCollection vide pour toute bbox — limitation serveur CPTAQ |
| **CPTAQ WMS GetFeatureInfo** | zone_max et zone_agricole layers | ServiceException LayerNotQueryable | Layers non interrogeables via GetFeatureInfo |
| **MRC BHS Aménagement** | https://www.mrcbhs.ca/amenagement-du-territoire | HTTP 403 | Accès refusé |
| **Règlement 150-49 carte (Annexe 2 grilles)** | (cloudfront /reglements/) | HTTP 403 | PDF des grilles/zones 150-49 non accessible dans le dossier reglements en attente |
| **Polygones exacts H-609-4, H-521, H-143-1** | (aucun endpoint géospatial public) | Information non disponible | Les polygones précis des zones de zonage municipal n'existent pas dans un jeu de données public ouvert; les feuillets cartographiques (PDF) sont des images. L'intersection géométrique précise est donc **non confirmable sans SIG local sur les PDFs** |

---

## 2. Contexte géographique des trois zones

### H-609-4 (règlement 150-49, en attente)
- Zone résidentielle H-609 subdivisée en H-609-4 par l'amendement 150-49 (adopté 10 fév. 2026, consultation 23 mars 2026, 2e projet 24 mars 2026).
- Secteur : sud-centre de Valleyfield. Zones contiguës observées sur Feuillet-1/2 : I-924, I-925, I-932, I-933, I-934, I-935, I-936 (zones industrielles), A-939 (zone agricole), C-625, H-628. PAE (programme d'amélioration de l'environnement) présent.
- Densité 150-49 : base 0,5 log./ha → 50 log./ha si 30 % boisé protégé.
- Nouvelle zone A-118-1 créée par 150-49 comme zone tampon/conservation (distincte de A-118).
- Source : `AP_150-49_150-50_assemblee_consultation.pdf` (2026-02-25) · Feuillets 1 et 2 (2026-05-25).

### U-521→H-521 (règlement 150-51, en attente)
- Renommage U-521 (utilité publique) → H-521 (résidentiel). Secteur : rues Lanctôt et Cossette (centre de Valleyfield).
- Zones contigues (150-51 avis 22 avr. 2026) : P-520, H-516, H-519, H-518, H-524, H-522.
- Sur Feuillet-2 : A-912 est directement adjacent à U-521.
- Modification : permet habitations multifamiliales 4–12 logements, max 3 étages, structure isolée, côté Est du chemin Larocque entre rues Trudeau et Daoust. Note : la description « côté Est du chemin Larocque » dans le 150-51 concerne la zone C-627 (nouvelle zone résidentielle) — U-521 est le secteur Lanctôt/Cossette proprement dit. Ces deux sous-secteurs font partie du même règlement 150-51.
- Source : `Avis-public-Approbation-referendaire-150-51.pdf` (2026-04-22) · Feuillet-2 (2026-05-25).

### H-143/H-143-1 (règlement 150-49-1, en attente)
- Zone H-143 dans le quartier Grande-Île (annexé à Valleyfield en 2002). Coordonnées approx. : lat 45,277 N, lon 74,139 O (source Wikipedia Grande-Île).
- H-143-1 : sous-zone plus restrictive (2 log./ha @55 % boisé, 15 log./ha @70 %).
- Zones contigues H-143 (150-49-1, registre 28 avr. 2026) : **A-118, C-144, H-149, P-173, P-142**.
- A-118 est DIRECTEMENT ADJACENT à H-143 (confirmation officielle dans l'avis de registre 150-49-1).
- A-118 est dans la zone agricole provinciale (LPTA, LRQ c.P-41) — toutes les zones A du règlement 150 comportent la disposition spéciale LPTA.
- Grande-Île borde le fleuve Saint-Laurent / Lac Saint-François.
- Source : `AP_Avis-Registre-150-49-1.pdf` (2026-04-14/28) · Zones-A PDF (150-44) · Feuillet-2.

---

## 3. Résultats par couche géospatiale

### 3.1 BDZI — Zones inondables

**Requêtes REST effectuées :**
- Bbox étroite Valleyfield (lon -74,20 à -74,07, lat 45,22 à 45,32) : 0 polygone BDZI retourné.
- Bbox élargie région (lon -74,50 à -73,70, lat 45,10 à 45,45) : 34 polygones retournés.
- Bbox Grande-Île révisée (lon -74,20 à -74,05, lat 45,25 à 45,35) : 0 polygone BDZI.

**Polygones BDZI les plus proches (hors zones ciblées) :**
| OBJECTID | Description | No_rapport | Nom_rapport | Bbox |
|----------|-------------|------------|-------------|------|
| 837/846 | Zone de grand/faible courant | PDCC 16-019 | Rivière Saint-Louis, St-Louis-de-Gonzague | lon [-74,00,-73,99] lat [45,22,45,22] |
| 838/847 | Zone de grand/faible courant | PDCC 16-019 | Rivière Saint-Louis, St-Louis-de-Gonzague | lon [-74,10,-74,08] lat [45,20,45,20] |
| 1009–1031 | Zone de crue 0-100 ans | Projet règl. 302-2018 | Schéma aménagement MRC BHS | lat 45,05–45,22 (au sud de Valleyfield) |

**Conclusion BDZI :** Aucun polygone de zone inondable BDZI n'intersecte les zones H-609-4, H-521 (U-521) ou H-143/H-143-1 dans la base de données. Les zones PDCC 16-019 sont à 5–10 km au sud (Rivière Saint-Louis, Saint-Louis-de-Gonzague). Les ZIS (zones d'intervention spéciale) qui avaient temporairement désigné des secteurs de Valleyfield en 2019 (Parc Delpha-Sauvé, Parc Marcil, secteur Travaux publics, résidence Château Bellevue) ont été **en partie levées en décembre 2019** par décret ministériel — ces secteurs sont des parcs et installations publiques, non les zones résidentielles ciblées.

Source BDZI : https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/22/query (2026-05-25).
Source ZIS : https://www.neomedia.com/vaudreuil-soulanges/actualites/valleyfield/379678/inondations-cinq-municipalites-de-beauharnois-salaberry-retirees (article 3 jan. 2020).
Source ZIS détail secteurs : https://journalsaint-francois.ca/encore-des-zones-considerees-inondables-autour-du-lac-saint-francois/ (16 juill. 2019).

### 3.2 GRHQ — Hydrographie / bandes riveraines

**Requêtes REST effectuées :**
- Layer 104 (plans d'eau) bbox H-521 (lon -74,15 à -74,08, lat 45,24 à 45,28) : 8 objets, dont 1 plan d'eau de **159 ha** (TYPECE 10, lon [-74,13,-74,04] lat [45,26,45,29]).
- Layer 104 bbox Valleyfield ville (lon -74,20 à -74,07, lat 45,22 à 45,28) : 51 objets.
- Layer 104 bbox Grande-Île révisée (lon -74,20 à -74,08, lat 45,25 à 45,32) : 50 objets, dont Lac Saint-François 28 191 ha (TYPECE 23), plan d'eau 1 600 ha (TYPECE 23), plans d'eau 159 ha et 124 ha (TYPECE 10).
- Layer 104 bbox Grande-Île (lon -74,22 à -74,10, lat 45,19 à 45,25) : 19 objets (eau douce, dont un de 5 ha à lon [-74,16,-74,12]).
- Layer 101 (linéaires Strahler) bbox Grande-Île révisée : **512 éléments** (297 TYPECE 10, 131 TYPECE 23, 35 TYPECE 21, 18 TYPECE 41, 25 TYPECE 42).
- Layer 101 bbox Valleyfield ville : 328 éléments.

**Codes TYPECE pertinents (GRHQ) :**
- TYPECE 10 = cours d'eau linéaire / surface hydrographique
- TYPECE 21 = surface hydrographique (plan d'eau calme)
- TYPECE 23 = rive de surface hydrographique (ligne de rive)
- TYPECE 42 = île / péninsule

**Conclusions GRHQ :**
- **H-143/H-143-1 (Grande-Île)** : réseau hydrographique extrêmement dense (512 éléments linéaires, grandes surfaces d'eau en bordure). Le quartier Grande-Île borde le fleuve Saint-Laurent. Les bandes riveraines de 10–15 m (art. 267 LAU, Politique de protection des rives) s'appliquent à toute la bordure du secteur. Les cours d'eau permanents (PERENNITE P = 94 éléments) imposent des servitudes riveraines.
- **H-521 (secteur Lanctôt/Cossette)** : plan d'eau de 159 ha détecté à proximité immédiate (identifiable comme canal de Valleyfield / plan d'eau urbain). Bandes riveraines pertinentes si lot adjacent au plan d'eau.
- **H-609-4** : 328 éléments hydrographiques dans la bbox ville entière; aucun grand plan d'eau identifié dans la zone spécifique. Présence probable de ruisseaux/fossés (PERENNITE I), mais contrainte moindre que Grande-Île.

Source GRHQ : https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/ (2026-05-25).
Source GRHQ dataset : https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=grhq (maj 2026-05-21).

### 3.3 CPTAQ / Zone agricole

**Données obtenues :**
- Zones agricoles municipales (Règlement 150, Annexe A, version 150-44) : A-118, A-135, A-163, A-832, A-833-1, A-901, A-911, A-912, A-920, A-921, A-922, A-939, A-940, A-941, A-942, A-907, A-908, A-909, A-910, A-919, A-926, A-927, A-928, A-929, A-930, A-931.
- **Toutes** ces zones comportent la disposition spéciale : « Habitation bénéficiant d'un privilège ou d'un droit acquis reconnu par la **LPTA** (LRQ, c.P-41) » → elles sont toutes dans la zone agricole provinciale CPTAQ.
- A-118 : ancienne zone A15. Directement adjacent à H-143 (confirmé dans avis de registre 150-49-1).
- A-912 : ancienne zone Ags-7. Directement adjacent à U-521 (observé sur Feuillet-2).
- A-939 : ancienne zone A-1103/Ag2. Adjacent à H-609 (observé sur Feuillet-1).
- WFS CPTAQ (zone_max) : retourne FeatureCollection vide pour bbox Valleyfield — **limitation technique du serveur WFS**, pas absence de données. Le SHP ZA_transposee.zip (34,5 MB, Last-Modified 2026-05-03) est accessible mais non téléchargé (intersection non confirmable géométriquement sans polygones des zones H).

**Conclusions CPTAQ :**
- **H-143 / H-143-1 (Grande-Île)** : DIRECTEMENT ADJACENT à A-118 (zone agricole CPTAQ confirmée). La 150-49 crée une nouvelle zone A-118-1 (conservation/tampon) entre H-143/H-143-1 et A-118, suggérant une volonté de buffer explicite. Tout développement dans H-143-1 à moins de ~30 m de la limite A-118 tombe potentiellement sous un regard CPTAQ si la limite de la zone agricole est franchie.
- **H-521 / U-521** : adjacent à A-912 (zone agricole CPTAQ). Impact direct dépend de l'orientation du développement (côté est = chemin Larocque → moins de risque CPTAQ; côté ouest = potentiellement plus proche).
- **H-609-4** : adjacent à A-939 (zone agricole CPTAQ). La zone H-609 est plus centrale et industriellement encadrée (zones I), la limite CPTAQ est moins directe pour H-609-4 spécifiquement, mais A-939 figure sur Feuillet-1 dans la même zone d'influence.

Source CPTAQ : https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-codifie-Annexe-A-Zones-A-Agricoles-150-44.pdf (2026-05-25).
Source confirmation H-143/A-118 : https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-1.pdf (2026-04-14/28).
Source CPTAQ dataset : https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=zone-agricole-transposee (maj 2025-09-26).

---

## 4. Tableau synthèse : zone × contrainte

| Zone | Contrainte | Statut | Classification | Confiance | Notes / Sources |
|------|-----------|--------|----------------|-----------|-----------------|
| **H-609-4** | BDZI (zones inondables) | Aucun polygone BDZI dans la bbox — 0 résultat REST sur bbox ville et bbox élargie | **Non-applicable** (à ce stade) | Haute — 0 feature retourné par REST avec bbox couvrant l'ensemble de la ville | Source : REST BDZI layer 22, 2026-05-25. *Hypothèse* : si des cours d'eau non encore cartographiés par CEHQ traversent H-609-4, des zones inondables pourraient exister — non confirmé. |
| **H-609-4** | GRHQ / bandes riveraines | 328 éléments hydrographiques dans la bbox ville; aucun grand plan d'eau identifié spécifiquement dans H-609-4 | **Informatif** | Moyenne — la bbox est large (toute la ville); l'absence d'eau de surface ≥5 ha dans la sous-bbox H-609-4 est cohérente avec un secteur mixte résidentiel/industriel intérieur | Source : REST GRHQ layer 104, 2026-05-25. L'intersection géométrique précise (polygone H-609-4 vs GRHQ) **non confirmée**. |
| **H-609-4** | CPTAQ / zone agricole | Zone A-939 (LPTA) adjacente à H-609 sur Feuillet-1; la 150-49 crée A-118-1 comme zone tampon au contact de zones H | **Coûteux** (hypothèse) | Moyenne — A-939 est adjacent à H-609 en général mais l'appartenance précise de H-609-4 à la sous-zone mitoyenne de A-939 n'est pas confirmée géométriquement. Si lots H-609-4 touchent A-939, une demande CPTAQ est requise avant subdivision/développement. | Source : Feuillet-1 (2026-05-25), Zones-A-150-44.pdf (2026-05-25). *Hypothèse* : intersection exacte H-609-4 / A-939 non confirmée (polygones précis non disponibles publiquement). |
| **H-521 (ex U-521)** | BDZI (zones inondables) | Aucun polygone BDZI dans la bbox centre-ville | **Non-applicable** | Haute — 0 feature sur bbox couvrant le secteur Lanctôt/Cossette | Source : REST BDZI layer 22, 2026-05-25. |
| **H-521 (ex U-521)** | GRHQ / bandes riveraines | Plan d'eau de 159 ha (TYPECE 10) détecté dans la bbox H-521 (lon [-74,13,-74,04] lat [45,26,45,29]); 8 objets au total | **Coûteux** (hypothèse) | Moyenne — le plan d'eau de 159 ha chevauche la bbox H-521. Si des lots de H-521 sont en bordure directe de ce plan d'eau (probable pour le côté ouest/canal), la bande riveraine de 10–15 m réduit la superficie constructible et peut imposer PIIA spécial. L'intersection géométrique précise H-521 / plan d'eau **non confirmée**. | Source : REST GRHQ layer 104, 2026-05-25. |
| **H-521 (ex U-521)** | CPTAQ / zone agricole | A-912 (LPTA) adjacente à U-521 sur Feuillet-2; développement résidentiel prévu côté Est chemin Larocque (C-627) et Lanctôt/Cossette (H-521) | **Coûteux** (hypothèse) | Moyenne — A-912 est adjacente, mais le 150-51 prévoit du multifamilial sur la portion Est du chemin Larocque (C-627) qui est davantage côté ville que côté zone agricole. Si lots U-521/H-521 touchent A-912, une autorisation CPTAQ est requise. Intersection géométrique **non confirmée**. | Source : Feuillet-2 (2026-05-25), Zones-A-150-44.pdf (2026-05-25), avis 150-51 (2026-04-22). |
| **H-143/H-143-1** | BDZI (zones inondables) | Aucun polygone BDZI dans la bbox Grande-Île (lat 45,25–45,32) — 0 résultats REST | **Non-applicable** (dans BDZI) | Haute pour l'absence dans BDZI. *Mise en garde* : le quartier Grande-Île borde le fleuve Saint-Laurent; des études de zones inondables CEHQ pourraient exister pour le secteur riverain (non cartographiées dans BDZI pour cette bbox). Le ZIS de 2019 visait des parcs et installations publiques, pas les zones H. | Source : REST BDZI layer 22, 2026-05-25. Source ZIS : neomedia 2020-01-03, journalsaint-francois 2019-07-16. |
| **H-143/H-143-1** | GRHQ / bandes riveraines | 512 éléments linéaires dans la bbox Grande-Île; Lac Saint-François (28 191 ha), plans d'eau 1 600 ha et 159 ha à portée immédiate. PERENNITE P (permanents) = 94 éléments | **Bloquant** pour les lots riverains — **Coûteux** pour les lots intérieurs | Haute — Grande-Île est physiquement une île/péninsule; la densité GRHQ est extrêmement élevée. La Politique de protection des rives, du littoral et des plaines inondables (PPRLPI) impose une bande riveraine de 10–15 m sur tous les cours d'eau permanents. Cela réduit significativement la superficie constructible des lots en bordure du fleuve. Les lots intérieurs ne sont pas affectés directement. | Source : REST GRHQ layer 104 + 101, 2026-05-25. Source PPRLPI : https://www.environnement.gouv.qc.ca/eau/rives (Politique provinciale en vigueur). |
| **H-143/H-143-1** | CPTAQ / zone agricole | A-118 directement adjacent à H-143. Confirmation explicite dans l'avis de registre 150-49-1 (zones contigues listées : A-118, C-144, H-149, P-173, P-142). A-118 est dans la zone agricole LPTA (Zones-A-150-44.pdf). La 150-49 crée A-118-1 (nouveau) entre H-143-1 et A-118 comme zone de conservation. | **Bloquant** pour développement aux abords de la limite A-118 — **Coûteux** pour le reste de H-143 | Haute pour l'adjacence (source officielle). Moyenne pour l'intersection précise (polygones non disponibles). La CPTAQ supervise toute demande d'exclusion, subdivision ou changement d'utilisation des lots en zone agricole provinciale. Le fait que 150-49 crée A-118-1 comme tampon indique que la Ville reconnaît cette contrainte et y répond. Tout lot de H-143-1 en contact direct avec A-118 requiert une attention CPTAQ avant développement. | Source directe : `AP_Avis-Registre-150-49-1.pdf` (2026-04-14/28) · `AP_150-49_150-50_assemblee_consultation.pdf` (2026-02-25) · `Zones-A-Agricoles-150-44.pdf` (2026-05-25). |

---

## 5. Évaluation globale par zone

### H-609-4
- **BDZI :** Non-applicable (aucun inondable BDZI). Confiance haute.
- **GRHQ :** Informatif (pas de grand plan d'eau identifié en H-609-4; hydrographie urbaine mineure présente). Confiance moyenne.
- **CPTAQ :** Coûteux-hypothèse (A-939 adjacent, LPTA actif; intersection précise non confirmée). Confiance moyenne.
- **Verdict Phase 3 :** Contrainte principale = potentiel CPTAQ-A-939 à vérifier; pas d'inondable identifié. La boisé-conservation (150-49) est la contrainte dominante sur le développement.

### H-521 (ex U-521 Larocque/Sainte-Marie central)
- **BDZI :** Non-applicable. Confiance haute.
- **GRHQ :** Coûteux-hypothèse (plan d'eau 159 ha en bordure possible; bande riveraine 10–15 m si lot adjacent). Confiance moyenne.
- **CPTAQ :** Coûteux-hypothèse (A-912 adjacent, LPTA actif; lots côté Lanctôt/Cossette probablement plus éloignés). Confiance moyenne.
- **Verdict Phase 3 :** Zone centrale, contraintes modérées. Vérifier lots spécifiques vs canal et vs A-912.

### H-143/H-143-1 (Grande-Île)
- **BDZI :** Non-applicable dans la base BDZI (0 feature). Confiance haute pour l'absence BDZI. *Hypothèse* : le riverain Saint-Laurent n'est pas formellement carté dans la BDZI pour ce secteur (étude CEHQ peut exister, hors BDZI actuelle).
- **GRHQ / bandes riveraines :** Bloquant pour lots riverains (512 éléments, Saint-Laurent bordier, PPRLPI applicable). Coûteux pour lots intérieurs. Confiance haute.
- **CPTAQ :** Bloquant-coûteux. A-118 DIRECTEMENT adjacent, zone LPTA confirmée. La 150-49 crée A-118-1 comme tampon, confirmant la pression CPTAQ. Confiance haute.
- **Verdict Phase 3 :** Zone la PLUS contrainte des trois. Double contrainte GRHQ (Saint-Laurent) + CPTAQ (A-118). La 150-49 encadre explicitement ces contraintes (boisé + zone A-118-1). C'est la zone avec le plus fort potentiel de densification *à condition* de naviguer les contraintes CPTAQ et riveraines.

---

## 6. Items non disponibles et bloqueurs

1. **Polygones précis des zones H-609-4, H-521, H-143-1** : Information non disponible publiquement sous forme géospatiale exploitable. Les feuillets cartographiques (PDF) sont des images scannées ne permettant pas d'intersection géométrique. Pour une intersection exacte, il faudrait obtenir le SIG municipal (non diffusé en open data) ou vectoriser les feuillets.
2. **CPTAQ WFS bbox** : retourne FeatureCollection vide — limitation du serveur MapServer CPTAQ en mode WFS 1.0.0. Le SHP téléchargeable (34,5 MB) permettrait l'intersection mais nécessite le polygone des zones H (non disponible).
3. **BDZI pour les secteurs riverains Saint-Laurent** : Les études CEHQ pour le fleuve Saint-Laurent à Valleyfield n'apparaissent pas dans la base BDZI (la seule étude Saint-Laurent dans la région, MH-85-03, couvre lon -73,88 soit ~25 km à l'est). Une étude locale pourrait exister hors BDZI. Information non disponible dans les sources consultées.
4. **Détail de la limite A-118 / H-143-1** : L'avis de registre 150-49-1 confirme l'adjacence mais ne fournit pas la longueur de la limite commune ni les lots concernés. L'analyse par cadastre (lot XML RL70052) permettrait de préciser, mais l'intersection lot↔zone A-118 reste une hypothèse sans SIG.
