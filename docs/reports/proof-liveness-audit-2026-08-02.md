# Audit de vivacité des URL de preuve — 2026-08-02

- **Lane** : extraction (WP2/WP4, lever #1 — consolidation des captations)
- **Portée de CE rapport** : URL de **preuve documentaire** (`sourceUrl` PV/PDF) portées par les nœuds du graphe. **HORS vivier** (data-integrity/affichage) → gate simple.
- **Outil** : `api/src/scripts/audit-proof-liveness.ts` (read-only, committé, testé).
- **Statut** : **run autoritaire corpus-complet S3 fait** (§3). Pilote local corroborant en §3bis.

## 0. Résultat autoritaire (TL;DR)

Sur **1638 URL de preuve documentaire distinctes / 522 villes** du corpus S3 (1007 villes
`graph/<ville>/latest.json` listées, 522 portent au moins une URL de preuve) :

| Mesure | Valeur |
|---|---|
| **Vivantes** | **1606 (98,0 %)** |
| **Mortes** | **23 (1,4 %)** — 21× 404, 2× 403 |
| **Inconnues** (fetch failed réseau/DNS) | **9 (0,5 %)** |
| **Mortes récupérables depuis l'archive S3** (`docSha`) | **23 / 23 (100 %)** |

**Le « ~48 % de preuves mortes » N'EST PAS la couche documentaire** — elle est saine à 98 %, et
100 % des mortes sont récupérables via l'archive S3. Le 48 % vise la cohorte **preuve de ZONE**
(géométrie/grille), **geo-owned**, à mesurer séparément (§4).

## 1. Motif

Le lever #1 demande de **mesurer** l'état des URL de preuve, **ne jamais servir une preuve morte**, et **remplacer/archiver + taguer**. Aucun vérificateur de vivacité HTTP n'existait dans le repo (`report-opportunity-proof.ts` ne teste que la *présence* d'un champ, pas que l'URL répond). Cet audit comble ce manque.

## 2. Méthode

1. Collecte de toutes les URL de preuve distinctes depuis `graph/<ville>/latest.json` :
   champs `refs[].sourceUrl|rawRef|documentUrl`, `properties.sourceUrl|url_grille`, `source_ref`.
   L'**archive S3** est indexée par `docSha` — une URL morte dont le nœud porte un `docSha` est
   **récupérable depuis l'archive** (le viewer peut pointer la copie S3 au lieu de l'URL morte).
2. Sonde de chaque URL : `HEAD` (repli `GET Range: bytes=0-0` si 403/405/501), IPv4-first,
   timeout 12 s, 2 retries, concurrence 24. Verdicts : `alive` (2xx/3xx) · `dead` (4xx/5xx) ·
   `unknown` (timeout/réseau).

Commande (reproductible) :

```
tsx api/src/scripts/audit-proof-liveness.ts --dir <snapshots> --format json --out report.json
# corpus complet S3 (défaut, sans --dir) : SCRAPE_S3_*/GRAPH_S3_* dans l'env
```

## 3. Manifeste corpus-complet — les 23 URL mortes + 9 inconnues

Toutes les 23 mortes sont **archive-recoverable** (`docSha` présent) → le viewer peut repointer
l'archive S3 (lot 1c). Concentration : beloeil ×3, chambly ×4, mascouche ×2 (16 villes touchées).

| Ville | Statut | URL |
|---|---|---|
| beloeil | 404 | `…/conseil_20260323_pv.pdf` (+ 20260427, 20260525) |
| chambly | 404 | `…/projet-de-reglement-2026-1431-38a.pdf` (+ 1520-01, final 1506-06, 1542) |
| mascouche | 404 | `…/20260609proces-verbaux-seances-du-conseil.pdf` (+ ppcmoi 1101) |
| chute-saint-philippe | 404 | `…/20260417084418-seance-04-2026.pdf` |
| dudswell | 404 | `…/ODJ_2026-05-25.pdf` |
| la-prairie | 404 | `…/2026-05-19_pv_non_officiel.pdf` |
| mont-saint-hilaire | 404 | `…/Proces_verbal-_2026-06-01_…pas-approuve.pdf` |
| richmond | 404 | `…/pv-2026-04-07.pdf` |
| saint-albert | 404 | `…/6a2acd8eed233.pdf` |
| sainte-brigitte-des-saults | 404 | `…/3_2026-06-08_odj.pdf` |
| sainte-catherine | 404 | `…/Odj-Cm-20251209-…pdf` |
| saint-gabriel-lalemant | 404 | `…/…proces-verbal-2-juin-2026…pdf` |
| saint-jean-de-matha | 404 | `…/20260401pv-seance-ordinaire.pdf` |
| saint-pierre | 404 | `…/2026-06-Procès verbal 3 juin 2026.pdf` |
| sutton | 404 | `…/WEB-Proces-verbal-2026-06-03-V3.pdf` |
| saint-philippe-de-neri | 403 | `…/3-Proces-verbal-2-mars-2026.pdf` (+ 4-…7-avril) — HEAD+GET refusés (peut être anti-bot) |

**9 inconnues « fetch failed »** (réseau/DNS/TLS, à re-sonder) : armagh ×2, val-david ×4,
saint-hyacinthe ×2, saint-alphonse-rodriguez ×1. À reclasser après re-sonde (transitoire vs mort).

### 3bis. Pilote local corroborant (110 villes, 493 URL)

Run préalable sur snapshots locaux (batches r11–r13) : **98,8 % vivantes, 6 mortes (404) 100 %
archivables** — cohérent avec l'autoritaire (98,0 %). **Pas de biais de survie** : le taux local
récent (98,8 %) et le corpus complet (98,0 %) coïncident.

## 4. Lecture honnête — deux cohortes à ne pas confondre

- **Cet audit mesure la couche DOCUMENTAIRE PV** (`sourceUrl`) : **saine à 98,0 %** corpus-wide, mortes
  **100 % récupérables** via l'archive S3 (`docSha`). Le « ~48 % de preuves mortes » **n'est PAS**
  la couche documentaire.
- **Il NE mesure PAS les URL de preuve de ZONE** (provenance géométrie/grille). Vérifié : **0 `url_grille`**
  et **0 URL sur les nœuds `Zone`** dans les snapshots — cette provenance est **portée par geo**
  (`zonePolygonSource` = enum, pas une URL ; côté federation la preuve est une enveloppe passthrough
  `properties.proof` schéma `immo-feature-proof/v1`, clé S3 jamais exposée — cf. `docs/spec/geo-contracts/`).
  Le « ~48 % / plafond 52 % » se rapporte à cette cohorte **geo-owned**, à mesurer **avec geo**.

## 5. Suites

1. ~~Run autoritaire S3~~ — **FAIT** (§0/§3) : 1638 URL / 522 villes, 98,0 % vivantes.
2. **Re-sonde des 9 inconnues** (« fetch failed ») pour trancher transitoire vs mort — cheap.
3. **Cohorte zone/grille** — mesurer la vivacité des URL de provenance geo : **drumbeat geo** dès qu'il
   est en ligne (les URL vivent côté geo, pas dans les graphes documentaires immo).
4. **Lot 1c — remplacement/tag** : pour chaque morte archivable (23/23), repointer le viewer vers
   l'archive S3 (`docSha`) et **taguer l'état** de la preuve (servie / archivée / non couverte). Touche
   l'affichage, **pas le vivier** → PR distincte, gate simple.

## 6. Reproduire

```
# corpus complet S3 (autoritaire)
tsx --env-file=.env api/src/scripts/audit-proof-liveness.ts --format json --out report.json
# connectivité S3 + compte villes, sans sonde
tsx --env-file=.env api/src/scripts/audit-proof-liveness.ts --list-only
```
