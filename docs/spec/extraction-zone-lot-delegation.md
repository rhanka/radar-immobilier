# Re-graphify legacy OBSOLÈTE — extraction structurée zone_ref / no_lot / reglement_number
# Package de délégation pour `claude:immo_subagents`

> **Statut : DÉLÉGATION PRÊTE.**
> Ce document est le brief H2A complet pour déléguer à `claude:immo_subagents`
> le re-graphify des villes M–Z (tranche immo) afin de peupler les champs
> `zone_ref`, `no_lot` et `reglement_number` sur les nœuds Signal et DesignationEvent.
> Le conducteur (`claude:radar_conductor`) envoie ce texte via `h2a_offer`.
> Il NE doit PAS projeter PG lui-même — c'est le conducteur qui orchestrera la projection.

---

## 1. Décision de design : PROP, pas entité

**Décision : `zone_ref`, `no_lot`, `reglement_number` sont des PROPRIÉTÉS dans
`properties{}` des nœuds Signal et DesignationEvent — PAS des entités ni des arêtes.**

Justification :

1. **Rétro-compatibilité.** Les 522 villes ont des graphes v2.1. Ajouter une prop ne casse
   aucun schéma d'arête. Les arêtes `targets_lot` / `targets_zone` / `concerns` restent la
   façon canonique de lier Signal → Lot/Zone ; les nouvelles props sont un raccourci
   structuré pour le mapper géo (jointure directe, sans parsing regex).

2. **Levier geo-mapper.** Le mapper (`api/src/services/geo/extract-refs.ts`) extrait
   actuellement zone/lot par regex sur texte libre. Avec les props structurées, il fait
   une jointure directe : `zones.code_norm = normalize(signal.properties.zone_ref)`.
   Taux de résolution attendu : **~70–85 %** (vs ~30 % regex).

3. **Précédent ontologique.** `etape`, `etape_date`, `intensite`, `nb_unites_min` suivent
   déjà ce pattern de prop directe.

4. **Loi 25.** Les trois champs sont des données réglementaires publiques (zonage, cadastre,
   règlements municipaux). Aucune PII — pas de nom de propriétaire.

---

## 2. Champs legacy OBSOLÈTE — définitions et règles d'extraction

### 2.1 `zone_ref` — code de zone officiel

| Attribut | Valeur |
|----------|--------|
| Champ | `properties.zone_ref` |
| Type | string |
| Applicable à | Signal, DesignationEvent |
| Quand peupler | PV cite EXPLICITEMENT un code de zone (ex : "zone H-431", "zonée C-512") |
| Format | Brut tel que dans le PV (ne pas normaliser) |
| Exemples | `"H-431"`, `"C-512"`, `"H34-327 (VLO)"`, `"RU1302"`, `"A1336"`, `"1000"` |
| Anti-invention | Si le texte ne cite pas de code de zone → **champ OMIS** (ni null, ni "") |

**Exemples de textes PV et résultats :**

| Texte extrait du PV | `zone_ref` | Note |
|---------------------|------------|------|
| « Rezonage du lot 4 567 890 de la zone H-431 vers C-512 » | `"H-431"` | Zone source citée |
| « Modification zonage en zone C-512 — secteur commercial » | `"C-512"` | Zone cible citée |
| « Dérogation mineure — marges de recul, secteur nord » | *(omis)* | Pas de code de zone |
| « PIIA approuvé — 12 rue Principale, zone H34-327 (VLO) » | `"H34-327 (VLO)"` | Format Longueuil |
| « Rezonage secteur résidentiel vers zone commerciale » | *(omis)* | "zone commerciale" = description, pas code |
| « Rezonage zone 1000 vers zone 2000 » | `"1000"` | Format Saguenay numérique |

### 2.2 `no_lot` — numéro de lot cadastral

| Attribut | Valeur |
|----------|--------|
| Champ | `properties.no_lot` |
| Type | string (chiffres uniquement après normalisation) |
| Applicable à | Signal, DesignationEvent |
| Quand peupler | PV cite EXPLICITEMENT "lot XXXXXXX" ou "lot X XXX XXX" |
| Normalisation | Supprimer les espaces et tirets — conserver uniquement les chiffres |
| Longueur | 7–10 chiffres |
| Exemples | `"6057912"`, `"3819015"`, `"4567890"` |
| Anti-invention | Si le texte ne mentionne pas de numéro de lot → **champ OMIS** |

**Exemples :**

| Texte extrait du PV | `no_lot` | Note |
|---------------------|----------|------|
| « Subdivision du lot 4 567 890 en deux lots » | `"4567890"` | Espaces supprimés |
| « Dérogation mineure — lot 3 819 015 — marges de recul » | `"3819015"` | Présent |
| « Rezonage — résolution 2026-04-120 » | *(omis)* | Pas de numéro de lot |
| « Construction de 8 logements sur le lot 6057912 » | `"6057912"` | Présent |
| « Approbation article 6.2 du règlement » | *(omis)* | 6.2 = article, pas lot |

### 2.3 `reglement_number` — numéro de règlement

| Attribut | Valeur |
|----------|--------|
| Champ | `properties.reglement_number` |
| Type | string |
| Applicable à | Signal, DesignationEvent |
| Quand peupler | PV cite un numéro de règlement ET ce numéro n'est pas déjà dans un nœud Bylaw lié |
| Format | Brut tel que dans le PV |
| Exemples | `"Z-2026-042"`, `"450-2023"`, `"RZ-2024-012"`, `"No 450-2023"` |
| Anti-invention | Si le texte ne cite pas de numéro de règlement → **champ OMIS** |

**Exemples :**

| Texte extrait du PV | `reglement_number` | Note |
|---------------------|-------------------|------|
| « Avis de motion — projet de règlement Z-2026-042 » | `"Z-2026-042"` | Numéro explicite |
| « Adoption du règlement de zonage no 450-2023 » | `"450-2023"` | Présent |
| « Dérogation mineure — résolution 2026-04-095 » | *(omis)* | C'est un no de résolution, pas règlement |
| « Modification du règlement RZ-2024-012 » | `"RZ-2024-012"` | Présent |

---

## 3. Règle ANTI-INVENTION — absolue

> **Un champ absent du texte du PV NE DOIT JAMAIS être inventé, estimé ou inféré.**

- `zone_ref: null` → **INTERDIT**
- `zone_ref: ""` → **INTERDIT**
- `zone_ref: "inconnu"` → **INTERDIT**
- **Correct** : ne pas inclure la clé `zone_ref` dans `properties`.

Cette règle s'applique identiquement à `no_lot` et `reglement_number`.

Ne jamais déduire un code de zone depuis une description textuelle
(ex : "secteur résidentiel nord" → ne pas inventer "H-431").

---

## 4. Package de délégation H2A — brief pour `claude:immo_subagents`

> Ce texte est le corps du message H2A à envoyer. Le conducteur peut le copier
> tel quel dans `h2a_offer` → `claude:immo_subagents`.

---

**OBJET : RE-GRAPHIFY LEGACY OBSOLÈTE — extraction structurée zone_ref / no_lot / reglement_number (villes M–Z)**

Bonjour `claude:immo_subagents`,

**Mission :** Re-graphifier les villes de ta tranche (M–Z, ~231 villes) pour extraire
et peupler les champs `zone_ref`, `no_lot` et `reglement_number` sur chaque nœud
Signal et DesignationEvent. Ces champs alimentent le mapper géo (résolution ~70–85 %
vs ~30 % avec regex post-hoc).

**Ontologie de référence :** `radar/ontology/ontology-profile.yaml` legacy OBSOLÈTE (branche
`feat/ontology-legacy OBSOLÈTE-extraction`). Tu dois lire ce profil avant de lancer graphify.
La `ontology_version` de sortie doit être `"2.2"`.

**Contrat de sortie :** `radar/ontology/graphify-output-contract.md` §9 (champs legacy OBSOLÈTE).

**Directive d'extraction :**

Pour chaque Signal et DesignationEvent, lire le texte du PV source et :

1. Si le texte cite EXPLICITEMENT un code de zone (format lettre+chiffres+tiret ou
   numérique pur "zone 1000") → peupler `properties.zone_ref` avec la valeur brute.
2. Si le texte cite EXPLICITEMENT un numéro de lot ("lot X XXX XXX") → peupler
   `properties.no_lot` avec les chiffres uniquement (espaces supprimés).
3. Si le texte cite EXPLICITEMENT un numéro de règlement ("règlement Z-2026-042") ET
   qu'aucun nœud Bylaw lié ne le porte déjà → peupler `properties.reglement_number`.
4. Si l'une de ces valeurs est absente du texte → NE PAS inclure la clé (ni null, ni "").

**Règle ANTI-INVENTION absolue** : ces champs ne sont jamais inférés ou estimés.
Un champ absent du texte = clé absente de `properties`. Zéro exception.

**Conservation des champs v2.1** : les champs `etape` et `etape_date` doivent rester
présents (non écrasés) sur les nœuds qui les portaient déjà depuis le re-graphify v2.1.

**Périmètre :** tranche M–Z de la directive `radar/ontology/regraphify-directive.md` §4.
Soit les villes dont le slug normalisé (sans accents, kebab-case) commence par m–z.
~231 villes.

**Découpage en lots recommandé (contrainte OOM : sériel, pas parallèle) :**

| Lot | Tranche | ~Nb villes | Commentaire |
|-----|---------|------------|-------------|
| 1 | m* | ~45 | mont-*, municipalites-m |
| 2 | n*, o* | ~35 | notre-dame-* (priorité), ogden, orford |
| 3 | p*, q*, r* | ~40 | parisville, rosemere, roxton-pond (priorité) |
| 4 | s* | ~70 | saint-*, sainte-*, sep-iles, sherbrooke |
| 5 | t*, u*, v*, w*, x*, y*, z* | ~41 | terrebonne, thetford, trois-rivieres… |

Travailler chaque lot en séquentiel (un seul `graphify run` à la fois) pour éviter OOM.

**Même remarque pour le codex (tranche A–L) :** le conducteur enverra un brief miroir
à `claude:codex_subagents` pour les villes A–L.

**Critères d'acceptation par lot :**

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

# Gate 3 : aucun no_lot invalide (si présent → chiffres uniquement, 7–10 digits)
jq '[.nodes[]
     | select(.type == "Signal" or .type == "DesignationEvent")
     | select(.properties.no_lot != null)
     | select(.properties.no_lot | test("^[0-9]{7,10}$") | not)
     | .id] | length == 0' graph/<slug>/latest.json
# → true

# Gate 4 (informatif) : rapport de couverture zone_ref et no_lot
jq '
  (.nodes | map(select(.type == "Signal" or .type == "DesignationEvent"))) as $sde |
  {
    total:     ($sde | length),
    avec_zone: ($sde | map(select(.properties.zone_ref != null)) | length),
    avec_lot:  ($sde | map(select(.properties.no_lot != null)) | length)
  }
' graph/<slug>/latest.json
# → rapport informatif (pas de seuil bloquant — la couverture dépend du texte)
```

Gates 1, 2, 3 sont **bloquants** (must be true avant upload SCW).
Gate 4 est informatif — reporter les chiffres dans le rapport de lot.

**Upload SCW obligatoire** après chaque lot validé :

```bash
# Upload du graphe vers SCW (bucket radar-immobilier)
aws s3 cp graph/<slug>/latest.json \
  s3://radar-immobilier/graph/<slug>/latest.json \
  --endpoint-url $SCW_ENDPOINT
```

**NE PAS projeter PG.** Le conducteur orchestrera la projection après validation
des gates sur l'ensemble des lots A–Z.

**Rapport de lot attendu :**

- Slug des villes traitées.
- Nb de Signal/DesignationEvent avec `zone_ref` présent vs total.
- Nb de Signal/DesignationEvent avec `no_lot` présent vs total.
- Nb de villes où les 3 gates bloquants sont `true`.
- Toute anomalie (ville sans Signal, gate false, erreur graphify).

Merci.

---

## 5. Critères d'acceptation globaux (conducteur)

Avant de lancer la projection PG, le conducteur valide :

1. **100 % des lots M–Z** ont été traités et signalés par `claude:immo_subagents`.
2. **100 % des lots A–L** ont été traités et signalés par `claude:codex_subagents`.
3. **Gates 1–3 verts** sur toutes les villes des deux tranches.
4. **Taux de couverture zone_ref ≥ 10 %** sur l'ensemble (sanity check minimal ;
   certains PVs ne citent aucun code de zone — un taux faible n'est pas anormal).
5. Pas de `zone_ref: null` ni `zone_ref: ""` dans aucun graphe.

## 6. Plan de validation post-projection (conducteur)

```sql
-- 6.1 Couverture zone_ref / no_lot (spot-check)
SELECT
  COUNT(*) FILTER (WHERE props->'properties'->>'zone_ref' IS NOT NULL
                     AND props->'properties'->>'zone_ref' != '') AS avec_zone_ref,
  COUNT(*) FILTER (WHERE props->'properties'->>'no_lot' IS NOT NULL
                     AND props->'properties'->>'no_lot' != '') AS avec_no_lot,
  COUNT(*) AS total
FROM graph_nodes
WHERE type IN ('Signal','DesignationEvent');

-- 6.2 Distribution des codes de zone (top 20)
SELECT props->'properties'->>'zone_ref' AS zone_ref, count(*)
FROM graph_nodes
WHERE type IN ('Signal','DesignationEvent')
  AND props->'properties'->>'zone_ref' IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- 6.3 Vérification anti-invention : aucun zone_ref vide
SELECT count(*)
FROM graph_nodes
WHERE type IN ('Signal','DesignationEvent')
  AND props->'properties'->>'zone_ref' = '';
-- → 0

-- 6.4 Taux de résolution attendu (après mapper)
-- (à lancer après le re-run du mapper une fois les graphes legacy OBSOLÈTE projetés)
SELECT
  COUNT(*) FILTER (WHERE target_type = 'Zone') AS resolus_zone,
  COUNT(*) AS total_tentatives,
  ROUND(100.0 * COUNT(*) FILTER (WHERE target_type = 'Zone')
        / NULLIF(COUNT(*), 0), 1) AS pct_resolu
FROM geo_resolutions
WHERE provenance LIKE 'structured_%';
-- → objectif ≥ 70 %
```

---

## 7. Estimation d'impact — taux de résolution

### 7.1 Situation actuelle (avant legacy OBSOLÈTE)

| Champ structuré | Remplissage sur 7 781 nœuds Signal/DesignationEvent |
|---|---|
| `zone_ref` | **1×** (quasi vide) |
| `no_lot` | **0×** |
| `reglement_number` | **0×** |

Le mapper est 100 % dépendant du regex sur texte libre → taux de résolution ~30 %.

### 7.2 Après legacy OBSOLÈTE (honnêteté sur l'estimation)

**Hypothèse de couverture graphify :**

Les PVs québécois citent explicitement un code de zone dans environ 40–60 % des
dossiers de rezonage/dérogation. Les numéros de lot sont mentionnés dans ~30–45 %
(surtout dérogations mineures, subdivisions). Les numéros de règlement sont présents
dans ~50–70 % (pipeline rezonage, avis de motion).

**Taux de résolution mapper estimé après legacy OBSOLÈTE :**

| Dimension | Taux estimé | Condition |
|-----------|-------------|-----------|
| Résolution zone via `zone_ref` | **60–75 %** des nœuds où la couche vectorielle est disponible | Code de zone présent dans PV + couche zonage ArcGIS/CKAN disponible |
| Résolution zone via regex (fallback) | +10–15 % supplémentaires | Sur nœuds sans `zone_ref` mais avec code dans le texte libre |
| Résolution lot via `no_lot` | **30–50 %** des nœuds avec mention de lot | Cadastre allégé disponible province-entière |
| **Résolution globale (zone)** | **~70–85 %** | Pour les ~15–250 villes avec couche vectorielle disponible |
| Résolution globale toutes villes | **< 30 %** | Villes sans couche vectorielle (~850 villes PDF/JMap) |

**Conclusion :** legacy OBSOLÈTE permettra au mapper de passer de ~30 % à ~70–85 % de résolution
pour les villes avec couche géo vectorielle. La limite principale reste la disponibilité
des couches géo, pas la qualité de l'extraction.

---

## 8. Références

- Profil ontologie legacy OBSOLÈTE : `radar/ontology/ontology-profile.yaml`
- Contrat de sortie legacy OBSOLÈTE : `radar/ontology/graphify-output-contract.md` §9
- Directive re-graphify : `radar/ontology/regraphify-directive.md`
- Mapper géo : `api/src/services/geo/extract-refs.ts` + `api/src/services/geo/resolve-refs.ts`
- Cadrage geo-intégration : `docs/spec/cadrage-geo-integration-mapper.md` §2.5
- Brief v2.1 (précédent) : `docs/spec/etape-anticipation-delegation.md`
- Partition villes codex/immo : `radar/ontology/regraphify-directive.md` §4
- Mémoire OOM : `agents-need-worktree-isolation.md` + `oom-parallel-test-stacks.md`
  → travailler EN SÉQUENTIEL, un lot à la fois
