# Décision-dossier — Structure de tracking stable v1

Date: 2026-06-28
Auteur: conducteur radar-immobilier, synthèse double consensus (Claude Opus + Codex).
Sources: `docs/spec/reports/tracking-structure-claude.md`, `docs/spec/reports/tracking-structure-codex.md`.
Statut: **à trancher** (orientation). Aucune mutation Track tant que non approuvé.

## 1. Diagnostic (consensus)

Le suivi est illisible parce que **le backlog Track est plat** : sur 437 events / 111 items, **0 item `role:workpackage`, 0 `parent`**. Le seul regroupement est un champ `workspace` texte-libre à **14 valeurs incohérentes** où coexistent 4 générations de nommage (`wp4-*`, `wp5-*`, `WP A.x`, `WP B`, `frontA-*`, `frontB-geo`, `CS-L/CS-P`, `L1-L6`, `reorientation`, `meta-track`, `evdoc-branch-*`).

Conséquence : `track report` ne peut PAS produire de vue %·WP ni répondre aux 4 échelles (maintenant / semaine / mois / projet). Tant que la structure n'est pas posée, on se perd.

## 2. Structure cible recommandée — 6 WP immuables

Top stable, immuable : on ajoute/ferme/déplace des **sous-lots** et **todos**, jamais on ne renomme/recycle un code WP sans nouveau décision-dossier. Reprend ton intention (data / réconciliation / fonctionnel / infra) + la correction consensus.

| Code | Titre | Contenu (sous-lots) | RACI geo/immo | Critère de complétude |
|---|---|---|---|---|
| **WP1 · DATA** | Sources & substrat | villes(geo) · PV/avis/YouTube(acquisition) · zones(désignations, géo, grilles) · lots(cadastre, proprio, géo) | geo par défaut (foncier/géospatial) ; immo sur acquisition texte PV/avis/YT + scraping dur | Couches ciblées ont provenance, fraîcheur, clé de jointure (`citySlug`/`NO_LOT`/`codeAffiche`), couverture par axe, statut honnête fait/hypothèse/non-dispo/simulé |
| **WP2 · EXTRACTION** | Signaux & ontologie | graphify (v2.3) · entités · citations/grounding · classification/confiance | **100 % IMMO — indélégable (le « SAUF »)** | Signaux des axes actifs ont source, date, extrait, page/bbox, confiance, type, statut, lien preuve ; reliquats explicitement `blocked`/`dropped` |
| **WP3 · RÉCONCILIATION E2E & PREUVE** | Chaîne de vérité | signal→PDF/rawRef→citation/page/bbox→zone→grille→lot=opportunité · parité Steve · gates 33 | A immo (vérité opportunité) ; R geo (projection zone/lot/géométrie) | 33 opportunités démontrables avec preuve+zone+lot+grille+score ; chaque rupture visible avec cause ; 4 villes Steve diffables vs table de contrôle |
| **WP4 · PRODUIT** | App radar client | 4 vues (Signaux/Opportunités/Évaluation/Sources) · fiche lot · filtres · buckets · marques/notes · exports · viewer preuve (restitution) · CS-L/CS-P · DS/app shell | A immo/produit ; R geo sur couches carto déléguées | 17 features Steve livrées ou explicitement planifiées/droppées ; démo répond « quoi faire maintenant » par ville/zone/lot sans cacher l'état de preuve |
| **WP5 · PLATEFORME & SCALE** | Socle & industrialisation | S3-first · Postgres reconstructible · serverless/cron 1104 sans OOM · auth durable 15j · MCP · chat-ui · agents remote · déploiement/CD · perf/sécu | A immo-plateforme ; C geo (contrats OGC/S3) | Services reproductibles/sécurisés/observables ; auth durable OK ; PG rebuild depuis S3 ; agents ne cassent pas le writer Track |
| **WP6 · GOUVERNANCE** | Pilotage Track & reporting | structure Track · décision-dossiers · focus HTML · statuts/signoff · reporting now/week/month/project · kanban Track↔PG | A propriétaire/conducteur | Track répond aux 4 échelles ; chaque item dans 1 seul WP ; décisions ouvertes ont owner+critère ; `track focus --format html` présentable client |

### Correspondance avec ton draft
- Ton **WP1 data** → conservé en **WP1**, mais **l'extraction des signaux en sort** vers **WP2** (correction consensus).
- Ton **WP2 réconciliation e2e** → **WP3** (niveaux L1/L2/L3 = critères internes, pas des WP).
- Ton **WP3 fonctionnel immo** → **WP4 PRODUIT** (mailles québec/ville/zone/lot = sous-lots/navigation, pas définition de WP).
- Ton **WP4 infra** → scindé en **WP5 plateforme & scale** + **WP6 gouvernance** (sinon "infra" redevient le fourre-tout).

## 3. Modèle de todo (commun aux deux analyses)

- **Statut fermé** : `planned · in_progress · blocked · needs_review · done · dropped`.
- **Signoff fermé** : `not_required · pending · signed · rejected`.
- **Axes de focus = TAGS, pas des WP** : `focus:30` (démo prioritaire) · `focus:33` (opportunités preuve E2E) · `focus:1104` (couverture provinciale).
- **Échelle temps = filtre, pas un WP** : `now` (3–7 items) · `week` · `month` · `project`.
- **Règle d'honnêteté** : un item `AWAITED`/`done` mais non signé s'affiche **`needs_review`**, jamais "fait", dans la vue client.

Forme d'un todo (corps/critères Track) :
```yaml
wp: WP3
sub_lot: evidence-chain
status: in_progress
signoff: pending
focus_axes: [33, 30]
time_scale: week
raci: { accountable: immo, responsible: [immo, geo] }
criteria:
  - "Signal a rawRef PDF + citation page/bbox"
  - "Zone et lot réconciliés ou marqués non-disponible"
  - "Fallback client honnête"
```

## 4. Track ↔ PostgreSQL (commun)

- **Track = source de vérité** des WP/todos/statuts/signoff/décisions (append-only).
- **PostgreSQL = projection lecture** pour le kanban UI (`track_items_projection`, `track_wp_rollup`, `track_focus_cache`), régénérable.
- Une action UI ne change **jamais** le statut canonique en silence : elle crée une intention (`track_write_requests`) ou appelle un writer autorisé ; l'état affiché revient de la projection Track.
- Rendu client = `track focus <decision-id> --workspace <w> --format html` → 4 panneaux : Maintenant / Semaine / Mois / Depuis le départ.

## 5. Décisions à trancher (avec préco)

| # | Décision | Préco | Ce qui l'invaliderait |
|---|---|---|---|
| D1 | Extraction signaux = WP autonome (WP2) ou sous-lot de DATA | **WP2 autonome** | tu veux garder data+signaux ensemble malgré la perte du seam geo/immo |
| D2 | Gouvernance (WP6) séparée de plateforme (WP5) | **séparée** | tu n'exposes jamais Track au client → réduire à 5 WP |
| D3 | Scale = sous-lot de WP5 ou WP dédié | **sous-lot de WP5** | tu veux un WP « industrialisation » visible en propre |
| D4 | Nombre canonique de l'axe couverture | **1104** (mesuré : 1106 total − Montréal/Laval) | convention « 1105 » à conserver pour une raison métier |
| D5 | `AWAITED done` non signé affiché `needs_review` | **oui** | — |
| D6 | Écriture Track depuis UI kanban | **projection + queue d'intention, writer autorisé** | tu veux toutes mutations manuelles CLI/conducteur |

## 6. Mise en œuvre (sur GO)

1. Créer le décision-dossier Track `tracking-structure-v1` (orientation), y attacher ce doc.
2. Créer 6 items parents `role:workpackage` = WP1…WP6.
3. `track item reparent` chaque item existant vers exactement 1 WP/sous-lot (les items à cheval sont **splités**, pas multi-homés). Table de migration détaillée dans les 2 rapports sources (§ migration).
4. Ajouter les critères de complétude ; le % est **calculé par Track**, jamais à la main.
5. Produire la vue `track focus … --format html`.
6. Évolution `track-reader` pour lire `parentId`+`role` → rollups %·WP dans l'UI (1 todo WP6).

## 7. Points de divergence Claude ↔ Codex (mineurs)
- **Data** : Codex supprime tout WP « data » et split en WP-SIG + WP-GEO ; Claude (et cette synthèse) gardent un WP1 DATA avec RACI explicite. → tranché par **D1** (extraction sort) ; le reste de DATA peut rester un WP avec 2 lanes RACI.
- **Scale** : Claude en fait un WP propre ; Codex le fond dans plateforme. → **D3**, préco fond.
- Tout le reste (extraction autonome, gouvernance séparée, tags focus, Track source de vérité, needs_review) = **accord total**.

## 8. Taxonomie figée des sous-items WPx.y (v1) — 2026-06-28

Niveau 2 de la structure : **29 sous-items** (`kind:chore`, créés DANS le workspace de leur WP
parent — le reparent cross-workspace reste bloqué par l'invariant containment Track 0.19.2, donc le
sous-item est physiquement parenté et le WP passe). Codes **immuables** : on ajoute/ferme des todos
sous un WPx.y, on ne renomme/recycle pas un code sans nouveau décision-dossier. Projection
item→WPx.y dans `docs/spec/reports/wp6-item-subitem-map.json` (111/111), rollups dans
`wp6-focus-rollup.*` (par axe) et la projection kanban 2 niveaux (`api/src/services/track/wp-projection.ts`).

| Code | Titre | ID Track | Workspace |
|---|---|---|---|
| WP1.1 | Villes & registre (geo) | `01KW7HVAPETNMPW0F5QWR80REC` | wp1-data |
| WP1.2 | PV & sources textuelles — acquisition (immo) | `01KW7HWAQHW215XKNZRZH8JA3H` | wp1-data |
| WP1.3 | Zones — désignations / géo / grilles | `01KW7HWAW2HCR0TYAX8R9R2CG0` | wp1-data |
| WP1.4 | Lots — cadastre / propriétaires / géo | `01KW7HWB0K10Z2Q6QHQ2629YE6` | wp1-data |
| WP2.1 | Graphify — pipeline v2.3 | `01KW7HWB54R8TB03EW9685YDTY` | wp2-extraction |
| WP2.2 | Citations / grounding / page-bbox | `01KW7HWB9HD58SBNG438FVXWDB` | wp2-extraction |
| WP2.3 | Ontologie — entités additionnelles | `01KW7HWBE0BATB0FQ10JJHWT2V` | wp2-extraction |
| WP2.4 | Orchestration parsing à l'échelle | `01KW7HWBJJFH5AAVGZB9WEJEEG` | wp2-extraction |
| WP3.1 | Niveau 1 — signal × PDF / preuve | `01KW7HWBPYSK37B2EXAB2W12DK` | wp3-reconciliation |
| WP3.2 | Niveau 2 — signal × zone (directe/rue) × geo | `01KW7HWBVFG5AYV7T0X7GWDQQZ` | wp3-reconciliation |
| WP3.3 | Niveau 3 — signal × zone × grille × lot (opportunité) | `01KW7HWC05G2DX55M6D5STKP07` | wp3-reconciliation |
| WP3.4 | Métriques rappel/précision & parité Steve | `01KW7HWC4PDZD7V50HTY6QY2HS` | wp3-reconciliation |
| WP4.1 | Vue Signaux (Québec) | `01KW7HWC99XR5HP8M19F7K92AS` | wp4-produit |
| WP4.2 | Vue Opportunités (ville/zones) | `01KW7HWCDXEBTC3PTS5WBJ5VAG` | wp4-produit |
| WP4.3 | Vue Évaluation (zone/lots) + fiche lot | `01KW7HWCHXMA1E74WDXQ73GSQG` | wp4-produit |
| WP4.4 | Vue Sources (couverture) | `01KW7HWCNMCXRF9AAN3A26V1BH` | wp4-produit |
| WP4.5 | Marques / notes / buckets / filtres (CS-L3–L5) | `01KW7HWCSPHG5G2KWRGMCD7B3W` | wp4-produit |
| WP4.6 | Exports & différenciateurs (CS-P) | `01KW7HWCX2XQ0W223VRMQ1AWNE` | wp4-produit |
| WP4.7 | Viewer preuve PDF (transverse) | `01KW7HWD0P54G5QCYEBF6QDP3E` | wp4-produit |
| WP5.1 | Auth & session durable | `01KW7HWD47ZER7DQ2PWFDVFHV9` | wp5-plateforme |
| WP5.2 | MCP immo | `01KW7HWD831W46RE1RM3NYMR9V` | wp5-plateforme |
| WP5.3 | Persistance S3-first / rebuild | `01KW7HWDBDDQP0Q7V1XA7M3K2E` | wp5-plateforme |
| WP5.4 | Scale — serverless / agents remote | `01KW7HWDF1K778HJZJYCNSF6CN` | wp5-plateforme |
| WP5.5 | Déploiement / CD | `01KW7HWDJXV1NK3JVG3YGNGARA` | wp5-plateforme |
| WP5.6 | Chat-ui / llm-mesh | `01KW7HWDPK55QN7CRCV7P1N9TB` | wp5-plateforme |
| WP6.1 | Structure Track & WP | `01KW7HWDT6G7C0N3MS1PF8E5EC` | wp6-gouvernance |
| WP6.2 | Reporting multi-échelle / focus | `01KW7HWDXRYYPCMGX1XFCKZD98` | wp6-gouvernance |
| WP6.3 | Kanban UI / projection PG | `01KW7HWE1QFZW7H5W4ZBT71Q4K` | wp6-gouvernance |
| WP6.4 | Décision-dossiers & remote→h2a | `01KW7HWE6ABHZHR4SVSBMXHMH1` | wp6-gouvernance |

**Axes de focus (tags de projection, §3)** — restitués par `wp6-focus-rollup.*`. Le CLI Track n'expose
pas de primitive `tag` ; les axes sont donc une **projection** au-dessus des items (comme le rattachement
WP). Axes canoniques v1 : `focus:30` · `focus:1104` · `focus:33` · `focus:5000plus` (échelle ville×signaux).
