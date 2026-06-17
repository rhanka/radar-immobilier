# Contrat de sortie graphify — ontologie canonique v2.2

> **Statut : NORMATIF.**  
> Tout graphe produit par graphify (re-graphify ou nouvelle ville) DOIT se conformer
> à ce contrat. Toute variante listée en section [INTERDIT](#interdit--variantes-bannies)
> est invalide et doit être corrigée avant ingestion dans le pipeline SCW→PG.
>
> **v2.1** (2026-06-14) : ajout des champs `etape` + `etape_date` sur Signal et
> DesignationEvent pour l'axe ANTICIPATION du scoring. Voir §8.
>
> **v2.2** (2026-06-15) : ajout des champs `zone_ref`, `no_lot`, `reglement_number`
> sur Signal et DesignationEvent pour alimenter le mapper géo (résolution ~70–85 % vs
> ~30 % avec regex post-hoc). Champs OPTIONNELS — jamais inventés. Voir §9.

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
| `ontology_version`| string   | **`"2.0"`** pour graphes v2.0 ; **`"2.1"`** pour graphes v2.1 (avec `etape`) |
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

Un graphe v2.1 est valide si les règles ci-dessus sont satisfaites ET :

7. `ontology_version` vaut `"2.1"`.
8. Tout Signal et DesignationEvent portant un dossier de rezonage / instrument à résolution
   a un champ `etape` dont la valeur appartient à l'enum v2.1 (voir §8).
9. Si `etape` est présent, `etape_date` est présent et valide (format YYYY-MM-DD).

Un graphe v2.2 est valide si les règles v2.1 sont satisfaites ET :

10. `ontology_version` vaut `"2.2"`.
11. Les champs `zone_ref`, `no_lot`, `reglement_number` — quand présents — respectent les
    formats définis en §9 (pas de valeur vide `""`, pas de valeur `null` — utiliser l'absence
    de clé si la donnée est absente du PV).
12. Règle anti-invention : aucun Signal/DesignationEvent n'a un `zone_ref`, `no_lot` ou
    `reglement_number` inventé ou déduit par inférence hors-texte.

---

## 8. Champs v2.1 — Axe ANTICIPATION : `etape` + `etape_date`

### 8.1 Contexte

L'axe ANTICIPATION du scoring radar mesure à quelle étape du processus réglementaire
en est un dossier. Plus l'étape est précoce, plus l'avantage concurrentiel de l'analyste
est grand. Ces champs sont ajoutés aux propriétés de **Signal** et **DesignationEvent**.

### 8.2 Enum `etape` — valeurs autorisées

**Pipeline complet** (rezonage / modification réglementaire — ordre anticipation décroissante) :

| Valeur                 | Définition                                                                 | Score anticipation |
|------------------------|----------------------------------------------------------------------------|--------------------|
| `avis_motion`          | Intention annoncée avant tout texte formel (avant le 1er projet)           | MAX (5)            |
| `projet_reglement`     | Premier projet de règlement adopté en séance                               | 4                  |
| `consultation_publique`| Assemblée ou consultation publique tenue (LAU art. 123)                    | 3                  |
| `second_projet`        | Second projet adopté (règlements susceptibles d'approbation référendaire)  | 2                  |
| `adoption`             | Vote final — règlement adopté                                              | 1                  |
| `entree_vigueur`       | Certificat de conformité MRC reçu ; règlement opposable                    | 0                  |

**Instruments à résolution autonome** (ne s'inscrivent pas dans le pipeline complet) :

| Valeur               | Définition                                              |
|----------------------|---------------------------------------------------------|
| `derogation_mineure` | Dérogation mineure (LAU art. 145.1)                     |
| `piia`               | Plan d'implantation et d'intégration architecturale     |
| `ppcmoi`             | Projet particulier (LAU art. 145.36)                    |
| `usage_conditionnel` | Permis d'usage conditionnel (LAU art. 145.5.1)         |

**Valeur par défaut** si l'étape ne peut pas être déterminée : `inconnu`.

### 8.3 Champ `etape_date`

- Type : `string`, format `date` (ISO-8601, YYYY-MM-DD).
- Valeur : date à laquelle l'étape a été franchie, extraite du PV source.
- Obligatoire si `etape` est présent et différent de `inconnu`.
- Absent ou `null` si `etape` vaut `inconnu`.

### 8.4 Règle de priorité (plusieurs étapes dans un PV)

Quand un PV mentionne plusieurs étapes d'un même dossier dans la même séance
(ex. « avis de motion et dépôt du premier projet de règlement »), retenir l'étape
**la plus précoce** dans l'ordre du pipeline complet.

### 8.5 Exemple

```json
{
  "id":    "signal-saint-constant-rezonage-ra-rb",
  "type":  "Signal",
  "label": "Signal : rezonage RA→RB — avis de motion (2026-04-01)",
  "properties": {
    "category":    "rezonage",
    "kind":        "densification",
    "date":        "2026-04-01",
    "municipality":"saint-constant",
    "status":      "candidate",
    "intensite":   "haute",
    "nb_unites_min": 8,
    "nb_unites_max": 24,
    "etape":       "avis_motion",
    "etape_date":  "2026-04-01"
  }
}
```

### 8.6 Gate jq de validation (v2.1)

```bash
# Vérifie que tous les Signal/DesignationEvent ont un champ etape
jq '
  [.nodes[]
    | select(.type == "Signal" or .type == "DesignationEvent")
    | select(.properties.etape == null or .properties.etape == "")
  ] | length == 0
' graph/<slug>/latest.json
# → doit retourner true

# Vérifie que les valeurs d'etape appartiennent à l'enum
ETAPE_ENUM='["avis_motion","projet_reglement","consultation_publique","second_projet","adoption","entree_vigueur","derogation_mineure","piia","ppcmoi","usage_conditionnel","inconnu"]'
jq --argjson enum "$ETAPE_ENUM" '
  [.nodes[]
    | select(.type == "Signal" or .type == "DesignationEvent")
    | select(.properties.etape != null)
    | select(.properties.etape as $e | ($enum | index($e)) == null)
    | .id
  ]
' graph/<slug>/latest.json
# → doit retourner []
```

---

## 9. Champs v2.2 — Axe GÉO-RÉSOLUTION : `zone_ref` + `no_lot` + `reglement_number`

### 9.1 Contexte

Ces trois champs peuplent les données structurées à la source (dans graphify) pour que
le mapper géo (`api/src/services/geo/extract-refs.ts` + `resolve-refs.ts`) puisse
faire une simple jointure PG au lieu d'une extraction regex post-hoc sur texte libre.

Taux de résolution attendu avec ces champs peuplés : **~70–85 %** (vs ~30 % en regex seul).

### 9.2 Règles communes

| Règle | Détail |
|-------|--------|
| **Optionnel** | Les trois champs sont optionnels. Leur absence est normale pour les PVs qui n'en font pas mention. |
| **Anti-invention** | Si la valeur n'est PAS explicitement dans le texte du PV → champ OMIS (pas de `null`, pas de `""`). |
| **Pas de null ni vide** | Utiliser l'absence de clé dans `properties`. `zone_ref: null` et `zone_ref: ""` sont tous deux invalides. |
| **Loi 25** | Les trois champs sont des données réglementaires publiques. Aucune PII. |

### 9.3 Champ `zone_ref`

- **Type** : `string`
- **Contenu** : code de zone officiel tel qu'il apparaît dans le PV (format brut conservé).
- **Formats observés** : `H-431`, `C-512`, `H34-327`, `H34-327 (VLO)`, `RU1302`, `A1336`, `1000`.
- **Quand présent** : le PV cite explicitement un code de zone (pas une description textuelle vague).

### 9.4 Champ `no_lot`

- **Type** : `string`
- **Contenu** : numéro de lot cadastral, chiffres uniquement (espaces supprimés), 7–10 chiffres.
- **Exemples** : `"6057912"`, `"3819015"`, `"4567890"`.
- **Quand présent** : le PV cite explicitement "lot XXXXXXX" ou "lot X XXX XXX".

### 9.5 Champ `reglement_number`

- **Type** : `string`
- **Contenu** : numéro de règlement tel que dans le PV.
- **Exemples** : `"Z-2026-042"`, `"450-2023"`, `"RZ-2024-012"`.
- **Quand présent** : le PV cite explicitement un numéro de règlement ET ce numéro n'est pas
  déjà porté par un nœud Bylaw lié.

### 9.6 Exemple de nœud v2.2

```json
{
  "id":    "event-saint-constant-rezonage-2026-04-01",
  "type":  "DesignationEvent",
  "label": "Rezonage lot 4 567 890 : zone H-431 vers zone C-512 (règlement Z-2026-042)",
  "properties": {
    "date":            "2026-04-01",
    "meetingDate":     "2026-04-01",
    "decision":        "approuvé",
    "kind":            "rezonage",
    "municipality":    "saint-constant",
    "resolution":      "2026-04-120",
    "etape":           "adoption",
    "etape_date":      "2026-04-01",
    "zone_ref":        "H-431",
    "no_lot":          "4567890",
    "reglement_number": "Z-2026-042"
  }
}
```

Nœud sans lot ni zone mentionnés (dérogation textuelle sans code) :

```json
{
  "id":    "event-saint-constant-derogation-2026-04-02",
  "type":  "DesignationEvent",
  "label": "Dérogation mineure — agrandissement en zone agricole",
  "properties": {
    "date":        "2026-04-02",
    "meetingDate": "2026-04-02",
    "decision":    "refusé",
    "kind":        "derogation_mineure",
    "municipality":"saint-constant",
    "etape":       "derogation_mineure",
    "etape_date":  "2026-04-02",
    "outcome":     "refusee"
  }
}
```

### 9.7 Gate jq de validation (v2.2)

```bash
# Gate 1 : ontology_version = "2.2"
jq '.ontology_version == "2.2"' graph/<slug>/latest.json
# → true

# Gate 2 : aucun zone_ref vide ou null (si présent → non-vide)
jq '[.nodes[]
     | select(.type == "Signal" or .type == "DesignationEvent")
     | select(.properties.zone_ref != null)
     | select(.properties.zone_ref == "")
     | .id] | length == 0' graph/<slug>/latest.json
# → true

# Gate 3 : aucun no_lot vide ou non-numérique (si présent → chiffres uniquement)
jq '[.nodes[]
     | select(.type == "Signal" or .type == "DesignationEvent")
     | select(.properties.no_lot != null)
     | select(.properties.no_lot | test("^[0-9]{7,10}$") | not)
     | .id] | length == 0' graph/<slug>/latest.json
# → true

# Gate 4 : couverture zone_ref — taux de nœuds avec zone_ref vs total Signal/DesignationEvent
jq '
  (.nodes | map(select(.type == "Signal" or .type == "DesignationEvent"))) as $sde |
  {
    total:     ($sde | length),
    avec_zone: ($sde | map(select(.properties.zone_ref != null)) | length),
    avec_lot:  ($sde | map(select(.properties.no_lot != null)) | length)
  }
' graph/<slug>/latest.json
# → rapport informatif (pas de seuil bloquant — la couverture varie selon le texte des PVs)
```
