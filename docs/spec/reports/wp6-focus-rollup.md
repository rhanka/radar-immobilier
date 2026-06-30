# WP6 — Vue rollup par AXE DE FOCUS (projection)

> Généré 2026-06-28. Axes = tags de projection (pas de primitive tag CLI Track).
> Numérateurs sourcés : `wp1-data-state.md` (2026-06-28 09:01), `2.3-completude-1105-FRESH.md`, `wp3-33-anomalies.json`.
> `—` = non recensé (jamais inventé). Le rattachement WPx.y reste une projection (`wp6-item-subitem-map.json`).

## focus:30 — villes démo prioritaires (priorityRank 1→30)  (N=30)
*Source dénominateur : packages/radar-sources/src/geo/municipalities.qc.json (champ priorityRank)*

| Sous-item WPx.y | Progression | Détail |
|---|---|---|
| **WP1.1** Villes & registre (geo) | 30 / 30 (100.0 %) |  |
| **WP1.2** PV & sources textuelles — acquisition (immo) | 27 / 30 (90.0 %) | graphe toutes versions |
| **WP1.3** Zones — désignations / géo / grilles | 2 / 30 (6.7 %) | zonage géo joignable |
| **WP1.4** Lots — cadastre / propriétaires / géo | 30 / 30 (100.0 %) | lots cadastre/géo |
| **WP2.1** Graphify — pipeline v2.3 | 25 / 30 (83.3 %) | v2.3 |
| **WP3.4** Métriques rappel/précision & parité Steve | 4 / 30 (13.3 %) | 4 villes Steve (bootstrap simulation) |
| **WP4.1** Vue Signaux (Québec) | — / 30 (non recensé) | Vue Signaux — feature produit (couverture data via WP1/WP2) |
| **WP4.2** Vue Opportunités (ville/zones) | — / 30 (non recensé) | Vue Opportunités — feature produit |
| **WP4.3** Vue Évaluation (zone/lots) + fiche lot | — / 30 (non recensé) | Vue Évaluation + fiche lot — feature produit |
| **WP4.5** Marques / notes / buckets / filtres (CS-L3–L5) | — / 30 (non recensé) | Marques/notes/buckets/filtres — feature produit |
| **WP4.6** Exports & différenciateurs (CS-P) | — / 30 (non recensé) | Exports & différenciateurs — feature produit |
| **WP5.1** Auth & session durable | — / 30 (non recensé) | auth démo |
| **WP5.6** Chat-ui / llm-mesh | — / 30 (non recensé) | chat-ui démo |
| **WP6.1** Structure Track & WP | — / 30 (non recensé) |  |
| **WP6.2** Reporting multi-échelle / focus | — / 30 (non recensé) |  |
| **WP6.3** Kanban UI / projection PG | — / 30 (non recensé) |  |

## focus:1104 — couverture provinciale (1106 − 2 exclues)  (N=1104)
*Source dénominateur : municipalities.qc.json (1106 total, 2 exclues: Montréal, Laval)*

| Sous-item WPx.y | Progression | Détail |
|---|---|---|
| **WP1.1** Villes & registre (geo) | 1104 / 1104 (100.0 %) |  |
| **WP1.2** PV & sources textuelles — acquisition (immo) | 1007 / 1104 (91.2 %) | graphe 91,2 % |
| **WP1.3** Zones — désignations / géo / grilles | 211 / 1104 (19.1 %) | zonage géo 19,1 % ; grilles 0 |
| **WP1.4** Lots — cadastre / propriétaires / géo | 1102 / 1104 (99.8 %) | lots 99,8 % ; proprio 0 (Loi 25) |
| **WP2.1** Graphify — pipeline v2.3 | 976 / 1104 (88.4 %) | v2.3 88,4 % ; 31 v2.2 + 97 sans graphe |
| **WP2.2** Citations / grounding / page-bbox | — / 1104 (non recensé) | citations par ville non recensées (gate publish impose grounding) |
| **WP2.3** Ontologie — entités additionnelles | 976 / 1104 (88.4 %) | porté par v2.3 |
| **WP2.4** Orchestration parsing à l'échelle | 976 / 1104 (88.4 %) | vecteur d'extension 976→1104 |
| **WP4.4** Vue Sources (couverture) | — / 1104 (non recensé) | Vue Sources couverture — reflète l'atome par ville |
| **WP5.3** Persistance S3-first / rebuild | 1007 / 1104 (91.2 %) | graphes S3 persistés |
| **WP5.4** Scale — serverless / agents remote | — / 1104 (non recensé) | scale provincial |
| **WP6.1** Structure Track & WP | — / 1104 (non recensé) |  |
| **WP6.2** Reporting multi-échelle / focus | — / 1104 (non recensé) |  |
| **WP6.3** Kanban UI / projection PG | — / 1104 (non recensé) |  |

## focus:33 — opportunités preuve E2E z∩m∩p (cible WPB-E2E)  (N=33)
*Source dénominateur : WPB-E2E 33 opportunités prioritaires ; audit docs/spec/reports/wp3-33-anomalies.json (10 villes prio, 27 signaux)*

| Sous-item WPx.y | Progression | Détail |
|---|---|---|
| **WP2.2** Citations / grounding / page-bbox | 19 / 27 (70.4 %) | signaux avec citation (8 absentes/27) ; page 19/27 ; bbox 0/27 |
| **WP2.3** Ontologie — entités additionnelles | 9 / 10 (90.0 %) | villes auditées ontology_version=2.3 |
| **WP3.1** Niveau 1 — signal × PDF / preuve | 19 / 27 (70.4 %) | signaux liés à une preuve PDF (8 citations absentes/27) |
| **WP3.2** Niveau 2 — signal × zone (directe/rue) × geo | 5 / 27 (18.5 %) | signaux avec zone_ref structuré ; geometry zone 0/15 |
| **WP3.3** Niveau 3 — signal × zone × grille × lot (opportunité) | — / 33 (non recensé) | 28 anomalies sur l'échantillon (data 15 / algo 6 / data_algo 7) ; grilles 0 → niveau 3 bloqué |
| **WP3.4** Métriques rappel/précision & parité Steve | 28 / 28 (100.0 %) | audit data+algo produit (28 anomalies classées) |
| **WP4.7** Viewer preuve PDF (transverse) | 19 / 27 (70.4 %) | Viewer preuve PDF — 19/27 signaux audités citables |
| **WP6.1** Structure Track & WP | — / 33 (non recensé) |  |
| **WP6.2** Reporting multi-échelle / focus | — / 33 (non recensé) |  |
| **WP6.3** Kanban UI / projection PG | — / 33 (non recensé) |  |
| **WP6.4** Décision-dossiers & remote→h2a | — / 33 (non recensé) |  |

## focus:5000plus — tous signaux/opportunités à l'échelle ville×signaux  (N=5000+)
*Source dénominateur : cible d'échelle (aucun census par-signal n'existe encore en local)*

| Sous-item WPx.y | Progression | Détail |
|---|---|---|
| **WP2.4** Orchestration parsing à l'échelle | — / 5000+ (non recensé) | orchestration remote (cible 3272 docs) |
| **WP3.1** Niveau 1 — signal × PDF / preuve | — / 5000+ (non recensé) | non recensé |
| **WP3.2** Niveau 2 — signal × zone (directe/rue) × geo | — / 5000+ (non recensé) | non recensé |
| **WP3.3** Niveau 3 — signal × zone × grille × lot (opportunité) | — / 5000+ (non recensé) | non recensé |
| **WP5.2** MCP immo | — / 5000+ (non recensé) | MCP immo — socle (forward-looking) |
| **WP5.3** Persistance S3-first / rebuild | — / 5000+ (non recensé) | substrat S3-first reconstructible |
| **WP5.4** Scale — serverless / agents remote | — / 5000+ (non recensé) | serverless / agents remote (cible 1000 villes sans OOM) |
| **WP5.5** Déploiement / CD | — / 5000+ (non recensé) | déploiement/CD socle |
| **WP6.1** Structure Track & WP | — / 5000+ (non recensé) |  |
| **WP6.2** Reporting multi-échelle / focus | — / 5000+ (non recensé) |  |
| **WP6.3** Kanban UI / projection PG | — / 5000+ (non recensé) |  |
| **WP6.4** Décision-dossiers & remote→h2a | — / 5000+ (non recensé) |  |

## Atome par ville (extension WP1)

Le rollup WP1 agrège l'atome par ville `docs/spec/reports/wp1-atome-par-ville.tsv` (**1104 villes**, colonnes `slug,name,priorityRank,graph_version`). L'extension `wp1-atome-par-ville-full.tsv` (zones/lots/citations par ville, produite par l'agent geo/WP1) permettra d'agréger par ville comme le fait geo : focus:30 = `priorityRank ≤ 30`, focus:1104 = toutes lignes.

