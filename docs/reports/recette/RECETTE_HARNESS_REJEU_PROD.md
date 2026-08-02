# Harnais de recette — rejeu B′ sur le corpus de production

**WP5 RECETTE · 5.1 rejeu prod · 5.2 rappel/précision · 5.4 budget de sortants.**
Statut : **contrôle de validité PASSÉ (bit-exact)** — harnais opérationnel comme
**gate de merge du vivier B′**. Mesures du 2026-08-02.

> Règle de recette : **aucun merge touchant le vivier B′** sans rejeu rouge→vert
> de ce harnais sur les 7 221 nœuds réels. La CI verte ne prouve rien : 3
> correctifs B′ ont eu la CI verte en perdant des signaux réels ; seul le rejeu
> par identifiant les arrête.

## 1. Source de vérité et extraction

- **Prod = scale-to-zero.** Le namespace `radar-immobilier` tourne à `0/0`
  (postgres, minio, api…) ; `immo.sent-tech.ca` remonte par scale-from-zero.
  La donnée du vivier vit dans **`radar_postgres` → table `graph_nodes`**.
- **Baseline figée.** Les nœuds `graph_nodes` datent de la dernière ingestion
  (`max(created_at) = 2026-06-21`). Les cronjobs de projection sont **suspendus**
  (`radar-refresh-projection`, dernier run 2026-07-01). Le corpus prod est donc
  **quiescent** — mesure reproductible.
- **Extraction (lecture seule, empreinte minimale).**
  1. `kubectl scale statefulset radar-postgres -n radar-immobilier --replicas=1`
  2. `kubectl exec … psql` → `COPY (SELECT row_to_json(t) FROM (<projection>) t) TO STDOUT`
     avec la **projection SQL exacte** de `listCitiesWithSignalNodes`
     (`type IN ('Signal','DesignationEvent') AND city_slug IS NOT NULL`,
     `props->'properties'->>'…'`).
  3. `kubectl scale … --replicas=0` (restauration prod).
  - Aucun autoscaler (0 ScaledObject/HPA) ; **zéro mutation de donnée** (SELECT
    seul) ; kubeconfig **jamais imprimé**. `COPY TEXT` échappe les backslashes →
    dé-échappement au parse (7221/7221 lignes valides).

## 2. Contrôle de validité — OBLIGATOIRE avant tout chiffre

Le rejeu de la classification **`main`** sur le dump prod PG DOIT reproduire la
baseline figée. Sinon le pipeline est faux — arrêt.

| Métrique | Baseline prod (2026-07-17) | Rejeu harnais (dump PG) | Verdict |
|---|---|---|---|
| Nœuds `Signal`+`DesignationEvent` | 7 221 | **7 221** | ✅ |
| Villes avec signal | 724 | **724** | ✅ |
| Signaux éligibles B′ (`classifyBPrime`) | 6 777 | **6 777** | ✅ |
| Villes éligibles | 720 | **720** | ✅ |

**Bit-exact ⇒ pipeline fidèle.** `api/src/services/graph/recette-replay-pg.prod.test.ts`.

### Dérive SCW ≠ prod PG (piège documenté)

Les projections graphify vivent aussi sur **SCW** (`graph/<slug>/latest.json`,
1007 graphes). Un rejeu sur **SCW live** donne **7 205 / 723 / 6 764 / 719**
(−16 nœuds, −1 ville). Deux causes :
- SCW est **en avance** sur la dernière ingestion prod PG (graphify écrit en continu).
- **`graph_nodes.id` est PK GLOBALE** : un id partagé entre plusieurs slugs
  (cas Hemmingford ×3, Notre-Dame ×2) compte **1×** en PG, mais 1×/slug en SCW.

⇒ **La source de vérité recette est le dump prod PG, PAS le SCW live.** Le rejeu
SCW (`recette-replay.prod.test.ts`) sert au suivi de dérive, pas au gate.

## 3. Ensembles d'appartenance B′ (par signal)

Depuis `classifyVivierSignal` (+ `isResidentialEligible`), du plus large au plus strict :

| Ensemble | Définition | Compte main (corpus figé) |
|---|---|---|
| `eligible` | `exclusion_reason === null` (toutes exclusions vivier) | 6 226 |
| `bPerim` | `eligible` ∧ `zonage = oui` | 4 989 |
| `resElig` | `bPerim` ∧ `isResidentialEligible` (axe R) | 1 249 |
| `precoce` | `bPerim` ∧ `etape ∈ {avis_motion, projet_reglement}` (badge B précoce) | 786 |
| `bprime` | `precoce` ∧ `resElig` (vivier B′ précoce résidentiel — le plus strict) | 314 |

> `eligible` (6 226) ≠ le contrôle `classifyBPrime`-only (6 777) : ce dernier est
> le **pré-filtre lexical B′** seul ; `classifyVivierSignal` ajoute les exclusions
> zonage/PIIA/dérogation. Les deux sont mesurés, chacun pour son gate.

## 4. Moteur de bascules — entrants / SORTANTS nommés

Le net cache les sortants. On rejoue une version compilée **depuis les blobs git**
(`git checkout <ref> -- api/src/services/graph/vivier-v2.ts packages/radar-domain/src`),
on émet un **snapshot d'appartenance par id**, et on **diffe** contre `main`.
`recette-membership-snapshot.prod.test.ts` + `scratchpad/diff-snap.py`.

### Cas prouvé — le trio de correctifs « lexique refonte »

Rejeu sur le corpus figé, axe `resElig` (le net POSITIF masque des sortants) :

| Transition | net | ENTRANTS | **SORTANTS (perdus)** |
|---|---|---|---|
| `c0f1d4d → a15ce4e` (lire « refonte » par occurrence) | +4 | 7 | **3** : `event-chibougamau-520-05`, `event-hatley-refonte-urbanisme-sadd-2026`, `event-saint-jean-de-matha-zonage-604-adoption-2026-01-14` (instrument `refonte`→`autre`) |
| `a15ce4e → ab2b49b` (borner « refonte » à l'urbanisme) | +1 | 3 | **2** : `event-chute-saint-philippe-refonte-reglementation-2026-04-13`, `event-piedmont-adoption-reglements-urbanisme-2026-05-04` |
| `ab2b49b → a078e9a` (apposition nue + préfixes) | +1 | 1 | 0 |

- **Verdict** : les 3 sortants de `a15ce4e` sont des **régressions transitoires**,
  **toutes récupérées** par `ab2b49b` (correction). `piedmont` bascule
  `refonte`→`ppcmoi` (reclassement, pas une perte de couverture).
- Sur l'axe strict **`bprime` : 0 sortant** sur tout le trio (+6 entrants).
- **Enseignement gate** : un correctif à net `+4` a bel et bien **retiré 3
  signaux réels** — invisible sans le diff par identifiant.

## 5. Critères de recette — ENDOSSÉS avec architect (WP8.4 / spec B′ WP8.1 §7)

Pour tout candidat modifiant le vivier B′ :
1. **Garde-fou main [a]** : `main` DOIT valider 7221 nœuds / 724 villes / 6777
   éligibles / 720 villes. Toute dérive ⇒ **ABORT** avant tout diff candidat.
2. **Snapshot candidat vs main [b]**, par lot.
3. **Budget de sortants [c] (5.4)** :
   - **SORTANT** = signal IN-B′ sous `main` (précoce ∩ résidentiel∈{oui,
     indéterminé-admis} ∩ zonage ; précoce = `avis_motion`/`projet_reglement`
     strict) qui QUITTE B′ sous candidat.
   - **BLOQUANT par défaut.** Admis UNIQUEMENT nommé comme **CORRECTION** avec
     preuve (faux positif prouvé), via un **ledger explicite + enum de raison**
     (ex. `faux_positif_prouve`). Jamais de perte silencieuse. **Recette seule**
     prononce l'admission.
   - **ENTRANTS** (amende architect) : tracés + comptés + **nommés**, en
     **soft-review** (non bloquant mais visible) — un entrant injustifié gonfle
     B′ (défaut moins grave qu'un sortant silencieux, mais pas invisible).
   - ⇒ Sortants = **hard-block** ; entrants = **soft-review**.
4. **Vérité terrain (WP8.1)** : **GOLD** = Steve-30 figé (`gold-steve-30.expected.json`,
   verdict HARD) ; **SILVER** = proxy Steve calibré sur les 167 (verdict soft +
   « zéro sortant silencieux »), étiqueté silver — anti-invention préservée. La
   **cohorte des 167 n'existe pas encore** en artefact ; sa définition est un
   arbitrage propriétaire (escaladé au conducteur par architect).

## 6. Mode d'emploi

```bash
# 1. Extraire le corpus prod (scale-up read-only, puis scale-down — cf. §1)
#    → <dump>.ndjson (7221 lignes)
# 2. Contrôle de validité (main), depuis api/
RECETTE_PG_NDJSON=<dump> npx vitest run \
  src/services/graph/recette-replay-pg.prod.test.ts   # attend 7221/724/6777/720
# 3. Snapshot d'un ref candidat + diff des bascules
RECETTE_PG_NDJSON=<dump> RECETTE_SNAP_DIR=<out> scripts/recette/snap-ref.sh <ref>
RECETTE_PG_NDJSON=<dump> RECETTE_SNAP_DIR=<out> scripts/recette/snap-ref.sh main
python3 scripts/recette/diff-snap.py <out>/main.ndjson <out>/<ref>.ndjson bprime
```

Hors `RECETTE_*` env, les 3 tests sont **skippés** (gate-safe : ils ne tournent
pas en CI faute de données prod, mais restent des tests enregistrés).

## 7. Validation EN BATCH des lots vivier / des 167

Le harnais valide un **lot** de villes (graphes frais d'extraction, SCW) sans
rejouer les 724. Chaîne unifiée (SCW frais **ou** dump prod PG → même outillage) :

```bash
# a) lot SCW frais -> lignes de projection (mêmes clés que le dump PG)
RECETTE_GRAPHS_DIR=<graphs> RECETTE_LOT_SLUGS=slug1,slug2,… \
RECETTE_PROJECTION_OUT=<lot-proj.ndjson> \
  npx vitest run src/services/graph/recette-replay.prod.test.ts
# b) projection -> snapshot d'appartenance
RECETTE_PG_NDJSON=<lot-proj.ndjson> RECETTE_SNAPSHOT_OUT=<lot-snap.ndjson> \
  npx vitest run src/services/graph/recette-membership-snapshot.prod.test.ts
# c) verdict par ville (rouge/vert vs attendus)
python3 scripts/recette/per-city-verdict.py <lot-snap.ndjson> <expected.json> --axis bprime
```

**Gate one-shot** (candidat → snapshot → diff SORTANTS/entrants vs baseline →
verdict gold ; code retour ≠ 0 si sortant) :
```bash
RECETTE_BASELINE_SNAP=<baseline-main-snapshot.ndjson> \
  scripts/recette/gate-candidate.sh <candidate-projection.ndjson> [gold-steve-30.expected.json]
```
Handoff extraction (confirmé conducteur) : par lot = (i) liste de slugs +
(ii) graphes frais ré-uploadés à `graph/<slug>/latest.json` (SCW). Baseline =
dump prod PG ; lots frais tirés de SCW. Vérité terrain = **gold-30 (verdict DUR)**
+ **silver-137 (proxy Steve calibré, étiqueté par provenance)** — recette
prononce DUR sur le gold, MESURE + NOMME les divergences sur le silver.

**Cohorte 167** : `docs/spec/reports/set-167-bprime.tsv` (priorityRank≤167, figée
conducteur). ⚠️ slugs à normaliser vers `graph_nodes.city_slug` (tiret double MRC,
apostrophes) avant gate — sinon villes silencieusement ratées.

`expected.json` = `{ "<slug>": {"in_bprime": true|false} }` : `true` = ville
attendue DANS B′ (score ≥6) ; `false` = faux positif attendu DEHORS. Code retour
≠ 0 s'il reste des RED (gate). **Débit** : rejeu pur des 724 villes = ~0,66 s ;
un lot = quelques secondes. Le rejeu n'est pas le goulot.

### Résultat GOLD Steve-30 sur graphes FRAIS (SCW 2026-08-02)

Vérité terrain réelle (`gold-steve-30.expected.json`, verdict humain Steve repris
tel quel), classif `main`, graphes frais d'extraction. **25 GREEN / 4 RED** sur
29 villes gold (Hemmingford / Notre-Dame-Joliette = slugs ambigus, hors gate dur).

**4 RED — faux positifs à trancher pour FULL B′** (ville que Steve place DEHORS
mais que B′ inclut aujourd'hui) :

| Ville | bprime | attendu DEHORS car |
|---|--:|---|
| `neuville` | 1 | CPTAQ agricole ; zone Pa-4 indéterminée |
| `preissac` | 1 | rezonage église indéterminé |
| `sainte-catherine` | 2 | 16 signaux ; seul qualifié = adoption, reste indét |
| `stratford` | 1 | RU-13 indéterminé |

**Soft-review (sous-comptes)** : `saint-frederic` cible 2 / obtenu 1,
`saint-stanislas-de-kostka` cible 2 / obtenu 1 (paire refonte partiellement
captée) — signaux-cible possiblement manquants. `rosemère` et
`saint-charles-borromée` (les 2 faux positifs « EN ATTENTE geo » de la recette
hors-ligne) sont **désormais correctement exclus** (bprime = 0) sur graphes frais.

> `in_bprime` (in/out) = gate DUR ; `target` (compte Steve) = informatif, mesuré
> sur la donnée de Steve — un écart de compte sur graphes frais est soft-review,
> pas bloquant. Les 4 RED sont le vrai reste-à-faire B′ sur le gold ; le passage
> aux 167 attend la cohorte (arbitrage propriétaire, escaladé par architect).
