# Contrat d'attestation d'ABSENCE-SOURCE (geo ↔ immo) — enabler du N-A honnête

## §0 — Statut & portée

**Statut : contrat PARTAGÉ figé.** Enabler GÉNÉRIQUE du 0-UNKNOWN honnête : il
définit ce qui compte comme **preuve valide** qu'un datum est **légitimement
absent de sa source autoritaire**. C'est la seule voie pour faire passer une
cellule `(muni × KPI)` de **UNKNOWN** à **N-A PROUVÉ**.

Séparé de B′ / crosswalk / recall (ne les modifie pas). Consommé par
`docs/spec/CRITERES_PREUVE_NA_KPI_IMMO.md` (SHA `3163877`, ferme son **OPEN #5**)
et par le geo-side `SPEC_PALIER_RESOLUTION.md`. **Réutilisable pour TOUT KPI dont
le N-A = absence-source** (pas seulement `noLot`).

**Répartition** : geo (lanes LOT / ZONES, data owners) **IMPLÉMENTE** la requête
re-jouable ; l'architect immo **GRAVE la validité** (ce document) ; **geo-archi
ratifie la FORME** (jamais le critère métier).

## §1 — Définition

Une **attestation d'absence-source** est la preuve qu'un datum **n'existe pas**
légitimement dans sa **source autoritaire**, produite par une **requête
RE-JOUABLE** et enregistrée comme le triplet **{ source, date, résultat }**.
Elle n'est jamais produite par défaut, en masse, ni sur un simple « pas trouvé ».

## §2 — Critères de validité (ce qui compte comme preuve)

Une attestation est **VALIDE ssi les QUATRE tiennent** :

1. **SOURCE AUTORITAIRE** — la source qui fait autorité pour le datum, citée avec
   son **identité + version/millésime**. Pour les attributs de lot (`noLot`,
   surface, code postal, adresse) = le **rôle d'évaluation foncière / cadastre du
   Québec** (Données Québec). **JAMAIS** le pipeline/graphe immo ni « nos données ».
2. **REQUÊTE RE-JOUABLE** — déterministe et citable : quiconque la re-joue à
   l'identique contre la source obtient le même résultat. Le **texte/paramètres**
   de la requête sont enregistrés.
3. **RÉSULTAT D'ABSENCE** — le résultat de la requête qui **démontre** l'absence
   (ex. 0 ligne ; la municipalité/parcelle n'a aucun `NO_LOT` ; le rôle ne porte
   pas l'attribut pour ce lot). Le **résultat exact** est enregistré.
4. **DATE** — la date de la requête ; l'absence est attestée **as-of** cette
   version/millésime de la source.

**Une attestation à qui manque UN de { source, requête, résultat, date } est
INVALIDE → la cellule reste UNKNOWN.**

## §3 — Garde-fous anti-gaming (règle d'or)

- **« Pas trouvé dans notre pipeline / graphe / extraction » ≠ absence-source.**
  L'absence-SOURCE se prouve **contre la source autoritaire**, jamais contre notre
  couverture.
- Absence-dans-notre-extraction = **UNKNOWN** (ou trou de détection), **PAS N-A**.
- Fabriqué / non re-jouable / source non autoritaire = **INVALIDE → UNKNOWN**.
- Une attestation ne peut **JAMAIS** être générée par défaut ou en masse sans
  re-jouabilité **individuelle** par cellule.

## §4 — Application (générique + exemple `noLot`)

Gabarit par cellule : `{ kpi, muni, source:{ dataset, version }, query, result, date }`.

- **14 `noLot`** (immo produit l'entité `OntoLot` ; la source reste le cadastre) :
  SOURCE = **cadastre du Québec** (Données Québec, millésime *X*) ; REQUÊTE =
  lookup des lots cadastraux de la municipalité / de la parcelle → 0 lot /
  aucun `NO_LOT` ; RÉSULTAT = l'ensemble vide/absent ; DATE = date de requête.
  **COMPLET** = un `noLot` cadastre existe et est servi. (geo/LOT implémente.)
- **15 surface / 16 code-postal / 17 adresse** (props geo-servies) : même gabarit
  contre le rôle/cadastre (« le rôle ne porte pas surface/CP/adresse pour ce
  lot »). geo **atteste** l'absence-source ; immo grave le **N-A SERVI** en
  **citant cette attestation** (frontière anti-double-comptage, cf. `3163877` §4).
- **Générique** : tout KPI dont le N-A = absence légitime dans une source
  autoritaire consomme ce contrat.

**TBD (append sans changer la validité)** : geo (LOT/ZONES) fournit la **requête
concrète exacte** + l'**identité/version** du dataset cadastre/rôle par KPI ; je
les append ici, la forme de validité §2 ne change pas.

## §5 — Ownership & flux

- **geo (LOT / ZONES, data owners)** : implémente + exécute la requête re-jouable,
  produit le triplet `{ source, date, résultat }` par cellule.
- **architect immo** : grave la validité (ce contrat) et la consomme dans les
  critères N-A (`3163877`).
- **geo-archi** : ratifie la FORME (pas le critère métier).
- **recette** : n'accepte une cellule **N-A** que si l'attestation est **VALIDE**
  (les 4 critères §2 tiennent) ; sinon la cellule reste **UNKNOWN**.

## §6 — Traçabilité + OPEN

| Élément | Autorité |
|---|---|
| `noLot` = clé cadastre autoritaire ; sources `role-evaluation`/`cadastre` | `packages/radar-domain/src/schemas/ontology/entities.ts:148,153,219-220` |
| Grille + ownership (immo produit 14 + `OntoAdresse` 17 ; 12,13,15,16,17,18,19 geo-servis) | `SPEC_PALIER_OWNERSHIP.md` §2/§3 (staged handoff) |
| Critères N-A immo (OPEN #5 résolu par ce contrat) | `docs/spec/CRITERES_PREUVE_NA_KPI_IMMO.md` (`3163877`) §5 |
| Frontière servi/absence-source ; geo-side | `SPEC_PALIER_RESOLUTION.md` §4 |
| Recall (KPI 20) | `docs/spec/CONTRAT_MESURE_RECALL_SET.md` (`2335a7d`) |

**OPEN** : la requête concrète re-jouable + la version de dataset par KPI sont
fournies par geo (LOT/ZONES) et appendées en §4 ; elles ne modifient pas la forme
de validité gravée ici.
