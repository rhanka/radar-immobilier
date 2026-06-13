# Directive de re-graphify — migration vers l'ontologie canonique v2.0

> **Statut : OPÉRATIONNEL.**  
> Ce document décrit la méthode complète de migration des 522 villes vers
> le format canonique v2.0 défini dans `graphify-output-contract.md`.

---

## 1. Principe général

**On ne re-scrape PAS.** Les fichiers `raw/` (PVs téléchargés, 522 villes) sont conservés.
Le re-graphify consiste à réinterpréter le raw existant au format v2.0 et à écraser
`graph/<ville>/latest.json` avec `ontology_version: "2.0"`.

Toute ville nouvelle (après la migration) suit directement le chemin v2.0 dès la config.

---

## 2. Layout SCW canonique

```
raw/
  proces-verbaux-<slug>/
    cas/                         ← PDF des PVs (inchangé, conservé tel quel)
      <sha256>.pdf
      ...

parsed/
  <ville>/
    graphify/
      <sha256>/                  ← Snapshot par version de graphify
        graph.json               ← Graphe brut produit par graphify
    ...

graph/
  <ville>/
    latest.json                  ← ← ← CIBLE de la migration (format v2.0)
```

**Invariant :** `raw/` n'est JAMAIS modifié. Seuls `parsed/` et `graph/` sont écrits.

---

## 3. Méthode de re-graphify — 522 villes existantes

### 3.1 Entrée

Pour chaque ville `<slug>` :
- Source : `raw/proces-verbaux-<slug>/cas/*.pdf` (PVs existants)
- Config : `radar/cities/<slug>/graphify.yaml` (profil de la ville)
- Ontologie : `radar/ontology/ontology-profile.yaml` v2.0

### 3.2 Commande type

```bash
# Re-graphify d'une ville depuis son raw
graphify run \
  --profile radar/ontology/ontology-profile.yaml \
  --city-config radar/cities/<slug>/graphify.yaml \
  --raw-dir "s3://bucket/raw/proces-verbaux-<slug>/cas/" \
  --output "s3://bucket/graph/<slug>/latest.json" \
  --ontology-version 2.0
```

### 3.3 Sortie

- Écrase `graph/<slug>/latest.json` avec `ontology_version: "2.0"`.
- Snapshot sauvegardé dans `parsed/<slug>/graphify/<run-sha>/graph.json`.

---

## 4. Partition des villes par agent

Pour paralléliser le re-graphify sans collision, partition par initiale du slug normalisé :

| Agent   | Tranche alphabétique | Critère (slug normalisé, sans accents) |
|---------|---------------------|----------------------------------------|
| **codex** | A → L inclusive    | `slug[0] in [a,b,c,d,e,f,g,h,i,j,k,l]` |
| **immo**  | M → Z inclusive    | `slug[0] in [m,n,o,p,q,r,s,t,u,v,w,x,y,z]` |

**Règle de normalisation du slug :** minuscules, sans accents, `-` comme séparateur,
conformément aux slugs SCW existants (ex : `saint-constant`, `sainte-julie`).

**Note :** les villes sans initiale latine (chiffres, etc.) sont assignées à `immo`.

---

## 5. Priorité : les 60 villes sans nœuds

Ces 60 villes ont des `latest.json` au format ad-hoc (résumés textuels, pas de graphe structuré).
Elles doivent être **re-graphifiées en priorité absolue** car elles représentent des données
complètement absentes du pipeline PG.

Liste complète des 60 villes sans nœuds à traiter en priorité :

```
beauceville, becancour, bedford--brome-missisquoi, berthier-sur-mer,
berthierville, blainville, blue-sea, candiac, cantley, cap-saint-ignace,
cap-sante, carignan, cayamant, chambly, champlain, contrecoeur,
cookshire-eaton, cote-saint-luc, coteau-du-lac, cowansville, danville,
gore, gracefield, granby, grand-saint-esprit, grenville-sur-la-rouge,
ham-nord, ham-sud, hampstead, harrington, hatley, la-minerve,
lac-superieur, lac-tremblant-nord, lambton, lancienne-lorette,
lange-gardien--la-cote-de-beaupre, lange-gardien--les-collines-de-loutaouais,
lanoraie, lavaltrie, les-cedres, les-coteaux, lile-cadieux,
lile-du-grand-calumet, mont-saint-gregoire, mont-saint-hilaire,
mont-saint-michel, mont-tremblant, nantes, notre-dame-des-prairies,
notre-dame-du-bon-conseil--drummond--2, notre-dame-du-mont-carmel,
notre-dame-du-rosaire, notre-dame-du-sacre-coeur-dissoudun, ogden,
orford, otterburn-park, parisville, rosemere, roxton-pond
```

Ces villes ont du `raw/` disponible mais le parseur précédent a produit un résumé
au lieu d'un graphe. Le re-graphify v2.0 doit produire un `nodes/edges` structuré.

**Partition priorité :**
- `codex` (A–L) : beauceville, becancour, bedford, berthier-sur-mer, berthierville,
  blainville, blue-sea, candiac, cantley, cap-saint-ignace, cap-sante, carignan,
  cayamant, chambly, champlain, contrecoeur, cookshire-eaton, cote-saint-luc,
  coteau-du-lac, cowansville, danville, gore, gracefield, granby, grand-saint-esprit,
  grenville-sur-la-rouge, ham-nord, ham-sud, hampstead, harrington, hatley,
  la-minerve, lac-superieur, lac-tremblant-nord, lambton, lancienne-lorette,
  lange-gardien--* (2), lanoraie, lavaltrie, les-cedres, les-coteaux,
  lile-cadieux, lile-du-grand-calumet
- `immo` (M–Z) : mont-saint-gregoire, mont-saint-hilaire, mont-saint-michel,
  mont-tremblant, nantes, notre-dame-* (4), ogden, orford, otterburn-park,
  parisville, rosemere, roxton-pond

---

## 6. Villes nouvelles (post-migration)

Le chemin pour une ville nouvelle est :

```
1. Créer radar/cities/<slug>/graphify.yaml
   (depuis radar/cities/graphify.template.yaml)
2. Scraper : récupérer les PVs → raw/proces-verbaux-<slug>/cas/
3. Graphifier : graphify run --ontology-version 2.0 → graph/<slug>/latest.json
```

Toute ville créée après la migration est v2.0 nativement.

---

## 7. Re-projection SCW → Postgres

Après le re-graphify d'une ville (ou d'un lot de villes), re-projeter dans PG :

### 7.1 Truncate + rebuild complet (migration initiale)

```bash
# Depuis le conteneur API (make shell ENV=prod ou make exec ENV=prod)
# ATTENTION : TRUNCATE graph_nodes + graph_edges → toutes les villes perdent leur graphe PG
# N'exécuter qu'une fois toutes les villes re-graphifiées (ou en deux passes).
psql $DATABASE_URL <<'SQL'
  TRUNCATE graph_nodes, graph_edges CASCADE;
SQL

# Re-projeter depuis SCW
tsx api/src/scripts/project-graph-from-s3.ts
```

### 7.2 Re-projection sélective (incrémentale)

Pour une ville ou un lot de villes sans toucher aux autres :

```bash
tsx api/src/scripts/project-graph-from-s3.ts <slug1> <slug2> ...
```

Le script est **idempotent** (upsert ON CONFLICT) — safe à relancer.

### 7.3 Comportement du script

`api/src/scripts/project-graph-from-s3.ts` :
- Lit `graph/<slug>/latest.json` depuis SCW.
- Skip si le JSON n'a pas de champ `nodes` (ex : les 60 villes ad-hoc non encore re-graphifiées).
- Appelle `upsertGraph(db, citySlug, graphJson)`.

**Note :** les villes non encore re-graphifiées (format ad-hoc sans `nodes`) sont automatiquement
skippées — elles ne corrompent pas la projection.

---

## 8. Séquençage recommandé

```
Phase 1 : Re-graphify des 60 villes sans nœuds (priorité max)
  → codex : lot A–L (44 villes)
  → immo  : lot M–Z (16 villes)
  → projection sélective : tsx project-graph-from-s3.ts <slugs-lot>

Phase 2 : Re-graphify des 462 villes avec nœuds (normalisation v2.0)
  → codex : lot A–L (~231 villes)
  → immo  : lot M–Z (~231 villes)
  → projection incrémentale par lots de ~50

Phase 3 : Validation post-migration
  → SELECT COUNT(*) FROM graph_nodes — doit dépasser 11 077 (baseline v1)
  → SELECT DISTINCT ontology_version FROM graph_nodes — doit être {"2.0"} uniquement
  → Vérification des 9 types uniquement : no Address, no Document, no Valuation
  → spot-check 5 villes via l'UI radar
```

---

## 9. Mapping de normalisation lors du re-graphify

Le parseur v2.0 doit appliquer automatiquement les normalisations suivantes sur
les graphes hérités v1 :

| Dimension | Mapping |
|-----------|---------|
| `from`/`to` → | `source`/`target` |
| `src`/`tgt` → | `source`/`target` |
| `"relation": x` → | `"type": x` |
| `"rel": x` → | `"type": x` |
| conteneur `relations` → | `edges` |
| `evidence: ...` → | `refs: []` (si docSha inconnu) |
| `refs: [string]` → | `refs: []` |
| `props: {...}` → | `properties: {...}` |
| type `Address` → | type `Adresse`, préfixe `adresse-` |
| type `Document` → | type `Source`, préfixe `source-` |
| type `Valuation` → | supprimé (et toutes ses arêtes) |
| relation `has_signal` → | `raises_signal` |
| relation `renames` → | supprimée (0 sémantique v2.0) |
| relation `valued_by` → | supprimée |
| préfixe `mun-` / `municipality-` / `muni-` (Municipality) → | `muni-` |
| préfixe `src-` (Source) → | `source-` |
| préfixe `sig-` (Signal) → | `signal-` |
| préfixe `de-`/`designation-`/`evt-`/`desig-`/`devent-`/`designationEvent-` → | `event-` |
| préfixe `constr-` (Constraint) → | `constraint-` |
| préfixe `adr-`/`addr-` (Adresse) → | `adresse-` |
| séparateur `:` dans les ids → | `-` |
| clé ville `ville`/`city`/`citySlug` → | `municipality` |
| clé date `generated`/`generatedAt` → | `generated_at` |
| clé PV `pvCount` → | `pv_count` |

---

## 10. Contrôle de qualité post-re-graphify

Avant de projeter une ville dans PG, vérifier :

```bash
# Vérification structure basique (jq)
jq '
  .ontology_version == "2.0"
  and (.nodes | type) == "array"
  and (.edges | type) == "array"
  and (.municipality | type) == "string"
' graph/<slug>/latest.json

# Compter les types de nœuds (doit n'afficher que les 9 types canoniques)
jq '[.nodes[].type] | group_by(.) | map({type: .[0], count: length})' \
  graph/<slug>/latest.json

# Vérifier l'absence de variantes bannies dans les arêtes
jq '.edges[] | select(has("from") or has("to") or has("src") or has("tgt")
  or has("relation") or has("rel") or has("evidence"))' \
  graph/<slug>/latest.json
# → doit retourner vide

# Vérifier les préfixes d'id
jq '.nodes[] | .id' graph/<slug>/latest.json | \
  grep -vE '^"(muni|source|bylaw|zone|event|signal|lot|adresse|constraint)-'
# → doit retourner vide
```

---

## 11. Références

- Contrat de sortie normatif : `radar/ontology/graphify-output-contract.md`
- Ontologie v2.0 : `radar/ontology/ontology-profile.yaml`
- Script de projection SCW→PG : `api/src/scripts/project-graph-from-s3.ts`
- Tables PG : `graph_nodes`, `graph_edges` (upsert via `upsertGraph`)
- Analyse empirique : `/tmp/onto-analyse/` (non commitée, référence de travail)
