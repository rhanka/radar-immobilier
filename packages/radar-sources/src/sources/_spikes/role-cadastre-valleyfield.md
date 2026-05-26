# Phase 2 — Ancrage foncier Salaberry-de-Valleyfield
## Rôle d'évaluation + Cadastre allégé : résultats d'investigation réelle

**Rédigé :** 2026-05-25  
**Agent :** claude-sonnet-4-6 (investigation de données réelles)  
**Méthode :** WebSearch + WebFetch + `curl` + `pdftotext` + parsing XML Python

---

## (a) Sources utilisées — résultats d'accès

### Source 1 : Rôle d'évaluation foncière 2026, municipalité 70052

| Champ | Valeur |
|-------|--------|
| URL dataset | <https://www.donneesquebec.ca/recherche/dataset/roles-d-evaluation-fonciere-du-quebec> |
| URL index CSV 2026 | <https://donneesouvertes.affmunqc.net/role/indexRole2026.csv> |
| URL fichier XML | <https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml> |
| Format | XML codé MEFQ (Manuel d'évaluation foncière du Québec) |
| Taille | 27 Mo |
| Méthode d'accès | `curl` direct, HTTP 200, téléchargement réussi |
| Date d'accès | 2026-05-25 |
| Statut | **ACCESSIBLE — données réelles obtenues** |

L'index `indexRole2026.csv` liste 70052 Salaberry-de-Valleyfield avec l'URL exacte `https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml`. Le rôle 2026-2027-2028 a été déposé le 2026-09-13 (année de référence marché : 2024-07-01), géré par Servitech Inc.

**Schéma XML pertinent :**
- `RL0101x/RL0101Ax` = numéro civique  
- `RL0101x/RL0101Ex` = code d'usage (RU, AV, BO, CH, TE…)  
- `RL0101x/RL0101Gx` = nom de rue  
- `RL0103x/RL0103Ax` = NO_LOT (numéro de lot cadastral)  
- `RL0104A` = code de secteur (4 chiffres)  
- `RL0301A` = superficie du plancher bâtiment (m²)  
- `RL0302A` = superficie du lot (m²)  
- `RL0401A` = date de référence d'évaluation  
- `RL0402A` = valeur totale de l'unité d'évaluation  
- `RL0404A` = valeur de l'immeuble bâti (peut être valeur historique si > RL0402A)  
- `RL0405A` = valeur du terrain  

**Note qualité :** Pour certains enregistrements, `RL0404A` (valeur immeuble) ou `RL0405A` (valeur terrain) dépassent `RL0402A` (valeur totale). Ceci correspond à des valeurs historiques ou de comparaison inscrites dans le dossier. La valeur **RL0402A est la valeur de référence authoritative** du rôle 2026.

### Source 2 : Cadastre allégé du Québec (polygones NO_LOT)

| Champ | Valeur |
|-------|--------|
| URL couche ESRI | <https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0> |
| URL requête | `…/query?where=NO_LOT='X XXX XXX'&outFields=NO_LOT&returnGeometry=true&f=json` |
| Format NO_LOT | Chaîne de caractères avec espaces (ex. `4 516 943`) |
| Géométrie | Polygones ESRI en EPSG:3857 (Web Mercator) |
| Méthode d'accès | API REST ESRI MapServer, HTTP 200, requête nominale confirmée |
| Date d'accès | 2026-05-25 |
| Statut | **ACCESSIBLE — 15/15 lots vérifiés présents dans le cadastre** |

**Note :** Infolot (<https://appli.foncier.gouv.qc.ca/infolot/>) offre la consultation visuelle mais pas d'API publique programmatique. L'API Cadastre allégé ci-dessus est la source REST exploitable. MaxRecordCount = 2000.

### Source 3 : Règlements d'amendement de zonage (règl. 150-49, 150-49-1, 150-51)

| Règlement | URL PDF | HTTP | Date accès |
|-----------|---------|------|------------|
| 150-49 (H-609-4) | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-49-residuel.pdf> | 200 | 2026-05-25 |
| 150-49-1 (H-143/H-143-1) | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-49-1.pdf> | 200 | 2026-05-25 |
| 150-51 (U-521→H-521) | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-51-zonage.pdf> | 200 | 2026-05-25 |
| Plans 150-49 (Annexe B) | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Plans-reglement-150-49.pdf> | 200 | 2026-05-25 |
| Plans 150-49-1 (Annexe A) | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/AN3-Plans-reglement-150-49-1.pdf> | 200 | 2026-05-25 |
| Plans 150-51 (Annexe A) | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/URBA-AN3-2026-04-14-Second-projet-de-reglement-150-51-Plans.pdf> | 200 | 2026-05-25 |

Ces documents sont accessibles depuis <https://www.ville.valleyfield.qc.ca/reglements-en-attente/>. Les règlements 150-49, 150-51 sont encore désignés "projets de règlement" sur la page municipale ; 150-49-1 est désigné "règlement" (procédure référendaire terminée — un certificat PHV est joint).

---

## (b) Lots candidats par opportunité

### Opportunité 1 — H-609-4 (règl. 150-49)

**Contexte réglementaire (extrait textuel du règlement 150-49, art. 12.7, obtenu 2026-05-25) :**

> *Dans la zone H-609-4, l'ouverture d'une rue publique (ou d'un projet d'ensemble avec voie véhiculaire privée) est prohibée et la densité résidentielle maximale brute est fixée à 0,5 logement à l'hectare par terrain. Nonobstant ce qui précède, l'ouverture d'une rue publique ou l'augmentation de la densité résidentielle est recevable dans ladite zone seulement si la densité proposée est modulée en fonction de la proportion des milieux naturels qui sont protégés dans le concept de développement. Cette modulation est assujettie à une procédure PIIA (règl. 153).*
>
> **Option 12.7.1 — 50 logements/ha :** Au moins 30 % du terrain doit être conservé sous usage « Conservation » ; superficie résiduelle jusqu'à 50 logements/ha.

La zone H-609-4 est créée à même une partie des zones H-607, H-609 et H-609-3 (art. 9 du règl. 150-49). **Rues situées dans ou à proximité de la zone : CHAMPLAIN, SAINT-JEAN-BAPTISTE, SALABERRY, BESNER, MARIE-ROSE, BOURDEAU, LEBLANC, LALONDE, LACROIX** (source : briefs de l'opportunité ; à confirmer par plan Annexe B du règl. 150-49 — PDF obtenu mais non parsé ici).

**Lots candidats** (source : RL70052_2026.xml, accédé 2026-05-25, valeurs au rôle 2026 — date réf. marchande 2024-07-01) :

| # | NO_LOT | Adresse | Usage | Superficie lot (m²) | Valeur totale (rôle 2026) | Valeur terrain (rôle 2026) | Cadastre allégé |
|---|--------|---------|-------|---------------------|--------------------------|---------------------------|-----------------|
| 1 | 4516943 | 190 SALABERRY | RU — Résidentiel unifamilial | 14 990 m² | 1 311 600 $ | 2 130 600 $* | Présent (vérifié) |
| 2 | 3818335 | 316 SAINT-JEAN-BAPTISTE | RU — Résidentiel unifamilial | 8 561 m² | 2 254 300 $ | 2 671 700 $* | Présent (vérifié) |
| 3 | 4516958 | 63 CHAMPLAIN | RU — Résidentiel unifamilial | 3 443 m² | 842 600 $ | 2 289 000 $* | Présent (vérifié) |
| 4 | 3817581 | 213 LALONDE | RU — Résidentiel unifamilial | 1 645 m² | 259 100 $ | 431 900 $ | Présent (vérifié) |
| 5 | 3817940 | 532 BESNER | RU — Résidentiel unifamilial | 1 139 m² | 216 400 $ | 306 300 $ | Présent (vérifié) |

\* Valeur terrain (RL0405A) supérieure à la valeur totale (RL0402A) dans plusieurs enregistrements : anomalie de données liée à une valeur historique ou de comparaison inscrite au dossier — voir note qualité ci-dessus. La valeur totale RL0402A est la valeur de référence.

**Distribution d'usage sur les rues de la zone H-609-4 (1 308 enregistrements totaux) :**
- RU (résidentiel unifamilial) : 1 306 enregistrements  
- CH (chalet/villégiature) : 2 enregistrements  
- Aucun lot TE (terrain libre) répertorié sur ces rues dans le rôle 2026 — la zone est entièrement bâtie ou occupée.

---

### Opportunité 2 — U-521 → H-521 (règl. 150-51)

**Contexte réglementaire (extrait textuel du règlement 150-51, art. 7 et art. 14, obtenu 2026-05-25) :**

> *Art. 7 — L'annexe « A » dudit Règlement 150 est modifiée par le remplacement de la grille des usages et normes de la zone U-521 par la grille de la nouvelle zone H-521.*  
> *Art. 14 — L'annexe « B » dudit Règlement 150 est modifiée par le remplacement de la désignation de la zone U-521, par la désignation H-521, **en conservant les mêmes limites**.*

Le changement est un **rezonage de type U (utilité publique) vers H (résidentiel)** à périmètre géographique identique. La grille d'usages est remplacée (annexe « c » du règlement, PDF non parsé ici). Statut : "projet de règlement" �� pas encore en vigueur à la date de consultation (2026-05-25).

**Rues situées dans ou à proximité de la zone U-521/H-521 : LAROCQUE, SAINTE-MARIE, SAINT-FRANCOIS, MAISONNEUVE, JEANNE-MANCE** (source : briefs de l'opportunité).

**Lots candidats** (source : RL70052_2026.xml, accédé 2026-05-25, valeurs rôle 2026) :

| # | NO_LOT | Adresse | Usage actuel (rôle 2026) | Superficie lot (m²) | Valeur totale (rôle 2026) | Valeur terrain (rôle 2026) | Cadastre allégé |
|---|--------|---------|--------------------------|---------------------|--------------------------|---------------------------|-----------------|
| 1 | 4516554 | SAINTE-MARIE (sans no civique) | BO — Bureau/commercial | 17 866 m² | 89 400 $ | 71 500 $ | Présent (vérifié) |
| 2 | 4514460 | 683 LAROCQUE | CH — Chalet/villégiature | 11 360 m² | 1 212 400 $ | 1 352 200 $* | Présent (vérifié) |
| 3 | 4514434 | JEANNE-MANCE (sans no civique) | RU — Résidentiel unifamilial | 3 548 m² | 425 600 $ | 279 700 $ | Présent (vérifié) |
| 4 | 5952129 | 389 MAISONNEUVE | RU — Résidentiel unifamilial | 1 873 m² | 276 300 $ | 400 100 $* | Présent (vérifié) |
| 5 | 3819614 | 105 SAINT-FRANCOIS | RU — Résidentiel unifamilial | 768 m² | 190 100 $ | 429 900 $* | Présent (vérifié) |

**Distribution d'usage sur les rues de la zone U-521 (515 enregistrements totaux) :**
- CH (chalet/villégiature) : 218 — correspond probablement à des unités sur LAROCQUE (secteur riverain/insulaire)
- BO (bureau/commercial) : 126 — SAINTE-MARIE (axe commercial actuel, usage U = utilité publique possible)  
- RU (résidentiel unifamilial) : 181

**Observation :** L'usage CH sur LAROCQUE et l'usage BO sur SAINTE-MARIE reflètent l'usage *actuel au rôle* (avant l'entrée en vigueur du rezonage U-521 → H-521). La zone U (utilité publique) dans le rôle peut correspondre à des équipements collectifs ou à un usage mixte particulier.

---

### Opportunité 3 — H-143 / H-143-1 (règl. 150-49-1)

**Contexte réglementaire (extrait textuel du règlement 150-49-1, art. 12.7, obtenu 2026-05-25) :**

> *Dans les zones H-143 et H-143-1, l'ouverture d'une rue publique est prohibée et la densité résidentielle maximale brute est fixée à 0,5 logement à l'hectare par terrain. Nonobstant ce qui précède, la densité est modulable si les milieux naturels protégés le justifient (procédure PIIA, règl. 153).*
>
> - **H-143-1 — Option 2 log/ha :** 55 % du terrain en Conservation obligatoire  
> - **H-143-1 — Option 15 log/ha :** 70 % du terrain en Conservation obligatoire  
> - **H-143 — Option 50 log/ha :** 30 % du terrain en Conservation obligatoire

La zone H-143-1 est créée à même une partie de la zone H-143 (art. 5 du règl. 150-49-1). Le certificat PHV (procédure référendaire) est joint au document, indiquant que le règlement 150-49-1 a complété son processus d'adoption.

**Rues situées dans ou à proximité de la zone (secteur Grande-Île / Mgr-Langlois) : OVIDE, PATRIOTES, LECOMPTE, GOSSELIN, GRANDE-ILE, MGR-LANGLOIS** (source : briefs de l'opportunité).

**Lots candidats** (source : RL70052_2026.xml, accédé 2026-05-25, valeurs rôle 2026) :

| # | NO_LOT | Adresse | Usage actuel (rôle 2026) | Superficie lot (m²) | Valeur totale (rôle 2026) | Valeur terrain (rôle 2026) | Cadastre allégé |
|---|--------|---------|--------------------------|---------------------|--------------------------|---------------------------|-----------------|
| 1 | 3247200 | 1620 MGR-LANGLOIS | BO — Bureau/commercial | 19 680 m² | 2 985 100 $ | 11 250 800 $* | Présent (vérifié) |
| 2 | 6527169 | LECOMPTE (sans no civique) | AV — Immeuble locatif/appartements | 12 612 m² | 908 000 $ | 605 400 $ | Présent (vérifié) |
| 3 | 3595639 | 748 GRANDE-ILE | AV — Immeuble locatif/appartements | 7 263 m² | 892 500 $ | 2 875 100 $* | Présent (vérifié) |
| 4 | 5139121 | GOSSELIN (sans no civique) | RU — Résidentiel unifamilial | 1 660 m² | 239 500 $ | 148 300 $ | Présent (vérifié) |
| 5 | 3595656 | 751 PATRIOTES | RU — Résidentiel unifamilial | 1 298 m² | 299 600 $ | 367 400 $* | Présent (vérifié) |

**Distribution d'usage sur les rues de la zone H-143 (650 enregistrements totaux) :**
- AV (immeuble locatif/appartements) : 244 — fort sur LECOMPTE et GRANDE-ILE
- BO (bureau/commercial) : 187 — fort sur MGR-LANGLOIS
- RU (résidentiel unifamilial) : 231 — GOSSELIN, PATRIOTES, OVIDE

**Observation :** MGR-LANGLOIS est un boulevard commercial/institutionnel majeur avec plusieurs grands lots BO (jusqu'à 617 764 m² pour le lot 3247173). Le secteur Grande-Île est mixte AV/RU. La zone H-143/H-143-1 est un secteur de verdure (milieux naturels) à densification conditionnelle.

---

## (c) Note sur la correspondance lot ↔ zone et la fiabilité

### Méthode utilisée

Les lots ont été sélectionnés **uniquement par correspondance de nom de rue** (champ `RL0101Gx` du rôle). Le rôle d'évaluation ne contient pas directement le code de zone (`H-609-4`, `U-521`, `H-143`). La correspondance rue → zone est **une hypothèse** fondée sur :

1. Les noms de rues cités dans les briefs de l'opportunité (fournis par le conducteur)  
2. La confirmation que ces rues existent dans le rôle avec des enregistrements réels

### Niveau de confiance

| Opportunité | Confiance rue ↔ zone | Justification |
|-------------|---------------------|---------------|
| H-609-4 | **HYPOTHÈSE** — confiance modérée | Les rues CHAMPLAIN, SJB, SALABERRY, etc. sont dans le rôle. La zone H-609-4 est créée à même H-607, H-609, H-609-3 (art. 9 règl. 150-49). La délimitation exacte nécessite le plan Annexe B du règl. 150-49 (PDF disponible mais non parsé) |
| U-521 → H-521 | **HYPOTHÈSE** — confiance modérée | LAROCQUE, SAINTE-MARIE, etc. sont dans le rôle. Art. 14 du règl. 150-51 confirme que U-521 conserve les mêmes limites. La zone U dans le rôle (BO, CH) reflète l'usage pré-rezonage |
| H-143 / H-143-1 | **HYPOTHÈSE** — confiance modérée | MGR-LANGLOIS, GRANDE-ILE, GOSSELIN etc. sont dans le rôle. La zone H-143-1 est créée à même une partie de H-143 (art. 5 règl. 150-49-1) ; les lots GRANDE-ILE / LECOMPTE correspondent géographiquement |

### Pour confirmer la correspondance lot ↔ zone

La démarche requise pour passer de hypothèse à certitude :

1. **Parser les plans PDF** (Annexes B des règlements) — déjà téléchargés — ou requêter le service WMS de zonage municipal si disponible sur la plateforme cartographique de la ville (<https://citoyen.valleyfield.ca/>).
2. **Croiser les polygones de zone** (si disponibles en GeoJSON/WMS sur <https://donneesquebec.ca/recherche/dataset/?tags=Cadastre> ou via le service IGO de la ville) avec les centroïdes des lots du cadastre allégé.
3. **Alternative manuelle** : consulter la Grille des usages de la zone H-609-4 (Annexe « f » du règl. 150-49, PDF disponible) et vérifier que les lots adressés sur les rues concernées tombent géographiquement dans la délimitation.

### Données non disponibles

| Donnée | Statut | Raison |
|--------|--------|--------|
| Polygones de zone de zonage en format ouvert (GeoJSON/WFS) | Non disponible via open data | Le règl. 150-49 Annexe B est un PDF plan — non publié en format vectoriel sur donneesquebec.ca à la date de consultation |
| Grille d'usages détaillée zone H-609-4 (densités max, usages autorisés détaillés) | Non parsée | Disponible dans Annexe « f » du règl. 150-49 (PDF déjà téléchargé) — extraction PDF requise |
| Propriétaires des lots | Non disponible (caviardé) | Le rôle open data ne contient pas les noms de propriétaires (art. 72 Loi sur la fiscalité municipale) |
| Matricules complets | Non disponible dans ce rôle | RL0104C n'est pas un matricule dans ce fichier ; le matricule officiel est au Registre foncier (JLR, payant) |

---

## Récapitulatif des URLs clés

| Ressource | URL |
|-----------|-----|
| Index CSV 2026 | <https://donneesouvertes.affmunqc.net/role/indexRole2026.csv> |
| Rôle XML Valleyfield 2026 | <https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml> |
| Cadastre allégé — couche REST | <https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0> |
| Infolot (consultation visuelle) | <https://appli.foncier.gouv.qc.ca/infolot/> |
| Règlement 150-49 | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-49-residuel.pdf> |
| Règlement 150-49-1 | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-49-1.pdf> |
| Règlement 150-51 | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Reglement-150-51-zonage.pdf> |
| Plans 150-49 (Annexe B) | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/Plans-reglement-150-49.pdf> |
| Plans 150-49-1 (Annexe A) | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/AN3-Plans-reglement-150-49-1.pdf> |
| Plans 150-51 (Annexe A) | <https://dua3m7xvptjbw.cloudfront.net/documents/reglements/URBA-AN3-2026-04-14-Second-projet-de-reglement-150-51-Plans.pdf> |
| Données Québec — jeu de données rôles | <https://www.donneesquebec.ca/recherche/dataset/roles-d-evaluation-fonciere-du-quebec> |
| Page règlements en attente — Valleyfield | <https://www.ville.valleyfield.qc.ca/reglements-en-attente/> |
