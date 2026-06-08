# SPEC_ONTOLOGY - Ontologie graphify-ready + modele de donnees multi-villes (zonage, lots, designation, contraintes, valuation)

> **Statut** : PROPOSITION DE DESIGN (WP5) - **v2 SIGNABLE**. **Aucun code n'est ecrit.**
> Les blocs YAML (profil graphify), Zod et PostGIS/Drizzle sont des **esquisses**
> (sketches) de design, pas des migrations ni des fichiers de profil exploitables.
>
> **Branche** : `feat/ontology-data-model` (off `main`), PR #47.
> **Auteur** : assistant radar.
> **Date** : 2026-06-07. **Revision** : v2 (corrections double-revue senior, voir ci-dessous).
> **Lot de travail** : WP5 (ontologie + modele de donnees), au-dessus de WP4 (scraping).
>
> **Pourquoi v2** : deux revues senior independantes (codex 5.5 + opus 4.8) ont conclu
> "architecture solide mais PAS signable en l'etat", parce que la v1 **survendait ce que
> graphify garantit**. v2 reecrit chaque garantie en distinguant strictement ce que la
> **source graphify** fait reellement de ce qui releve de la **politique radar (wrapper)**.
> Toutes les affirmations "graphify" ci-dessous sont verifiees contre la source
> (`src/ontology-profile.ts`, `src/ontology-reconciliation.ts`, `src/ontology-patch.ts`,
> `src/types.ts`, `tests/fixtures/profile-demo/graphify/ontology-profile.yaml`).
>
> **Inputs lus (tout est ancre dessus)** :
> `docs/spec/input/VISION.md`, `docs/spec/input/PROMPT.md` (6 phases analyste),
> `docs/spec/input/PROCESS.md` (pipeline 6 etapes + scoring 5 axes),
> `docs/spec/SPEC_DESIGN_DATA_MODEL.md` (le design relationnel PR#46 a **elever**),
> `docs/spec/SPEC_PLAN_SCRAPING.md` (WP4 : ciblage/recueil/exploitation, SourceBinding),
> graphify : `src/ontology-profile.ts`, `src/ontology-reconciliation.ts`,
> `src/ontology-patch.ts`, `src/types.ts`,
> `tests/fixtures/profile-demo/graphify/ontology-profile.yaml`,
> `tests/fixtures/profile-demo/graphify.yaml`,
> `ui/src/lib/onboarding/onboarding-data.ts` (liste multi-villes).

---

## Decisions D1-D6 (validees)

Six decisions tranchees avant ce sign-off ; elles ferment les questions ouvertes
critiques de la v1 et structurent le reste du document.

| # | Decision | Resout |
|---|---|---|
| **D1** | **Un projet graphify par ville** (corpus + `state_dir` par ville) + **un graphe provincial distinct** pour les cles province-wide (`Lot`, `Adresse`, CPTAQ). Le **profil** est partage ; ce sont les **projets** qui sont par ville. `citySlug` + periode active sont **encodes dans les `normalized_terms`/ids** avant l'appel graphify. | La "contrainte municipale du generateur de candidats" de la v1 etait **fictive** (graphify ne filtre pas par municipalite). |
| **D2** | **`Constraint` en V1** : noeud source-backed + relation `CONSTRAINS` pour CPTAQ zone-agricole / BDZI (inondable) / GRHQ (hydro). L'**axe risque (20 %)** lit des `ConstraintHit` evidence-backed (`source`/`date`/`confidence`/`evidence_refs`). Servitudes/PIIA restent `manual-check`. | L'axe risque (2e poids du scoring) n'avait **aucun foyer auditable** en V1. |
| **D3** | **Frontiere graphify vs politique radar** explicite. `reconciliation_policy`/`acceptance_rules` sont **inertes dans graphify** (le parseur les ignore) -> les transitions de statut passent par `hardening.status_transitions`, et les regles d'acceptation/revue deviennent une **politique radar** appliquee par un **validateur radar avant projection** (bloquant). | La v1 presentait des hints de prompt comme des gates durs graphify. |
| **D4** | **Coupe V1/V2**. V1 minimum : `Municipality, Zone, Bylaw, DesignationEvent, Constraint, Source, Signal` (profil graphify) + `Lot, Valuation, Adresse` (registre/relationnel) ; `OpportunityDossier` reste **relationnel** (jamais un noeud graphify). PPCMOI/CPTAQ/derogations en V1 = **sous-types de `DesignationEvent` + `Signal`** ; promus en noeuds dedies en V2. | Reduit la sur-ingenierie (15 noeuds + 15 relations concus avant la 2e ville). |
| **D5** | **Contrat bitemporel** : `projectAsOf(knownAt)` ajoute au contrat de projection ; `patch.created_at -> knownFrom` ; correction d'une mauvaise reconciliation = **patch compensatoire** (append-only) ; replay as-of. **PR#46 (base relationnelle bitemporelle) = PREREQUIS explicite**, pas un chantier parallele. | graphify n'a **aucune** requete temporelle ; le bitemporel etait hand-wave. |
| **D6** | **Intentions et signaux faibles de premier ordre** : `Signal` typé `intention`/`precedent` (PV "la ville est ouverte a densifier ce secteur", PPCMOI comme precedent reglementaire), relié au reel par `TARGETS_ZONE`/`MENTIONS` + preuve. | VISION 7 demande de reconstruire les **intentions** municipales, pas seulement les faits. |

---

## Reste graphify vs politique radar (table de verite)

Verifie contre la source graphify. **Ne jamais** compter sur graphify pour ce qui est en
colonne droite : c'est radar qui doit l'implementer/garantir.

| Garantie | graphify (source verifiee) | politique radar (wrapper, hors graphify) |
|---|---|---|
| Profil valide (node/relation types existent, statuts connus) | **OUI** `validateOntologyProfile` (`ontology-profile.ts`) | - |
| Endpoint rules sur `add_relation` (source/target autorises) | **OUI** `validateAddRelation` (`ontology-patch.ts:380`) | - |
| `evidence_refs` non vide **et** refs connues sur tout patch | **OUI** `validateEvidenceRefs` (`ontology-patch.ts:333`) | - |
| Transitions de statut `from -> to` | **OUI** *si* `hardening.status_transitions` defini (`ontology-profile.ts:119`, `ontology-patch.ts:344`) ; si absent, **tout** est permis | - |
| Candidats `entity_match` (meme type + termes normalises partages) | **OUI** `generateOntologyReconciliationCandidates` (`ontology-reconciliation.ts:214`) | - |
| Scope **ville/periode** des candidats | **NON** - aucun filtre municipalite ; `reasons` est texte decoratif | **OUI** (D1 : un projet par ville + `citySlug`/periode encodes dans `normalized_terms`/ids) |
| `registry_match` (un `Lot` matche le cadastre autoritaire) | **NON** - `promotion_requires` n'est qu'un hint **re-surface au prompt** (`profile-prompts.ts`), aucun validateur | **OUI** (validateur radar avant projection) |
| Revue humaine obligatoire pour `REZONES`/signal T1 | **NON** - hint de prompt | **OUI** (validateur radar : `REZONES` sans patch humain = bloque) |
| Preuve **directe** d'une relation (pas juste un ref qui existe) | **NON** - seule l'existence des refs est verifiee | **OUI** (validateur radar) |
| `reconciliation_policy` / `acceptance_rules` | **NON** - **ignore par le parseur**, inerte, ne participe meme pas au `profile_hash` | **OUI** (regles d'acceptation cote radar) |
| Bitemporel / as-of (`projectAsOf`) | **NON** - patches append-only `created_at`, aucune requete temporelle | **OUI** (replay `applied-patches.jsonl <= knownAt` + store relationnel PR#46) |
| `inference_policy` / `evidence_policy` (contraintes de relations/preuves) | **OUI** - parses et valides (`ontology-profile.ts:140-158`) | (on s'en sert ; voir 1.3) |

---

## 0. Cadre : pourquoi une couche ontologie au-dessus du relationnel

### 0.1 Le manque que WP5 comble (delta vs le design relationnel PR#46)

`SPEC_DESIGN_DATA_MODEL.md` (PR#46) livre un excellent **modele relationnel** :
Zone/ZoneVersion, Lot/LotVersion, DesignationEvent, Valuation, lot_zone_resolution,
bitemporalite, resolution as-of-date, CityProfile. Mais il **suppose le passage du
brut au relationnel resolu** par un parseur deterministe (le connecteur Craft CMS de
Valleyfield). Deux limites des qu'on sort de la ville pilote :

1. **Le brut est non structure et multi-format.** Avis publics PDF, proces-verbaux
   scannes, videos YouTube transcrites, articles de presse, XML de role. La meme chose
   reelle (`H-609-4`, le reglement `150-49`, le lot `3 819 015`) y apparait sous des
   **graphies variables** et eparses. Un parseur par CMS ne suffit pas a N villes.
2. **L'utilisateur veut des ecrans de reconciliation / mapping d'entites.** VISION et
   PROCESS exigent de **relier les documents entre eux** (VISION 4.4, 7), avec **trace de
   preuve** sur chaque fait (PROCESS 5). C'est un probleme de **graphe de connaissance
   reconcilie human-in-the-loop**.

WP5 insere une **couche knowledge graph (graphify)** entre le recueil (WP4 etage 2) et le
store relationnel (WP4 etage 3) :

```
brut (Source) -> [extraction radar 3a : NER + normalisation QC] -> MENTIONS deja normalisees
   -> graphify (candidats entity_match -> studio/patch -> CANONIQUE validee)
   -> [validateur radar] -> projection relationnelle bitemporelle (Zone/Lot/Bylaw/...)
   -> scoring / Signal
```

Le **relationnel reste la verite d'exploitation** (requetes as-of-date, scoring) ; la
couche ontologie est la **verite de reconciliation** (quelle graphie de quel document
designe quelle entite canonique, avec quelle preuve et quelle decision humaine).

> **Prerequis (D5)** : PR#46 (base relationnelle, bitemporel C3, resolution as-of-date)
> est un **prerequis** de WP5, pas un chantier parallele. La derivation `knownAt` en
> projection (4.4) depend de decisions PR#46 ; WP5 ne peut etre implemente avant.

### 0.2 Principes directeurs (regles cardinales)

- **Anti-invention** : une valeur non obtenue = `non-disponible` explicite ; une
  reconciliation non confirmee reste `candidate`, jamais `validated` (PROCESS 5).
- **Brut avant extraction** : les noeuds `Source` pointent la cle S3
  `raw/<kind>/<city>/<Y>/<M>/<D>/<sha>.<ext>` ; aucune re-extraction ne re-fetch.
- **Citation obligatoire** : toute mention/relation porte des `evidence_refs`
  (source + page/bbox). graphify **garantit** la presence et l'existence des refs
  (`validateEvidenceRefs`) ; la **preuve directe** (le ref designe bien la relation) est
  un gate **radar** (voir table de verite).
- **Multi-villes des le depart (D1)** : l'ontologie (le **profil**) est **stable** ;
  ce qui varie par ville vit dans `CityProfile` + `SourceBinding[]` et dans le **projet**
  graphify (corpus + `state_dir`) propre a chaque ville. Aucune logique "Valleyfield" en dur.
- **PII hors modele** : **aucun noeud proprietaire/personne** (LFM art. 72 + Loi 25).
  L'`owner` reste `non-disponible`/`manual-check` (voir 7.4). Le registre foncier, s'il est
  un jour source, sera une table separee a acces journalise, hors de ce design.

### 0.3 Perimetre multi-villes initial

Municipalites referencees (`ui/src/lib/onboarding/onboarding-data.ts`, MRC
Beauharnois-Salaberry et voisinage) : **Salaberry-de-Valleyfield** (`70052`, pilote, seule
peuplee), **Beauharnois**, **Vaudreuil-Dorion**, **Chateauguay**, **Mercier**,
**Saint-Constant**, **Saint-Jean-sur-Richelieu**, **Sorel-Tracy**. Le modele generalise a N
villes aux **regimes de zonage, processus decisionnels et canaux differents** (section 5).

---

## 1. Ontologie (profil graphify) - V1

Esquisse d'`ontology-profile.yaml` au **format reel de graphify** : le parseur
(`validateOntologyProfile`, `ontology-profile.ts`) ne lit que `node_types`, `relation_types`,
`registries`, `citation_policy`, `hardening`, `inference_policy`, `evidence_policy`,
`hierarchies`, `outputs`. **Tout autre bloc est silencieusement ignore** (raison pour
laquelle la v1 `reconciliation_policy` etait inerte). Le **profil est partage** par toutes
les villes (section 5.4) ; ce sont les **projets** (`graphify.yaml`, section 6) qui sont par
ville.

### 1.1 Noeuds (node types) - perimetre V1 (D4)

10 types de noeuds en V1, classes par role graphify : **reconcilie** (mentionne a travers
des documents, alias + reconciliation), **registre** (donnee autoritaire CSV/JSON/XML),
**source-backed** (porteur de preuve), **derive** (projection, hors reconciliation).

| Node type | Role graphify | Identifie le concept reel | Reconcilie ? | V1/V2 |
|---|---|---|---|---|
| `Municipality` | registre (`municipalities`) | une ville (slug + code MAMH 70052) | non (autoritaire) | **V1** |
| `Zone` | **reconcilie** + hardenable | une zone reglementaire (`H-609-4`, `U-521`) | **oui** | **V1** |
| `Bylaw` (reglement) | **reconcilie** + hardenable | un reglement (`150-49`, `2024-58`) | **oui** | **V1** |
| `DesignationEvent` | **reconcilie** + hardenable | un changement date+source (rezonage, scission, PPCMOI, CPTAQ, derogation) | **oui** | **V1** |
| `Constraint` | **source-backed** (D2) | une contrainte (CPTAQ agricole, BDZI inondable, GRHQ hydro) | non (registre geo source-backed) | **V1** |
| `Lot` | registre (`cadastre`) + reconcilie leger | un lot cadastral (`NO_LOT` 3 819 015) | **oui** (graphies PDF -> cadastre autoritaire) | **V1** |
| `Adresse` | registre (`adresses_qc`) (D-opus) | une adresse normalisee (Adresses Quebec, cle provinciale) | **oui** (graphies en avis) | **V1** |
| `Valuation` | registre (`role`) / derive | valeur datee (role / estimation marche) | non | **V1** |
| `Source` (Document) | **source_backed** | un document brut (avis PDF, PV, role XML, video) | non (porteur de preuve) | **V1** |
| `Signal` | derive | un signal de veille (rezonage, ppcmoi, cptaq, **intention**, **precedent**) | non | **V1** |

> **Differé en V2 (D4), avec justification** :
> - `PPCMOIProject`, `CPTAQDecision` : en V1, captures comme **sous-types de
>   `DesignationEvent`** (`subtype: ppcmoi` / `cptaq`) + `Signal` (kind correspondant) +
>   relations `TARGETS_ZONE`/`TARGETS_LOT`. Ils portent deja preuve et alimentent le
>   scoring. **Promotion en noeuds dedies en V2** quand une 2e ville prouve la variance de
>   processus (eviter d'ajouter de la surface de reconciliation sur un pilote mono-ville).
> - `ZoneVersion`, `LotVersion`, `RegulatoryStage` : **projections relationnelles** (4.x),
>   pas des noeuds graphify (ils ne sont pas reconcilies, ils sont calcules).
> - `Region` (MRC) : couche regionale, attribut `mrcSlug` sur `Municipality` en V1 ;
>   noeud en V2 si une vue MRC l'exige.
> - `MinorVarianceDecision` : V1 = `DesignationEvent subtype minor-variance` (7.1) ; noeud
>   dedie en V2.
> - `OpportunityDossier` : **reste relationnel** (assemble par le scoring), **jamais** un
>   noeud graphify (rien a reconcilier ; le sortir du profil reduit le bruit du graphe).

```yaml
# docs/spec : ESQUISSE d'ontology-profile.yaml (format graphify reel, V1)
id: radar-immobilier-zonage
version: 1
default_language: fr

node_types:
  Municipality:
    aliases: [ville, municipalite]
    registry: municipalities
  Zone:
    aliases: [zone, zonage, secteur de zonage]
    status_policy: hardenable        # passe par la reconciliation
  Bylaw:
    aliases: [reglement, regl, amendement, projet de reglement]
    status_policy: hardenable
  DesignationEvent:
    aliases: [changement de zonage, rezonage, scission, fusion, renommage, subdivision, ppcmoi, derogation, dezonage]
    status_policy: hardenable
  Constraint:
    aliases: [contrainte, zone agricole, zone inondable, bande riveraine, milieu humide]
    source_backed: true              # CPTAQ/BDZI/GRHQ : porteur de preuve
  Lot:
    aliases: [lot, lot cadastral, numero de lot, matricule]
    registry: cadastre               # NO_LOT autoritaire (cadastre du Quebec)
    status_policy: hardenable        # graphies PDF reconciliees au lot autoritaire
  Adresse:
    aliases: [adresse, no civique, adresse municipale]
    registry: adresses_qc            # Adresses Quebec (cle provinciale)
    status_policy: hardenable
  Valuation:
    aliases: [valeur, role d'evaluation, valeur fonciere, evaluation municipale]
    registry: role
  Source:
    source_backed: true              # avis PDF, PV, role XML, video, article
  Signal:
    aliases: [signal, alerte, intention, precedent]
```

### 1.2 Relations (relation types) - V1

Chaque relation a une **endpoint rule** (verifiee par `validateAddRelation`), une exigence
de citation et une politique de statut.

| Relation | source -> target | Semantique | Citation | Hardenable |
|---|---|---|---|---|
| `LOCATED_IN` | Zone, Lot, Adresse -> Municipality | localisation administrative | oui | non |
| `LOCATED_AT` | Lot -> Adresse | un lot porte une/des adresse(s) (les avis citent souvent l'adresse) | oui | oui |
| `GOVERNED_BY` | Zone -> Bylaw | la zone est regie par un reglement | **oui** | oui |
| `AMENDS` | Bylaw -> Bylaw | `150-49-1` **amende** `150-49` (representation **unique** de l'amendement ; `AMENDED_BY` = vue inverse derivee) | **oui** | oui |
| `REZONES` | DesignationEvent -> Zone | changement usage/densite (le **signal**) | **oui** | oui |
| `SPLITS` | DesignationEvent -> Zone | scission (H-143 -> H-143 + H-143-1) | **oui** | oui |
| `RENAMES` | DesignationEvent -> Zone | renommage a limites constantes (U-521 -> H-521) | **oui** | oui |
| `MERGES` | DesignationEvent -> Zone | fusion | **oui** | oui |
| `SUBDIVIDES` | DesignationEvent -> Lot | filiation cadastrale (123 -> 123-1/-2) | **oui** | oui |
| `TARGETS_ZONE` | DesignationEvent -> Zone | l'evenement (ppcmoi/derogation/cptaq/intention) **concerne** une zone sans la rezoner | **oui** | oui |
| `TARGETS_LOT` | DesignationEvent -> Lot | l'evenement concerne des lots precis (ppcmoi/cptaq) | **oui** | oui |
| `ASSIGNED_ZONE` | Lot -> Zone | assignation datee (avec `method`/`confidence`) | oui | oui |
| `VALUED_BY` | Lot -> Valuation | rattachement d'une valeur datee (**par lot/matricule**, pas par zone) | oui | non |
| `CONSTRAINS` | Constraint -> Lot, Zone | une contrainte (CPTAQ/BDZI/GRHQ) pese sur un lot/une zone (D2) | **oui** | oui |
| `DERIVED_FROM` | (toute entite reconciliee) -> Source | provenance validee d'un fait | **oui** | non |
| `MENTIONS` | Source -> Zone, Bylaw, DesignationEvent, Constraint, Lot, Adresse | un document mentionne une entite (graphie brute) | **oui** | oui (mention->canonique) |
| `SUPERSEDES` | DesignationEvent -> DesignationEvent | chaine de remplacement d'evenements | oui | non |
| `RAISES_SIGNAL` | DesignationEvent -> Signal | un fait declenche un signal de veille | oui | non |

> **Amendement, representation unique (D4 / correction double-revue)** : l'amendement de
> reglement est porte par **la seule arete `AMENDS`** (Bylaw -> Bylaw). `AMENDED_BY` est sa
> **vue inverse** (non stockee). Le champ relationnel `amendsBylawId` (4.2) est **derive en
> projection** depuis l'arete `AMENDS`, jamais saisi a la main : on supprime ainsi la
> double modelisation v1 (arete `SUPERSEDES` + FK + mention textuelle "AMENDS"). `SUPERSEDES`
> est reserve aux **chaines d'evenements** (DesignationEvent), pas aux reglements.

> **MENTIONS vs DERIVED_FROM** : `MENTIONS` est la **graphie brute** detectee (candidate, a
> reconcilier) ; `DERIVED_FROM` est la **provenance validee** d'un fait (apres
> reconciliation). Une mention acceptee (`accept_match`) devient un `DERIVED_FROM` portant
> les memes `evidence_refs`.

> **`HAS_STAGE` (cycle legal)** : en V1, `RegulatoryStage` est une **projection
> relationnelle** (4.2), donc `HAS_STAGE` (Bylaw -> RegulatoryStage) est une **arete
> relationnelle**, pas une relation du profil graphify. Elle deviendra une relation graphify
> en V2 quand `RegulatoryStage` sera promu noeud. Idem `FEEDS_DOSSIER` (vers
> `OpportunityDossier`, qui reste relationnel) : edge **relationnel** uniquement.

```yaml
relation_types:
  located_in:   { source: [Zone, Lot, Adresse], target: Municipality }
  located_at:   { source: Lot, target: Adresse, requires_evidence: true }
  governed_by:  { source: Zone, target: Bylaw, requires_evidence: true }
  amends:       { source: Bylaw, target: Bylaw, requires_evidence: true }
  rezones:      { source: DesignationEvent, target: Zone, requires_evidence: true }
  splits:       { source: DesignationEvent, target: Zone, requires_evidence: true }
  renames:      { source: DesignationEvent, target: Zone, requires_evidence: true }
  merges:       { source: DesignationEvent, target: Zone, requires_evidence: true }
  subdivides:   { source: DesignationEvent, target: Lot, requires_evidence: true }
  targets_zone: { source: DesignationEvent, target: Zone, requires_evidence: true }
  targets_lot:  { source: DesignationEvent, target: Lot, requires_evidence: true }
  assigned_zone:{ source: Lot, target: Zone }
  valued_by:    { source: Lot, target: Valuation }
  constrains:   { source: Constraint, target: [Lot, Zone], requires_evidence: true }
  derived_from: { source: [Zone, Bylaw, DesignationEvent, Constraint, Lot, Adresse, Valuation], target: Source, requires_evidence: true }
  mentions:     { source: Source, target: [Zone, Bylaw, DesignationEvent, Constraint, Lot, Adresse], requires_evidence: true }
  supersedes:   { source: DesignationEvent, target: DesignationEvent }
  raises_signal:{ source: DesignationEvent, target: Signal }
```

### 1.3 Registres, citation, hardening, evidence/inference policy, outputs

graphify-reel : on utilise `hardening.status_transitions` (transitions reellement
appliquees), `evidence_policy` et `inference_policy` (reellement parses et valides) **a la
place** du bloc `reconciliation_policy` v1 (inerte). `promotion_requires` reste, mais on
**sait** qu'il n'est que **re-surface au prompt** : son enforcement reel est le validateur
radar (3.5, 4.4).

```yaml
registries:
  municipalities:
    source: municipalities          # CSV : code MAMH, slug, nom, DGUID, mrc
    id_column: code_mamh
    label_column: nom_officiel
    alias_columns: [slug]
    node_type: Municipality
  cadastre:
    source: cadastre                # cadastre allege QC : NO_LOT autoritaire
    id_column: no_lot
    label_column: no_lot
    node_type: Lot
  adresses_qc:
    source: adresses_qc             # Adresses Quebec : cle provinciale
    id_column: id_adresse
    label_column: adresse_complete
    node_type: Adresse
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

# evidence_policy : REELLEMENT parse/valide (ontology-profile.ts:148). Exige des refs sur
# les relations porteuses de signal et les contraintes -> citation obligatoire cote graphify.
evidence_policy:
  require_evidence_refs: true
  min_refs: 1
  relation_types: [governed_by, amends, rezones, splits, renames, merges, subdivides, constrains, mentions, derived_from]
  node_types: [Constraint]

# inference_policy : REELLEMENT parse/valide (ontology-profile.ts:140). On interdit toute
# relation inferee non listee -> graphify ne fabrique pas de relation hors de ce set.
inference_policy:
  allow_inferred_relations: false
  allowed_relation_types: [located_in, located_at, assigned_zone, valued_by]
  require_evidence_refs: true

# hardening.status_transitions : la SEULE mecanique de transition appliquee par graphify
# (ontology-patch.ts:344). Le bloc v1 reconciliation_policy.status_transitions etait inerte.
hardening:
  statuses: [candidate, attached, needs_review, validated, rejected, superseded]
  default_status: candidate
  promotion_requires:               # NOTE : re-surface au prompt seulement, PAS un gate dur
    - source_citation
    - allowed_relation_type
    - registry_match_for_registered_types   # enforce par le VALIDATEUR RADAR (4.4)
  status_transitions:
    - { from: [candidate], to: [needs_review, validated, rejected] }
    - { from: [attached],  to: [needs_review, validated, rejected] }
    - { from: [needs_review], to: [validated, rejected] }
    - { from: [validated], to: [superseded] }
    # depuis rejected/superseded : aucune transition (etats terminaux)

outputs:
  ontology:
    enabled: true
    canonical_node_types: [Zone, Bylaw, DesignationEvent, Constraint, Lot, Adresse]
    source_node_types: [Source]
    relation_exports: [governed_by, amends, rezones, constrains, assigned_zone, raises_signal]
    wiki:
      enabled: true
      page_node_types: [Zone, Bylaw]
```

---

## 2. Entites canoniques + modele mention / alias

### 2.1 Le probleme : meme chose reelle, graphies eparses

La meme zone, le meme reglement, le meme lot apparaissent differemment selon le document :

- `H-609-4` : "zone H-609-4", "H 609-4", "h609-4", "zone H609.4", "secteur H-609-4".
- `150-49` : "Reglement 150-49", "Regl. no 150-49", "R. 150-49", "150-49-1" (amendement).
- `3 819 015` : "lot 3 819 015", "3819015", "3 819 015 du cadastre du Quebec", matricule
  "RL0104C" (cle differente du NO_LOT).
- `2025-0059` : "PPCMOI 2025-0059", "projet particulier 2025-0059", "dossier 2025-0059".

graphify modelise une **entite canonique** (`label`, `aliases`, `type`, `status`,
`source_refs`, `normalized_terms`) et y rattache les **mentions** variantes, qui
**s'effondrent** en un seul noeud via la generation de candidats `entity_match`.

### 2.2 Normalisation d'alias - **dans l'extraction radar (3a), AVANT graphify**

> **Ou tourne la normalisation (correction double-revue)** : graphify n'a **aucun** concept
> de normalisation/regex par ville (son matching de candidats est generique :
> `ontology-reconciliation.ts` compare des `normalized_terms` deja calcules). Donc **toutes
> les regex QC tournent dans l'extraction radar (etape 3a), AVANT graphify**. graphify ne
> voit que des `label`/`aliases`/`normalized_terms` **deja normalises**.
> `CityProfile.zoningRegime.codeScheme` **surcharge** le defaut QC par ville (section 5).

Chaque type produit une forme normalisee (`normalized_terms`) qui sert a generer les
candidats. **Encodage du scope (D1)** : pour les cles ville-scopees, on **prefixe** les
`normalized_terms` et l'`id` canonique par `citySlug` **et la periode active**, de sorte que
la generation de candidats graphify (qui ne connait ni ville ni periode) reste naturellement
bornee.

| Entite | Regex de capture (radar 3a) | Normalisation -> `normalized_terms` | Portee d'unicite | Encodage scope |
|---|---|---|---|---|
| **Zone** | `([A-Z]{1,4})[\s\-.]?(\d+)([\-.]\d+)*` | upper, separateur `-`, prefixe -> `kind` (H/C/U/I/P/A) | **ville + periode** | `zone::<citySlug>::<periode>::H-609-4` |
| **Bylaw** | `(?:regl(?:ement)?\.?\s*(?:n[o°]\s*)?)?(\d{2,4}(?:-\d+)+)` | strip "reglement/regl./no/#", token a tirets | **ville** | `bylaw::<citySlug>::150-49` |
| **DesignationEvent** | derive de la phrase declencheuse (verbe + cible) | `subtype` + cible normalisee | **ville + periode** | `event::<citySlug>::<periode>::...` |
| **Lot** | `(\d{1,3}(?:[\s ]\d{3})+|\d{6,8})` | strip espaces (et insecables) -> entier | **provinciale** (cadastre QC) | `lot::<no_lot>` (graphe provincial) |
| **Adresse** | parser civique QC (no + voie + municipalite) | forme canonique Adresses Quebec | **provinciale** | `adresse::<id_adresse>` (graphe provincial) |

> **Cle ville-scope vs provinciale** : `Zone`, `Bylaw`, `DesignationEvent` ont une cle
> **ville-scopee** (le code `H-1` existe dans 50 villes) -> reconciliees dans le **projet
> graphify de la ville** (D1). `Lot`, `Adresse` (et `CPTAQDecision` en V2) ont une cle
> **provinciale** -> reconciliees dans le **graphe provincial distinct** (D1). C'est le
> **partitionnement du corpus** qui borne les candidats, pas un filtre municipalite (qui
> n'existe pas dans graphify).

### 2.3 Forme d'un candidat (vocabulaire graphify reel)

`generateOntologyReconciliationCandidates` (`ontology-reconciliation.ts:214`) produit des
`entity_match` deterministes : il compare les noeuds de **meme `type`** ayant des
**`normalized_terms` partages**, score 0.95 (match de label exact) ou 0.8 (termes partages,
plus un `statusBoost` de 0.05 si l'un est deja plus avance), et **genere `reasons` de facon
mecanique** (`same node type: X`, `shared normalized term(s): ...`). **Aucune** notion de
municipalite ; le scope est garanti par le **projet par ville** (D1). Forme reelle :

```jsonc
{
  "schema": "graphify_ontology_reconciliation_candidates_v1",
  "candidates": [{
    "id": "reconcile:<sha24>",                   // hash deterministe (canonical|candidate|terms)
    "kind": "entity_match",
    "status": "candidate",
    "score": 0.95,                               // 0.95 = label exact ; 0.8 = termes partages
    "candidate_id": "mention-avis-150-49-p3",    // la graphie brute "zone H 609-4"
    "canonical_id": "zone::salaberry::2026::H-609-4",  // citySlug + periode encodes (D1)
    "shared_terms": ["h", "609", "4"],
    "evidence_refs": ["raw/avis/salaberry/2026/05/.../Avis-150-49.pdf.sha#p3"],
    "reasons": ["same node type: Zone", "shared normalized term(s): h, 609, 4"], // texte mecanique
    "proposed_patch_operation": "accept_match"
  }]
}
```

> Le champ `reasons` etant decoratif (genere par le code, pas un critere), **aucune** logique
> radar ne doit s'y fier. Le filtrage ville/periode est realise **en amont** (projet par
> ville + encodage des `normalized_terms`), pas par lecture de `reasons`.

### 2.4 Identite canonique vs code affiche dans le temps (le point dur, conserve)

Le `codeAffiche` d'une zone **peut changer** (U-521 -> H-521) et un code **peut etre
reutilise** apres retrait. Donc :

- L'**entite canonique `Zone`** porte une **identite stable** (le `id` interne relationnel,
  section 4) ; `codeAffiche` est un **alias date**, pas l'identite.
- Un renommage U-521 -> H-521 n'est **pas** un `merge_alias` : c'est un `DesignationEvent`
  type `zone-rename` produisant une nouvelle `ZoneVersion`. "U-521" reste un alias
  **historique** de la **meme** canonique (meme `id`).
- Une **reutilisation** de code (meme "H-200" pour deux zones a 10 ans d'ecart) impose deux
  canoniques distinctes -> d'ou l'**encodage de la periode active** dans les
  `normalized_terms`/id (2.2) : la cle metier est `(zone_id, periode)`, jamais le code.

### 2.5 Desambiguisation des numeros nus (fenetre de mots-cles)

Un numero nu (`2024-58`, `2025-0059`, une date) est ambigu sans declencheur. Strategie
**contextuelle** (extraction radar 3a) : pour chaque numero capture, examiner une **fenetre
de mots-cles** (+/- N tokens) :

- mot-cle reglementaire ("reglement", "regl.", "no", "amendement") -> `Bylaw`.
- mot-cle PPCMOI ("ppcmoi", "projet particulier", "dossier") -> `DesignationEvent subtype
  ppcmoi` (V2 : `PPCMOIProject`).
- format `AAAA-NNNN` avec annee plausible **sans** mot-cle reglementaire dans la fenetre, ou
  pattern de date -> rejet (ni Bylaw ni PPCMOI) ; reste mention non typee.

En l'absence de declencheur dans la fenetre, le numero **n'est pas** promu en entite : il
reste une mention `needs_review` (anti-invention).

---

## 3. Workflow de reconciliation (graphify studio + patch lifecycle)

Ce sont les **ecrans de reconciliation / mapping d'entites** demandes. Radar **pilote** le
coeur de patch graphify (et peut **embarquer** sa SPA studio).

### 3.1 Le cycle propose -> valide -> dry-run -> apply

graphify n'edite jamais les fichiers derives ; chaque decision est un
`graphify_ontology_patch_v1` (append-only) valide contre : hash de profil, hash de graphe,
existence des `evidence_refs`, regles d'endpoint de relation, transitions de statut, et un
jail de chemin. Forme reelle (`ontology-patch.ts`) :

```jsonc
{
  "schema": "graphify_ontology_patch_v1",
  "id": "patch-20260607-0001",
  "operation": "accept_match",
  "status": "proposed",
  "profile_hash": "sha256...", "graph_hash": "sha256...",
  "target": { "candidate_id": "mention-avis-150-49-p3", "canonical_id": "zone::salaberry::2026::H-609-4" },
  "evidence_refs": ["raw/avis/salaberry/2026/05/.../Avis-150-49.pdf.sha#p3"],
  "reason": "Avis public 150-49 p.3 cite la zone H-609-4.",
  "author": "analyste@radar", "created_at": "2026-06-07T..."
}
```

### 3.2 Operations de patch (les 9, mappees au domaine radar)

Les 9 operations sont reelles (`ontology-patch.ts:11`). **Ce que chaque validateur verifie
reellement** est indique entre crochets (le reste = politique radar).

| Operation | Usage radar | graphify verifie |
|---|---|---|
| `accept_match` | rattacher "zone H 609-4" du PV a la `Zone` canonique | [existence des 2 noeuds, `validateAcceptMatch:356`] |
| `reject_match` | rejeter un faux positif | [presence candidate_id/mapping_id] |
| `create_canonical` | creer une `Zone`/`Bylaw` depuis une preuve revue | [type connu + label] |
| `merge_alias` | attacher une variante de graphie comme alias | [canonical existe + alias present] |
| `set_status` | promouvoir `candidate -> validated` | [transition autorisee par `status_transitions:344`] |
| `add_relation` | ajouter `GOVERNED_BY`/`REZONES`/`CONSTRAINS` | [endpoints autorises, `validateAddRelation:380`] |
| `reject_relation` | rejeter une relation candidate | [presence relation_id/relation_type] |
| `deprecate_entity` | marquer une canonique obsolete | [node existe] |
| `supersede_entity` | lier la depreciee a son remplacant | [deprecated_id + replacement_id existent] |

> **Ce que graphify NE verifie PAS** (donc gates radar, 3.5/4.4) : qu'un `Lot` matche le
> cadastre, qu'un `REZONES` a une revue humaine, qu'un ref est une **preuve directe**. Le
> patch core verifie l'existence des refs, pas leur pertinence semantique.

### 3.3 Files de candidats (les ecrans)

La SPA studio (`graphify ontology studio`, read-only par defaut ; `--write` ouvre
valider/dry-run/apply en loopback + bearer token) sert :

- **File de candidats** : trier/filtrer par `score`, `kind`, `canonical_id`,
  `candidate_id`, `min_score`, `query` (filtres reels, `OntologyReconciliationCandidateFilter`).
  **Note** : pas de filtre `municipality` (n'existe pas) ; le scope ville vient du **projet**
  (D1). Ecran de mapping : gauche mentions brutes, droite canoniques proposees.
- **Comparaison candidat/canonique** + extrait source (page/bbox).
- **Trace d'audit** (`applied-patches.jsonl` / `rejected-patches.jsonl`, append-only).
- **Apercu de patch** (validate puis dry-run avant write).

### 3.4 Comment radar pilote (ou embarque) la reconciliation

- **A. Embarquer la SPA studio** read-only dans l'UI radar ; l'apply passe par le coeur
  write-guarded (token loopback). Le moins de code, fidele a graphify.
- **B. Piloter par API/MCP** : radar consomme l'API read-only + les outils MCP write depuis
  ses propres ecrans. Plus de controle UX, plus de code.

**Preco : A pour la V1**. Dans les deux cas, un **job de projection** (4.4) materialise les
canoniques **validees** vers le relationnel ; les `candidate`/`needs_review` n'entrent
**jamais** dans le relationnel d'exploitation (anti-invention).

### 3.5 Validateur radar avant projection (gate dur, hors graphify) - D3

Puisque graphify ne garantit pas les invariants metier (table de verite), radar interpose un
**validateur bloquant** entre la couche ontologie validee et la projection (4.4). Il
**REJETTE** (et renvoie en `needs_review`) :

1. un **`Lot`** dont le `registry_ref` ne **matche pas** le cadastre autoritaire
   (`registry_match` reel ; graphify ne le fait pas) ;
2. une relation **`REZONES`** (ou tout signal T1) **sans patch humain** (`author` != systeme,
   `operation` revue) - la "revue humaine obligatoire" est ici, pas dans graphify ;
3. **toute relation** sans **preuve directe** : un `evidence_ref` doit pointer un extrait
   (page/bbox) ou la relation est reellement attestee, pas seulement un ref existant.

> Ce validateur est la **traduction concrete** de l'ex-`acceptance_rules` v1 (inerte dans
> graphify). Il s'appuie sur les sorties graphify (canoniques validees + evidence) mais
> applique les regles cote radar. Les seuils d'auto-acceptation (ex. `score >= 0.95` pour
> cles provinciales) sont **proposables** automatiquement mais **audites**, jamais ecrits
> sans passer ce validateur.

---

## 4. Modele relationnel (Zod + PostGIS) qui materialise les canoniques

Le store relationnel **materialise** les canoniques **validees**. Il **reutilise** PR#46
(`SPEC_DESIGN_DATA_MODEL.md`) pour `zones/zone_versions`, `lots/lot_versions`,
`designation_events`, `valuations`, `lot_zone_resolutions` (bitemporel, as-of-date, choix
A2/B2/C3/D2). **PR#46 = prerequis (D5)**. WP5 ajoute 5 deltas.

### 4.1 Delta 1 : le pont canonique <-> relationnel

Chaque table d'entite reconciliee gagne une colonne de **pont** vers la canonique graphify +
la **decision** qui l'a validee + le **temps de connaissance**.

```ts
// ESQUISSE - colonnes ajoutees a zones / lots / bylaws / designation_events / constraints
canonicalId: text("canonical_id").notNull(),        // graphify canonical_id (stable)
reconStatus: text("recon_status").notNull().default("validated"), // OntologyStatus
reconPatchId: text("recon_patch_id"),               // patch qui a valide (audit)
knownFrom: timestamp("known_from").notNull(),       // = patch.created_at (D5, bitemporel)
knownTo: timestamp("known_to"),                     // ferme par patch compensatoire (D5)
```

Invariant : **seules** les lignes `recon_status = validated` **et** ayant passe le
**validateur radar** (3.5) sont visibles a l'exploitation/scoring.

### 4.2 Delta 2 : `Bylaw` + cycle legal (RegulatoryStage en projection)

PR#46 portait le reglement comme **string**. WP5 le promeut en **entite canonique
reconciliee** (mentionnee partout) avec son **cycle de vie legal** (alimente l'axe Timing).

```ts
// ESQUISSE - bylaws (nouvelle table)
export const Bylaw = z.object({
  id: z.string().uuid(),
  canonicalId: z.string().min(1),
  citySlug: z.string().min(1),                 // numero ville-scope
  numero: z.string().min(1),                   // "150-49", "2024-58"
  amendsBylawId: z.string().uuid().optional(), // DERIVE de l'arete AMENDS (jamais saisi)
  titre: z.string().nullable().default(null),
  rawRef: z.string().min(1),
  evidence: z.array(EvidenceItem).default([]),
});

// ESQUISSE - regulatory_stages : PROJECTION relationnelle (pas un noeud graphify en V1)
export const RegulatoryStageKind = z.enum([
  "avis-motion", "1er-projet", "consultation-publique", "2e-projet",
  "registre-referendaire", "adopte", "entree-vigueur", "abandonne",
]);
export const RegulatoryStage = z.object({
  id: z.string().uuid(),
  bylawId: z.string().uuid(),                   // HAS_STAGE = FK relationnelle
  kind: RegulatoryStageKind,
  occurredOn: isoDateSchema,
  outcome: z.enum(["passed", "failed", "pending", "non-disponible"]).default("non-disponible"),
  rawRef: z.string().min(1),
  evidence: z.array(EvidenceItem).default([]),
});
```

> `RegulatoryStage` (timeline d'etapes datees) remplace le `bylawStage` plat de PR#46. La
> date d'effet d'un `DesignationEvent` (`validFrom`) reste l'adoption/l'entree en vigueur.

### 4.3 Delta 3 : `Constraint` source-backed (D2, axe risque)

```ts
// ESQUISSE - constraints (D2 : CPTAQ agricole / BDZI inondable / GRHQ hydro)
export const ConstraintKind = z.enum([
  "cptaq-zone-agricole", "bdzi-inondable", "grhq-hydro", "bande-riveraine",
  "milieu-humide", "servitude", "piia", "patrimoine", "autre",
]);
export const Constraint = z.object({
  id: z.string().uuid(),
  canonicalId: z.string().min(1),
  kind: ConstraintKind,
  citySlug: z.string().min(1),
  source: z.string().min(1),                    // CPTAQ / BDZI / GRHQ / municipal
  observedOn: isoDateSchema.nullable().default(null),
  confidence: z.enum(["high", "medium", "low", "manual-check"]).default("manual-check"),
  rawRef: z.string().min(1),
  evidence: z.array(EvidenceItem).default([]),  // citation obligatoire (evidence_policy)
});

// ConstraintHit = projection d'une relation CONSTRAINS sur un Lot/Zone -> lu par l'axe risque
export const ConstraintHit = z.object({
  constraintId: z.string().uuid(),
  targetKind: z.enum(["lot", "zone"]),
  targetId: z.string().uuid(),
  kind: ConstraintKind,
  source: z.string().min(1),
  date: isoDateSchema.nullable().default(null),
  confidence: z.enum(["high", "medium", "low", "manual-check"]),
  evidenceRefs: z.array(z.string()).min(1),     // l'axe risque (20%) est ainsi AUDITABLE
});
```

> En V1, les contraintes **fiables** (CPTAQ/BDZI/GRHQ, donnees provinciales) sont des noeuds
> `Constraint` reconciliables ; servitudes/PIIA restent `manual-check` (pas de source
> structuree). L'axe risque ne consomme **que** des `ConstraintHit` portant
> `{source, date, confidence, evidence_refs}` (7.3).

### 4.4 Delta 4 : la projection (canonique validee -> relationnel) + contrat bitemporel (D5)

Un **job de projection** (idempotent, rejouable) lit la couche ontologie validee (apres le
validateur radar 3.5) et materialise les tables relationnelles. **Point unique d'ecriture** du
relationnel d'exploitation.

```ts
// ESQUISSE de contrat (non implemente)
interface OntologyProjection {
  // incremental : rejoue les patches valides depuis un patch
  projectValidatedCanonicals(sincePatchId?: string): Promise<ProjectionReport>;
  // AS-OF (D5) : rejoue applied-patches.jsonl jusqu'a created_at <= knownAt
  // -> reconstruit l'etat de reconciliation CONNU a knownAt, puis projette.
  projectAsOf(knownAt: string): Promise<ProjectionReport>;
}
```

Regles de projection :
- `MENTIONS` validee (`accept_match`) -> `EvidenceItem` + `DERIVED_FROM`.
- `REZONES`/`SPLITS`/`RENAMES`/`MERGES` -> `DesignationEvent` (+ `ZoneVersion` projetee).
- `SUBDIVIDES` -> `DesignationEvent` `lot-subdivision` + `parentLotIds`.
- `AMENDS` -> derive `Bylaw.amendsBylawId` (representation unique, 1.2).
- `ASSIGNED_ZONE` -> `lot_zone_resolution` (`method`, `confirmed`, `coveragePct`).
- `CONSTRAINS` -> `ConstraintHit` (lu par l'axe risque).
- `VALUED_BY` -> `Valuation` (par lot/matricule).

**Contrat bitemporel (D5)** - deux axes orthogonaux :
- **temps de validite (valid-time)** = `validFrom`/`validTo` : quand le **fait reglementaire**
  est vrai dans le monde (date d'adoption/entree en vigueur). Vient de la **source**. (PR#46.)
- **temps de connaissance (knowledge-time)** = `knownFrom`/`knownTo` : quand **radar a su**.
  `knownFrom = patch.created_at` (la decision de reconciliation). **Origine claire** :
  `knownAt` est une **date de DECISION** (patch), pas la date du document.
- **Correction d'une mauvaise reconciliation** = **patch compensatoire** (append-only) :
  un nouveau patch (`reject_match` / `set_status -> rejected` / `supersede_entity`) qui, en
  projection, **ferme** `knownTo` du fait errone et **ouvre** la version corrigee. On ne
  supprime jamais : le graphe reste append-only, le relationnel enregistre `knownTo`.
- **Replay as-of** : `projectAsOf(K)` rejoue les patches `created_at <= K` -> "qu'est-ce que
  radar croyait a la date K ?". Combine a la resolution valid-time PR#46 = **bitemporalite**
  ("etat reglementaire a T, tel que connu a K").

### 4.5 Delta 5 : `Adresse` (cle provinciale) + `LOCATED_AT`

Les avis citent souvent une **adresse**, pas un `no_lot`. `Adresse` (Adresses Quebec, cle
provinciale, graphe provincial D1) est un point de recoupement inter-documents fort.

```ts
export const Adresse = z.object({
  id: z.string().uuid(),
  canonicalId: z.string().min(1),
  idAdresse: z.string().min(1),                 // cle Adresses Quebec (provinciale)
  adresseComplete: z.string().min(1),           // forme normalisee (extraction 3a)
  citySlug: z.string().min(1),                  // filtrage (identite reste provinciale)
  lotIds: z.array(z.string().uuid()).default([]), // LOCATED_AT (Lot <-> Adresse)
  rawRef: z.string().min(1),
  evidence: z.array(EvidenceItem).default([]),
});
```

### 4.6 Cles multi-villes et provenance

- `citySlug` (FK `CityProfile`) sur **toute** entite ville-scopee (Zone, Bylaw,
  DesignationEvent, Constraint). `Lot.noLot`, `Adresse.idAdresse` sont provinciaux mais
  portent `citySlug` pour le filtrage.
- `rawRef` (cle S3) + `EvidenceItem` partout (provenance de bout en bout).
- `canonicalId` = pont stable ; `reconPatchId` = audit ; `knownFrom`/`knownTo` = bitemporel.

---

## 5. Variabilite multi-villes (CityProfile + SourceBinding[])

**L'ontologie (le profil) est stable ; les bindings et le projet graphify varient.**

### 5.1 Les deux axes de variabilite + les canaux typés

| Axe | Ce qui varie | Capture |
|---|---|---|
| **Regime de zonage** | schema de code (H-/Ha-/R1...), unite de densite (log/ha, COS, UI/ha), format de grille | `zoningRegime` |
| **Processus decisionnel** | conseil/consultation, registre referendaire, PPCMOI actif, variantes CPTAQ, nombre d'etapes | `decisionProcess` |
| **Canaux** (correction double-revue) | CMS des avis, format des PV, chaine YouTube, portails GIS multiples | `SourceBinding[]` typé (5.3) |

### 5.2 Esquisse `CityProfile`

```ts
export const ZoningRegime = z.object({
  codeScheme: z.object({
    regex: z.string(),                          // surcharge la regex QC par defaut (2.2)
    prefixToKind: z.record(z.string()),         // { "H":"H", "Ha":"H", "R1":"H", "Cv":"C" }
  }),
  densityUnit: z.enum(["log-ha", "logements", "cos", "ui-ha", "non-disponible"]),
  gridFormat: z.enum(["pdf-table", "html", "gis-vector", "non-disponible"]),
});

export const DecisionProcess = z.object({
  hasReferendumRegister: z.boolean(),
  ppcmoiEnabled: z.boolean(),
  cptaqVariants: z.array(z.enum(["individuelle", "appui-municipal", "portee-collective"])).default([]),
  adoptionStages: z.array(RegulatoryStageKind).default([]),
});

export const CityProfile = z.object({
  slug: z.string().min(1),
  nomOfficiel: z.string().min(1),
  codeMamh: z.string().min(1),                  // "70052"
  dguidStatcan: z.string().nullable().default(null),
  mrcSlug: z.string().min(1),                   // attribut (Region = noeud V2)
  bbox: z.object({ minLon: z.number(), minLat: z.number(), maxLon: z.number(), maxLat: z.number() }),
  zoningRegime: ZoningRegime,
  decisionProcess: DecisionProcess,
  aliasOverrides: z.record(z.unknown()).default({}),
  sources: z.array(SourceBinding).default([]),  // remplace l'objet `channels` monolithique
});
```

### 5.3 `SourceBinding[]` typé (correction double-revue)

L'objet `channels` v1 (`cms`/`avisUrl`/`pvFormat`/`youtubeChannel`) etait **trop
monolithique** pour des villes multi-portails. On le remplace par un **tableau de bindings
typés**, un par canal, avec **plusieurs canaux par `kind`** possible.

```ts
export const SourceCapability = z.enum([
  "list", "fetch", "search", "pagination", "auth-required", "ocr-needed", "asr-needed",
]);
export const SourceBinding = z.object({
  sourceId: z.string().min(1),                  // identifiant stable du binding
  kind: z.enum([                                // type de source
    "avis-public", "reglement", "ppcmoi", "proces-verbal", "grille-zonage",
    "plan-urbanisme", "role-evaluation", "cadastre", "adresses-qc",
    "cptaq", "bdzi", "grhq", "presse", "video",
  ]),
  channel: z.object({
    engine: z.enum(["craft", "pg-solutions", "wordpress", "voila", "azimut", "gonet", "youtube", "rest", "file", "autre"]),
    url: z.string().url().nullable().default(null),
    selectors: z.record(z.unknown()).default({}),
  }),
  auth: z.enum(["none", "basic", "api-key", "session"]).default("none"),
  cadence: z.enum(["daily", "weekly", "monthly", "on-demand"]).default("weekly"),
  adapter: z.string().min(1),                   // adaptateur WP4 (par moteur)
  capabilities: z.array(SourceCapability).default([]),
  tier: z.enum(["A", "B", "C"]).default("B"),
  priority: z.number().int().default(0),
});
```

> Une ville a typiquement **plusieurs** bindings `kind: "grille-zonage"` (un PDF + un portail
> GIS), ou plusieurs `kind: "proces-verbal"` (HTML recent + scans anciens). Le tableau le
> permet ; l'objet monolithique non.

### 5.4 Ce qui reste stable vs ce qui varie

| Element | Stable (partage N villes) | Varie par ville |
|---|---|---|
| `ontology-profile.yaml` (node/relation types, policies) | **oui** | non |
| Tables relationnelles (schema) | **oui** | non |
| `citation_policy`, `hardening`, `evidence/inference_policy` | **oui** | non |
| **Projet graphify** (`graphify.yaml` : corpus + `state_dir`) | non | **oui (un par ville, D1)** |
| Graphe provincial (Lot/Adresse/CPTAQ) | structure stable | un seul, partage |
| Registres (cadastre/role/adresses) | structure stable | valeurs par ville |
| Normalisation d'alias | regles QC communes (3a) | `codeScheme`/`aliasOverrides` |
| Canaux/adaptateurs | provinciaux partages | `SourceBinding[]` municipaux |

Ajouter une ville = une entree `CityProfile` (+ `SourceBinding[]`) + un **projet graphify**
(`graphify.yaml` pointant le corpus S3 de la ville) + (si CMS inedit) un adaptateur. Le
profil graphify et le schema relationnel **ne changent pas**.

---

## 6. Pipeline de bout en bout + projet graphify (graphify.yaml)

```
[WP4 etage 1 CIBLAGE]  CityProfile + SourceBinding[] + scope -> CiblagePlan (aucune I/O)
        |
[WP4 etage 2 RECUEIL]  SourceAdapter.list/fetch -> RawDocument (S3) + provenance
                       => corpus du projet graphify de la ville (noeuds Source)
        |
[WP4 etage 3 EXPLOITATION] -- WP5 le decompose :
  3a. EXTRACTION radar     : NER + NORMALISATION QC (regex 2.2, codeScheme) AVANT graphify
                             -> MENTIONS deja normalisees (citySlug+periode encodes)
  3a'. graphify extract     : dataprep (pdf_ocr) + extraction -> noeuds/relations candidats
  3b. RECONCILIATION        : candidats entity_match -> studio/patch -> CANONIQUES validees
  3c. VALIDATEUR RADAR (3.5): bloque Lot sans cadastre / REZONES sans humain / relation sans preuve
  3d. PROJECTION (4.4)      : canoniques validees -> relationnel bitemporel
  3e. SCORING / SIGNAUX     : du relationnel -> Signal (incl. intentions D6) + OpportunityDossier
```

> **OCR / ASR (correction double-revue)** : les sources sont des **PDF et scans** ->
> `dataprep.pdf_ocr` (graphify reel) gere l'OCR a l'etage 3a'. La **transcription
> audio->texte (ASR)** des videos YouTube n'est **pas** dans graphify : elle est **en amont**
> (WP4 recueil), produisant un texte qui devient une `Source`. A specifier dans WP4.

### 6.1 Esquisse `graphify.yaml` (projet par ville) - format reel

graphify pilote l'ingestion par un **project config** (distinct du profil). Format reel
(`tests/fixtures/profile-demo/graphify.yaml`) : `inputs.corpus`, `inputs.registries`,
`dataprep.pdf_ocr`/`citation_minimum`, `outputs.state_dir`.

```yaml
# ESQUISSE - graphify.yaml du projet VILLE (un par ville, D1)
version: 1
profile:
  path: graphify/ontology-profile.yaml         # PROFIL PARTAGE
inputs:
  corpus:
    - raw/avis/salaberry                        # corpus borne a la ville -> candidats bornes
    - raw/pv/salaberry
    - raw/reglements/salaberry
    - raw/grilles/salaberry
  registries:
    - references/municipalities.csv
dataprep:
  pdf_ocr: auto                                 # PDF/scans : OCR automatique
  prefer_ocr_markdown: true
  citation_minimum: page
  preserve_source_structure: true
outputs:
  state_dir: .graphify/salaberry-de-valleyfield # state_dir PAR VILLE (D1)
  write_html: true
  write_wiki: true
```

```yaml
# ESQUISSE - graphify.yaml du projet PROVINCIAL (un seul, D1)
version: 1
profile:
  path: graphify/ontology-profile.yaml
inputs:
  corpus:
    - raw/cross-city                            # docs citant des cles provinciales
  registries:
    - references/cadastre.csv                    # Lot (NO_LOT)
    - references/adresses_qc.csv                 # Adresse
    - references/cptaq.csv                        # CPTAQ (V2 noeud)
dataprep:
  pdf_ocr: auto
  citation_minimum: page
outputs:
  state_dir: .graphify/_provincial
```

### 6.2 Mapping aux 6 phases PROCESS / PROMPT

| Phase PROCESS | Sous-etape WP5 | Entites produites |
|---|---|---|
| 1. Signal reglementaire | 3a-3b-3e | `Bylaw`, `DesignationEvent` (REZONES + subtypes ppcmoi/cptaq/derogation), `Signal` |
| 2. Ancrage foncier | 3b-3c-3d | `Lot`/`LotVersion`, `Adresse`, `ASSIGNED_ZONE`, `Valuation` (role) |
| 3. Contraintes | 3b-3d (D2) | `Constraint` + `CONSTRAINS` -> `ConstraintHit` (axe risque) |
| 4. Enrichissement marche | 3d | `Valuation` (market-estimate, souvent non-disponible Tier C) |
| 5. Contexte strategique | 3a-3e | mentions de contexte (StatCan, MRC) -> evidence de dossier |
| 6. Scoring | 3e | `OpportunityDossier` (relationnel, 5 axes) |

---

## 7. Mapping scoring / signaux

### 7.1 Designation -> Signal (priorites VISION) + intentions (D6)

| Source du signal | Entite V1 | Priorite VISION | `Signal.kind` |
|---|---|---|---|
| changement densite/usage | `DesignationEvent` REZONES | 1 (10/10) | `residential-rezoning` |
| projet particulier | `DesignationEvent subtype ppcmoi` (V2 : `PPCMOIProject`) | 2 (7/10) | `ppcmoi` |
| derogation densifiante | `DesignationEvent subtype minor-variance` | 3 | `derogation` |
| dezonage agricole | `DesignationEvent subtype cptaq` (V2 : `CPTAQDecision`) | 4 (8/10) | `cptaq-dezonage` |
| **intention municipale** | `DesignationEvent subtype intention` + `TARGETS_ZONE` | 7 (VISION) | **`intention`** |
| **precedent reglementaire** | PPCMOI/derogation cite comme precedent | 2 (VISION) | **`precedent`** |

> **Intentions/signaux faibles (D6)** : un PV "la ville est ouverte a densifier ce secteur"
> devient un `Signal kind=intention` rattache a un `DesignationEvent subtype=intention`,
> relié a la zone par `TARGETS_ZONE`, **avec preuve** (page du PV). Un PPCMOI invoque comme
> precedent -> `kind=precedent`. Le modele capture ainsi **faits ET intentions** (VISION 7).
> Anti-invention preserve : une intention reste `needs_review` tant qu'aucune preuve directe
> n'est attachee, et un signal `intention`/`precedent` est **plafonne a "surveillance"**
> (jamais un signal T1 dur).

> **Derogations mineures (correction double-revue)** : `DesignationEvent subtype
> minor-variance` porte des **filtres retenir/rejeter** alignes VISION priorite 3 :
> **retenir** densite/hauteur/marges/COS densifiants ; **rejeter** cabanon/cloture/cosmetique.
> Promotion en `MinorVarianceDecision` (noeud) en V2 si le volume le justifie.

### 7.2 `Signal/Relation -> AxisScore` (table concrete, 5 axes) - correction double-revue

Scoring PROCESS = 5 axes : potentiel 30 / risque 20 / timing 20 / faisabilite 15 / marche 15.

| Axe | Poids | Entite / relation source | Formule (esquisse) | Preuve requise | Fallback `non-disponible` | Cap "surveillance" |
|---|---|---|---|---|---|---|
| **Potentiel reglementaire** | 30 % | `DesignationEvent REZONES -> Zone` + `ZoneVersion` (densite cible) | delta densite/usage permis (avant -> apres) x echelle de la zone | Bylaw + page avis + patch `REZONES` valide | densite cible non chiffree -> score partiel sur la **nature** du changement | `REZONES` non `validated` (reste candidate) -> surveillance |
| **Risque** | 20 % | `Constraint -CONSTRAINS-> Lot/Zone` = `ConstraintHit` (D2) | `1 - somme ponderee(hits)` (CPTAQ agricole, BDZI inondable, GRHQ) | `ConstraintHit {source, date, confidence, evidence_refs}` | contraintes non verifiees -> axe **exclu**, poids renormalises | tout hit `confidence in {low, manual-check}` -> surveillance |
| **Timing** | 20 % | `RegulatoryStage` (relationnel) du `Bylaw`/`DesignationEvent` | proximite `entree-vigueur` ; `registre-referendaire` ouvert -> prudent | etape datee + evidence | etape inconnue -> axe `non-disponible` | `registre-referendaire` ouvert -> cap surveillance |
| **Faisabilite** | 15 % | `Valuation` (role, par lot) ratio bati/terrain + `owner` (7.4) | ratio bas = sous-densifie (pre-filtre) ; `owner` inconnu degrade | role XML (matricule) + evidence | `owner = non-disponible` -> faisabilite plafonnee + `manual-check` | `owner = manual-check` requis -> surveillance |
| **Marche** | 15 % | `Valuation` market-estimate (Tier C, **pas** le role) | comparables marche recents | comparable Tier C date | aucun comparable -> axe `non-disponible`, poids renormalises | - |

> **Regle transverse (PROCESS 5)** : un axe sans preuve est **`non-disponible`** (poids
> renormalises sur les axes disponibles), et **tout** dossier dont un axe critique est
> `non-disponible`/`manual-check` est **plafonne a "surveillance"** (jamais promu en
> opportunite ferme). Chaque `AxisScore` pointe ses `evidence_refs` (scoring auditable).

### 7.3 Axe risque auditable (D2)

L'axe risque (20 %, 2e poids) ne lit **que** des `ConstraintHit` (4.3). Chaque hit porte
`{source, date, confidence, evidence_refs}` : le score risque est donc **trace a la source**
(coherent avec "citation obligatoire", PROCESS 5). Un filtre geospatial **sans noeud** (le
choix v1 differé) ne pouvait pas porter de preuve - d'ou la promotion de `Constraint` en V1.

### 7.4 `owner` = non-disponible / manual-check (correction double-revue)

PROCESS demande une **fiche lot avec proprietaire**, mais le proprietaire est **PII exclue du
graphe** (LFM 72 + Loi 25 ; aucun noeud personne). Donc :
- `owner` est explicitement **`non-disponible`** par defaut, ou **`manual-check`** si une
  verification humaine au registre foncier est requise.
- Impact **axe faisabilite (15 %)** : `owner` inconnu **degrade** la faisabilite et pose un
  drapeau `manual-check` ; il **ne bloque pas** le dossier mais le **plafonne a
  "surveillance"** tant que non verifie.
- Module futur : un registre foncier sourcé serait une **table separee a acces journalise**,
  hors graphe et hors de ce design.

### 7.5 Gel des scores (reproductibilite)

Reproduire un score passe = `gridVersion` fige + `knownAt` fige (knowledge-time, D5) +
`reconPatchId`. `projectAsOf(knownAt)` (4.4) reconstruit l'etat de reconciliation **connu** a
K : on sait quelle decision etait `validated` a K.

---

## 8. Coupe V1 / V2 (D4)

### 8.1 V1 (ce sign-off)

- **Noeuds profil** : `Municipality, Zone, Bylaw, DesignationEvent, Constraint, Lot, Adresse,
  Valuation, Source, Signal` (10).
- **Relations profil** : voir 1.2 (`located_in, located_at, governed_by, amends, rezones,
  splits, renames, merges, subdivides, targets_zone, targets_lot, assigned_zone, valued_by,
  constrains, derived_from, mentions, supersedes, raises_signal`).
- **Projections relationnelles** (pas des noeuds graphify) : `ZoneVersion`, `LotVersion`,
  `RegulatoryStage`, `ConstraintHit`.
- **Relationnel uniquement** : `OpportunityDossier` (assemble par le scoring).
- **PPCMOI/CPTAQ/derogations** : `DesignationEvent` sous-types + `Signal` kinds.
- **Topologie graphify** : 1 projet par ville + 1 projet provincial (D1).
- **Garanties radar** (hors graphify) : validateur avant projection (3.5), scope ville/periode
  (encodage normalized_terms), bitemporel/as-of (projection), regles d'acceptation.

### 8.2 V2 (differé, avec rationale)

| Element V2 | Pourquoi differé |
|---|---|
| `PPCMOIProject`, `CPTAQDecision` (noeuds dedies) | sur-ingenierie sur pilote mono-ville ; en V1 `DesignationEvent` sous-types portent deja preuve + scoring. Promus quand une 2e ville prouve la variance de processus. |
| `Region` (MRC) noeud | `mrcSlug` (attribut) suffit en V1 ; noeud si une vue MRC l'exige. |
| `RegulatoryStage` / `ZoneVersion` / `LotVersion` noeuds graphify | restent des projections relationnelles tant qu'ils ne sont pas reconcilies. |
| `MinorVarianceDecision` noeud | `DesignationEvent subtype minor-variance` suffit en V1. |
| `HAS_STAGE`, `FEEDS_DOSSIER` relations graphify | aretes relationnelles en V1 (endpoints non-graphify). |
| Renumerotation cadastrale de masse | seul `SUBDIVIDES` en V1 ; evenement de masse a modeliser en V2. |

---

## 9. Questions ouvertes (sign-off)

**Fermees par D1-D6** :
- ~~Reutilisation de code de zone : comment borner l'identite ?~~ -> **D1** (projet par ville
  + periode encodee dans `normalized_terms`) + 2.4.
- ~~Un profil partage ou un profil par ville ?~~ -> **D1** : profil **partage**, mais **un
  projet** (corpus + `state_dir`) par ville + un projet provincial.
- ~~`Constraint` en V1 ou plus tard ?~~ -> **D2** : V1 (CPTAQ/BDZI/GRHQ), axe risque auditable.
- ~~Frontiere canonique <-> relationnel ?~~ -> **D5** : projection unidirectionnelle +
  `projectAsOf` ; le relationnel ne reecrit jamais le graphe.
- ~~Normalisation d'alias : profil ou CityProfile ?~~ -> regex QC communes en **extraction
  radar 3a** ; `codeScheme`/`aliasOverrides` surchargent par ville.
- ~~`DesignationEvent` reconcilie ou pure projection ?~~ -> noeud reconciliable (un PV
  "scission de H-143" est une mention), materialise ensuite en event relationnel.
- ~~PII / registre foncier ?~~ -> hors modele (7.4) ; table journalisee separee si un jour sourcee.

**Genuinement ouvertes** :
1. **Studio (option A) vs API/MCP (option B)** pour l'UI radar. *Preco : A en V1.*
2. **Sequencement du graphe provincial** : un seul graphe provincial peut grossir ; faut-il le
   partitionner par MRC quand N villes seront ingerees ? *A re-evaluer apres la 2e ville.*
3. **ASR video** : la transcription YouTube est en amont (WP4) ; format/qualite/citation
   (timecode comme `page`) a specifier dans WP4 avant d'ingerer des `Source` video.
4. **Auto-acceptation** : `score >= 0.95` proposable pour cles provinciales, mais le seuil et
   l'audit exact restent a calibrer sur donnees reelles (toujours derriere le validateur 3.5).

---

## 10. Recapitulatif du perimetre de ce document

- **Ecrit ici** : ce seul fichier (`docs/spec/SPEC_ONTOLOGY_DATA_MODEL.md`).
- **Non ecrit** : aucun `ontology-profile.yaml`/`graphify.yaml` reel, aucun schema
  Zod/Drizzle reel, aucune migration, aucun code. Les blocs YAML/ts/sql sont des
  **esquisses** de design pour le sign-off.
- **Prerequis** : PR#46 (base relationnelle bitemporelle) valide **avant** WP5 (D5).
- **Prochain pas (apres sign-off)** : geler le profil graphify partage, creer les projets
  `graphify.yaml` par ville + provincial, brancher l'etage EXPLOITATION WP4 (3a-3e),
  implementer les deltas relationnels (Bylaw/RegulatoryStage/Constraint/Adresse + pont
  canonique + bitemporel) et le job de projection (`projectAsOf`), en coherence avec le jalon
  J4 de `SPEC_PLAN_SCRAPING.md`.
