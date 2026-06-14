# Axe ANTICIPATION — champ `etape` : package de délégation pour claude:immo_subagents

> **Statut : DÉLÉGATION PRÊTE.**  
> Ce document est le brief H2A complet pour déléguer à `claude:immo_subagents`
> le re-graphify des villes M–Z afin de peupler les champs `etape` / `etape_date`.
> L'agent conducteur (`claude:radar_conductor`) envoie ce texte via `h2a_offer` ;
> il NE doit PAS projeter PG lui-même (c'est le conducteur qui orchestre la projection).

---

## 1. Décision de design : PROP, pas entité

**Décision : `etape` et `etape_date` sont des PROPRIÉTÉS dans `properties{}` des nœuds
Signal et DesignationEvent — PAS une nouvelle entité.**

Justification :

1. **Rétro-compatibilité.** Les 522 villes ont des graphes v2.0 avec Signal et DesignationEvent.
   Ajouter une prop ne casse aucun schéma d'arête ni aucun préfixe d'id existant.
   Ajouter une entité `Etape` impliquerait 9 nouveaux types de nœuds + N nouvelles arêtes
   `has_etape`, un migration schema PG et une adaptation de tous les validateurs.

2. **Cycle de vie simple.** Un dossier de rezonage a UNE étape courante au moment
   où le PV est rédigé. L'historique multi-étapes n'est pas dans le scope du radar
   (on ne reconstruit pas la timeline complète d'un dossier — on capte le signal
   au moment où il paraît dans le PV). Une entité n'apporterait de valeur que pour
   modéliser la progression d'un dossier document par document, ce qui est hors scope v2.1.

3. **Scoring immédiat.** Une prop `etape` dans `properties` est directement lisible
   par la couche de scoring (requête PG JSONB `props->'properties'->>'etape'`) sans
   nouvelle table ni jointure.

4. **Précédent ontologique.** `intensite`, `nb_unites_min`, `nb_unites_max`, `outcome`
   suivent déjà ce pattern. `etape` s'inscrit dans le même paradigme.

---

## 2. Enum ordonné final — `etape` v2.1

### Pipeline complet (ordre anticipation décroissante)

| Rang | Valeur                 | Mots-clés principaux dans le texte des PVs                           |
|------|------------------------|----------------------------------------------------------------------|
| 0    | `avis_motion`          | « avis de motion », « avis de motion règlement », « l'avis de motion a été déposé » |
| 1    | `projet_reglement`     | « premier projet de règlement », « 1er projet », « dépôt du projet de règlement », « projet de règlement no », « projet de règl. » |
| 2    | `consultation_publique`| « consultation publique », « assemblée publique », « avis public de consultation », « audience publique » |
| 3    | `second_projet`        | « second projet de règlement », « 2e projet », « deuxième projet », « second projet » |
| 4    | `adoption`             | « adopté », « adoptée », « règlement adopté », « adoption du règlement », « a été adopté » |
| 5    | `entree_vigueur`       | « entré en vigueur », « entrée en vigueur », « certificat de conformité MRC », « en vigueur depuis » |

### Instruments à résolution autonome

| Valeur               | Mots-clés                                                                       |
|----------------------|---------------------------------------------------------------------------------|
| `derogation_mineure` | « dérogation mineure », « déroga. mineure », « article 145.1 »                  |
| `piia`               | « PIIA », « plan d'implantation », « plan d'intégration architecturale »         |
| `ppcmoi`             | « PPCMOI », « projet particulier », « article 145.36 »                          |
| `usage_conditionnel` | « usage conditionnel », « permis conditionnel », « article 145.5.1 »            |

### Valeur par défaut

| Valeur    | Quand                                                           |
|-----------|-----------------------------------------------------------------|
| `inconnu` | Aucun mot-clé ne permet de déterminer l'étape avec confiance.  |

---

## 3. Directive d'extraction graphify

### 3.1 Principe général

Pour chaque nœud Signal ou DesignationEvent extrait d'un PV :

1. Analyser le texte du paragraphe source (passage du PV) et le `label` du nœud.
2. Identifier la ou les étapes mentionnées pour ce dossier.
3. Si plusieurs étapes du pipeline complet sont mentionnées dans le même paragraphe
   pour le même dossier, retenir **l'étape la plus précoce** (rang le plus bas).
4. Écrire la valeur dans `properties.etape` et la date d'étape dans `properties.etape_date`.
5. Si l'étape est un instrument à résolution autonome (`derogation_mineure`, `piia`,
   `ppcmoi`, `usage_conditionnel`), écrire aussi l'issue dans `properties.outcome`
   (valeurs : `accordee`, `refusee`, ou vide si non connue).

### 3.2 Exemples mappés

| Texte extrait du PV                                                                       | `etape`                | `etape_date`  | `outcome`  |
|-------------------------------------------------------------------------------------------|------------------------|---------------|------------|
| « Avis de motion — Règlement Z-2026-042 modification zonage secteur nord »                | `avis_motion`          | date séance   | —          |
| « Dépôt du premier projet de règlement 2026-042 »                                         | `projet_reglement`     | date séance   | —          |
| « Avis de motion et dépôt du projet de règlement no 2026-002 (UHA) »                     | `avis_motion`          | date séance   | —          |
| « Consultation publique tenue le 12 mai 2026 — règlement 2026-042 »                      | `consultation_publique`| 2026-05-12    | —          |
| « Second projet de règlement 2026-042 adopté »                                            | `second_projet`        | date séance   | —          |
| « Règlement Z-2026-042 adopté à l'unanimité »                                             | `adoption`             | date séance   | —          |
| « Règlement Z-2026-042 entré en vigueur — certificat MRC reçu »                          | `entree_vigueur`       | date séance   | —          |
| « Dérogation mineure accordée — lot 3 819 015, marges de recul »                         | `derogation_mineure`   | date séance   | `accordee` |
| « Dérogation mineure refusée — agrandissement en zone protégée »                         | `derogation_mineure`   | date séance   | `refusee`  |
| « PPCMOI adopté — projet résidentiel 45 logements avenue des Érables »                  | `ppcmoi`               | date séance   | `accordee` |
| « PIIA approuvé — façade commerciale rue principale »                                     | `piia`                 | date séance   | `accordee` |
| « Usage conditionnel accordé — stationnement zone résidentielle »                        | `usage_conditionnel`   | date séance   | `accordee` |
| « Rezonage zone RA vers RB » (sans mention d'étape précise)                              | `inconnu`              | —             | —          |

### 3.3 `etape_date` : source de la date

Par ordre de priorité :
1. Date explicitement mentionnée dans le texte pour cette étape.
2. Date de séance du PV source (`meetingDate` du nœud Source).
3. `properties.date` du nœud lui-même.

Si aucune date n'est disponible et que `etape` est `inconnu`, omettre `etape_date`.

### 3.4 Loi 25 — zéro PII

Le champ `etape` et `etape_date` ne contiennent aucune donnée personnelle (ils
décrivent l'étape réglementaire, pas les parties). Le champ `demandeur` existant
reste soumis aux règles d'anonymisation usuelles (`demandeur_corporate` seulement).

---

## 4. Package de délégation H2A — brief pour `claude:immo_subagents`

> Ce texte est le corps du message H2A à envoyer. Le conducteur peut le copier
> tel quel dans `h2a_offer` → `claude:immo_subagents`.

---

**OBJET : RE-GRAPHIFY axe ANTICIPATION — champ `etape` / `etape_date` (villes M–Z)**

Bonjour `claude:immo_subagents`,

**Mission :** Re-graphifier les villes de ta tranche (M–Z, ~231 villes) pour extraire
et peupler les champs `etape` et `etape_date` sur chaque nœud Signal et DesignationEvent.
Ces champs alimentent l'axe ANTICIPATION du scoring radar.

**Ontologie de référence :** `radar/ontology/ontology-profile.yaml` v2.1 (branche `docs/ontologie-etape`,
PR ouverte). Tu dois lire ce profil avant de lancer graphify. La `ontology_version` de
sortie doit être `"2.1"`.

**Contrat de sortie :** `radar/ontology/graphify-output-contract.md` §8 (champs v2.1).

**Directive d'extraction :**

- Pour chaque Signal et DesignationEvent, identifier l'étape réglementaire depuis le texte
  du PV source (voir `docs/spec/etape-anticipation-delegation.md` §3).
- Valeurs autorisées pour `etape` (enum ordonné) :
  - Pipeline complet : `avis_motion` > `projet_reglement` > `consultation_publique` >
    `second_projet` > `adoption` > `entree_vigueur`
  - Instruments : `derogation_mineure`, `piia`, `ppcmoi`, `usage_conditionnel`
  - Défaut : `inconnu`
- Règle de priorité : si plusieurs étapes du pipeline complet dans un même paragraphe
  pour le même dossier, retenir la plus précoce (rang le plus bas).
- Écrire aussi `etape_date` (YYYY-MM-DD) = date de l'étape ou date de séance du PV.
- Pour les instruments : écrire l'issue dans `properties.outcome` (`accordee`/`refusee`).

**Périmètre :** tranche M–Z de la directive `radar/ontology/regraphify-directive.md` §4.
Soit les villes dont le slug normalisé (sans accents, kebab-case) commence par m–z.
~231 villes (dont 16 en priorité absolue : mont-*, nantes, notre-dame-*, ogden, orford,
otterburn-park, parisville, rosemere, roxton-pond).

**Découpage en lots recommandé (contrainte OOM : seriel, pas parallèle) :**

| Lot | Tranche | ~Nb villes | Commentaire |
|-----|---------|------------|-------------|
| 1   | m*      | ~45        | mont-*, municipalites-m |
| 2   | n*, o*  | ~35        | notre-dame-* (priorité), ogden, orford |
| 3   | p*, q*, r* | ~40   | parisville, rosemere, roxton-pond (priorité) |
| 4   | s*      | ~70        | saint-*, sainte-*, sep-iles, sherbrooke |
| 5   | t*, u*, v*, w*, x*, y*, z* | ~41 | terrebonne, thetford, trois-rivieres… |

Travailler chaque lot en séquentiel (un seul `graphify run` à la fois) pour éviter OOM.

**Critères d'acceptation par lot :**

```bash
# 1. Chaque Signal/DesignationEvent a un champ etape (non null, non vide)
jq '[.nodes[] | select(.type == "Signal" or .type == "DesignationEvent")
     | select(.properties.etape == null or .properties.etape == "")] | length == 0' \
   graph/<slug>/latest.json
# → true

# 2. Toutes les valeurs etape appartiennent à l'enum v2.1
ENUM='["avis_motion","projet_reglement","consultation_publique","second_projet","adoption","entree_vigueur","derogation_mineure","piia","ppcmoi","usage_conditionnel","inconnu"]'
jq --argjson e "$ENUM" '[.nodes[] | select(.type == "Signal" or .type == "DesignationEvent")
     | select(.properties.etape != null)
     | select(.properties.etape as $v | ($e | index($v)) == null) | .id] | length == 0' \
   graph/<slug>/latest.json
# → true

# 3. ontology_version = "2.1"
jq '.ontology_version == "2.1"' graph/<slug>/latest.json
# → true

# 4. etape_date valide quand etape != "inconnu"
jq '[.nodes[] | select(.type == "Signal" or .type == "DesignationEvent")
     | select(.properties.etape != null and .properties.etape != "inconnu")
     | select(.properties.etape_date == null or .properties.etape_date == "")] | length == 0' \
   graph/<slug>/latest.json
# → true
```

**NE PAS projeter PG.** Le conducteur orchestrera la projection après validation
des gates ci-dessus sur l'ensemble des lots.

**Rapport de lot attendu :**
- Slug des villes traitées.
- Nb de Signal/DesignationEvent avec `etape != "inconnu"` vs total.
- Nb de villes où le gate jq est `true` sur les 4 critères.
- Toute anomalie (ville sans Signal, gate false, erreur graphify).

Merci.

---

## 5. Critères d'acceptation globaux (conducteur)

Avant de lancer la projection PG, le conducteur valide :

1. **100 % des lots M–Z** ont été traités et signalés par `claude:immo_subagents`.
2. **Gate jq vert** sur les 4 critères ci-dessus pour chaque ville de la tranche M–Z.
3. **Taux d'étape identifiée ≥ 60 %** : au moins 60 % des Signal/DesignationEvent
   ont `etape != "inconnu"` (seuil pragmatique ; le reste sera affiné lors du prochain cycle).
4. **Aucun Signal/DesignationEvent sans `etape`** (même `inconnu` est acceptable ;
   l'absence de la clé ne l'est pas).

## 6. Plan de validation post-projection (conducteur)

```sql
-- 6.1 Distribution des étapes (spot-check)
SELECT props->'properties'->>'etape', count(*)
FROM graph_nodes
WHERE type IN ('Signal','DesignationEvent')
  AND props->'properties'->>'etape' IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;

-- 6.2 Taux de couverture (doit être >= 60%)
SELECT
  COUNT(*) FILTER (WHERE props->'properties'->>'etape' NOT IN ('inconnu','')) AS avec_etape,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE props->'properties'->>'etape' NOT IN ('inconnu',''))
        / NULLIF(COUNT(*),0), 1) AS pct
FROM graph_nodes
WHERE type IN ('Signal','DesignationEvent');

-- 6.3 Villes sans aucun signal avec etape identifiée (anomalie à investiguer)
SELECT props->>'municipality' AS ville, COUNT(*) AS total_signals,
       COUNT(*) FILTER (WHERE props->'properties'->>'etape' NOT IN ('inconnu','')) AS avec_etape_id
FROM graph_nodes
WHERE type = 'Signal'
GROUP BY 1 HAVING COUNT(*) FILTER (WHERE props->'properties'->>'etape' NOT IN ('inconnu','')) = 0
ORDER BY 2 DESC LIMIT 20;
```

---

## 7. Références

- Profil ontologie v2.1 : `radar/ontology/ontology-profile.yaml`
- Contrat de sortie v2.1 : `radar/ontology/graphify-output-contract.md` §8
- Directive re-graphify : `radar/ontology/regraphify-directive.md`
- Partition villes codex/immo : `radar/ontology/regraphify-directive.md` §4
- Mémoire OOM : `agents-need-worktree-isolation.md` + `oom-parallel-test-stacks.md`
  → travailler EN SÉQUENTIEL, un lot à la fois
