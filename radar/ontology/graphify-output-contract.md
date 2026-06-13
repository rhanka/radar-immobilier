# Contrat de sortie graphify — ontologie canonique v2.0

> **Statut : NORMATIF.**  
> Tout graphe produit par graphify (re-graphify ou nouvelle ville) DOIT se conformer
> à ce contrat. Toute variante listée en section [INTERDIT](#interdit--variantes-bannies)
> est invalide et doit être corrigée avant ingestion dans le pipeline SCW→PG.

---

## 1. Structure top-level du fichier `latest.json`

```json
{
  "municipality":     "<slug-kebab-case>",
  "generated_at":    "<ISO-8601>",
  "ontology_version": "2.0",
  "pv_count":        <entier>,
  "nodes":           [ ... ],
  "edges":           [ ... ]
}
```

| Champ             | Type     | Règle                                                     |
|-------------------|----------|-----------------------------------------------------------|
| `municipality`    | string   | Slug kebab-case de la ville (ex : `saint-constant`)       |
| `generated_at`    | string   | ISO-8601, ex : `2026-06-12T14:23:00Z`                    |
| `ontology_version`| string   | **Toujours `"2.0"`** pour les graphes v2.0               |
| `pv_count`        | integer  | Nombre de PVs traités                                     |
| `nodes`           | array    | Liste de nœuds (peut être vide `[]`)                      |
| `edges`           | array    | Liste d'arêtes (peut être vide `[]`)                      |

---

## 2. Schéma de nœud

```json
{
  "id":         "<prefixe>-<ville-slug>-<identifiant>",
  "type":       "<NodeType>",
  "label":      "<texte libre>",
  "properties": {
    "<clé>": "<valeur>"
  }
}
```

| Champ        | Type   | Règle                                                                 |
|--------------|--------|-----------------------------------------------------------------------|
| `id`         | string | Préfixe figé + slug ville + identifiant local (voir table préfixes)  |
| `type`       | string | L'un des 9 types canoniques (voir section 4)                         |
| `label`      | string | Libellé lisible humain — **obligatoire, non vide**                    |
| `properties` | object | Toutes les propriétés métier — **jamais à plat sur le nœud**         |

Champs optionnels directement sur le nœud (legacy toléré, ne pas créer) : `status`, `description`.

---

## 3. Schéma d'arête

```json
{
  "source": "<nodeId>",
  "target": "<nodeId>",
  "type":   "<relation>",
  "refs":   [
    { "docSha": "<sha256-hex>", "page": <entier> }
  ]
}
```

| Champ    | Type   | Règle                                                                              |
|----------|--------|------------------------------------------------------------------------------------|
| `source` | string | `id` du nœud source                                                               |
| `target` | string | `id` du nœud cible                                                                |
| `type`   | string | L'une des 25 relations canoniques (voir `ontology-profile.yaml`)                  |
| `refs`   | array  | Preuves documentaires — **liste vide `[]` si aucune preuve, jamais absent**       |

Chaque élément de `refs` :

| Champ    | Type    | Règle                              |
|----------|---------|------------------------------------|
| `docSha` | string  | SHA-256 hex du fichier source      |
| `page`   | integer | Numéro de page (≥ 1)               |

---

## 4. Table des préfixes d'id de nœud

| Type canonique    | Préfixe IMPOSÉ | Exemple d'id                               |
|-------------------|----------------|--------------------------------------------|
| `Municipality`    | `muni`         | `muni-saint-constant`                      |
| `Source`          | `source`       | `source-saint-constant-2026-04-05`         |
| `Bylaw`           | `bylaw`        | `bylaw-saint-constant-Z-2026-042`          |
| `Zone`            | `zone`         | `zone-saint-constant-RA`                   |
| `DesignationEvent`| `event`        | `event-saint-constant-rezonage-2026-04-01` |
| `Signal`          | `signal`       | `signal-saint-constant-rezonage-RA-RB`     |
| `Lot`             | `lot`          | `lot-saint-constant-3456789`               |
| `Adresse`         | `adresse`      | `adresse-saint-constant-123-rue-du-moulin` |
| `Constraint`      | `constraint`   | `constraint-saint-constant-cptaq-2026-003` |

**Règle de format :** `<prefixe>-<ville-slug>-<identifiant-local>` — séparateur **`-`** uniquement.  
Pas de `:` dans les ids v2.0. Pas d'autre préfixe que ceux listés ci-dessus.

---

## 5. Exemple complet réaliste

Scénario : ville de Saint-Constant — rezonage d'un lot de résidentiel (RA) vers résidentiel dense (RB).

```json
{
  "municipality":     "saint-constant",
  "generated_at":    "2026-04-15T10:00:00Z",
  "ontology_version": "2.0",
  "pv_count":        3,
  "nodes": [
    {
      "id":    "muni-saint-constant",
      "type":  "Municipality",
      "label": "Saint-Constant",
      "properties": {
        "slug": "saint-constant",
        "mrc":  "Roussillon",
        "province": "QC"
      }
    },
    {
      "id":    "source-saint-constant-pv-2026-04-01",
      "type":  "Source",
      "label": "PV Conseil municipal 2026-04-01 — Saint-Constant",
      "properties": {
        "docSha":     "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        "date":       "2026-04-01",
        "municipality": "saint-constant",
        "sourceKind": "pv",
        "format":     "pdf"
      }
    },
    {
      "id":    "bylaw-saint-constant-Z-2026-042",
      "type":  "Bylaw",
      "label": "Règlement Z-2026-042 — Modification zonage secteur nord",
      "properties": {
        "numero":       "Z-2026-042",
        "date":         "2026-04-01",
        "municipality": "saint-constant",
        "status":       "en_vigueur",
        "stage":        "adoption",
        "resolution":   "2026-04-120",
        "docSha":       "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
      }
    },
    {
      "id":    "bylaw-saint-constant-Z-2019-011",
      "type":  "Bylaw",
      "label": "Règlement Z-2019-011 — Zonage général (modifié)",
      "properties": {
        "numero":       "Z-2019-011",
        "date":         "2019-09-03",
        "municipality": "saint-constant",
        "status":       "en_vigueur"
      }
    },
    {
      "id":    "zone-saint-constant-RA",
      "type":  "Zone",
      "label": "Zone RA — Résidentiel faible densité",
      "properties": {
        "code":         "RA",
        "municipality": "saint-constant",
        "usage":        "residentiel_faible_densite",
        "bylaw":        "Z-2019-011"
      }
    },
    {
      "id":    "zone-saint-constant-RB",
      "type":  "Zone",
      "label": "Zone RB — Résidentiel moyenne densité",
      "properties": {
        "code":         "RB",
        "municipality": "saint-constant",
        "usage":        "residentiel_moyenne_densite",
        "bylaw":        "Z-2026-042"
      }
    },
    {
      "id":    "lot-saint-constant-4567890",
      "type":  "Lot",
      "label": "Lot 4567890 — Saint-Constant",
      "properties": {
        "lotNumber":    "4567890",
        "municipality": "saint-constant",
        "superficie_m2": 1200,
        "usage":        "residentiel"
      }
    },
    {
      "id":    "event-saint-constant-rezonage-2026-04-01",
      "type":  "DesignationEvent",
      "label": "Rezonage lot 4567890 : RA → RB (résolution 2026-04-120)",
      "properties": {
        "date":         "2026-04-01",
        "meetingDate":  "2026-04-01",
        "decision":     "approuvé",
        "kind":         "rezonage",
        "municipality": "saint-constant",
        "resolution":   "2026-04-120",
        "docSha":       "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
      }
    },
    {
      "id":    "signal-saint-constant-rezonage-ra-rb",
      "type":  "Signal",
      "label": "Signal : rezonage RA→RB densification secteur nord",
      "properties": {
        "category":     "rezonage",
        "kind":         "densification",
        "date":         "2026-04-01",
        "municipality": "saint-constant",
        "status":       "candidate",
        "intensite":    "haute",
        "nb_unites_min": 8,
        "nb_unites_max": 24
      }
    }
  ],
  "edges": [
    {
      "source": "zone-saint-constant-RA",
      "target": "muni-saint-constant",
      "type":   "located_in",
      "refs":   []
    },
    {
      "source": "zone-saint-constant-RB",
      "target": "muni-saint-constant",
      "type":   "located_in",
      "refs":   []
    },
    {
      "source": "lot-saint-constant-4567890",
      "target": "muni-saint-constant",
      "type":   "located_in",
      "refs":   []
    },
    {
      "source": "bylaw-saint-constant-Z-2026-042",
      "target": "bylaw-saint-constant-Z-2019-011",
      "type":   "amends",
      "refs":   [
        { "docSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "page": 2 }
      ]
    },
    {
      "source": "event-saint-constant-rezonage-2026-04-01",
      "target": "zone-saint-constant-RB",
      "type":   "rezones",
      "refs":   [
        { "docSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "page": 5 }
      ]
    },
    {
      "source": "event-saint-constant-rezonage-2026-04-01",
      "target": "lot-saint-constant-4567890",
      "type":   "targets_lot",
      "refs":   [
        { "docSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "page": 5 }
      ]
    },
    {
      "source": "event-saint-constant-rezonage-2026-04-01",
      "target": "signal-saint-constant-rezonage-ra-rb",
      "type":   "raises_signal",
      "refs":   [
        { "docSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "page": 5 }
      ]
    },
    {
      "source": "source-saint-constant-pv-2026-04-01",
      "target": "event-saint-constant-rezonage-2026-04-01",
      "type":   "supports",
      "refs":   [
        { "docSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "page": 5 }
      ]
    },
    {
      "source": "bylaw-saint-constant-Z-2026-042",
      "target": "source-saint-constant-pv-2026-04-01",
      "type":   "derived_from",
      "refs":   [
        { "docSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "page": 2 }
      ]
    },
    {
      "source": "zone-saint-constant-RA",
      "target": "bylaw-saint-constant-Z-2019-011",
      "type":   "governed_by",
      "refs":   [
        { "docSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "page": 1 }
      ]
    }
  ]
}
```

---

## 6. INTERDIT — variantes bannies

Les variantes suivantes ont été observées dans le corpus v1 et sont **bannies** en v2.0.
Chaque occurrence doit être normalisée lors du re-graphify.

### 6.1 Endpoints d'arête : `from`/`to` et `src`/`tgt`

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| `"from": "<id>"` sur une arête | `"source": "<id>"` |
| `"to": "<id>"` sur une arête | `"target": "<id>"` |
| `"src": "<id>"` sur une arête | `"source": "<id>"` |
| `"tgt": "<id>"` sur une arête | `"target": "<id>"` |

**Exemple banni :**
```json
{"from": "src-97f7b73e", "rel": "mentions", "to": "bylaw-227-2026"}
```
**Forme correcte :**
```json
{"source": "source-armagh-97f7b73e", "type": "mentions", "target": "bylaw-armagh-227-2026", "refs": []}
```

---

### 6.2 Champ de relation : `relation` et `rel`

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| `"relation": "<type>"` sur une arête | `"type": "<type>"` |
| `"rel": "<type>"` sur une arête | `"type": "<type>"` |

**Exemple banni :**
```json
{"source": "bylaw-...", "relation": "amends", "target": "bylaw-..."}
```
**Forme correcte :**
```json
{"source": "bylaw-...", "type": "amends", "target": "bylaw-...", "refs": []}
```

---

### 6.3 Conteneur d'arêtes : `relations`

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| Clé top-level `"relations": [...]` | `"edges": [...]` |

**Exemple banni :**
```json
{"municipality": "saint-bruno-de-montarville", "relations": [...]}
```
**Forme correcte :**
```json
{"municipality": "saint-bruno-de-montarville", "edges": [...]}
```

---

### 6.4 Champ de preuve : `evidence` au lieu de `refs`

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| `"evidence": "Résolution 2026-646"` (string) | `"refs": [{"docSha": "...", "page": <n>}]` |
| `"evidence": {"resolution": "...", "quote": "..."}` (objet) | `"refs": [{"docSha": "...", "page": <n>}]` |

Si le `docSha` n'est pas disponible, utiliser `"refs": []` (liste vide) — **jamais le champ `evidence`**.

---

### 6.5 `refs` en liste de strings

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| `"refs": ["R 2026-03-050", "R 2026-04-080"]` | `"refs": [{"docSha": "...", "page": <n>}]` |

Les strings de résolution doivent aller dans `properties.resolutionRef` du nœud concerné,
pas dans `refs` de l'arête.

---

### 6.6 Propriétés à plat (`props` au lieu de `properties`)

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| `"props": { "mrc": "..." }` sur un nœud | `"properties": { "mrc": "..." }` |
| Propriété métier directement à plat sur le nœud | Dans `"properties": { ... }` |

**Exemple banni :**
```json
{"id": "mun:saint-jean-sur-richelieu", "type": "Municipality", "mrc": "Haut-Richelieu"}
```
**Forme correcte :**
```json
{"id": "muni-saint-jean-sur-richelieu", "type": "Municipality", "label": "Saint-Jean-sur-Richelieu",
 "properties": {"mrc": "Haut-Richelieu"}}
```

---

### 6.7 Préfixes d'id ad-hoc

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| `mun-`, `municipality-` pour Municipality | `muni-` |
| `src-` pour Source | `source-` |
| `sig-` pour Signal | `signal-` |
| `de-`, `designation-`, `evt-`, `desig-`, `devent-`, `designationEvent-` pour DesignationEvent | `event-` |
| `constr-` pour Constraint | `constraint-` |
| `adr-`, `addr-` pour Adresse | `adresse-` |
| Préfixe `signal-` sur un nœud `Bylaw`, `Zone` ou `Constraint` | Préfixe canonique du type réel |
| Préfixe absent (`__none__`) | Préfixe canonique obligatoire |
| Nom de ville comme préfixe d'id (ex: `drummondville-...`) | `<prefixe_type>-<ville-slug>-<id_local>` |

---

### 6.8 Séparateur `:` dans les ids

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| `bylaw:saint-constant:Z-2026-042` (`:` comme séparateur de segments d'id) | `bylaw-saint-constant-Z-2026-042` |

Le séparateur canonique dans les ids est **`-`** (tiret). Le `:` est banni.

---

### 6.9 Clés top-level alternatives

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| `"ville": "<slug>"` | `"municipality": "<slug>"` |
| `"city": "<slug>"` | `"municipality": "<slug>"` |
| `"citySlug": "<slug>"` | `"municipality": "<slug>"` |
| `"generated": "<date>"` | `"generated_at": "<ISO-8601>"` |
| `"generatedAt": "<date>"` | `"generated_at": "<ISO-8601>"` |
| `"pvCount": <n>` | `"pv_count": <n>` |
| Absence de `"ontology_version"` | `"ontology_version": "2.0"` obligatoire |

---

### 6.10 Types de nœuds supprimés

| Type banni | Action de migration |
|------------|---------------------|
| `Address` (anglais) | Remplacer par `Adresse` avec préfixe `adresse-` |
| `Document` | Remplacer par `Source` avec préfixe `source-` |
| `Valuation` | Supprimer le nœud et toutes ses arêtes (`valued_by`, etc.) |

---

### 6.11 Relation `has_signal` (synonyme consolidé)

| Variante bannie | Forme correcte v2.0 |
|-----------------|----------------------|
| `"type": "has_signal"` | `"type": "raises_signal"` |

`has_signal` était émis par 7 villes (530 arêtes). En v2.0, c'est un synonyme consolidé de `raises_signal`.

---

### 6.12 Fichiers ad-hoc sans `nodes`

Les 60 fichiers `latest.json` sans tableau `nodes` (pattern `keyBylaws`/`keyDerogations`/`summary`/
`key_signals`/`signalsByKind`) sont **invalides** au format v2.0. Ils doivent être re-graphifiés
depuis les fichiers `raw/` correspondants.

---

## 7. Règles de validation résumées

Un graphe v2.0 est valide si et seulement si :

1. `ontology_version` est présent et vaut `"2.0"`.
2. Tous les champs top-level obligatoires (`municipality`, `generated_at`, `pv_count`, `nodes`, `edges`) sont présents.
3. Chaque nœud a : `id` (préfixe canonique), `type` (l'un des 9), `label` non vide, `properties` (objet).
4. Chaque arête a : `source`, `target`, `type` (l'une des 25 relations), `refs` (array, peut être vide).
5. Chaque élément de `refs` a : `docSha` (string), `page` (entier ≥ 1).
6. Aucune variante bannie des sections 6.1 à 6.12 n'est présente.
