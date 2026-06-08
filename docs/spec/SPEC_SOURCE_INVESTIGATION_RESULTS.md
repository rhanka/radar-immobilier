# SPEC_SOURCE_INVESTIGATION_RESULTS — Probing réel des sources WP4

> **Statut**: RÉSULTATS d'investigation (fetch HTTP réel, server-side).
> **Réalisé le**: 2026-06-08 (env `test-wp4inv`, worktree `feat/wp4-source-investigation`).
> **Périmètre**: probe réel des sources Tier A (top-5) de `SPEC_PLAN_SCRAPING.md`,
> multi-villes **Salaberry-de-Valleyfield (70052)** + **Beauharnois (70022)**.
> **Échantillons bruts**: `packages/radar-sources/src/sources/_spikes/<id>/samples/`.
> Index typé des échantillons: `_spikes/wp4-investigation-fixtures.ts`.

---

## 0. Règles d'investigation appliquées

- **Anti-invention**: chaque verdict ci-dessous est adossé à un échantillon RÉEL
  capté par un `curl` server-side. Quand un endpoint ne renvoie rien (ex.
  `terrAPI adresses` sur une requête multi-mots), c'est **dit explicitement** et
  le contournement réel est documenté. Aucune valeur fabriquée.
- **Légal / ToS**: données **publiques / open-data uniquement**, aucun login,
  aucun contournement de paywall/CAPTCHA. `robots.txt` lu et respecté pour les
  deux villes (voir §1.1 / §1.2). Les sources tier C login/payant sont
  **documentées** comme telles, pas probées.
- **Statuts HTTP réels**: re-vérifiés en fin de run (2026-06-08), pas seulement
  au premier passage.

---

## 1. Sources probées — verdicts réels

### 1.1 `avis-publics-valleyfield` (A1) — Salaberry-de-Valleyfield

| Champ | Valeur réelle |
| --- | --- |
| URL page | `https://www.ville.valleyfield.qc.ca/avis-publics` |
| URL PDF | `https://dua3m7xvptjbw.cloudfront.net/documents/avis/<nom>.pdf` (CDN CloudFront) |
| Format | HTML (Craft CMS) → PDF |
| Joignable | **OUI** — page HTTP 200 `text/html`; PDF `2026-05-20-Avis-de-derogation-mineure.pdf` HTTP 200 `application/pdf` **131 553 octets** |
| Login | Non |
| robots.txt | `Disallow: /admin/ /asset-transforms/ /cpresources/ /vendor/` — `/avis-publics` **autorisé** |
| Entités alimentées | `Bylaw`, `DesignationEvent` (sous-types dérogation/PPCMOI/consultation/registre/EEV), `Signal` |
| Échantillon | `avis-publics-valleyfield/samples/avis-pdf-urls.txt` (20 URLs PDF réelles) |

**Faisabilité (valeur × effort)**: valeur **haute** (signal réglementaire direct,
point de départ du slice BR07) × effort **2-3 j-h** → `build-now`. Pas d'API/RSS;
ancres `icon-block--is-link` à parser; classification 1er passage par nom de
fichier/titre, extraction fine = OCR/LLM du PDF.

**Multi-villes**: source **municipale** → **un adaptateur par moteur CMS**.
Valleyfield = **Craft** (`icon-block--is-link`, CDN CloudFront `documents/avis/`).

---

### 1.2 `avis-publics-beauharnois` (multi-villes) — Beauharnois 70022

| Champ | Valeur réelle |
| --- | --- |
| URL page | `https://ville.beauharnois.qc.ca/la-ville/administration-et-vie-democratique/avis-publics` |
| URL PDF | `https://ville.beauharnois.qc.ca/wp-content/uploads/<nom>.pdf` |
| Format | HTML (**WordPress**) → PDF |
| Joignable | **OUI** — page HTTP 200 `text/html`; PDF `AP_DM-2026-0037.pdf` HTTP 200 `application/pdf` **172 691 octets** |
| Login | Non |
| robots.txt | `Disallow: /wp-admin/` (sauf `admin-ajax.php`) — page + `/wp-content/uploads/` **autorisés** |
| Entités alimentées | `Bylaw`, `DesignationEvent`, `Signal` |
| Échantillon | `avis-publics-beauharnois/samples/avis-pdf-urls.txt` (7 URLs PDF réelles) |

**Faisabilité**: valeur **haute** × effort **1.5-2 j-h** (réutilise la logique de
parse/classification de Valleyfield; seuls le sélecteur de lien + l'URL de base
changent) → `build-now`. Type d'avis encodé dans le nom de fichier (`AP_DM` =
dérogation mineure, `AP-assemblee-consultation`, `AEV_REG` = entrée en vigueur,
`PROJETREG`, `REG`).

**Multi-villes — preuve clé**: Beauharnois = **WordPress** (CMS distinct de Craft).
Cela **valide l'architecture multi-CMS**: une source municipale ⇒ un adaptateur
par moteur CMS, pas un adaptateur universel. Code MAMH Beauharnois = **70022**
(confirmé dans l'index du rôle, §1.5).

---

### 1.3 `reglements-urbanisme-valleyfield` (A2) — Salaberry-de-Valleyfield

| Champ | Valeur réelle |
| --- | --- |
| URL listing | `https://www.ville.valleyfield.qc.ca/reglements-municipaux?cat=reglement-durbanisme&terme=` |
| URL PDF | `https://dua3m7xvptjbw.cloudfront.net/documents/reglements/<nom>.pdf` |
| Format | HTML (Craft) → PDF |
| Joignable | **OUI** — listing HTTP 200 (171 234 octets), page détail HTTP 200 (140 051 octets), `Reglement-450-02.pdf` HTTP 200 `application/pdf` **446 881 octets** |
| Login | Non |
| Entités alimentées | `Bylaw`, `Zone` (codes/usages/densité via grilles), `DesignationEvent` |
| Échantillon | `reglements-urbanisme-valleyfield/samples/reglements-urbanisme-listing-urls.txt` (25 slugs réels) + `reglement-450-02-pdf-urls.txt` |

**Faisabilité**: valeur **haute** (résout les n° de règlement cités par les avis:
150-49…; alimente Zone + DesignationEvent) × effort **3-5 j-h** (OCR/LLM des
grilles d'usage/densité/hauteur) → `build-now`. Familles réelles observées sur le
listing: 149 (lotissement), 150 (zonage), 151 (construction), 152 (administration),
153 (PIIA), 154 (PAE), 250 (usages conditionnels), 402 (PPCMOI), 432 (logements
abordables), 450 (plan d'urbanisme).

**Note CDN**: même CDN CloudFront que les avis, **deux collections** distinctes:
`documents/avis/` et `documents/reglements/`.

---

### 1.4 `donnees-quebec-catalog` (A4) — brique transverse (province-wide)

| Champ | Valeur réelle |
| --- | --- |
| URL | `https://www.donneesquebec.ca/recherche/api/3/action/package_search` (CKAN) |
| Format | JSON (API CKAN: `package_search`, `package_show`, `datastore_search`) |
| Joignable | **OUI** — HTTP 200, `package_search?q=rôle évaluation foncière` → `"count": 46`, 1er dataset = `roles-d-evaluation-fonciere-du-quebec` (MAMH, 52 ressources) |
| Login | Non |
| robots.txt | `/recherche/api/` autorisé |
| Entités alimentées | **(infra)** — résout les URLs de ressources réelles pour A5/A7/A8… |
| Échantillon | `donnees-quebec-catalog/samples/ckan-package-search-role.json`, `ckan-package-show-adresses-quebec.json` |

**Faisabilité**: valeur **haute** (brique de découverte/résolution partagée pour
toutes les sources open-data) × effort **1.5-2.5 j-h** → `build-now`. `package_show`
renvoie les vraies URLs de téléchargement (ex. adresses-quebec → AQréseau SHP/GPKG/
FGDB chez `diffusion.mern.gouv.qc.ca`; CPTAQ → `demandes.zip`).

**Multi-villes**: province-wide, **généralisation gratuite** (paramétrée par
mot-clé/organisation, indépendante de la ville).

---

### 1.5 `roles-evaluation-fonciere-mamh` (A5) — 70052 + 70022 (province-wide)

| Champ | Valeur réelle |
| --- | --- |
| URL index | `https://donneesouvertes.affmunqc.net/role/indexRole2026.csv` |
| URL XML | `https://donneesouvertes.affmunqc.net/role/RL70052_2026.xml` (Valleyfield), `RL70022_2026.xml` (Beauharnois) |
| Format | CSV (index) + XML codé (XSD `RL.xsd` v2.9) |
| Joignable | **OUI** — index HTTP 200; XML HTTP 200, `accept-ranges: bytes` (**Range/206 → streaming**). RL70052 ≈ 27.5 MB, RL70022 ≈ 9.06 MB |
| Login | Non |
| Entités alimentées | `Lot` (`RL0103Ax` = NO_LOT), `Valuation` (terrain/bâtiment/total), `Adresse` (rue `RL0101Gx`) |
| Échantillon | `roles-evaluation-fonciere-mamh/samples/RL70052_2026.first-record.xml`, `RL70022_2026.first-record.xml`, `indexRole2026.excerpt.csv` |

**Premier enregistrement RÉEL — Valleyfield (70052)** : rue `MGR-LANGLOIS`,
NO_LOT `[4193751, 4193752, 5559304, 5650993, 5650994]`, superficie `659.10 m²`
(`RL0301A`), date valeur `2024-07-01`, valeur totale `2 748 500 $` (`RL0404A`),
valeur bâtiment `1 331 800 $` (`RL0405A`).

**Premier enregistrement RÉEL — Beauharnois (70022)** : `20 1RE AVENUE`,
NO_LOT `4716029`, superficie `22.86 m²`, valeur terrain `136 000 $`, bâtiment
`308 000 $`, total `444 000 $` (`RL0404A`).

**Faisabilité**: valeur **haute** (ancrage foncier réel Lot+Valuation) × effort
**5-8 j-h** (XML codé → dictionnaire/XSD MAMH requis; gros fichiers → streaming;
contraintes caviardage/privacy à appliquer) → `build-now`.

**Multi-villes — généralisation gratuite**: l'index CSV mappe `code géographique →
XML par municipalité`. Confirmé réel: `70022 Beauharnois`, `70030
Saint-Étienne-de-Beauharnois`, `70052 Salaberry-de-Valleyfield`. Changer de ville
= changer le code MAMH dans l'URL. **Le même schéma XSD s'applique aux deux villes**
(vérifié sur les deux premiers enregistrements).

---

### 1.6 `adresses-quebec-igo-geocoder` (A7) — 70052 + 70022 (province-wide)

| Champ | Valeur réelle |
| --- | --- |
| URL | `https://geoegl.msp.gouv.qc.ca/apis/terrapi/<type>?q=<texte>&limit=<n>` (IGO terrAPI) |
| Format | GeoJSON `FeatureCollection` |
| Joignable | **OUI** — HTTP 200 sur `adresses` et `municipalites` |
| Login | Non |
| Entités alimentées | `Adresse` (clé provinciale `id_adresse`), géocodage/normalisation pour `Lot`, `Signal` |
| Échantillon | `adresses-quebec-igo-geocoder/samples/terrapi-adresses-salaberry.json`, `terrapi-municipalites-beauharnois.json` |

**Adresse RÉELLE — Valleyfield** (`/apis/terrapi/adresses?q=Salaberry-de-Valleyfield&limit=3`,
1re feature) : `code` (id_adresse provincial) `000464c34bfd4f25862f208af2e3dbf5J6S6A5`,
`nom` `24 rue Paquette, Salaberry-de-Valleyfield J6S6A5`.

**Municipalité RÉELLE — Beauharnois** (`/apis/terrapi/municipalites?q=Beauharnois`) :
`code 70022`, `designation V`, `population 15313`, `mrcCode 700`, `regAdminCode 16`.

> **Honnêteté de probe (anti-invention)**: l'endpoint `adresses` matche sur un
> **token de tête**, pas une requête plein-texte. Une chaîne « civique + rue +
> ville » (ex. `q=65 rue Victoria Salaberry-de-Valleyfield`) renvoie
> `{"features":[]}` (HTTP 200, vide — re-vérifié). Les vraies adresses sortent en
> requêtant **par le nom de la municipalité** (`q=Salaberry-de-Valleyfield`) ou
> **par préfixe de code postal** (`q=J6T` → adresses Valleyfield réelles). Le
> filtre `mun=70052` n'est **pas** honoré. Ce comportement est consigné dans
> `wp4-investigation-fixtures.ts`. L'échantillon vide initial a été remplacé par
> un échantillon non-vide reproductible.

**Faisabilité**: valeur **moyenne-haute** (normalisation adresse + géocodage,
utilitaire transverse) × effort **2-3 j-h** → `build-now`. Pour le bulk vectoriel:
MRNF AQréseau SHP/GPKG (résolu via A4).

**Multi-villes — généralisation gratuite**: province-wide, paramétré par
texte/code. Couvre les deux villes (échantillons réels Valleyfield + Beauharnois).

---

### 1.7 `cptaq-zone-agricole` (A8) — filtre contrainte (province-wide)

| Champ | Valeur réelle |
| --- | --- |
| URL SHP | `https://carto.cptaq.gouv.qc.ca/data/shapefiles/demandes.zip` |
| Résolution | via CKAN `package_show?id=decisions-de-la-cptaq` (org CPTAQ, 4 ressources) |
| Format | SHP (ZIP) + WMS (`carto.cptaq.gouv.qc.ca`, MapServer) |
| Joignable | **OUI** — HEAD `demandes.zip` HTTP 200 `application/zip` **87 992 550 octets** (≈ 88 MB) |
| Login | Non |
| Entités alimentées | `Constraint` (filtre dur zone agricole LPTA), `DesignationEvent` (sous-type cptaq), `Signal` |
| Échantillon | `cptaq-zone-agricole/samples/ckan-package-show-decisions-cptaq.json` |

**Ressources réelles** (du `package_show`): SHP `demandes.zip`, PDF
`A_Lire_decisions.pdf` (mise en garde légale), PDF service WMS, lien Déméter
(`demeter.cptaq.gouv.qc.ca`).

**Faisabilité**: valeur **haute** (filtre de contrainte dur anti-faux-positif:
intersection lot↔LPTA) × effort **3-5 j-h** (intersection géospatiale; mises en
garde légales LPTA à porter) → `build-now`. **Caveat**: la couche transposée
`zone-agricole-transposee` n'est **pas** le plan légal officiel.

**Multi-villes — généralisation gratuite**: province-wide, intersection par bbox/
géométrie de la ville cible.

---

## 2. Synthèse de couverture (top-5 + multi-villes)

| Source (id) | Tier | Joignable | Statut HTTP réel | Multi-villes | Échantillon réel |
| --- | --- | --- | --- | --- | --- |
| `avis-publics-valleyfield` | A1 | OUI | 200 (HTML + PDF 131 553 o) | municipal/Craft | 20 URLs PDF |
| `avis-publics-beauharnois` | (multi) | OUI | 200 (HTML + PDF 172 691 o) | municipal/WordPress | 7 URLs PDF |
| `reglements-urbanisme-valleyfield` | A2 | OUI | 200 (HTML + PDF 446 881 o) | municipal/Craft | 25 slugs + 2 PDF |
| `donnees-quebec-catalog` | A4 | OUI | 200 (CKAN count=46) | province-wide | 2 JSON CKAN |
| `roles-evaluation-fonciere-mamh` | A5 | OUI | 200 + Range (27.5/9.06 MB) | **70052 + 70022** | 2 XML + index CSV |
| `adresses-quebec-igo-geocoder` | A7 | OUI | 200 (GeoJSON) | **70052 + 70022** | 2 GeoJSON |
| `cptaq-zone-agricole` | A8 | OUI | 200 (ZIP 88 MB) | province-wide | 1 JSON CKAN |
| `avis-reglements-mrcbhs` | B6 | (doc) | régional | régional MRC | README (build-later) |

**Top-5 prioritaires de `SPEC_PLAN_SCRAPING.md` §5 — tous probés réels et joignables**:
A1 (avis), A2 (règlements), A5 (rôle), A4+A7 (briques transverses), A8 (CPTAQ).

**Multi-villes**: les deux villes pilotes sont couvertes par échantillon réel.
- Sources **province-wide** (A4/A5/A7/A8) → généralisation **gratuite** par
  code géo MAMH (70052/70022) / bbox / texte.
- Sources **municipales** (avis/règlements) → **un adaptateur par moteur CMS**;
  preuve concrète établie: Valleyfield=Craft vs Beauharnois=WordPress.

---

## 3. Tier A bonus / sources login-gated (documentées, non probées)

- **StatCan / BDZI / GRHQ (A9/A10/A11)** — déjà documentés `RÉEL/RÉEL partiel`
  dans `SPEC_PLAN_SCRAPING.md` (BDZI 0 polygone bbox high-conf, GRHQ 512 éléments
  Grande-Île, StatCan API WDS car pages HTML en 404). Non re-probés ici (priorité
  donnée au top-5 + multi-villes).
- **Tier C login/payant** (`registre-foncier-qc`, `jlr`, `centris-mls`,
  `cadastre-infolot` extraits) — **login/compte/paiement requis**. Conformément à
  la règle ToS, **non probés**: l'exigence d'accès est **documentée**, jamais
  contournée. `registre-foncier` = `manual-check` (preuve démo manuelle); JLR/
  Centris = `partner-required` (flux formel uniquement, ne pas scraper les annonces).
- **`videos-youtube-conseil-valleyfield` (B3)** — captions/transcriptions exigent
  un cookie API → bloqueur **documenté**, Tier B différé.

---

## 4. Limites honnêtes de ce run

- Échantillons MAMH = **premier enregistrement** de chaque rôle (Range request),
  pas le fichier complet (27.5 / 9.06 MB → streaming en prod).
- terrAPI `adresses`: comportement de matching par token de tête documenté
  (§1.6); pas de géocodage civique-exact obtenu par cet endpoint (utiliser le
  GeocodeServer ArcGIS ou AQréseau pour le fin).
- CPTAQ: HEAD seulement sur le ZIP 88 MB (pas de téléchargement complet);
  l'intersection spatiale exacte lot↔LPTA reste à câbler (hypothèse de plan).
- Pas de rate-limit rencontré sur ce run de reprise.
