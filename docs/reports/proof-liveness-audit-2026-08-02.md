# Audit de vivacité des URL de preuve — pilote 2026-08-02

- **Lane** : extraction (WP2/WP4, lever #1 — consolidation des captations)
- **Portée de CE rapport** : URL de **preuve documentaire** (`sourceUrl` PV/PDF) portées par les nœuds du graphe. **HORS vivier** (data-integrity/affichage) → gate simple.
- **Outil** : `api/src/scripts/audit-proof-liveness.ts` (read-only, committé, testé).
- **Statut** : **pilote** sur snapshots locaux — le run autoritaire sur le corpus complet S3 reste à faire (§4).

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

## 3. Résultat mesuré — pilote (110 villes locales, 89 avec URL)

| Mesure | Valeur |
|---|---|
| URL de preuve documentaire distinctes sondées | **493** |
| Vivantes | **487 (98,8 %)** |
| Mortes | **6 (1,2 %)** — toutes HTTP 404 |
| Inconnues (timeout/réseau) | 0 |
| Mortes **récupérables depuis l'archive S3** (`docSha`) | **6 / 6 (100 %)** |

**Manifeste des 6 URL mortes** (toutes documentaires, toutes archivables) :

| Ville | URL |
|---|---|
| sutton | `…/WEB-Proces-verbal-2026-06-03-V3.pdf` |
| saint-remi | `…/LOISIRS-Politique-de-remboursement-…pdf` |
| vaudreuil-dorion | `…/20260601_cons.pdf` |
| vaudreuil-dorion | `…/20260601_odj.pdf` |
| vaudreuil-dorion | `…/Reg_1842_comp.pdf` |
| waterville | `…/Guide-du-citoyen-Waterville.pdf` |

## 4. Lecture honnête — deux cohortes à ne pas confondre

- **Ce pilote mesure la couche DOCUMENTAIRE PV** (`sourceUrl`). Sur cette cohorte, l'état est **sain
  à 98,8 %** ; les rares mortes sont **100 % récupérables** via l'archive S3 (`docSha`). Le chiffre
  « ~48 % de preuves mortes » **n'est PAS reproduit sur la couche documentaire** de ce pilote.
- **Ce pilote NE mesure PAS les URL de preuve de ZONE** (provenance géométrie/grille). Vérifié :
  **0 `url_grille`** et **0 URL sur les nœuds `Zone`** dans l'ensemble des snapshots locaux — cette
  provenance est **portée par geo** (`zonePolygonSource` est un enum, pas une URL ; `zone_versions.raw_ref`
  côté Postgres/geo). Le « ~48 % / plafond 52 % » se rapporte vraisemblablement à cette cohorte geo,
  qui doit être mesurée **avec les données geo** (geo hors-ligne à cette date).
- **Biais de survie possible** : les snapshots locaux proviennent de captures récentes (batches r11–r13,
  110 villes). Le corpus complet (~522 villes, captures plus anciennes) peut afficher un taux de mort
  supérieur. **Le run autoritaire S3 sur tout le corpus tranche ce point.**

## 5. Suites

1. **Run autoritaire S3** — corpus documentaire complet (~522 villes) : dépend de `@aws-sdk/client-s3`
   (déclaré côté api). Donne le taux de mort réel corpus-wide + le manifeste complet des archivables.
2. **Cohorte zone/grille** — mesurer la vivacité des URL de provenance geo : **drumbeat geo** dès qu'il
   est en ligne (les URL vivent côté geo, pas dans les graphes documentaires immo).
3. **Remplacement/tag** — pour chaque morte archivable : repointer le viewer vers l'archive S3 et
   **taguer l'état** de la preuve (servie / archivée / non couverte). Lot séparé (touche l'affichage,
   pas le vivier ; PR distincte, gate simple).
