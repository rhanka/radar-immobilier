# CRITÈRES DE PREUVE N-A — KPI IMMO (garde-fou anti-invention)

## §0 — Statut & portée

> **Statut : GOUVERNANCE — garde-fou anti-invention.** Bloquant pour la
> résolution HONNÊTE du palier « 167×20 KPI à 0-UNKNOWN » côté immo.
> Cible propriétaire : chaque cellule `(muni × KPI)` est **COMPLET** ou
> **N-A PROUVÉ** ; **jamais** un UNKNOWN relabellé N-A sans preuve.

**Portée immo (ce document) = colonnes IMMO uniquement : 7, 12, 13, 14, 15, 16,
17, 18, 19, 20.** Les colonnes geo « graves » 1–11 sont hors périmètre ici
(cadrées geo-side).

**Ce document est le jumeau immo-side de**
`tmp/handoff/SPEC_PALIER_RESOLUTION.md` (geo-side). Même gabarit 3-états, même
règle d'or, mêmes critères N-A owner. Il **ne réinvente pas** les critères : il
les reprend depuis le cadrage owner (relayé par `SPEC_PALIER_RESOLUTION.md` §2,
seule copie du cadrage owner présente dans ce checkout) et ajoute le **MAPPING
KPI→champ graphe** réel, cité verbatim `fichier:ligne`, pour blinder la recette.

**Séparation stricte** (ce document n'amende AUCUN de ces contrats) :
- **B′ / lexique** : `packages/radar-domain/src/signals/b-prime.ts` — non amendé.
- **Crosswalk taxonomie** : `docs/spec/CROSSWALK_TAXONOMIE_GEO_IMMO.md` (`b9c121d`).
- **Recall** : `docs/spec/CONTRAT_MESURE_RECALL_SET.md` (SHA `2335a7d`, FROZEN).

**Grille canonique 20 KPI + ownership :** `docs/spec/SPEC_PALIER_OWNERSHIP.md`
§2. ⚠ **Ce fichier est ABSENT de ce checkout** (vérifié : `find … -name
SPEC_PALIER_OWNERSHIP.md` → aucun hit). Le seul portage du cadrage owner présent
est `SPEC_PALIER_RESOLUTION.md` §2 (geo-side), utilisé comme référence
autoritaire ici. **À reconnecter dès que la grille canonique est disponible dans
le worktree** (cf. §5 OPEN).

---

## §1 — Méthode 3-états (gabarit commun geo ↔ immo)

Chaque cellule `(muni × KPI)` prend **exactement un** état :

- **COMPLET** — la donnée est **servie ET vérifiée** (valeur réelle, non
  inventée, tracée à sa source).
- **N-A PROUVÉ** — **absence LÉGITIME** démontrée par une **preuve d'absence
  REPRODUCTIBLE**. Chaque cellule N-A porte le triplet :

  ```
  { source/requête re-jouable , DATE , RÉSULTAT }
  ```

  La requête doit pouvoir être **re-jouée** par un tiers et rendre le **même
  RÉSULTAT** (l'absence). Exemple de forme : `{ source: "listing OGC geo
  qc-tod-<slug>", date: "2026-08-02", résultat: "collection absente (404) →
  aucun périmètre TOD publié" }`.
- **UNKNOWN** — **vide NON prouvé**. Reste UNKNOWN tant qu'aucune preuve
  d'absence reproductible n'est produite.

**Règle d'or (dure) — jamais « pas trouvé ».** N-A EXIGE une preuve d'absence
reproductible. Un UNKNOWN relabellé N-A sans le triplet `{source,date,résultat}`
= **invention (interdit)**. C'est le garde-fou central.

**Corollaires immo (anti-invention déjà codés) :**
- Un **défaut** de champ n'est PAS une preuve d'absence. `effet_densifiant`
  défaut `"inconnu"` (Vivier) = **UNKNOWN**, jamais N-A (cf. §2 KPI 7).
- Un `null` « honnête » servi (`superficieM2: null`, `usageCode: null`) est
  UNKNOWN au niveau cellule tant que l'absence-source n'est pas attestée (cf. §2
  KPI 12–17, frontière rôle/cadastre).
- Un `false` par défaut n'est pas N-A : `inTod = false` « si inconnu — jamais
  inventé » (`lot-potential.ts:109`) → UNKNOWN, pas « hors TOD prouvé ».

---

## §2 — Critères N-A par KPI (owner-aligné + MAPPING champ graphe)

Format par KPI : **{3 états}** · **{critère N-A owner}** · **{MAPPING champ
graphe réel, `fichier:ligne`}**.

Convention MAPPING : « champ graphe immo » = champ du **modèle ontologique immo**
(`packages/radar-domain/src/schemas/ontology/entities.ts`). « prop geo servie » =
clé de `feature.properties` servie par geo sur les collections OGC
`qc-lots-<slug>` / `qc-tod-<slug>` (consommée par immo, **pas** un champ du
graphe immo). Cette distinction est LA frontière anti-double-comptage (§4 du
contrat geo-side).

---

### KPI 7 — Effet densifiant

- **COMPLET** : **Δ grille avant/après calculé** — l'effet est qualifié par le
  delta ancien↔nouveau de la grille (densification / réduction / stable).
- **N-A PROUVÉ** : **0 avis public + 0 certificat MRC 137.3**, aucun EEV
  (événement d'évolution de zonage) documenté, après recherche exhaustive
  **tracée** `{source, date, résultat}`.
- **UNKNOWN** : effet absent ou `"inconnu"` **sans preuve**. Le **défaut Vivier
  `inconnu` ≠ N-A**.

**Owner (verbatim, `SPEC_PALIER_RESOLUTION.md` §2)** : « absence d'EEV
documentée : **0 avis public + 0 certificat MRC 137.3** après recherche
exhaustive tracée. »

**MAPPING champ graphe :**
- `packages/radar-domain/src/vivier/vivier-v2.ts:6-12` — enum
  `vivierEffetDensifiantSchema = ["densifie","reduit","stable","inconnu"]` ;
  `:63` défaut `.default("inconnu")`.
- `packages/radar-domain/src/signals/b-prime.ts:18` — `effetDensifiant:
  "inconnu"` (type littéral : B′ ne qualifie JAMAIS l'effet ; toujours `inconnu`).
- Preuve du critère COMPLET dans l'UI : `ui/src/lib/components/sources-map/
  SourceConsole.svelte:179` — « Ne qualifie pas l'effet densifiant ; delta
  ancien↔nouveau requis. »
- **Constat :** le champ existe (`effet_densifiant`), mais sa valeur `"inconnu"`
  (défaut Vivier et invariant B′) est **UNKNOWN**, jamais N-A. COMPLET exige le
  calcul Δ grille, non porté par ce champ aujourd'hui.

---

### KPI 12 — Assignation lot ↔ zone

- **COMPLET** : lot **joint à une zone**, provenance de jointure servie
  (`zoneCode` + `zoneJoin ∈ {"code","centroid"}`).
- **N-A PROUVÉ** : **0 lot dans la zone**, prouvé par une requête rôle/cadastre
  re-jouable (aligné `SPEC_PALIER_RESOLUTION.md` §3, zones 2 : « cohérence-lot-zone
  N-A = 0 lot dans la zone »). **Frontière anti-double-comptage** : immo grave
  le N-A SERVI en citant la source geo ; geo atteste l'absence-source
  reproductible.
- **UNKNOWN** : zone non résolue **sans** preuve (`ZoneVersionProvider` retourne
  `null` → score 0 « honnête » — c'est un UNKNOWN de jointure, pas un N-A).

**MAPPING champ graphe :**
- **AUCUN CHAMP GRAPHE IMMO dédié.** L'assignation est une **jointure geo**
  calculée à la volée, exposée en props geo servies :
  `api/src/routes/geo-collections.ts:57-60` — `zoneCode`, `zoneJoin` (« "code" »
  = code de zone porté par le lot | « "centroid" » = centroïde du lot dans le
  polygone de zone).
- Provider immo : `api/src/routes/geo-lots.ts:65-68` `ZoneVersionProvider(noLot,
  citySlug) → ZoneVersionInput | null` ; `:62` « En production sans
  `lot_zone_resolution` : retourne null → score 0 honnête ».
- Enrichissement : `api/src/services/geo/lot-zone-enrichment.ts` (jointure lot↔zone).

---

### KPI 13 — Normes de zonage pliées au lot

- **COMPLET** : **≥ 1** valeur de norme servie (nombre fini / texte réel) foldée
  au lot.
- **N-A PROUVÉ** : muni **sans grille / sans règlement structurel** — gisement de
  normes épuisé et **tracé** (aligné owner « 5 Règlement / 3 Normes / 6
  Usage-dom : sans grille / sans règlement structurel — gisement épuisé et
  tracé », `SPEC_PALIER_RESOLUTION.md` §2). **Frontière** : immo grave le N-A en
  citant la source geo/grille ; geo atteste l'absence-source.
- **UNKNOWN** : aucune valeur servie **sans** preuve d'épuisement du gisement.

**MAPPING champ graphe :**
- **AUCUN CHAMP GRAPHE IMMO.** Normes **foldées au lot par geo**, mesurées via
  `LOT_NORM_VALUE_KEYS` (props geo servies) :
  `api/src/services/geo/lot-fields-coverage.ts:37-45` —
  `hauteur_max_value`, `densite_value`, `frontage_min_value`,
  `superficie_min_value`, `marge_avant_min_value`, `marge_laterale_min_value`,
  `marge_arriere_min_value`. Présence = **au moins UNE** valeur non nulle
  (`:141`).
- Source de zone de norme : `qc-zonage-norms-<slug>` (geo-collections.ts:55).
- Rendu UI (normes ≠ réelles) : `ui/src/lib/components/maps/
  lot-fiche-utils.ts:333-343` — « VERBATIM — jamais de valeur inventée ; ces
  NORMES de grille sont distinctes de la façade/superficie réelles ».

---

### KPI 14 — Lots (immo-lots)

- **COMPLET** : lot **servi** (identité cadastrale `noLot` réelle).
- **N-A PROUVÉ** : **absence-source attestée reproductible** (le rôle / cadastre
  ne porte pas de lot pour ce périmètre) — **frontière §4** : immo grave le N-A
  SERVI en citant geo/rôle/cadastre ; geo atteste l'absence-source. **Pas de
  double comptage.**
- **UNKNOWN** : aucun lot servi **sans** attestation d'absence-source.

**MAPPING champ graphe :**
- **`noLot`** — champ graphe immo :
  `packages/radar-domain/src/schemas/ontology/entities.ts:154` — `OntoLot.noLot:
  z.string().min(1)` (clé cadastre autoritaire, NO_LOT, `~l.148-161`).
- Collection geo servie : `qc-lots-<slug>` (`geo-lots.ts:21` `noLot` ;
  `lots-client.ts:27,436` `LotProperties.noLot`). Dénominateur « lots servis » =
  `numberMatched` exact (`lot-fields-coverage.ts:9,82`).

---

### KPI 15 — Surface (superficie réelle du lot)

- **COMPLET** : superficie réelle servie (nombre fini **> 0**).
- **N-A PROUVÉ** : **frontière §4** — absence-source attestée (le rôle RL0302A ne
  porte pas la superficie, et la géométrie publique est absente/non-polygone) via
  requête re-jouable ; immo cite la source geo.
- **UNKNOWN** : `superficieM2: null` **sans** attestation (défaut « honnête »).

**MAPPING champ graphe :**
- **`surface_m2`** (prop geo servie) → surfacé immo comme **`superficieM2`** :
  - mesure : `api/src/services/geo/lot-fields-coverage.ts:49,136` — `surface_m2`
    « aire réelle du lot (nombre fini > 0) ».
  - client UI : `ui/src/lib/maps/lots-client.ts:87,500-502` — `superficieM2` ←
    `superficieM2 | surface_m2`.
  - route lots : `api/src/routes/geo-lots.ts:23` — `superficieM2` **calculée
    depuis la géométrie GeoJSON** (cadastre allégé MRNF, polygone) ; « Les
    superficies du rôle (RL0302A) ne sont pas disponibles dans ce flux » ; `null`
    si géométrie absente/non-polygone.
  - scoring : `api/src/services/scoring/lot-potential.ts:82-83`
    `LotVersionInput.superficieM2: number | null`.
- **Constat :** **AUCUN CHAMP GRAPHE IMMO** dans l'ontologie — c'est une prop geo
  servie (`surface_m2`), calculée géométriquement côté geo/route, consommée par
  immo. Frontière §4 s'applique.

---

### KPI 16 — Code postal

- **COMPLET** : `code_postal` (FSA) servi, chaîne non vide.
- **N-A PROUVÉ** : **frontière §4** — le rôle/adresses-source ne porte pas de code
  postal pour ce lot, attesté par requête re-jouable ; immo cite la source geo.
- **UNKNOWN** : `code_postal` vide/absent **sans** attestation.

**MAPPING champ graphe :**
- **`code_postal`** (prop geo servie, FSA) → **`codePostal`** :
  - mesure : `api/src/services/geo/lot-fields-coverage.ts:54,140` — `code_postal`
    « chaîne non vide (FSA) ».
  - client UI : `ui/src/lib/maps/lots-client.ts:73,514` — `codePostal` ←
    `code_postal`.
  - rendu UI : `ui/src/lib/components/maps/CadastreMapView.svelte:359`
    `data-testid="lot-detail-code-postal"`.
- **Constat :** **AUCUN CHAMP GRAPHE IMMO** dans l'ontologie
  (`entities.ts` : `OntoLot`/`OntoAdresse` ne portent pas `codePostal`). C'est
  une **prop geo servie** sur `qc-lots-<slug>`, consommée par immo. Voir §3
  (scope CP).

---

### KPI 17 — Adresse

- **COMPLET** : `adresse` (civique) servie, chaîne non vide.
- **N-A PROUVÉ** : **frontière §4** — « le rôle d'évaluation ne porte pas
  d'adresse civique pour ce lot » (exemple owner geo-side, `SPEC_PALIER_
  RESOLUTION.md` §4) → requête `<source>` re-jouable ; immo cite la source geo.
- **UNKNOWN** : adresse vide/absente **sans** attestation.

**MAPPING champ graphe :**
- **DEUX porteurs distincts** (à ne pas confondre) :
  1. **prop geo servie `adresse`** (adresse foldée au lot) : mesure
     `lot-fields-coverage.ts:53,139` ; client `lots-client.ts:67,506`.
  2. **champ graphe immo `adresseComplete`** : `entities.ts:169` —
     `OntoAdresse.adresseComplete: z.string().min(1)` (registry `adresses_qc`,
     `idAdresse` clé provinciale `:169`, projection `LOCATED_AT` `lotIds`).
- **Constat :** le KPI 17 SERVI mesuré côté couverture-lot est la **prop geo
  `adresse`** ; l'ontologie immo dispose en plus d'une entité `OntoAdresse`
  (registry). Le N-A relève de la frontière §4 (absence-source rôle/adresses).

---

### KPI 18 & 19 — TOD (transit-oriented development)

- **COMPLET** : appartenance TOD servie (lot dans un périmètre TOD documenté).
- **N-A PROUVÉ** : **hors périmètre TOD DOCUMENTÉ** (immo-side ; geo atteste la
  donnée d'appartenance si requise). Owner verbatim
  (`SPEC_PALIER_RESOLUTION.md` §2) : « TOD (18/19) : **hors périmètre** TOD
  documenté (immo-side ; geo atteste la donnée d'appartenance si requise). »
- **UNKNOWN** : `tod`/`inTod` absent **sans** documentation de périmètre. Le
  **`inTod = false` par défaut ≠ N-A** (« false si inconnu — jamais inventé »,
  `lot-potential.ts:109`).

**MAPPING champ graphe :**
- **AUCUN CHAMP GRAPHE IMMO.** TOD est une **couche/prop geo** :
  - couche : collection geo **`qc-tod-<slug>`** —
    `api/src/routes/source-coverage.ts:320` (`id.startsWith("qc-tod-")`),
    `:957-960` (« servi » = collection `qc-tod-<slug>` dans le listing LIVE ;
    sinon `absent`).
  - prop lot : `api/src/routes/geo-collections.ts:67-69` — `tod` boolean
    « UNIQUEMENT si la source lots porte déjà la donnée (`tod`/`inTod`/`in_tod`).
    **Jamais fabriqué : les collections live n'ont pas de périmètre TOD
    aujourd'hui → champ absent.** »
  - client : `ui/src/lib/maps/lots-client.ts:52,486` — `tod?` ←
    `[tod, inTod, in_tod]`.
  - scoring : `api/src/services/scoring/lot-potential.ts:106-109,238` — `inTod`
    (bonus +1.0), défaut `false`, « jamais inventé ».
- **Constat :** KPI **géo-spatial** (périmètre TOD = géométrie geo), **pas** un
  champ du graphe immo. Voir §3 (scope TOD).

---

### KPI 20 — Recall (+ précision) v3.4

- **COMPLET** : recall mesuré **avec sa précision** et `over_split` par groupe,
  selon le contrat figé (recall = Σ matched / 85 ; plafond honnête 81/85).
- **N-A PROUVÉ** : **0 event de référence sur l'ODJ** → **dénominateur immo
  nul**. Owner (`SPEC_PALIER_RESOLUTION.md` §3) : « 20 Recall-v3.4 : N-A si 0
  event de référence sur l'ODJ (dénominateur immo nul) ».
- **UNKNOWN** : recall non mesuré alors qu'il existe ≥ 1 event de référence.

**Contrat de référence (FROZEN, non amendé ici) :**
`docs/spec/CONTRAT_MESURE_RECALL_SET.md` (SHA `2335a7d`) —
- clé d'identité exacte `(muni, source_url_norm, date_iso, crosswalked_type)`
  (§1) ;
- **dénominateur fixe = 85 DesignationEvents immo** (§2, §3.2) ;
- **recall et précision reportés ENSEMBLE** — jamais recall seul (§4) ;
- type via crosswalk `b9c121d` (non amendé).

**MAPPING champ graphe :** N/A « champ » — c'est une **mesure de jointure**, pas
un attribut. Le dénominateur porte sur les **DesignationEvent** immo (entité
graphe `OntoDesignationEvent`, cf. `entities.ts`), dénombrés par le contrat.

---

## §3 — Résolution de scope : CP (16) et TOD (18/19)

Question : ces KPI ont-ils un **champ dans le graphe immo** ?

| KPI | Champ graphe immo ? | Où vit la donnée | Nature |
|---|---|---|---|
| **16 Code postal** | **NON** (absent de `entities.ts`) | prop geo servie `code_postal` (FSA) sur `qc-lots-<slug>` ; surfacée `codePostal` (`lots-client.ts:73`) | **Attribut geo-servi** (rôle/adresses-source), frontière §4 |
| **18/19 TOD** | **NON** (absent de `entities.ts`) | couche geo `qc-tod-<slug>` + prop lot `tod`/`inTod`/`in_tod` | **KPI GÉO-SPATIAL** (périmètre = géométrie, calculé côté geo) |

**Tranche (fondée sur le code) :**

- **TOD (18/19) = KPI GÉO-SPATIAL, calculé côté geo, HORS graphe immo.** Le code
  est explicite : périmètre = collection géographique `qc-tod-<slug>`
  (`source-coverage.ts:957`), et la prop lot `tod` n'est servie que si la source
  lots la porte déjà, **jamais fabriquée** (`geo-collections.ts:67-69`). Immo ne
  possède AUCUN champ graphe TOD et ne doit pas en fabriquer. N-A = « hors
  périmètre TOD documenté » ATTESTÉ côté geo (owner §2). **Le code TRANCHE :
  géo-spatial, pas un champ manquant à peupler côté immo.**

- **CP (16) = attribut geo-servi, HORS graphe immo.** `code_postal` est servi par
  geo sur la collection lots et consommé par immo (mesure + UI) ; il n'existe pas
  dans l'ontologie immo. Ce n'est pas un calcul géo-spatial (c'est un attribut du
  rôle/adresses) → relève de la **frontière §4** (immo grave le N-A servi en
  citant geo ; geo atteste l'absence-source). ⚠ **SCOPE À CONFIRMER
  geo-archi/conducteur** : faut-il **persister** `codePostal` dans le graphe immo
  (`OntoLot`/`OntoAdresse`) ou rester en **consommation geo-servie** ? Le code
  seul montre une consommation geo-servie mais ne dit pas si la persistance immo
  est une cible ; à trancher owner/geo-archi.

---

## §4 — Table récapitulative (KPI → champ → critère N-A)

| KPI | Champ / porteur réel (`fichier:ligne`) | Champ graphe immo ? | Critère N-A PROUVÉ (owner-aligné) |
|---|---|---|---|
| **7 Effet-dens** | `vivier-v2.ts:6-12,63` `effet_densifiant` (défaut `inconnu`) ; `b-prime.ts:18` (invariant `inconnu`) | oui (valeur ≠ COMPLET) | 0 avis public + 0 certificat MRC 137.3, EEV non documenté, tracé |
| **12 Lot↔zone** | `geo-collections.ts:57-60` `zoneCode`/`zoneJoin` ; `geo-lots.ts:65` `ZoneVersionProvider` | **non** (jointure geo) | 0 lot dans la zone, requête rôle/cadastre re-jouable (frontière §4) |
| **13 Normes-pliées** | `lot-fields-coverage.ts:37-45` `LOT_NORM_VALUE_KEYS` | **non** (prop geo) | muni sans grille/règlement structurel, gisement épuisé + tracé |
| **14 Lots** | `entities.ts:154` `OntoLot.noLot` | **OUI** `noLot` | absence-source rôle/cadastre attestée reproductible (frontière §4) |
| **15 Surface** | `lot-fields-coverage.ts:49` `surface_m2` → `lots-client.ts:87` `superficieM2` ; `geo-lots.ts:23` (calc géométrie) | **non** (prop geo) | absence-source (RL0302A + géométrie absente) attestée (frontière §4) |
| **16 Code postal** | `lot-fields-coverage.ts:54` `code_postal` → `lots-client.ts:73` `codePostal` | **non** (prop geo, ⚠ §3) | absence-source (rôle/adresses sans CP) attestée (frontière §4) |
| **17 Adresse** | prop geo `adresse` (`lot-fields-coverage.ts:53`) **+** `entities.ts:169` `OntoAdresse.adresseComplete` | prop geo **et** entité `OntoAdresse` | absence-source (rôle sans adresse civique) attestée (frontière §4) |
| **18/19 TOD** | couche geo `qc-tod-<slug>` (`source-coverage.ts:320,957`) ; prop `tod` (`geo-collections.ts:67`) | **non** (géo-spatial) | hors périmètre TOD documenté, attesté geo (owner §2) |
| **20 Recall v3.4** | `CONTRAT_MESURE_RECALL_SET.md` (`2335a7d`), dénom. 85 | mesure (DesignationEvent) | 0 event de référence sur l'ODJ (dénominateur immo nul) |

---

## §5 — OPEN (à trancher owner / geo-archi / conducteur)

1. **⚠ SCOPE — CP (16) :** persister `codePostal` dans le graphe immo
   (`OntoLot`/`OntoAdresse`) OU rester en consommation geo-servie `code_postal` ?
   Le code seul ne tranche pas la cible de persistance. → **geo-archi/conducteur.**
2. **⚠ SCOPE — TOD (18/19) :** confirmer que TOD reste **géo-spatial côté geo**
   (position de ce document, fondée sur `qc-tod-<slug>` +
   `geo-collections.ts:67-69`) et qu'immo n'a **pas** à peupler un champ TOD. Le
   code TRANCHE en ce sens ; confirmation owner requise pour figer.
3. **Grille canonique absente :** `SPEC_PALIER_OWNERSHIP.md` §2 n'est pas dans ce
   checkout ; le cadrage owner est repris via `SPEC_PALIER_RESOLUTION.md` §2/§3/§4
   (geo-side). **Reconnecter** ce document à la grille canonique dès sa
   disponibilité et vérifier l'alignement KPI par KPI.
4. **KPI 7 COMPLET (Δ grille) :** aucun champ ne porte aujourd'hui le delta
   ancien↔nouveau de grille (`effet_densifiant` reste `inconnu` en B′/Vivier).
   Confirmer le porteur du calcul Δ grille (geo-side ? crosswalk ?) pour rendre
   COMPLET atteignable.
5. **Frontière §4 (14–17) — attestation d'absence-source :** confirmer la
   **requête geo re-jouable** normée (rôle/cadastre/adresses) qui produit le
   RÉSULTAT d'absence-source, pour que le triplet `{source,date,résultat}` immo
   cite une source geo stable (contrat d'attestation geo↔immo).
6. **Recall (20) :** le contrat `2335a7d` fige le dénominateur à **85** ; l'ODJ
   par muni doit exposer son dénominateur immo local pour distinguer N-A
   (dénominateur nul) d'UNKNOWN (non mesuré) au niveau cellule.
