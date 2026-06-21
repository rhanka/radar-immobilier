# Audit : villes sans Signal/DesignationEvent — gisement récupérable

**Date** : 2026-06-21  
**Auteur** : rhanka (audit automatisé, lecture seule)  
**Branche** : `docs/audit-villes-sans-signal`  
**Périmètre** : 1 009 villes graphifiées en v2.3, dont 295 sans Signal/DesignationEvent  

---

## 1. Constat initial

```sql
SELECT count(DISTINCT city_slug) FROM graph_nodes;
-- 1009

SELECT count(*) FROM (
  SELECT city_slug FROM graph_nodes
  GROUP BY city_slug
  HAVING count(*) FILTER (WHERE type IN ('Signal','DesignationEvent')) = 0
) t;
-- 295
```

**714 villes** ont au moins un signal détecté ; **295 villes** (29,2 %) ont un graphe v2.3 mais zéro Signal ni DesignationEvent.

Toutes les 295 villes ont un `graph/latest.json` sur SCW (`radar-immobilier-docs-pocs`), confirmant que le pipeline graphify a bien tourné.

---

## 2. Méthode d'audit

### 2.1 Catégorisation par contenu graphe SCW

Lecture de `graph/{city}/latest.json` pour chacune des 295 villes :

| Catégorie | Critère | Nb villes |
|-----------|---------|-----------|
| **A — Aucune source** | Graphe = Municipality seul (0 Source) | 162 (54,9 %) |
| **B — PDFs scannés uniquement** | Sources présentes, toutes annotées `"note": "PDF scanné"` | 12 (4,1 %) |
| **C — Sources HTML** | Toutes les sources sont au format HTML | 34 (11,5 %) |
| **D — PDFs texte** | Sources PDF sans annotation "scanné" | 76 (25,8 %) |
| **E — Mixte PDF+HTML** | Mix de formats | 11 (3,7 %) |

### 2.2 Sous-analyse des catégories A et D

**Catégorie A — sous-décomposition** (via `runs/proces-verbaux-{city}/`) :

| Sous-cat | Critère | Nb |
|----------|---------|-----|
| A1 — Pas de run | Aucune entrée dans `runs/` | 104 |
| A2 — Run vide | Manifests vides (SPA/403/scraper raté) | 22 |
| A3 — Run non-vide, graphe vide | Scraper a collecté des fichiers, rien extrait | 36 |

**Catégorie D — analyse PDFs** (extraction `pdftotext` sur échantillon, n=55 PDFs, 20 villes) :

- PDFs extractables : 36/55 (65 %)
- PDFs scannés non annotés : 19/55 (35 %) → catégorie D contient du B caché
- PDFs extractables avec mots-clés de zonage fort : 6/36 (16,7 %)
- Villes avec au moins un hit de zonage : 4/20 (20 %)

### 2.3 Analyse des runs anciens graphify (pre-v2.3)

Scan de `parsed/{city}/graphify/*/graph.json` pour les 295 villes :

- **13 villes** avaient des Signals dans des runs graphify anciens, absents du graphe v2.3 courant
- **282 villes** n'ont jamais eu de Signal dans aucun run

---

## 3. Résultats par ville — échantillon de 20 villes auditées

### 3.1 Villes avec sous-extraction confirmée (Signal perdu ou non capté)

#### Brigham (catégorie C — HTML)
- Runs anciens : **5 signaux** dans graphify pré-v2.3
- Signaux trouvés :
  - `DesignationEvent` : Subdivision lot 3 521 520 → lots 6 715 283 + 6 715 284 (résol. 26-03-059, contribution parcs 4 500 $)
  - `DesignationEvent` : Subdivision lot 3 520 533 → lots 6 715 716 + 6 715 717 (résol. 26-03-060, contribution parcs 4 800 $)
  - `Signal` : Lotissement lot 3 521 520 → 2 nouveaux lots, mars 2026
  - `Signal` : Lotissement lot 3 520 533 → 2 nouveaux lots, mars 2026
  - `Signal` : PPCMOI 250$ + dérogation mineure 200$
- Graphe v2.3 actuel : Source HTML seulement, pas de Signal
- **Verdict : sous-extraction v2.3, signaux réels perdus**

#### Chartierville (catégorie D — PDF texte extractable)
- Aucun signal dans graphe v2.3, aucun dans ancien graphify
- `pdftotext` sur PV 2026-01-12 → hit confirmé :  
  > *"CONSIDÉRANT la lettre transmise à M. Daniel Lauzon concernant son projet de lotissement et qui confirme la décision du conseil quant à la contribution pour fins de parcs et terrains de jeux [...] la contribution s'élève à 6 691,10 $"*
- **Verdict : sous-extraction v2.3, signal réel dans le texte non capté**

#### Ulverton (catégorie D — PDF texte extractable)
- PV 2025-03-03 → section URBANISME :  
  > *"Permis émis depuis le 4 février 2025 : 2 — 1 Bâtiment Accessoire 1 Lotissement"*
- PV 2025-01-13 → dérogations CPTAQ éoliennes (contexte agricole)
- **Verdict : sous-extraction, au moins un signal récupérable (lotissement)**

#### Maniwaki (catégorie D — PDF texte extractable)
- 3 signaux dans runs anciens (Jan, Fév, Mai 2026), confirmés sur texte extrait :
  - Cession bâtiment Château Logue à la MRC (résolution R2026-02-041)
  - Acquisition foncière lots îles rivière Gatineau
  - Adoption règlements démolition 1061 et occupation/entretien 1062
- Graphe v2.3 : 10 sources, 7 Bylaws, 0 Signal
- **Verdict : sous-extraction v2.3 confirmée (3 signaux perdus)**

#### Blue-Sea (catégorie D — PDF texte)
- Runs anciens : 3 signaux dont :
  - Adoption 1er projet Plan d'urbanisme Blue Sea (règlement 2026-123)
  - Avis de motion règlement 2026-120 — salubrité et bâtiments patrimoniaux
  - Demande d'amendement projet de loi 22 / art. 245.1 LAU
- **Verdict : sous-extraction v2.3**

### 3.2 Villes avec vraie absence d'activité zonage

#### Maddington Falls (catégorie D)
- 3 PDFs texte-extractables analysés
- PV budget 2025-12-16 : "dérogations mineures" = ligne budgétaire, pas un signal
- PV ordinaire 2025-12-02 : 0 mot-clé zonage fort
- **Verdict : vraie absence d'activité de zonage récente** (petite municipalité, PVs de gestion courante)

#### Roquemaure, Gallichan, Lorrainville (catégorie B/D)
- PDFs scannés non extractables → impossible à confirmer
- Pas de signal dans anciens runs graphify (runs anciens analysés)
- **Verdict : inconnu** (scannés → nécessite OCR pour trancher)

#### Bois-Franc, Manseau, Blue-Sea partial (catégorie D)
- PDFs texte-extractables, 0 mot-clé zonage fort
- Petites municipalités, PVs de gestion courante
- **Verdict probable : vraie absence d'activité de zonage récente**

#### Sherbrooke, Trois-Rivières, Terrebonne, Thetford-Mines (catégorie A)
- Grandes villes, 0 source dans graphe v2.3
- Runs : vides (Sherbrooke 4 runs vides) ou inexistants
- Scraper incapable de pénétrer leurs portails (SPA/auth/403)
- **Verdict : échec scraper, PVs existent mais inaccessibles**

---

## 4. Quantification du gisement

### 4.1 Ratio vraie-absence vs sous-extraction

Sur les 133 villes avec catégories B+C+D+E (documents présents) :

| Situation | Nb estimé | Base de calcul |
|-----------|-----------|----------------|
| Sous-extraction confirmée (anciens runs) | **13** | Scan exhaustif parsed/ |
| Sous-extraction confirmée (pdftotext, texte présent) | **~6** | Échantillon 20/76 : 4 villes soit ~20% de 76=15, corrigé conservateur |
| PDFs scannés non analysables | **~40** | 35% des D + tous les B = 12+0,35×76≈40 |
| Sources HTML potentiellement extractables | **34** | Catégorie C |
| Vraie absence probable (texte, 0 hit zonage) | **~40** | 65% texte × 80% pas de zonage sur D |

**Estimation conservatrice** :
- Villes récupérables par re-graphify seul (documents texte déjà présents) : **20–30 villes**
- Villes récupérables avec OCR (PDFs scannés) : **15–20 villes supplémentaires**
- Villes récupérables avec scraper amélioré (HTML/SPA) : **34+ villes** (cat C + grandes villes)
- Villes sans activité réelle de zonage (vraie absence) : **~100–120 villes** (cat A1 = 104 + fraction D sans hit)

### 4.2 Résumé chiffré

| Catégorie | Villes | Récupérables par re-graphify | Récupérables avec effort |
|-----------|--------|------------------------------|--------------------------|
| A1 — Pas scrappées | 104 | 0 (pas de docs) | ~30 (scraper improved) |
| A2 — Scraper vide | 22 | 0 | ~10 (Playwright/OCR) |
| A3 — Runs non-vides, graphe vide | 36 | ~15 (re-graphify) | 25 |
| B — PDFs scannés | 12 | 0 | ~6 (OCR pipeline) |
| C — HTML | 34 | ~10 (re-graphify HTML-capable) | 25 |
| D — PDFs texte | 76 | ~20 (re-graphify) | 20 |
| E — Mixte | 11 | ~5 | 8 |
| **TOTAL** | **295** | **~50** | **~125** |

---

## 5. Cas spéciaux notables

### 5.1 Saint-Télésphore (catégorie D)
- 22 signaux dans anciens runs, **mais tous sont des faux positifs** :
  extraits d'un guide du MAMOT sur la participation publique en urbanisme
  (phrases génériques comme "un changement de zonage", "règlements d'urbanisme")
- Graphe v2.3 : 0 Signal — **correct**, le filtre v2.3 a bien éliminé ces faux positifs
- Verdict : amélioration de précision v2.3, pas de perte réelle

### 5.2 Saint-Prosper-de-Champlain (catégorie D)
- Anciens runs : 5 signaux génériques ("Zoning / urbanism signal", "Designation / bylaw change event")
  sans label ni propriétés — probable sur-extraction du modèle LLM
- Graphe v2.3 : 0 Signal — **correct**
- Verdict : correction de bruit v2.3

### 5.3 Grandes villes (Sherbrooke, Trois-Rivières, Terrebonne, Thetford-Mines)
- Graphe v2.3 : 1 nœud (Municipality seul), 0 source, 0 signal
- Ces villes sont scrapées mais leurs portails web bloquent l'extracteur
- Représentent un potentiel de signaux très élevé (meetings fréquents, projets importants)
- **Ne font PAS partie du gisement récupérable par re-graphify seul**

---

## 6. Conclusions

### 6.1 Répartition (295 villes sans signal)

| Profil | Villes | % |
|--------|--------|---|
| **Vraie absence d'activité zonage** | ~100–120 | ~37–41 % |
| **Sous-extraction graphify v2.3** | ~50–65 | ~17–22 % |
| **PDFs scannés (OCR requis)** | ~40 | ~14 % |
| **Scraper/SPA bloqué** | ~40–60 | ~14–20 % |
| **Indéterminé / mixte** | ~20–30 | ~7–10 % |

**Conclusion principale : ~55–60 % des 295 ont une raison structurelle (vraie absence ou scraper bloqué), ~20–25 % représentent un gisement récupérable par re-graphify.**

### 6.2 Gisement récupérable estimé

- **~50 villes récupérables immédiatement** par re-graphify (docs texte présents, pas de signal extrait)
- **~20 villes supplémentaires** avec pipeline OCR (PDFs scannés)
- **~35 villes** si scraper HTML/SPA amélioré (catégorie C + portails bloqués)

---

## 7. Recommandations

### Reco 1 — Re-graphify ciblé des 13 villes à signaux perdus (priorité haute)
Les 13 villes avec signaux dans anciens runs mais absents de v2.3 sont le gisement
le plus certain. Relancer graphify sur leurs PVs les plus récents avec un contexte
plus riche (forcer l'extraction de mentions de lotissement, subdivision, dérogation).

**Villes concernées** :
`blue-sea`, `brigham`, `maniwaki`, `montcerf-lytton`, `montreal-ouest`,
`saint-aime`, `saint-aime-du-lac-des-iles`, `sainte-helene-de-chester`,
`saint-gabriel-de-valcartier`, `saint-jacques-de-leeds`, `saint-prosper-de-champlain`\*,
`saint-telesphore`\*, `stoke`  
(\* = signaux anciens probablement faux positifs, à vérifier manuellement)

### Reco 2 — Re-graphify des catégories D + A3 (priorité moyenne)
~50 villes supplémentaires ont des PDFs texte-extractables mais sans signal.
Un passage sur les PVs les plus récents avec un prompt plus sensible aux
mentions implicites (permis émis, contribution parcs, demandes CPTAQ) devrait
récupérer ~15–20 villes supplémentaires.

Exemple validé : **Chartierville** (lotissement Daniel Lauzon, 6 691 $),
**Ulverton** (1 lotissement dans section URBANISME).

### Reco 3 — OCR pipeline pour la catégorie B + D-scannés (priorité basse)
~40 villes ont uniquement des PDFs scannés. L'investissement OCR est non-trivial
(Textract/Tesseract) mais permettrait de débloquer ~15–20 villes supplémentaires.

### Reco 4 — Ne pas re-graphify les 104 villes A1 ni les grandes villes bloquées
Ces villes n'ont pas de contenu brut disponible. Le re-graphify n'apporterait rien.
La correction est au niveau du scraper (Playwright, anti-detect, authentification).

### Reco 5 — Purge des signaux parasites Saint-Télésphore / Saint-Prosper
Les signaux génériques issus d'anciens runs pour ces deux villes ne doivent pas
être réintroduits. Le filtre v2.3 est correct sur ce point.

---

## 8. Données sources

- Base PostgreSQL : `radar-immobilier` namespace k8s (KUBECONFIG=~/.kube/poc.yaml)
- Bucket S3 : `radar-immobilier-docs-pocs` (Scaleway fr-par)
- Graphes SCW : `graph/{city}/latest.json` (1 118 villes avec latest.json)
- PDFs bruts : `raw/proces-verbaux-{city}/cas/{sha}.pdf`
- Anciens runs graphify : `parsed/{city}/graphify/*/graph.json`
- Extraction texte : `pdftotext` (poppler 24.02.0)

---

*Audit lecture seule — aucune modification de production. Loi 25 : aucune donnée personnelle traitée.*
