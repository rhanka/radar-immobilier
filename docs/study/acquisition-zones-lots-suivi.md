# Suivi — Acquisition Zones + Lots (Phase 2 géo data)

> **Statut** : en cours — P0 livré.
> **Date création** : 2026-06-14. **Auteur** : rhanka.
> **Référence** : `docs/spec/cadrage-zones-lots-acquisition.md` (PR #203).
> **Branche** : `feat/acquisition-zones-lots-p0`.

---

## Matrice de suivi par TYPE de plateforme

| Type | Plateforme | Couverture estimée (villes) | Statut | Effort réel/estimé | Scraper |
|------|------------|----------------------------:|--------|-------------------|---------|
| **LOTS** | Cadastre allégé REST (MELCC/MRNF) | **1104/1104** | ✅ **FAIT (P0-A)** | ~1 j-h | `cadastre-allege.ts` |
| **T1** | ArcGIS REST FeatureServer/MapServer | ~150–250 (T1) | ✅ **FAIT crawler (P0-B)** / seed 3 villes | ~1,5 j-h | `arcgis-zonage.ts` |
| **T2** | Données Québec CKAN (open data) | ~10–15 | 🔲 **DIFFÉRÉ PLANIFIÉ (P1)** | ~1,5–2,5 j-h | à créer |
| **T3** | JMap / JMap NG (K2 Geospatial) | ~10–30 | 🔲 **DIFFÉRÉ PLANIFIÉ (S4)** | ~3–8 j-h/déploiement | à créer |
| **T4** | GOnet / Azimut (PG Solutions) | minoritaire (souvent auth) | 🔲 **DIFFÉRÉ PLANIFIÉ (S4, si export public)** | ~8–15+ j-h, risqué | à créer |
| **T5** | PDF scannés / plans papier | ~600–800 | 🔲 **DIFFÉRÉ PLANIFIÉ (OCR + éditeur)** | non automatisable | éditeur semi-manuel |

**Légende :** ✅ FAIT · 🔄 EN COURS · 🔲 DIFFÉRÉ PLANIFIÉ · ❌ EXCLU

---

## P0 livré (2026-06-14)

### P0-A — Adapter Cadastre allégé REST

**Fichiers** :
- `packages/radar-sources/src/geo/cadastre-allege.ts` — adapter principal
- `packages/radar-sources/src/geo/cadastre-allege.fixture.ts` — fixtures CI
- `packages/radar-sources/src/geo/cadastre-allege.test.ts` — tests (0 réseau)
- `packages/radar-sources/src/geo/geo-fetch-utils.ts` — utilitaires partagés

**Endpoint réel vérifié (2026-06-14)** :
```
https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0
```

**Schéma confirmé** :
- `NO_LOT` (string 10) — numéro de lot cadastral, avec espaces (ex. "6 057 912")
- `OBJECTID` (OID) — clé interne ArcGIS
- `SHAPE` (geometry) — polygone GeoJSON

**Vérifications live** :
- Count total : **4 642 815 lots** (`where=1=1&returnCountOnly=true`)
- `maxRecordCount=2000`, `supportsPagination=true`
- Formats : JSON, geoJSON, PBF
- Delson bbox → 5 features, NO_LOT "6 057 912" (OBJECTID 21621) ✓
- Sainte-Catherine bbox → **7 092 lots** ✓

**Échantillon réel Delson** :
```json
{"no_lot": "6 057 912", "objectid": 21621, "geom_type": "Polygon"}
{"no_lot": "2 095 168", "objectid": 28449, "geom_type": "Polygon"}
{"no_lot": "4 138 886", "objectid": 94088, "geom_type": "Polygon"}
```

**Particularités** :
- NO_LOT contient des espaces → à normaliser côté immo lors de la jointure
- Licence : © Gouv. QC, accès public, attribution requise (≠ CC-BY)
- Full crawl province ≈ 2 322 requêtes (4 642 815 ÷ 2000) → throttling recommandé

---

### P0-B — Crawler ArcGIS REST générique (zonage)

**Fichiers** :
- `packages/radar-sources/src/geo/arcgis-zonage.ts` — crawler générique
- `packages/radar-sources/src/geo/arcgis-zonage.fixture.ts` — fixtures CI
- `packages/radar-sources/src/geo/arcgis-zonage.test.ts` — tests (0 réseau)
- `packages/radar-sources/src/geo/arcgis-service-registry.ts` — registre villes → URL

**Registre villes vérifiées T1** :

| Ville | URL service ArcGIS REST | Champ zone | Vérifié |
|-------|------------------------|-----------|---------|
| Longueuil | `services2.arcgis.com/h4XWvDXfYYyD6jNu/.../DO_Zonage/FeatureServer/0` | `Zonage` | 2026-06-14 |
| Shawinigan | `cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer/0` | `zone_` | 2026-06-14 |
| Sherbrooke | `services3.arcgis.com/qsNXG7LzoUbR4c1C/.../Zonage/FeatureServer/0` | `NO_ZONE` | 2026-06-14 |

**Échantillons réels vérifiés** :

Longueuil (query 3 features HTTP 200) :
```json
{"zone": "H34-327 (VLO)", "url_grille": "...H34-327.pdf", "objectid": 1, "geom_type": "Polygon"}
{"zone": "H34-141 (VLO)", "url_grille": "...H34-141.pdf", "objectid": 2, "geom_type": "Polygon"}
{"zone": "P34-191 (VLO)", "url_grille": "...P34-191.pdf", "objectid": 3, "geom_type": "Polygon"}
```

Shawinigan (query 3 features HTTP 200) :
```json
{"zone_": "H-9509", "usage_": "H", "objectid": 1, "geom_type": "Polygon"}
{"zone_": "H-9506", "usage_": "H", "objectid": 2, "geom_type": "Polygon"}
{"zone_": "H-9503", "usage_": "H", "objectid": 3, "geom_type": "Polygon"}
```

Sherbrooke (query 3 features HTTP 200) :
```json
{"no_zone": "A1336", "grille": "...GrilleUsage/?zoneid=A1336", "mun": "43027", "objectid": 1}
{"no_zone": "A1301", "grille": "...GrilleUsage/?zoneid=A1301", "mun": "43027", "objectid": 2}
{"no_zone": "RU1302", "grille": "...GrilleUsage/?zoneid=RU1302", "mun": "43027", "objectid": 3}
```

**Détection automatique du champ zone** :
Candidats par priorité : `NO_ZONE` > `CODEZONE` > `CODE_ZONE` > `Zonage` > `zone_` > `ZONE` > `DESIGNATION` > `NOM_ZONE` > `CATEGORIE` → fallback : premier champ String non-OID.

---

## Backlog planifié (types T2–T5)

### T2 — Données Québec CKAN (P1 différé)

**Statut** : DIFFÉRÉ PLANIFIÉ (S1/P1). Non implémenté dans P0.

**Effort estimé** : ~1,5–2,5 j-h.

**Villes candidates** (source CKAN vérifié 2026-06-14) :
- Longueuil : dataset GeoJSON direct `https://www.donneesquebec.ca/recherche/dataset/.../zonage.json` ✓
- Gatineau, Saguenay, Lévis, Trois-Rivières, Québec, Repentigny, Rimouski, Rouyn-Noranda : à vérifier
- `package_search?q=zonage&rows=0` → **50 datasets** total DQ, ~10–15 villes avec géométrie

**À faire** : adapter CKAN générique (donneesquebec.ca + organization=ville) → téléchargement
GeoJSON/SHP/KML direct. Spike déjà existant : `donnees-quebec-catalog`.

---

### T3 — JMap / JMap NG (S4 différé)

**Statut** : DIFFÉRÉ PLANIFIÉ (S4). Non implémenté.

**Villes concernées** : grandes villes utilisant K2 Geospatial JMap (~10–30).
Exemples : Montréal (JMap NG), potentiellement Québec, Gatineau.

**Effort** : 3–8 j-h par déploiement (rétro-ingénierie API réseau non documentée).

**Condition de déclenchement** : résultat recensement S3 identifie les villes JMap à fort
potentiel (priorityRank élevé + zonage JMap public sans auth).

---

### T4 — GOnet / Azimut (S4 différé, conditionnel)

**Statut** : DIFFÉRÉ PLANIFIÉ (S4, conditionnel — uniquement si export public sans auth).

**Contexte** : GOnet (PG Solutions / Harris) est leader de l'évaluation municipale QC mais le
portail citoyen ne donne PAS accès au zonage cartographié sans login dans la majorité des cas.

**Condition de déclenchement** : un déploiement spécifique expose le zonage publiquement
(sans auth). À confirmer au cas par cas en S3.

**Effort** : 8–15+ j-h, fragile, risque ToS. Priorité basse.

---

### T5 — PDF scannés / plans papier (différé planifié — OCR + éditeur)

**Statut** : DIFFÉRÉ PLANIFIÉ (priorité longue traîne). **Le principal confirme explicitement
que « même les PDF scannés on finira par les faire ».**

**Volume** : ~600–800 petites villes QC n'ont que des plans de zonage en PDF scanné.

**Approches** :
1. **OCR + géoréférencement automatisé** (Tesseract/Cloud Vision + QGIS/GDAL) :
   difficile (plans non structurés, coordonnées absentes). R&D requise.
2. **Éditeur de zones semi-manuel** (inspiration : `editeur-zones.html` de Steve,
   193 zones Sainte-Catherine saisies manuellement) : scalable humainement pour les
   villes prioritaires, non pour 800 villes.
3. **Vectorisation sous-traitée** : option commerciale pour les villes à fort volume.

**Condition de déclenchement** : score métier justifie l'investissement sur une ville donnée
(ex. potentiel de signaux zonage élevé, demande explicite d'un partenaire municipal).

---

## Prochaines étapes recommandées (séquencement cadrage)

| Priorité | Étape | Description | Effort |
|----------|-------|-------------|--------|
| S1/P1 | Adapter CKAN | Adapter générique Données Québec → ~10–15 villes zonage | 1,5–2,5 j-h |
| S2 | Recensement ArcGIS T1 | Peupler registre → ~150–250 villes via sondage URL | 3–5 j-h |
| S3 | Inventaire rejouable | Script sondage plateforme → `GeoSourceInventory` 1104 villes | 3–5 j-h |
| S4 | Intégration immo | Jointure rôle↔lot, modèle Zone/Lot/Designation (SPEC_INTENT_DATA_MODEL_ZONING_LOTS) | hors-effort ici |

---

## Articulation geo ↔ immo

Les modules P0 sont dans `packages/radar-sources/src/geo/` (côté `immo`, socle immédiat).
**Migration future** vers `@sentropic/geo` (issue #56) : les modules sont sans dépendance
domaine immo → extraction directe. Frontière claire : `geo` livre GeoJSON normalisé + provenance,
`immo` consomme + applique sémantique temporelle.

---

*Dernière mise à jour : 2026-06-14 — feat/acquisition-zones-lots-p0*
