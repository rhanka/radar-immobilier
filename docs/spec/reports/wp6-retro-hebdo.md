# WP6 — Retro hebdomadaire (4 semaines, reconstruite depuis le log Track)

> Source : `.track/events.jsonl` (horodatage des transitions `realization.transition` + `item.created`).
> Projection WP : `wp6-item-wp-map.json` (111 items mappés). Sous-items : `wp6-item-subitem-map.json`.
> Fenêtres : 4 semaines glissantes finissant le 2026-06-28. Les events Track démarrent le 2026-06-08.
> « ouverts (fin de semaine) » = items mappés ni *done* ni *cancelled* au dimanche soir.
> Le **passé est conservé** : un item *done* reste *done* dans chaque snapshot ultérieur (rollup « depuis le début »).

## Semaine 1 — 2026-06-01 → 2026-06-07 *(événements Track démarrent le 2026-06-08 : semaine pré-tracking)*

**Bilan** : 0 créé(s) cette semaine, 0 passé(s) à *done*, 0 *done* cumulés (depuis le début), 111 ouvert(s) en fin de semaine.

| WP | créés (sem.) | faits→done (sem.) | done cumulés | ouverts (fin sem.) |
|---|--:|--:|--:|--:|
| WP1 | 0 | 0 | 0 | 24 |
| WP2 | 0 | 0 | 0 | 20 |
| WP3 | 0 | 0 | 0 | 8 |
| WP4 | 0 | 0 | 0 | 34 |
| WP5 | 0 | 0 | 0 | 21 |
| WP6 | 0 | 0 | 0 | 4 |
| **TOTAL** | **0** | **0** | **0** | **111** |

## Semaine 2 — 2026-06-08 → 2026-06-14

**Bilan** : 69 créé(s) cette semaine, 44 passé(s) à *done*, 44 *done* cumulés (depuis le début), 67 ouvert(s) en fin de semaine.

| WP | créés (sem.) | faits→done (sem.) | done cumulés | ouverts (fin sem.) |
|---|--:|--:|--:|--:|
| WP1 | 21 | 17 | 17 | 7 |
| WP2 | 10 | 8 | 8 | 12 |
| WP3 | 3 | 1 | 1 | 7 |
| WP4 | 13 | 5 | 5 | 29 |
| WP5 | 19 | 10 | 10 | 11 |
| WP6 | 3 | 3 | 3 | 1 |
| **TOTAL** | **69** | **44** | **44** | **67** |

*Faits cette semaine :*
- [WP1] `SJRYE4` WP4-A — Investigation données réelles multi-villes
- [WP1] `Z6NSSS` WP4-B — Recueil substrat (RawDocument + S3) + 1ʳᵉ source
- [WP1] `X370SP` WP4 source #2 — avis-publics Beauharnois adapter + seed ontologie enrichi
- [WP1] `79WN1Y` WP4 source #3 — rôle d'évaluation MAMH SourceAdapter (collect->exploitation)
- [WP1] `DEVPF3` WP4 source #4 — Adresses Québec adapter + mentions Adresse
- [WP1] `GTD9V1` WP4 source #5 — règlements d'urbanisme adapter + Bylaw/Zone mentions
- [WP1] `KBGBDY` WP4 — Sources #2-5 (1 PR/source)
- [WP1] `KWBPD1` Ciblage — stage CiblagePlan (modele + UI editable, no I/O) pilotable
- [WP1] `7X4ZMF` Pipelines executables — declencher recueil(live)+exploitation depuis l'UI
- [WP1] `Y3P262` Exploitation: l'etat projet est ECRASE par source au lieu d'accumuler (executor multi-sour
- [WP1] `75TRS3` A.2.1 Liste des villes + perimetre (rayon MTL extensible QC) via CiblagePlan
- [WP1] `8CEFXX` A.2.2 Scraper procès-verbaux GENERIQUE (avis de motion + changement de zonage + n. regleme
- [WP1] `03F4XJ` A.2.3 YouTube seances: download + transcrit (Voxtral si besoin) + graphify
- [WP1] `7VDNZ2` Source conseils-municipaux (PV) — automation=refresh
- [WP1] `NT6HEH` Source avis-publics — automation=refresh
- [WP1] `WQ27MR` Source youtube-seances — automation=refresh
- [WP1] `BDRC86` Tracking progressif scraping par ville x source (automation 1shot/refresh, fenetre)
- [WP2] `JPWR9C` WP4 — Pipeline exploitation (mentions -> réconciliation -> projection -> signaux)
- [WP2] `DRW3YQ` WP5-V1 — Ontologie graphify + modèle bitemporel Zod+PostGIS
- [WP2] `79C2QY` WP5 — Studio réconciliation (UI) + seed données réelles + valideurs D3
- [WP2] `5NBX21` Reconciliation graphify VISIBLE — chevauchement cross-source reel (avis<->reglement meme B
- [WP2] `XBCMWT` WP5 — Studio write-core (accept/reject -> patches graphify, token-gated)
- [WP2] `A0AK81` llmesh — extraction semantique graphify via @sentropic/llm-mesh (enrolment token)
- [WP2] `8MEC05` Write-core: candidat decide reste en file + set_status UI + token durable compose
- [WP2] `PVK1N3` WP5 — Studio write-core (accept/reject -> patches graphify)
- [WP3] `2WF5BQ` WP B — Vertical profond geo (zone->lot), villes prioritaires opportunites<6mois x lots Geo
- [WP4] `8CHEZE` WP A.1 — Visualisation geographique-centrique (carte-first, bandeau de vues)
- [WP4] `7CZ5MG` A.1.1 Vue Signaux (maille Quebec/villes) — nb opportunites/ville sur 6 mois, clic ville ->
- [WP4] `JC3RS4` A.1.2 Vue Opportunites (maille ville/zones) — clic zone -> zoom
- [WP4] `TQZFZ3` A.1.3 Vue Evaluation (maille zone/lots) — qualifier lots selon grilles de zonage
- [WP4] `1F1DQB` A.1.4 Vue Sources (maille Quebec, maturite recueil) — villes GeoJSON coloriees par maturit
- [WP5] `ZNJMVE` Deploiement — k8s (PR #8) ou via sentropic
- [WP5] `0Y07WK` WP A.3 — Infrastructure data & agents (remote, backlog, graph DB, UI gestion + chat-ui)
- [WP5] `CZVFGE` chat.test.ts dépend des clés provider du .env (faux-négatif make test)
- [WP5] `3MP3ND` A.3.1 Graph DB / table graphe Postgres (nodes/edges) — persistance graphe ontologique (gra
- [WP5] `8P0NX8` A.3.3 UI de gestion (dont chat-ui)
- [WP5] `J5SGFX` Provincial graph — partition par MRC quand N villes ingérées (différé)
- [WP5] `QVYSJ8` L1 — Geler l'anti-pattern + 2 bugs: rawObjectKey en CAS pur (retirer date-in-key) + sharde
- [WP5] `RQN539` L2 — Worker scrape -> S3: port Storage (PUT raw cas+meta) + manifestes de run (runs/.../ma
- [WP5] `RVWNF9` L3 — Persister parsed/ + graph/ sur S3 (docSha x parserVersion ; graphifyVersion x inputse
- [WP5] `6CWGXJ` Mount S3 SCW read-only (substrat graphify) — rclone mount-scw.sh
- [WP6] `ZJF6E2` Backlog <-> track — brancher la vue Backlog sur le store track (au lieu de l'in-memory dem
- [WP6] `FETF3A` Backlog actualisation live (auto-refresh depuis le sidecar track)
- [WP6] `E3CFZ2` Réorientation « Grand filet » — radar changement de zonage, carte-first, multi-villes

## Semaine 3 — 2026-06-15 → 2026-06-21

**Bilan** : 24 créé(s) cette semaine, 12 passé(s) à *done*, 56 *done* cumulés (depuis le début), 55 ouvert(s) en fin de semaine.

| WP | créés (sem.) | faits→done (sem.) | done cumulés | ouverts (fin sem.) |
|---|--:|--:|--:|--:|
| WP1 | 2 | 2 | 19 | 5 |
| WP2 | 8 | 4 | 12 | 8 |
| WP3 | 2 | 0 | 1 | 7 |
| WP4 | 11 | 5 | 10 | 24 |
| WP5 | 1 | 1 | 11 | 10 |
| WP6 | 0 | 0 | 3 | 1 |
| **TOTAL** | **24** | **12** | **56** | **55** |

*Faits cette semaine :*
- [WP1] `GK07C2` Persist `publishedAt` at recueil time
- [WP1] `1P2YN6` Metadata repair from existing S3
- [WP2] `5K8VX9` Baseline, specs, and track
- [WP2] `ZNPGEK` Graphify contract and non-regression gate notes
- [WP2] `HSED5E` Merge readiness
- [WP2] `TGD580` Graphify evidence contract — signal description, citation and PDF link
- [WP4] `6QTSNW` API evidence DTO and document route
- [WP4] `M4WDWG` UI signal card and PDF overlay
- [WP4] `8V3RTE` Evidence-backed signal document cards
- [WP4] `RYTC7H` Geo router compatibility layer — real /geo/* routes with hash compatibility
- [WP4] `49GYZ9` Geo PDF overlay integration — signal evidence viewer with page bbox
- [WP5] `DBPYWV` P5 Admin validation view — approve reject suspend users

## Semaine 4 — 2026-06-22 → 2026-06-28

**Bilan** : 18 créé(s) cette semaine, 14 passé(s) à *done*, 70 *done* cumulés (depuis le début), 39 ouvert(s) en fin de semaine.

| WP | créés (sem.) | faits→done (sem.) | done cumulés | ouverts (fin sem.) |
|---|--:|--:|--:|--:|
| WP1 | 1 | 0 | 19 | 4 |
| WP2 | 2 | 0 | 12 | 7 |
| WP3 | 3 | 2 | 3 | 5 |
| WP4 | 10 | 11 | 21 | 13 |
| WP5 | 1 | 1 | 12 | 9 |
| WP6 | 1 | 0 | 3 | 1 |
| **TOTAL** | **18** | **14** | **70** | **39** |

*Faits cette semaine :*
- [WP3] `757RPT` P3 Zones and lots display — priority detections with geometry fallback
- [WP3] `E2MH8M` CS-L1 — Scoring visuel lots 4+∩TOD (carte Opportunités, couche lots coloriée data-driven)
- [WP4] `FRR3NW` Zones/lots matchant le filtre non colorisés sur la carte — highlight data-driven absent
- [WP4] `TK3DEX` Geo URL state contract — mode selection focus filters viewport
- [WP4] `FAVX0D` Filtre Signaux : les 3 filtres ne sont pas cochés par défaut
- [WP4] `ED2QGX` PDF viewer Preuve ne rend pas — modal affiche erreur + fallback lien (route API PDF absent
- [WP4] `PPQKPC` Header pas l'AppHeader canonique DS — écart structurel/visuel
- [WP4] `3B83A1` Police DS non chargée app-wide — font-family Inter en dur, 0 @font-face
- [WP4] `5CAZTD` Filtre Signaux : état non persisté (URL / store / localStorage)
- [WP4] `1106T5` Filtre zones/lots : les listes Zones et Lots du panneau ville ne sont pas filtrées par le 
- [WP4] `42Q66Y` Fiches de zones non affichées : l'accordéon Zones (ex. Saint-Frédéric, compteur=6) ne mont
- [WP4] `T2GYQF` Filtre Signaux : taille de police des libellés trop grande
- [WP4] `KTV0K5` Panneau Signaux : déclarations font bespoke (hors tokens DS)
- [WP5] `KBP234` graphify → DB graphe Postgres (persistance nodes/edges)

> Note semaine 4 : **29 sous-items WPx.y** + structure créés le 2026-06-28 (gouvernance, hors 111 backlog produit) ; n'altèrent pas les compteurs ci-dessus.

## Synthèse 4 semaines (cumulatif done par WP)

| WP | S1 | S2 | S3 | S4 |
|---|--:|--:|--:|--:|
| WP1 | 0 | 17 | 19 | 19 |
| WP2 | 0 | 8 | 12 | 12 |
| WP3 | 0 | 1 | 1 | 3 |
| WP4 | 0 | 5 | 10 | 21 |
| WP5 | 0 | 10 | 11 | 12 |
| WP6 | 0 | 3 | 3 | 3 |
| **TOTAL** | **0** | **44** | **56** | **70** |

> *done* cumulés = realization=done (70 au 2026-06-28). Le bucket **DONE signé = 68** (2 items *done* restent **AWAITED** : signoff/acceptation en attente — comptés ouverts au sens « à clore »).

