# SPEC_ONTOLOGY - Ontologie graphify-ready + modele de donnees multi-villes (zonage, lots, designation, valuation)

> **Statut** : PROPOSITION DE DESIGN (WP5), pour sign-off. **Aucun code n'est ecrit.**
> Les blocs YAML (profil graphify), Zod et PostGIS/Drizzle sont des **esquisses**
> (sketches) de design, pas des migrations ni des fichiers de profil exploitables.
>
> **Branche** : `feat/ontology-data-model` (off `main`).
> **Auteur** : assistant radar.
> **Date** : 2026-06-07.
> **Lot de travail** : WP5 (ontologie + modele de donnees), au-dessus de WP4 (scraping).
>
> **Inputs lus (tout est ancre dessus)** :
> `docs/spec/input/VISION.md` (intention produit : densification, priorites 1-4,
> langage municipal), `docs/spec/input/PROMPT.md` (les 6 phases de l'analyste),
> `docs/spec/input/PROCESS.md` (pipeline 6 etapes + scoring 5 axes),
> `docs/spec/SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md` (intention modele),
> `docs/spec/SPEC_DESIGN_DATA_MODEL.md` (le design relationnel a **elever** : Zone/
> ZoneVersion, Lot/LotVersion, DesignationEvent, Valuation, lot_zone_resolution,
> bitemporel, as-of-date, CityProfile, choix A-D, questions 1-8),
> `docs/spec/SPEC_PLAN_SCRAPING.md` (WP4 : ciblage/recueil/exploitation, SourceBinding,
> CityProfile, sources A1-A12/B1-B12/C1-C5),
> graphify : `README.md` + `tests/fixtures/profile-demo/graphify.yaml` +
> `tests/fixtures/profile-demo/graphify/ontology-profile.yaml` +
> `src/ontology-patch.ts` (schema `graphify_ontology_patch_v1`, 9 operations) +
> `src/ontology-reconciliation.ts` (candidats `entity_match`) +
> `src/types.ts` (`OntologyStatus`) +
> `spec/SPEC_ONTOLOGY_LIFECYCLE_RECONCILIATION.md` (studio + lifecycle),
> `packages/radar-sources/src/{SourceAdapter.ts,prioritySources.ts}`,
> `ui/src/lib/onboarding/onboarding-data.ts` (liste multi-villes).

---

## 0. Cadre : pourquoi une couche ontologie au-dessus du relationnel

### 0.1 Le manque que WP5 comble (delta vs le design relationnel PR#46)

`SPEC_DESIGN_DATA_MODEL.md` (PR#46) livre un excellent **modele relationnel** :
Zone/ZoneVersion, Lot/LotVersion, DesignationEvent, Valuation, lot_zone_resolution,
bitemporalite, resolution as-of-date, CityProfile. Mais il **suppose le passage du
brut au relationnel resolu** : un parseur deterministe (le connecteur Craft CMS de
Valleyfield) produit directement les entites. Deux limites apparaissent des qu'on
sort de la ville pilote :

1. **Le brut est non structure et multi-format.** Avis publics PDF, proces-verbaux
   scannes, vageos YouTube transcrites, articles de presse (NeoMedia), XML de role.
   La meme chose reelle (la zone `H-609-4`, le reglement `150-49`, le lot `3 819 015`)
   y apparait sous des **graphies variables** et eparses. Un parseur par CMS ne
   suffit pas a N villes aux regimes differents.
2. **L'utilisateur veut des ecrans de reconciliation / mapping d'entites.** VISION et
   PROCESS exigent de **relier les documents entre eux** (VISION 4.4, 7), de
   reconstruire le contexte d'un numero de reglement, avec **trace de preuve** sur
   chaque fait (PROCESS 5). C'est exactement un probleme de **graphe de connaissance
   reconcilie human-in-the-loop**.

WP5 insere donc une **couche knowledge graph (graphify)** entre le recueil (WP4 etage 2)
et le store relationnel (WP4 etage 3) :

```
brut (Source/Document) -> graphify : extraction de MENTIONS -> reconciliation
   (candidats -> studio/patch -> CANONIQUE valide) -> materialisation relationnelle
   (Zone/Lot/Bylaw/DesignationEvent/Valuation, bitemporel) -> scoring / Signal
```

Le **relationnel reste la verite d'exploitation** (requetes as-of-date, scoring) ; la
couche ontologie est la **verite de reconciliation** (quelle graphie de quel document
designe quelle entite canonique, avec quelle preuve et quelle decision humaine).

### 0.2 Principes directeurs (herites des regles cardinales)

- **Anti-invention** : une valeur non obtenue = `non-disponible` explicite ; une
  reconciliation non confirmee reste `candidate`, jamais promue en `fait` (PROCESS 5,
  WP4 0.1).
- **Brut avant extraction** : les noeuds `Source/Document` pointent la cle S3
  `raw/<kind>/<city>/<Y>/<M>/<D>/<sha>.<ext>` ; aucune re-extraction ne re-fetch.
- **Citation obligatoire** : toute mention et toute relation porte des `evidence_refs`
  (source + page/bbox). C'est la regle `citation_policy` de graphify + l'`EvidenceItem`
  du domaine, alignes.
- **Multi-villes des le depart** : l'ontologie est **stable** ; ce qui varie par ville
  vit dans `CityProfile` + `SourceBinding` (cf. section 5). Aucune logique
  "Valleyfield" en dur.
- **PII hors modele** : **aucun noeud proprietaire/personne** (LFM art. 72 + Loi 25).
  Le registre foncier reste `manual-check`/`partner-required` ; s'il est un jour
  source, ce sera une table separee a acces journalise, hors de ce design.

### 0.3 Perimetre multi-villes initial

Municipalites deja referencees dans le depot
(`ui/src/lib/onboarding/onboarding-data.ts`, MRC Beauharnois-Salaberry et voisinage) :
**Salaberry-de-Valleyfield** (`70052`, ville pilote, seule reellement peuplee),
**Beauharnois**, **Vaudreuil-Dorion**, **Chateauguay**, **Mercier**,
**Saint-Constant**, **Saint-Jean-sur-Richelieu**, **Sorel-Tracy**. Le modele doit
generaliser a N villes aux **regimes de zonage, processus decisionnels et canaux de
communication differents** (section 5). La MRC est une **couche regionale**, pas une
ville.

---

## 1. Ontologie (profil graphify)

Esquisse concrete d'un `ontology-profile.yaml` au **format reel de graphify** (cle
`node_types` avec `aliases`/`status_policy`/`registry`/`source_backed` ; `relation_types`
avec `source`/`target` ; `registries` ; `citation_policy` ; `hardening` ; bloc
`reconciliation_policy` ; `outputs.ontology`). Le profil est **partage par toutes les
villes** (section 5.4).

### 1.1 Noeuds (node types)

15 types de noeuds (liste demandee, **sans noeud proprietaire/PII**), classes par role
graphify : **reconcilie** (mentionne a travers des documents, donc avec alias +
reconciliation), **registre** (donnee autoritaire CSV/JSON/XML), **source-backed**
(porteur de preuve), **derive** (projection calculee, hors reconciliation).

| Node type | Role graphify | Identifie le concept reel | Reconcilie ? |
|---|---|---|---|
| `Municipality` | registre (`municipalities`) | une ville (slug + code MAMH 70052) | non (autoritaire) |
| `Region` (MRC) | registre (`mrc`) | une MRC (Beauharnois-Salaberry) | non |
| `Zone` | **reconcilie** + hardenable | une zone reglementaire (`H-609-4`, `U-521`) | **oui** |
| `ZoneVersion` | derive | etat date d'une zone (code/densite/usages a T) | non (projection) |
| `Lot` | registre (`cadastre`) + reconcilie | un lot cadastral (`NO_LOT` 3 819 015) | **oui** (graphies en PDF) |
| `LotVersion` | derive | etat date d'un lot (superficie/usage/geom) | non |
| `DesignationEvent` | **reconcilie** + hardenable | un changement date+source (rezonage, scission) | **oui** |
| `Bylaw` (reglement) | **reconcilie** + hardenable | un reglement (`150-49`, `2024-58`) | **oui** |
| `RegulatoryStage` | derive | une etape du cycle legal (adoption/consultation/referendum/en-vigueur) | non |
| `PPCMOIProject` | **reconcilie** + hardenable | un projet particulier (dossier `2025-0059`) | **oui** |
| `CPTAQDecision` | **reconcilie** + hardenable | une demande/decision CPTAQ (dezonage agricole) | **oui** |
| `Valuation` | registre (`role`) / derive | valeur datee (role d'evaluation / estimation marche) | non |
| `Source` (Document) | **source_backed** | un document brut (avis PDF, PV, role XML, video) | non (porteur de preuve) |
| `Signal` | derive | un signal de veille T1 (rezonage detecte) | non |
| `OpportunityDossier` | derive | un dossier d'opportunite T2 (score ancre au reel) | non |

> **Extension explicitement flaggee (hors liste minimale)** : `Constraint` (zone
> agricole LPTA, zone inondable BDZI, hydrographie GRHQ) est utile pour PROCESS etape 3.
> Optionnel en V1 ; modelisable comme noeud `Constraint` source-backed + relation
> `CONSTRAINS` (Constraint -> Lot/Zone). Laisse en option pour ne pas elargir le
> perimetre du sign-off (cf. question ouverte Q8).

```yaml
# docs/spec : ESQUISSE de docs/.../ontology-profile.yaml (format graphify reel)
id: radar-immobilier-zonage
version: 1
default_language: fr

node_types:
  Municipality:
    aliases: [ville, municipalite]
    registry: municipalities
  Region:
    aliases: [mrc, region]
    registry: mrc
  Zone:
    aliases: [zone, zonage, secteur de zonage]
    status_policy: hardenable        # passe par la reconciliation
  ZoneVersion:
    aliases: [version de zone]
    # derive : non reconcilie (projection des DesignationEvent)
  Lot:
    aliases: [lot, lot cadastral, numero de lot, matricule]
    registry: cadastre               # NO_LOT autoritaire (cadastre du Quebec)
    status_policy: hardenable        # graphies en PDF a reconcilier au lot autoritaire
  LotVersion:
    aliases: [version de lot]
  DesignationEvent:
    aliases: [changement de zonage, rezonage, scission, fusion, renommage, subdivision]
    status_policy: hardenable
  Bylaw:
    aliases: [reglement, regl, amendement, projet de reglement]
    status_policy: hardenable
  RegulatoryStage:
    aliases: [adoption, consultation, registre referendaire, entree en vigueur, avis de motion]
  PPCMOIProject:
    aliases: [ppcmoi, projet particulier, pcmoi]
    status_policy: hardenable
  CPTAQDecision:
    aliases: [cptaq, dezonage agricole, exclusion zone agricole, demande a portee collective]
    status_policy: hardenable
  Valuation:
    aliases: [valeur, role d'evaluation, valeur fonciere, evaluation municipale]
    registry: role                   # role autoritaire ; market-estimate = derive
  Source:
    source_backed: true              # avis PDF, PV, role XML, video, article
  Signal:
    aliases: [signal, alerte]
  OpportunityDossier:
    aliases: [dossier, opportunite, fiche opportunite]
```

### 1.2 Relations (relation types)

Chaque relation a une **endpoint rule** (source -> target en types de noeuds, format
graphify), une **exigence de citation** et une **politique de statut** (les relations
reconciliees passent par `candidate -> validated`).

| Relation | source -> target | Semantique | Citation | Hardenable |
|---|---|---|---|---|
| `LOCATED_IN` | Zone, Lot, PPCMOIProject -> Municipality | localisation administrative | oui | non (geo/registre) |
| `PART_OF` | Municipality -> Region | appartenance MRC | non (registre) | non |
| `GOVERNED_BY` | Zone -> Bylaw | la zone est regie par un reglement | **oui** | oui |
| `REZONES` | DesignationEvent -> Zone | changement usage/densite (le **signal**) | **oui** | oui |
| `SPLITS` | DesignationEvent -> Zone | scission (H-143 -> H-143 + H-143-1) | **oui** | oui |
| `RENAMES` | DesignationEvent -> Zone | renommage a limites constantes (U-521 -> H-521) | **oui** | oui |
| `MERGES` | DesignationEvent -> Zone | fusion | **oui** | oui |
| `SUBDIVIDES` | DesignationEvent -> Lot | filiation cadastrale (123 -> 123-1/-2) | **oui** | oui |
| `ASSIGNED_ZONE` | Lot -> Zone | assignation datee (avec `method`/`confidence`) | oui | oui |
| `VALUED_BY` | Lot, Zone -> Valuation | rattachement d'une valeur datee | oui | non |
| `DERIVED_FROM` | (toute entite) -> Source | provenance d'un fait | **oui** | non |
| `MENTIONS` | Source -> (toute entite) | un document mentionne une entite | **oui** | oui (mention->canonique) |
| `SUPERSEDES` | DesignationEvent -> DesignationEvent ; ZoneVersion -> ZoneVersion ; Bylaw -> Bylaw | chaine de remplacement | oui | non |
| `RAISES_SIGNAL` | DesignationEvent, PPCMOIProject, CPTAQDecision -> Signal | un fait declenche un signal de veille | oui | non |
| `FEEDS_DOSSIER` | Signal, Lot, Valuation -> OpportunityDossier | alimentation du dossier T2 | oui | non |

> **MENTIONS vs DERIVED_FROM** : `MENTIONS` est la **graphie brute** detectee dans un
> document (candidate, a reconcilier) ; `DERIVED_FROM` est la **provenance validee**
> d'un fait (apres reconciliation). Une fois une mention acceptee (`accept_match`), le
> couple devient un `DERIVED_FROM` portant les memes `evidence_refs`.

```yaml
relation_types:
  located_in:   { source: [Zone, Lot, PPCMOIProject], target: Municipality }
  part_of:      { source: Municipality, target: Region }
  governed_by:  { source: Zone, target: Bylaw }
  rezones:      { source: DesignationEvent, target: Zone }
  splits:       { source: DesignationEvent, target: Zone }
  renames:      { source: DesignationEvent, target: Zone }
  merges:       { source: DesignationEvent, target: Zone }
  subdivides:   { source: DesignationEvent, target: Lot }
  assigned_zone:{ source: Lot, target: Zone }
  valued_by:    { source: [Lot, Zone], target: Valuation }
  derived_from: { source: [Zone, Lot, DesignationEvent, Bylaw, PPCMOIProject, CPTAQDecision, Valuation], target: Source }
  mentions:     { source: Source, target: [Zone, Lot, DesignationEvent, Bylaw, PPCMOIProject, CPTAQDecision] }
  supersedes:   { source: [DesignationEvent, ZoneVersion, Bylaw], target: [DesignationEvent, ZoneVersion, Bylaw] }
  raises_signal:{ source: [DesignationEvent, PPCMOIProject, CPTAQDecision], target: Signal }
  feeds_dossier:{ source: [Signal, Lot, Valuation], target: OpportunityDossier }
```

### 1.3 Registres, citation, hardening, reconciliation, outputs

```yaml
registries:
  municipalities:
    source: municipalities          # CSV : code MAMH, slug, nom, DGUID, mrc
    id_column: code_mamh
    label_column: nom_officiel
    alias_columns: [slug]
    node_type: Municipality
  mrc:
    source: mrc
    id_column: code_mrc
    label_column: nom
    node_type: Region
  cadastre:
    source: cadastre                # cadastre allege QC : NO_LOT autoritaire
    id_column: no_lot
    label_column: no_lot
    node_type: Lot
  role:
    source: role                    # role d'evaluation MAMH (XML 70052)
    id_column: matricule
    label_column: matricule
    alias_columns: [no_lot]
    node_type: Valuation

citation_policy:
  minimum_granularity: page         # avis/PV/role : page minimale ; bbox si dispo
  require_source_file: true
  allow_bbox: when_available

hardening:
  statuses: [candidate, attached, needs_review, validated, rejected, superseded]
  default_status: candidate
  promotion_requires:
    - source_citation               # pas de promotion sans preuve (PROCESS 5)
    - allowed_relation_type
    - registry_match_for_registered_types   # Lot doit matcher le cadastre autoritaire

reconciliation_policy:
  status_transitions:               # calque sur la lifecycle graphify
    candidate: [needs_review, validated, rejected]
    needs_review: [validated, rejected]
    validated: [superseded]
    rejected: []
  acceptance_rules:
    promote_relation:               # REZONES/GOVERNED_BY... : ancrage source obligatoire
      require_source_grounding: true
      require_direct_mention: true
    merge_alias:                    # "H 609-4" -> "H-609-4" : variante de graphie
      require_shared_entity_context: true
      require_human_review: true

outputs:
  ontology:
    enabled: true
    canonical_node_types: [Zone, Lot, Bylaw, DesignationEvent, PPCMOIProject, CPTAQDecision]
    relation_exports: [governed_by, rezones, assigned_zone, raises_signal]
    wiki:
      enabled: true
      page_node_types: [Zone, Bylaw, OpportunityDossier]
```

---

## 2. Entites canoniques + modele mention / alias

### 2.1 Le probleme : meme chose reelle, graphies eparses

La meme zone, le meme reglement, le meme lot apparaissent differemment selon le
document (VISION 4.4, 5) :

- `H-609-4` : "zone H-609-4", "H 609-4", "h609-4", "zone H609.4", "secteur H-609-4".
- `150-49` : "Reglement 150-49", "Regl. no 150-49", "R. 150-49", "150-49-1" (amendement).
- `3 819 015` : "lot 3 819 015", "3819015", "3 819 015 du cadastre du Quebec", matricule
  "RL0104C" (cle differente du NO_LOT).
- `2025-0059` : "PPCMOI 2025-0059", "projet particulier 2025-0059", "dossier 2025-0059".

graphify modelise une **entite canonique** (`label`, `aliases`, `type`, `status`,
`source_refs`/`evidence_refs`, `normalized_terms`) et y rattache les **mentions**
variantes, de sorte qu'elles **s'effondrent en un seul noeud** au lieu de rester
eparses (README graphify, section "Canonical entities").

### 2.2 Normalisation d'alias (regles QC-specifiques)

Chaque type produit une **forme normalisee** (`normalized_terms`) servant a generer les
candidats `entity_match` (graphify score par termes partages + match exact de label).

| Entite | Regex de capture | Normalisation | Portee d'unicite | Piege |
|---|---|---|---|---|
| **Zone** | `([A-Z]{1,4})[\s\-.]?(\d+)([\-.]\d+)*` | upper, separateur canonique `-`, prefixe -> `kind` (H/C/U/I/P/A/CONS/REC) | **ville + periode** | un meme code peut etre **reutilise** dans le temps -> l'identite n'est pas le code (cf. 2.4) |
| **Bylaw** | `(?:regl(?:ement)?\.?\s*(?:n[o°]\s*)?)?(\d{2,4}(?:-\d+)+)` | strip "reglement/regl./no/n°/#", token numerique a tirets | **ville** | `150-49-1` est un **amendement distinct** de `150-49` (relation `SUPERSEDES`/AMENDS, pas alias) |
| **Lot** | `(\d{1,3}(?:[\s ]\d{3})+|\d{6,8})` | strip espaces et espaces insecables -> entier | **provinciale** (cadastre du Quebec) | ancien cadastre (pre-renovation) = numerotation differente -> filiation via `lot-renumerotation` |
| **PPCMOIProject** | `(?:ppcmoi|projet particulier).{0,20}?(\d{4}-\d{3,4})` | token `AAAA-NNNN` | **ville** | numero d'annee : ne pas confondre avec un numero de reglement |
| **CPTAQDecision** | `(?:cptaq|dossier).{0,20}?(\d{6,7})` | token numerique | **provinciale** (CPTAQ) | demande vs decision : l'une est signal, l'autre deverrouillage |

> **Cle d'unicite ville vs provinciale** : `Lot` (NO_LOT) et `CPTAQDecision` ont une
> cle **provinciale** (donc reconciliables cross-ville sans ambiguite). `Zone`, `Bylaw`,
> `PPCMOIProject` ont une cle **ville-scopee** (le code `H-1` existe dans 50 villes) :
> la reconciliation doit etre **contrainte par `Municipality`** (via `LOCATED_IN`) avant
> de proposer un `entity_match`. C'est un parametre de la generation de candidats.

### 2.3 Forme d'un candidat (vocabulaire graphify reel)

`graphify ontology candidates` produit des `entity_match` deterministes (rang par
termes normalises partages + match exact de label). Forme reelle
(`src/ontology-reconciliation.ts`) :

```jsonc
{
  "schema": "graphify_ontology_reconciliation_candidates_v1",
  "candidates": [{
    "id": "entity_match::zone-H6094-canonical::mention-avis-150-49-p3",
    "kind": "entity_match",
    "status": "candidate",
    "score": 0.95,                       // 0.95 = match de label exact ; 0.8 = termes partages
    "candidate_id": "mention-avis-150-49-p3",   // la graphie brute "zone H 609-4"
    "canonical_id": "zone-H6094-canonical",     // l'entite Zone canonique
    "shared_terms": ["h", "609", "4"],
    "evidence_refs": ["raw/avis/salaberry/2026/05/.../Avis-150-49.pdf.sha#p3"],
    "reasons": ["exact normalized label match", "same municipality 70052"],
    "proposed_patch_operation": "accept_match"
  }]
}
```

Chaque candidat porte donc **confiance** (`score`), **preuve** (`evidence_refs` =
cle S3 du `Source` + ancre page/bbox) et l'operation de patch proposee.

### 2.4 Identite canonique vs code affiche dans le temps (le point dur)

Le `codeAffiche` d'une zone **peut changer** (U-521 -> H-521) et un code **peut etre
reutilise** apres retrait. Donc :

- L'**entite canonique `Zone`** porte une **identite stable** (le `id` interne du
  relationnel, section 4) ; `codeAffiche` est un **alias date**, pas l'identite.
- Un renommage U-521 -> H-521 n'est **pas** un `merge_alias` : c'est un
  `DesignationEvent` de type `zone-rename` qui produit une nouvelle `ZoneVersion`. La
  graphie "U-521" reste un alias **historique** de la **meme** canonique (meme `id`).
- Une **reutilisation** de code (meme "H-200" pour deux zones distinctes a 10 ans
  d'ecart) impose deux canoniques distinctes -> la reconciliation doit borner par
  **periode active** en plus de la ville. C'est la justification du choix relationnel
  PR#46 : la cle metier est `(zone_id, periode)`, jamais le code.

---

## 3. Workflow de reconciliation (graphify studio + patch lifecycle)

Ce sont les **ecrans de reconciliation / mapping d'entites** demandes. Radar
**pilote** le coeur de patch graphify (et peut **embarquer** sa SPA studio).

### 3.1 Le cycle propose -> valide -> dry-run -> apply

graphify n'edite jamais les fichiers derives ; chaque decision est un
`graphify_ontology_patch_v1` (append-only) valide contre : hash de profil, hash de
graphe, existence des `evidence_refs`, regles d'endpoint de relation, transitions de
statut, et un jail de chemin. Forme reelle (`src/ontology-patch.ts`) :

```jsonc
{
  "schema": "graphify_ontology_patch_v1",
  "id": "patch-20260607-0001",
  "operation": "accept_match",
  "status": "proposed",
  "profile_hash": "sha256...", "graph_hash": "sha256...",
  "target": { "candidate_id": "mention-avis-150-49-p3", "canonical_id": "zone-H6094-canonical" },
  "evidence_refs": ["raw/avis/salaberry/2026/05/.../Avis-150-49.pdf.sha#p3"],
  "reason": "Avis public 150-49 p.3 cite la zone H-609-4 ; meme municipalite 70052.",
  "author": "analyste@radar", "created_at": "2026-06-07T..."
}
```

### 3.2 Operations de patch (les 9, mappees au domaine radar)

| Operation | Usage radar (zonage QC) |
|---|---|
| `accept_match` | rattacher la graphie "zone H 609-4" du PV a la `Zone` canonique H-609-4 |
| `reject_match` | rejeter un faux positif (ex. "H-609" base != "H-609-4") |
| `create_canonical` | creer une nouvelle `Zone`/`Bylaw`/`PPCMOIProject` a partir d'une preuve revue (ex. H-609-4 vue pour la 1re fois dans l'avis 150-49) |
| `merge_alias` | attacher une **variante de graphie** ("H609-4", "H 609-4") comme alias de la canonique (revue humaine requise) |
| `set_status` | promouvoir `candidate -> validated` (apres preuve) ou `-> needs_review` |
| `add_relation` | ajouter `GOVERNED_BY` (Zone->Bylaw 150-49), `REZONES`, `ASSIGNED_ZONE` avec preuve |
| `reject_relation` | rejeter une relation candidate erronee |
| `deprecate_entity` | marquer une canonique obsolete (zone supprimee par fusion) |
| `supersede_entity` | lier la canonique depreciee a son remplacant (U-521 depreciee -> H-521) |

Statuts (`OntologyStatus` reel) : `candidate -> attached -> needs_review -> validated`
(ou `rejected`), puis `superseded`. Le `hardening.default_status = candidate`,
`promotion_requires = [source_citation, allowed_relation_type, registry_match...]`.

### 3.3 Files de candidats (les ecrans)

La SPA studio (`graphify ontology studio`, read-only par defaut ; `--write` ouvre les
routes valider/dry-run/apply, **loopback + bearer token**) sert :

- **File de candidats** (`GET /api/ontology/reconciliation/candidates`) : trier/filtrer
  par `score`, `kind`, `canonical_id`, `min_score`, `municipality` ; c'est l'ecran de
  **mapping d'entites** (gauche : mentions brutes ; droite : canoniques proposees).
- **Comparaison candidat/canonique** : graphie brute + extrait source (page/bbox) vs
  entite canonique + ses alias deja attaches.
- **Trace d'audit** (`graphify ontology decision-log`) : tous les patches appliques/
  rejetes (append-only `applied-patches.jsonl` / `rejected-patches.jsonl`).
- **Apercu de patch** (validate puis dry-run avant write) : l'analyste voit l'effet
  avant d'ecrire.

### 3.4 Comment radar pilote (ou embarque) la reconciliation

Deux options (cf. question ouverte Q1) :

- **A. Embarquer la SPA studio** en read-only dans l'UI radar ; l'apply passe par le
  coeur write-guarded (token loopback). Le moins de code, fidele a graphify.
- **B. Piloter par API/MCP** : radar consomme l'API read-only (candidats, decision-log,
  rebuild-status) + les outils MCP write (`graphify ontology serve --write`) depuis ses
  propres ecrans. Plus de controle UX, plus de code.

**Preco : A pour la V1** (vitesse, fidelite), migration vers B si l'UX l'exige. Dans
les deux cas, **un job de projection** (section 4.4) materialise les canoniques
**validees** vers le store relationnel ; les `candidate`/`needs_review` n'entrent
**jamais** dans le relationnel d'exploitation (anti-invention).

### 3.5 Autonomie de reconciliation (seuil vs human-in-the-loop)

- `score >= 0.95` (match de label exact + meme ville) **et** entite a cle provinciale
  (`Lot`, `CPTAQDecision`) : `accept_match` **auto** proposable (mais audite).
- Tout ce qui alimente un **signal T1** (DesignationEvent `REZONES`) : **revue humaine
  obligatoire** avant `validated` (un faux signal de rezonage est couteux). C'est la
  regle `acceptance_rules.promote_relation.require_human_review`.

---

## 4. Modele relationnel (Zod + PostGIS) qui materialise les canoniques

Le store relationnel **materialise** les canoniques **validees**. Il **reutilise tel
quel** le design PR#46 (`SPEC_DESIGN_DATA_MODEL.md`) pour `zones/zone_versions`,
`lots/lot_versions`, `designation_events`, `valuations`, `lot_zone_resolutions`
(bitemporel, as-of-date, choix A2/B2/C3/D2). WP5 ajoute **4 deltas** :

### 4.1 Delta 1 : le pont canonique <-> relationnel

Chaque table d'entite reconciliee gagne une colonne de **pont** vers la canonique
graphify + la **decision** qui l'a validee (tracabilite de reconciliation).

```ts
// ESQUISSE - colonnes ajoutees a zones / lots / designation_events / bylaws
canonicalId: text("canonical_id").notNull(),        // graphify canonical_id (stable)
reconStatus: text("recon_status").notNull().default("validated"), // OntologyStatus
reconPatchId: text("recon_patch_id"),               // patch qui a valide (audit)
```

Invariant : **seules** les lignes `recon_status = validated` sont visibles a
l'exploitation/scoring. La projection (4.4) ne materialise que les canoniques validees.

### 4.2 Delta 2 : `Bylaw` et `RegulatoryStage` deviennent des entites de plein droit

PR#46 portait le reglement comme **string** sur `DesignationEvent` (`bylaw: "150-49"`).
WP5 le promeut en **entite canonique reconciliee** (il est mentionne partout : avis, PV,
grilles) avec son **cycle de vie legal** explicite (adoption/consultation/referendum/
entree-en-vigueur), ce qui alimente l'axe **Timing**.

```ts
// ESQUISSE - bylaws (nouvelle table)
export const Bylaw = z.object({
  id: z.string().uuid(),
  canonicalId: z.string().min(1),
  citySlug: z.string().min(1),                 // numero ville-scope
  numero: z.string().min(1),                   // "150-49", "2024-58"
  amendsBylawId: z.string().uuid().optional(), // "150-49-1" amende "150-49"
  titre: z.string().nullable().default(null),
  rawRef: z.string().min(1),
  evidence: z.array(EvidenceItem).default([]),
});

// ESQUISSE - regulatory_stages (cycle de vie d'un reglement, derive)
export const RegulatoryStageKind = z.enum([
  "avis-motion", "1er-projet", "consultation-publique", "2e-projet",
  "registre-referendaire", "adopte", "entree-vigueur", "abandonne",
]);
export const RegulatoryStage = z.object({
  id: z.string().uuid(),
  bylawId: z.string().uuid(),
  kind: RegulatoryStageKind,
  occurredOn: isoDateSchema,                    // date de l'etape
  outcome: z.enum(["passed", "failed", "pending", "non-disponible"]).default("non-disponible"),
  rawRef: z.string().min(1),
  evidence: z.array(EvidenceItem).default([]),
});
```

```sql
-- Index : bylaws (city_slug, numero) ; regulatory_stages (bylaw_id, occurred_on)
```

> `RegulatoryStage` remplace/precise le `bylawStage` de PR#46 (qui etait un enum plat
> sur l'evenement) par une **timeline** d'etapes datees : un reglement passe par avis
> -> 1er projet -> consultation -> 2e projet -> registre referendaire -> adopte ->
> en-vigueur. La date d'effet d'un `DesignationEvent` (`validFrom`) reste l'adoption ou
> l'entree en vigueur (question Q2 de PR#46, inchangee).

### 4.3 Delta 3 : `PPCMOIProject` et `CPTAQDecision` (priorites 2 et 4 de VISION)

Deux familles de signaux que PR#46 noyait dans `DesignationEvent`/`Signal` deviennent
des entites canoniques (mentionnees dans avis/PV, suivies dans le temps).

```ts
// ESQUISSE - ppcmoi_projects (VISION priorite 2, 7/10)
export const PPCMOIProject = z.object({
  id: z.string().uuid(),
  canonicalId: z.string().min(1),
  citySlug: z.string().min(1),
  numeroDossier: z.string().min(1),            // "2025-0059"
  adresse: z.string().nullable().default(null),
  targetZoneId: z.string().uuid().nullable().default(null),
  targetLotIds: z.array(z.string().uuid()).default([]),
  derogationSummary: z.record(z.unknown()).default({}),  // jsonb : usage/densite/hauteur derogees
  stageId: z.string().uuid().nullable().default(null),   // FK RegulatoryStage (meme cycle)
  rawRef: z.string().min(1),
  verification: Verification,
  evidence: z.array(EvidenceItem).default([]),
});

// ESQUISSE - cptaq_decisions (VISION priorite 4, 8/10 : dezonage agricole)
export const CPTAQDecision = z.object({
  id: z.string().uuid(),
  canonicalId: z.string().min(1),
  numeroDossier: z.string().min(1),            // dossier CPTAQ (cle provinciale)
  citySlug: z.string().min(1),
  kind: z.enum(["demande", "decision", "appui-municipal", "portee-collective"]),
  outcome: z.enum(["accordee", "refusee", "en-cours", "non-disponible"]).default("non-disponible"),
  lotIds: z.array(z.string().uuid()).default([]),
  decidedOn: isoDateSchema.nullable().default(null),
  rawRef: z.string().min(1),
  verification: Verification,
  evidence: z.array(EvidenceItem).default([]),
});
```

### 4.4 Delta 4 : la projection (canonique validee -> relationnel)

Un **job de projection** (idempotent, rejouable) lit la couche ontologie validee et
materialise/met a jour les tables relationnelles. C'est le point unique d'ecriture du
relationnel d'exploitation.

```ts
// ESQUISSE de contrat (non implemente)
interface OntologyProjection {
  // rejoue les patches validees -> upsert canonique relationnelle + relations
  projectValidatedCanonicals(sincePatchId?: string): Promise<ProjectionReport>;
  // ASSIGNED_ZONE -> lot_zone_resolutions (avec method/confidence) ; REZONES -> DesignationEvent + ZoneVersion
}
```

- `MENTIONS` validee (`accept_match`) -> `EvidenceItem` + `DERIVED_FROM`.
- `REZONES`/`SPLITS`/`RENAMES`/`MERGES` -> `DesignationEvent` (+ `ZoneVersion` projetee,
  PR#46 section 2-3).
- `SUBDIVIDES` -> `DesignationEvent` `lot-subdivision` + `parentLotIds`.
- `ASSIGNED_ZONE` -> `lot_zone_resolution` (`method`, `confirmed`, `coveragePct`).
- `VALUED_BY` -> `Valuation`.

La **bitemporalite** (validity + knowledge time, choix C3 PR#46) et la **resolution
as-of-date** (PR#46 section 3) restent **inchangees** : elles operent sur le store
relationnel materialise. Le pont `canonicalId` permet de **regenerer** le relationnel
depuis la couche ontologie (la couche ontologie devient la source de verite de
reconciliation ; les events restent la source de verite de l'historique).

### 4.5 Cles multi-villes et provenance

- `citySlug` (FK `CityProfile`) sur **toute** entite ville-scopee (Zone, Bylaw,
  PPCMOIProject, DesignationEvent). `Lot.noLot` et `CPTAQDecision.numeroDossier` sont
  provinciaux mais portent quand meme `citySlug` pour le filtrage.
- `rawRef` (cle S3) + `EvidenceItem` partout (provenance de bout en bout, WP4 0.1).
- `canonicalId` = pont stable vers le graphe ; `reconPatchId` = audit de la decision.

---

## 5. Variabilite multi-villes (CityProfile + SourceBinding)

**L'ontologie est stable ; les bindings varient.** Une ville se decrit par un
`CityProfile` qui capture trois axes de variabilite (regime de zonage, processus
decisionnel, canaux de communication) + un registre de `SourceBinding`.

### 5.1 Les trois axes de variabilite

| Axe | Ce qui varie entre villes | Capture dans `CityProfile` |
|---|---|---|
| **Regime de zonage** | schema de code (H-/Ha-/R1 numerote...), unite de densite (log/ha vs logements vs COS vs UI/ha), format de grille (PDF tableau, HTML, GIS vecteur) | `zoningRegime` |
| **Processus decisionnel** | conseil/consultation, presence d'un **registre referendaire**, PPCMOI active ou non, variantes CPTAQ (demande individuelle vs portee collective), nombre d'etapes d'adoption | `decisionProcess` |
| **Canaux de communication** | CMS des avis publics (Craft, PG Solutions, WordPress...), format des PV, presence d'une chaine YouTube | `channels` |

### 5.2 Esquisse `CityProfile` (elargit PR#46 et WP4 2.3)

```ts
// ESQUISSE - extension du CityProfile de WP4
export const ZoningRegime = z.object({
  codeScheme: z.object({
    regex: z.string(),                          // capture du code de zone propre a la ville
    prefixToKind: z.record(z.string()),         // { "H":"H", "Ha":"H", "R1":"H", "Cv":"C" }
  }),
  densityUnit: z.enum(["log-ha", "logements", "cos", "ui-ha", "non-disponible"]),
  gridFormat: z.enum(["pdf-table", "html", "gis-vector", "non-disponible"]),
});

export const DecisionProcess = z.object({
  hasReferendumRegister: z.boolean(),           // registre referendaire (oui Valleyfield)
  ppcmoiEnabled: z.boolean(),
  cptaqVariants: z.array(z.enum(["individuelle", "appui-municipal", "portee-collective"])).default([]),
  adoptionStages: z.array(RegulatoryStageKind).default([]),  // sous-ensemble applicable
});

export const Channels = z.object({
  cms: z.enum(["craft", "pg-solutions", "wordpress", "voila", "autre", "non-disponible"]),
  avisUrl: z.string().url().nullable().default(null),
  pvFormat: z.enum(["pdf", "html", "video", "non-disponible"]),
  youtubeChannel: z.string().url().nullable().default(null),
});

export const CityProfile = z.object({
  slug: z.string().min(1),                      // "salaberry-de-valleyfield"
  nomOfficiel: z.string().min(1),
  codeMamh: z.string().min(1),                  // "70052"
  dguidStatcan: z.string().nullable().default(null),
  mrcSlug: z.string().min(1),                   // "beauharnois-salaberry"
  bbox: z.object({ minLon: z.number(), minLat: z.number(), maxLon: z.number(), maxLat: z.number() }),
  zoningRegime: ZoningRegime,
  decisionProcess: DecisionProcess,
  channels: Channels,
  aliasOverrides: z.record(z.unknown()).default({}),  // ajustements de normalisation par ville
  sources: z.array(SourceBinding).default([]),
});
```

### 5.3 `SourceBinding` (deja amorce WP4)

Reutilise le contrat WP4 (`prioritySources.ts`) : `{ sourceId, kind, city?, tier,
recommendation, cadence, priority }`. Les sources **provinciales** (role MAMH, cadastre
allege, Adresses Quebec, CPTAQ, BDZI, GRHQ, Donnees Quebec) sont **parametrees par code
geo/DGUID/bbox** -> generalisation gratuite. Les sources **municipales** (avis,
reglements, PPCMOI, PV, plans/grilles) -> **un adaptateur par moteur de CMS**, parametre
par `channels.cms` + URL + selecteurs.

### 5.4 Ce qui reste stable vs ce qui varie

| Element | Stable (partage N villes) | Varie par ville |
|---|---|---|
| `ontology-profile.yaml` (node/relation types) | **oui** | non |
| Tables relationnelles (schema) | **oui** | non |
| `citation_policy`, `hardening`, `reconciliation_policy` | **oui** | non |
| Corpus graphify (`inputs.corpus`) | non | **oui** (raw S3 de la ville) |
| Registres (cadastre/role par code MAMH) | structure stable | **valeurs** par ville |
| Normalisation d'alias | regles QC communes | `aliasOverrides` (zero-pad, lettres) |
| Adaptateurs de source | provinciaux partages | municipaux par CMS |

Ajouter une ville = ajouter une **entree `CityProfile`** + (si CMS inedit) **un
adaptateur de moteur**. Le profil graphify et le schema relationnel **ne changent pas**.

---

## 6. Pipeline de bout en bout (mappe aux 3 etages WP4 + 6 phases PROCESS)

```
[WP4 etage 1 CIBLAGE]
  CityProfile + scope (zones/bylaws/bbox) + SourceBinding[] -> CiblagePlan
  (aucune I/O reseau)
        |
[WP4 etage 2 RECUEIL]
  SourceAdapter.list/fetch -> RawDocument (S3 raw/<kind>/<city>/...) + provenance
  => ces bruts sont l'inputs.corpus de graphify, materialises en noeuds Source
        |
[WP4 etage 3 EXPLOITATION] -- WP5 le decompose en 4 sous-etapes :
  3a. EXTRACTION graphify   : profile dataprep + extract -> MENTIONS (candidate)
                              + relations candidates (MENTIONS/REZONES/GOVERNED_BY...)
  3b. RECONCILIATION        : graphify ontology candidates -> studio/patch
                              -> CANONIQUES validees (accept_match/create_canonical/...)
  3c. PROJECTION (4.4)      : canoniques validees -> store relationnel (Zone/Lot/Bylaw/
                              DesignationEvent/Valuation), bitemporel, as-of-date
  3d. SCORING / SIGNAUX     : du store relationnel -> Signal (T1) + OpportunityDossier (T2)
```

Mapping aux **6 phases PROCESS / PROMPT** :

| Phase PROCESS | Sous-etape WP5 | Entites produites |
|---|---|---|
| 1. Signal reglementaire | 3a+3b+3d | `Bylaw`, `DesignationEvent` (REZONES), `PPCMOIProject`, `CPTAQDecision`, `Signal` |
| 2. Ancrage foncier | 3b+3c | `Lot`/`LotVersion`, `ASSIGNED_ZONE` -> `lot_zone_resolution`, `Valuation` (role) |
| 3. Contraintes | (3c, extension `Constraint`) | filtre CPTAQ/BDZI/GRHQ (option Q8) |
| 4. Enrichissement marche | 3c | `Valuation` (market-estimate, souvent non-disponible Tier C) |
| 5. Contexte strategique | 3a+3d | mentions de contexte (StatCan, MRC) -> evidence de dossier |
| 6. Scoring | 3d | `OpportunityDossier` (5 axes) |

---

## 7. Mapping scoring / signaux

### 7.1 Designation -> Signal T1 (la priorite 1 de VISION, 10/10)

Un **rezonage = `DesignationEvent` de type `zone-rezoning`** (ou `zone-creation` avec
usage H) declenche `RAISES_SIGNAL -> Signal` (`type = "residential-rezoning"`). C'est
le coeur de la veille (VISION 6 priorite 1). PPCMOI et CPTAQ alimentent aussi des
signaux (priorites 2 et 4) :

| Source du signal | Entite | Priorite VISION | Type de Signal |
|---|---|---|---|
| changement densite/usage | `DesignationEvent` REZONES | 1 (10/10) | `residential-rezoning` |
| projet particulier | `PPCMOIProject` | 2 (7/10) | `ppcmoi` |
| derogation densifiante | `DesignationEvent` (derog. retenue) | 3 | `derogation` |
| dezonage agricole | `CPTAQDecision` (demande) | 4 (8/10) | `cptaq-dezonage` |

### 7.2 Valuation -> axes de scoring (inchange vs PR#46 section 4)

Scoring PROCESS = 5 axes (potentiel 30 / risque 20 / timing 20 / faisabilite 15 /
marche 15). La valuation alimente :

- **marche (15)** : `market-estimate` uniquement. Le role d'evaluation **n'est pas** un
  prix de marche -> si pas de comparable Tier C, axe `non-disponible`, poids
  renormalises, reco plafonnee a "surveillance" (anti-invention, PROCESS 5).
- **potentiel (30)** : `upside = densite cible (ZoneVersion apres REZONES) x valeur
  terrain (role)`. Module le potentiel sans remplacer l'ampleur reglementaire.
- **faisabilite (15)** : ratio `valeurBatiment / valeurTerrain` du role = **pre-filtre**
  de sous-densification (ratio bas = candidat), pas une ponderation.
- **timing (20)** : alimente par `RegulatoryStage` (adopte mais registre referendaire
  ouvert -> timing prudent ; en-vigueur -> timing chaud).

### 7.3 Gel des scores (reproductibilite)

Reproduire un score passe = `gridVersion` fige (deja dans `AxisScore`) + `knownAt` fige
(knowledge time, choix C3 PR#46) + `reconPatchId` (etat de reconciliation a la date).
Le pont canonique ajoute la **3e dimension** : on sait quelle decision de reconciliation
etait validee a K.

---

## 8. Questions ouvertes (sign-off) + ce qui differe de PR#46

### 8.1 Ce que WP5 ajoute a PR#46 (le delta)

| PR#46 (SPEC_DESIGN_DATA_MODEL) | WP5 (ce document) |
|---|---|
| brut -> relationnel par parseur deterministe (1 CMS) | brut -> **mentions graphify -> reconciliation human-in-the-loop** -> relationnel |
| `bylaw` = string sur l'evenement | `Bylaw` **entite canonique** + `RegulatoryStage` (cycle legal) |
| PPCMOI/CPTAQ noyes dans Signal/Event | `PPCMOIProject`, `CPTAQDecision` **entites de plein droit** |
| pas de couche provenance documentaire | `Source` source-backed + `MENTIONS`/`DERIVED_FROM` + citation obligatoire |
| pas de pont graphe | colonnes `canonicalId`/`reconStatus`/`reconPatchId` (pont + audit) |
| reconciliation implicite | **studio + patch lifecycle** (`graphify_ontology_patch_v1`, 9 ops) |
| multi-villes par `citySlug` | + **profils de variabilite** (zoningRegime/decisionProcess/channels) |

Les fondations PR#46 (bitemporel C3, as-of-date, choix A2/B2/D2, `EvidenceItem`,
questions 1-8) sont **conservees telles quelles** et restent a valider en parallele.

### 8.2 Questions ouvertes specifiques a l'ontologie

1. **Embarquer la SPA studio (option A) ou piloter par API/MCP (option B) ?**
   *Preco : A pour la V1 (fidelite graphify, moins de code), B si l'UX l'exige.*
2. **Frontiere canonique <-> relationnel : projection (job rejouable) ou dual-write ?**
   *Preco : projection unidirectionnelle (canonique validee -> relationnel) ; le
   relationnel ne reecrit jamais le graphe.*
3. **Autonomie de reconciliation : auto-accept au-dela d'un seuil ou toujours humain ?**
   *Preco : auto proposable a `score >= 0.95` pour cles provinciales (Lot, CPTAQ) ;
   **revue humaine obligatoire** pour tout signal T1 (REZONES).*
4. **Normalisation d'alias : dans le profil graphify (registries) ou dans
   `CityProfile.aliasOverrides` ?** *Preco : regles QC communes dans le profil ; seuls
   les ecarts par ville (zero-pad, lettres) dans `aliasOverrides`.*
5. **Reutilisation de code de zone dans le temps : comment borner l'identite canonique ?**
   *Preco : reconciliation contrainte par `(Municipality, periode active)` ; l'identite
   reste `(zone_id, periode)`, jamais le code (coherent PR#46).*
6. **`DesignationEvent` : noeud canonique reconcilie ou pure projection ?** Il est a la
   fois mentionne (dans les PV) et calcule. *Preco : canonique reconciliable (un PV
   "scission de H-143" est une mention), materialise ensuite en event relationnel.*
7. **Profil graphify : un seul partage (preco) avec `inputs.corpus` par ville, ou un
   profil par ville ?** *Preco : un seul profil ; le corpus et les registres varient.*
8. **`Constraint` (CPTAQ zone agricole / BDZI / GRHQ) : noeud de plein droit en V1 ou
   plus tard ?** *Preco : plus tard (extension flaggee) ; en V1, les contraintes restent
   un filtre geospatial de l'etage exploitation, pas un noeud reconcilie.*
9. **PII / registre foncier : confirme hors modele (LFM 72 + Loi 25), aucun noeud
   personne ?** *Preco : oui, hors perimetre ; table separee a acces journalise si un
   jour sourcee.*

---

## 9. Recapitulatif du perimetre de ce document

- **Ecrit ici** : ce seul fichier (`docs/spec/SPEC_ONTOLOGY_DATA_MODEL.md`).
- **Non ecrit** : aucun `ontology-profile.yaml` reel, aucun schema Zod/Drizzle reel,
  aucune migration, aucun code. Les blocs YAML/ts/sql sont des **esquisses** de design
  pour le sign-off.
- **Prochain pas (apres validation)** : geler le profil graphify, brancher l'etage
  EXPLOITATION WP4 (3a-3d) sur la couche ontologie, implementer les deltas relationnels
  (Bylaw/RegulatoryStage/PPCMOIProject/CPTAQDecision + pont canonique) et le job de
  projection, en coherence avec le jalon J4 de `SPEC_PLAN_SCRAPING.md`.
