# SPEC_DESIGN - Modèle de données : zonage, lots, désignation dans le temps, valuation

> **Statut** : PROPOSITION DE DESIGN, pour sign-off. **Aucun code** n'est écrit ici.
> Schémas Zod et tables PostGIS/Drizzle sont des **esquisses** (sketches), pas des
> migrations. À valider avant toute implémentation (jalon J4 du plan scraping).
>
> **Branche** : `feat/datamodel-design` (off `main`).
> **Auteur** : assistant radar.
> **Date** : 2026-06-06.
>
> **Inputs lus** :
> `docs/spec/SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md` (intention, point de départ),
> `docs/spec/SPEC_PLAN_SCRAPING.md` (les entités de l'étage EXPLOITATION à matcher),
> `docs/spec/SPEC_EVOL_PROCESS_E2E.md` (« simulation à date », états, scoring 0-5),
> `docs/spec/SPEC_EVOL_DATA_MODEL.md` (leçons réelles Valleyfield),
> `docs/spec/input/PROMPT.md` (les 6 phases de l'analyste),
> `packages/radar-domain/src/valleyfield-dossiers.ts` (modèle à généraliser),
> `packages/radar-domain/src/schemas/{opportunity,common,signal,score,journal}.ts`,
> `packages/radar-domain/src/{scoring,source-kind}.ts`,
> `packages/radar-sources/src/{SourceAdapter.ts,prioritySources.ts}`,
> `api/src/db/schema.ts` (schéma Drizzle existant).

---

## 0. Cadre, objectifs, principes directeurs

### 0.1 Le problème à résoudre

Le modèle actuel (`valleyfield-dossiers.ts` + `schemas/opportunity.ts`) est
**centré dossier**. Zone et lots y sont des **chaînes de texte plates** :
`zone: "H-609-4"`, `bylaw: "150-49"`, `lots[].noLot: "4516943"`,
`lots[].valeur: "1 311 600 $"`. Conséquences directes :

1. **Pas d'historique** : on ne peut pas représenter `U-521 → H-521` ou
   `H-143 → H-143-1` comme un événement daté ; le dossier 2 encode la transition
   dans son titre et son `bylaw`, pas dans une structure interrogeable.
2. **Pas d'« état à une date »** : impossible de répondre « quelle était la zone du
   lot 4516554 au 2026-03-01 ? » (parcours « simulation à date », PROCESS_E2E §3).
3. **Valuation noyée** : `valeur: "1 311 600 $"` est une string non typée, sans année
   ni source, donc inexploitable pour l'axe **marché** du scoring (souvent
   `non-disponible`).
4. **Provenance dupliquée** : chaque datum devrait porter sa preuve, mais le lien
   lot → preuve passe aujourd'hui par le tableau `evidence[]` du dossier, pas par
   le lot lui-même.

### 0.2 Objectifs du modèle cible

- **O1 - Désignation temporelle** : représenter la création / scission / renommage /
  changement de densité-usage d'une zone OU d'un lot comme des **événements datés et
  sourcés** (`DesignationEvent`), avec liens de filiation (`supersedes`).
- **O2 - Résolution « as of date »** : reconstruire l'état zone/lot à une date T,
  en deux variantes : « réel » (temps de validité) et « audit » (bitemporel, ce que
  radar **savait** à une date de connaissance).
- **O3 - Valuation typée et datée** : rôle d'évaluation par lot/année + estimation
  marché, rattachée dans le temps, alimentant explicitement les axes de scoring.
- **O4 - Provenance de bout en bout** : chaque fait porte sa preuve (`EvidenceItem`,
  lien `rawRef` vers le brut S3) et son mode `réel | hypothèse | non-disponible | simulé`.
- **O5 - Multi-villes** : aucune logique « Valleyfield » en dur ; tout passe par un
  `CityProfile` (cf. SPEC_PLAN_SCRAPING §2.3).
- **O6 - Continuité** : matcher exactement les entités de l'étage EXPLOITATION du plan
  scraping (`Zone / Lot / DesignationEvent / Valuation / Signal`) et réutiliser les
  briques existantes (`EvidenceItem`, `Mode`, `Confidence`, `Verification`,
  `ScoreSet`, `AxesMap`).

### 0.3 Principes directeurs (hérités des règles cardinales)

- **Anti-invention** : une valeur non obtenue = `non-disponible` explicite. Jamais de
  valeur neutre fabriquée (PROCESS_E2E §4.4).
- **Brut avant extraction** : le modèle normalisé pointe toujours vers un
  `raw_document` (clé S3), ne re-fetch jamais.
- **Stable typé / instable jsonb** : colonnes typées pour les champs universels
  (présents pour toute municipalité QC) ; `jsonb` validé par Zod pour les champs
  instables (grilles de normes par zone/règlement), jusqu'à stabilisation
  (SPEC_EVOL_DATA_MODEL §3).
- **Géométrie = PostGIS** (Postgres 16 + PostGIS, déjà dans le socle), SRID 4326 en
  stockage canonique (le cadastre allégé livre en EPSG:3857 ; conversion à l'ingestion).
- **PII hors modèle public** : pas de champ `proprietaire` (LFM art. 72 ;
  SPEC_EVOL_DATA_MODEL §2.2). Si un jour sourcé via registre foncier payant → table
  séparée à accès journalisé, hors de ce design.

### 0.4 Vue d'ensemble (relations)

```
CityProfile 1───* Zone ───* DesignationEvent *─── Lot *───1 CityProfile
                  │              │   │                │
                  │ (résolution  │   │ (cible: zone   │
                  │  as-of-date) │   │  OU lot)       │
                  │              │   │                │
                  *              *   *                *
              ZoneVersion    Bylaw  EvidenceItem   Valuation
              (snapshot         │        │            │
               matérialisé)     │        ▼            ▼
                  │             │    raw_document  raw_document
                  └── lot_zone_resolution (assignation Lot↔Zone, datée + confiance)

Signal ──(supersedes/dérive de)── DesignationEvent
Opportunity ──* Lot   (dossier T2, score ancré au réel)
```

Le couple **(événements + snapshots matérialisés)** est le choix structurant
(option A2 du §6) : les `DesignationEvent` sont la source de vérité ; les
`ZoneVersion` et `lot_zone_resolution` sont des **projections matérialisées** pour
des requêtes « as of date » rapides, reconstructibles depuis les événements.

---

## 1. Entité model (concret)

Pour chaque entité : (a) rôle, (b) champs proposés, (c) esquisse Zod, (d) esquisse
table PostGIS/Drizzle. Les types réutilisés de l'existant sont signalés `[réutilisé]`.

### 1.0 Briques transverses (réutilisées + une nouvelle)

Réutilisés tels quels depuis `packages/radar-domain/src/schemas/` :

- `Mode = "real" | "simulation"` (`common.ts`).
- `Confidence = "high" | "medium" | "low"` (`common.ts`).
- `Verification = "fait" | "hypothese" | "non-disponible" | "simulé"` (`opportunity.ts`).
- `EvidenceItem` (`opportunity.ts`) : `{ phase, sourceId, label, url?, date,
  obtentionMode, confidence, verification, value? }`.
- `ScoreSet`, `AxesMap`, `weightedScore` (`opportunity.ts` / `score.ts`).

**Nouveauté transverse - `Temporal` (bitemporalité)**. Toute entité versionnée
porte le même bloc temporel, factorisé :

```ts
// packages/radar-domain/src/schemas/temporal.ts  (ESQUISSE)
import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema } from "./common.js";

/**
 * Bitemporalité minimale (SPEC_INTENT §3).
 * - validity time  : quand le fait est VRAI dans le monde (entrée en vigueur).
 * - knowledge time : quand RADAR l'a recueilli/su (transaction time).
 * validTo / knownTo = null  => version courante (ouverte).
 */
export const TemporalSpan = z.object({
  validFrom: isoDateSchema,                 // date d'effet (réglementaire)
  validTo: isoDateSchema.nullable().default(null),
  knownFrom: isoDateTimeSchema,             // 1re connaissance par radar
  knownTo: isoDateTimeSchema.nullable().default(null), // null = encore "cru vrai"
});
export type TemporalSpanT = z.infer<typeof TemporalSpan>;
```

**Décision de granularité bitemporelle** (cf. §6, choix C) : la **validity time** est
portée par **toutes** les entités versionnées (Zone, Lot, assignation Lot↔Zone,
Valuation). La **knowledge time** est portée de façon **complète** uniquement par
`ZoneVersion`, `lot_zone_resolution` et `Valuation` (les entités qui changent par
ré-extraction) ; pour `DesignationEvent` la knowledge time est `knownFrom`
(immuable, append-only) sans `knownTo`. Ce niveau couvre l'audit « que savait-on à
la date K » sans payer le coût d'une bitemporalité totale partout.

---

### 1.1 `Zone`

**(a) Rôle.** Une **zone réglementaire municipale** (H-609-4, U-521, H-143-1…),
identité **stable** dans le temps (`id` interne immuable) avec un **code affiché qui
peut changer** (renommage U-521 → H-521 conserve l'`id`). La Zone agrège ses
**versions** (`ZoneVersion`) ; les attributs variables (code, type, densité,
géométrie) vivent dans les versions, pas sur la zone.

**(b) Champs.**

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | identité interne **stable** (jamais réaffectée même si le code change) |
| `citySlug` | string | FK `CityProfile` |
| `kind` | enum | `H`(habitation) `C`(commercial) `U`(utilité publique) `I`(industriel) `P`(parc/public) `A`(agricole) `CONS`(conservation) `REC`(récréatif) `MIXTE` `AUTRE` |
| `createdByEventId` | uuid | `DesignationEvent` qui a créé la zone (filiation) |
| `metadata` | jsonb | ouvert (ex. `ancienCode` informatif) |

Les attributs **datés** (code affiché, géométrie, normes) sont dans `ZoneVersion` :

| Champ ZoneVersion | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `zoneId` | uuid | FK Zone |
| `codeAffiche` | string | « H-609-4 », « U-521 »… (peut changer entre versions) |
| `densiteLogHa` | numeric? | densité (log/ha) - souvent `null` (non publié) |
| `densiteCondition` | jsonb? | densité conditionnelle (ex. « 50 si ≥30 % conservé ») |
| `etagesMax` | int? | |
| `hauteurMaxM` | numeric? | |
| `usages` | jsonb | grille d'usages permis (instable → jsonb) |
| `normes` | jsonb | marges, COS, stationnement (instable → jsonb) |
| `geom` | geometry(MultiPolygon,4326)? | **souvent null** (gap polygone, §4 SPEC_EVOL_DATA_MODEL) |
| `geomSource` | enum | `open-data-ckan \| wms-municipal \| vectorised-pdf \| hypothese-street-name \| non-disponible` (réutilise `ZonePolygonSource`) |
| `sourceEventId` | uuid | `DesignationEvent` qui a produit cette version |
| `temporal` | TemporalSpan | bitemporel (inline en colonnes) |
| `evidence` | jsonb (`EvidenceItem[]`) | preuves de cette version |

**(c) Esquisse Zod.**

```ts
// packages/radar-domain/src/schemas/zone.ts  (ESQUISSE)
import { z } from "zod";
import { TemporalSpan } from "./temporal.js";
import { EvidenceItem, ZonePolygonSource } from "./opportunity.js"; // existants

export const ZoneKind = z.enum([
  "H", "C", "U", "I", "P", "A", "CONS", "REC", "MIXTE", "AUTRE",
]);

export const Zone = z.object({
  id: z.string().uuid(),
  citySlug: z.string().min(1),
  kind: ZoneKind,
  createdByEventId: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
});

export const GeomSource = ZonePolygonSource.or(z.literal("non-disponible"));

export const ZoneVersion = z.object({
  id: z.string().uuid(),
  zoneId: z.string().uuid(),
  codeAffiche: z.string().min(1),
  densiteLogHa: z.number().nonnegative().nullable().default(null),
  densiteCondition: z.record(z.unknown()).nullable().default(null),
  etagesMax: z.number().int().positive().nullable().default(null),
  hauteurMaxM: z.number().positive().nullable().default(null),
  usages: z.array(z.string()).default([]),
  normes: z.record(z.unknown()).default({}),
  // geom: GeoJSON validé hors Zod (PostGIS), ici on garde la métadonnée:
  geomSource: GeomSource.default("non-disponible"),
  sourceEventId: z.string().uuid(),
  temporal: TemporalSpan,
  evidence: z.array(EvidenceItem).default([]),
});
export type ZoneT = z.infer<typeof Zone>;
export type ZoneVersionT = z.infer<typeof ZoneVersion>;
```

**(d) Esquisse table PostGIS/Drizzle.** (PostGIS via `customType` Drizzle ; index
GiST sur la géométrie ; index sur la fenêtre temporelle.)

```ts
// api/src/db/schema.ts  (ESQUISSE - extension)
export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  citySlug: text("city_slug").notNull(),          // FK city_profiles.slug
  kind: text("kind").notNull(),                   // ZoneKind
  createdByEventId: uuid("created_by_event_id").notNull(), // FK designation_events.id
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const zoneVersions = pgTable("zone_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id").notNull().references(() => zones.id, { onDelete: "cascade" }),
  codeAffiche: text("code_affiche").notNull(),
  densiteLogHa: numeric("densite_log_ha"),
  densiteCondition: jsonb("densite_condition"),
  etagesMax: integer("etages_max"),
  hauteurMaxM: numeric("hauteur_max_m"),
  usages: jsonb("usages").notNull().default([]),
  normes: jsonb("normes").notNull().default({}),
  geom: geometry("geom", { type: "MultiPolygon", srid: 4326 }), // nullable (gap)
  geomSource: text("geom_source").notNull().default("non-disponible"),
  sourceEventId: uuid("source_event_id").notNull(), // FK designation_events.id
  // ── bitemporel ──
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),                        // null = courant
  knownFrom: timestamp("known_from", { withTimezone: true }).notNull().defaultNow(),
  knownTo: timestamp("known_to", { withTimezone: true }),
  evidence: jsonb("evidence").notNull().default([]),
});
// Index recommandés :
//   GIST (geom)                                  -- intersection spatiale
//   (zone_id, valid_from, valid_to)              -- résolution as-of-date
//   (code_affiche, city_slug)                    -- lookup par code affiché
//   EXCLUDE USING gist (zone_id WITH =, daterange(valid_from, valid_to) WITH &&)
//        WHERE (known_to IS NULL)                -- non-chevauchement des versions courantes
```

> **Note `code_affiche` non unique** : volontaire. Un même code peut désigner des
> zones différentes dans le temps après réutilisation, et la même zone peut changer
> de code. L'unicité métier est `(zone_id, période)`, pas le code.

---

### 1.2 `Lot`

**(a) Rôle.** Un **lot cadastral** (`NO_LOT`, la clé de jointure universelle de toutes
les couches spatiales QC - SPEC_EVOL_DATA_MODEL §1.1). Identité stable, géométrie et
attributs (superficie, usage) datés via `LotVersion`. La **zone d'un lot n'est pas un
champ du lot** : c'est une **résolution datée** (`lot_zone_resolution`, §1.5), parce
qu'elle dépend de la date ET de la qualité de l'assignation (géométrique vs hypothèse).

**(b) Champs.**

| Champ Lot | Type | Notes |
|---|---|---|
| `id` | uuid | identité interne stable |
| `citySlug` | string | FK CityProfile |
| `noLot` | string | `NO_LOT` cadastral (RL0103Ax) - clé de jointure |
| `matricule` | string? | matricule rôle (RL0104C ≠ matricule officiel registre foncier) |
| `createdByEventId` | uuid? | événement de subdivision/création (filiation) |
| `parentLotIds` | uuid[] | filiation : lots dont celui-ci est issu (subdivision/remembrement) |

| Champ LotVersion | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `lotId` | uuid | FK Lot |
| `superficieM2` | numeric? | RL0302A (universel) |
| `usageCode` | string? | RU/CH/BO/AV/TE (RL0101Ex, standardisé QC) |
| `adresseCivique` | string? | RL0101Ax + Gx (absent pour lots sans numéro) |
| `geom` | geometry(MultiPolygon,4326)? | cadastre allégé (REST ESRI, reprojeté 4326) |
| `geomSource` | enum | `cadastre-allege \| infolot \| non-disponible` |
| `temporal` | TemporalSpan | bitemporel |
| `rawRef` | string | clé S3 / id `raw_document` du rôle ou cadastre |
| `evidence` | jsonb | preuves |

**Filiation (la chaîne de désignation des lots)** : modélisée par
`parentLotIds[]` + un `DesignationEvent` de type `lot-subdivision` /
`lot-remembrement` / `lot-renumerotation`. Un lot subdivisé reçoit `validTo` à la date
de l'opération ; les lots enfants reçoivent `validFrom` = même date + `parentLotIds`
pointant le parent.

**(c) Esquisse Zod.**

```ts
// packages/radar-domain/src/schemas/lot.ts  (ESQUISSE)
import { z } from "zod";
import { TemporalSpan } from "./temporal.js";
import { EvidenceItem } from "./opportunity.js";

export const Lot = z.object({
  id: z.string().uuid(),
  citySlug: z.string().min(1),
  noLot: z.string().min(1),
  matricule: z.string().optional(),
  createdByEventId: z.string().uuid().optional(),
  parentLotIds: z.array(z.string().uuid()).default([]),
});

export const LotUsage = z.enum(["RU", "CH", "BO", "AV", "TE", "AUTRE"]);

export const LotVersion = z.object({
  id: z.string().uuid(),
  lotId: z.string().uuid(),
  superficieM2: z.number().nonnegative().nullable().default(null),
  usageCode: LotUsage.nullable().default(null),
  adresseCivique: z.string().nullable().default(null),
  geomSource: z.enum(["cadastre-allege", "infolot", "non-disponible"]).default("non-disponible"),
  temporal: TemporalSpan,
  rawRef: z.string().min(1),     // pointe le raw_document (S3)
  evidence: z.array(EvidenceItem).default([]),
});
export type LotT = z.infer<typeof Lot>;
export type LotVersionT = z.infer<typeof LotVersion>;
```

**(d) Esquisse table.**

```ts
export const lots = pgTable("lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  citySlug: text("city_slug").notNull(),
  noLot: text("no_lot").notNull(),
  matricule: text("matricule"),
  createdByEventId: uuid("created_by_event_id"), // FK designation_events.id (nullable)
  parentLotIds: jsonb("parent_lot_ids").notNull().default([]), // uuid[] (filiation)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lotVersions = pgTable("lot_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull().references(() => lots.id, { onDelete: "cascade" }),
  superficieM2: numeric("superficie_m2"),
  usageCode: text("usage_code"),
  adresseCivique: text("adresse_civique"),
  geom: geometry("geom", { type: "MultiPolygon", srid: 4326 }),
  geomSource: text("geom_source").notNull().default("non-disponible"),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  knownFrom: timestamp("known_from", { withTimezone: true }).notNull().defaultNow(),
  knownTo: timestamp("known_to", { withTimezone: true }),
  rawRef: text("raw_ref").notNull(),
  evidence: jsonb("evidence").notNull().default([]),
});
// Index : GIST(geom) ; (no_lot, city_slug) ; (lot_id, valid_from, valid_to)
```

---

### 1.3 `DesignationEvent` (le cœur temporel)

**(a) Rôle.** Le **fait daté et sourcé** qui change l'identité ou les attributs d'une
zone OU d'un lot, **provoqué par un règlement / avis / dépôt cadastral à une date**.
C'est la source de vérité de l'historique. **Append-only** (jamais modifié ; une
erreur se corrige par un événement compensatoire). Tous les snapshots (`ZoneVersion`,
`lot_zone_resolution`) sont des projections de ces événements.

**(b) Champs.**

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `citySlug` | string | FK CityProfile |
| `targetKind` | enum | `zone \| lot` |
| `targetId` | uuid | id de la Zone ou du Lot affecté (résultat) |
| `type` | enum | voir ci-dessous |
| `bylaw` | string? | n° règlement (150-49, 150-51, 150-49-1) |
| `bylawStage` | enum? | maturité légale : `avis \| 1er-projet \| 2e-projet \| adopte \| en-vigueur \| referendaire-en-cours` |
| `validFrom` | date | **date d'effet** (entrée en vigueur ; sinon date d'adoption avec flag) |
| `effectKind` | enum | `adoption \| entree-vigueur \| projet` (qualifie la date) |
| `supersedesEventId` | uuid? | événement précédent qu'il remplace (chaîne) |
| `affectedZoneIds` | uuid[] | pour scission/fusion (plusieurs cibles) |
| `affectedLotIds` | uuid[] | idem lots |
| `payload` | jsonb | détail du changement (avant/après densité, usages, code) |
| `rawRef` | string | clé S3 du `raw_document` (avis/règlement PDF) |
| `mode` | Mode | `real \| simulation` |
| `verification` | Verification | `fait \| hypothese \| non-disponible \| simulé` |
| `knownFrom` | datetime | date de connaissance radar |
| `evidence` | jsonb (`EvidenceItem[]`) | preuves |

**Taxonomie `type`** (couvre les cas réels Valleyfield + génériques) :

- `zone-creation` - création ex-novo (H-609-4 créée à même H-609).
- `zone-split` - scission (H-143 → H-143 + H-143-1 ; A-118 → A-118 + A-118-1 tampon).
- `zone-merge` - fusion.
- `zone-rename` - renommage à limites constantes (U-521 → H-521, art.14 « mêmes limites »).
- `zone-rezoning` - changement d'usage/densité (le **signal** principal : U→H, +densité).
- `zone-boundary-change` - modification de géométrie.
- `lot-subdivision` - un lot → plusieurs.
- `lot-remembrement` - plusieurs lots → un.
- `lot-renumerotation` - changement de `NO_LOT` sans changement géométrique.

> Un même règlement génère **plusieurs** `DesignationEvent` (150-49 crée H-609-4 ET
> participe à H-143/H-143-1 ET crée A-118-1). Le `bylaw` les regroupe.

**(c) Esquisse Zod.**

```ts
// packages/radar-domain/src/schemas/designation-event.ts  (ESQUISSE)
import { z } from "zod";
import { Mode } from "./common.js";
import { Verification, EvidenceItem } from "./opportunity.js";
import { isoDateSchema, isoDateTimeSchema } from "./common.js";

export const DesignationEventType = z.enum([
  "zone-creation", "zone-split", "zone-merge", "zone-rename",
  "zone-rezoning", "zone-boundary-change",
  "lot-subdivision", "lot-remembrement", "lot-renumerotation",
]);

export const BylawStage = z.enum([
  "avis", "1er-projet", "2e-projet", "adopte", "en-vigueur", "referendaire-en-cours",
]);

export const DesignationEvent = z.object({
  id: z.string().uuid(),
  citySlug: z.string().min(1),
  targetKind: z.enum(["zone", "lot"]),
  targetId: z.string().uuid(),
  type: DesignationEventType,
  bylaw: z.string().optional(),
  bylawStage: BylawStage.optional(),
  validFrom: isoDateSchema,
  effectKind: z.enum(["adoption", "entree-vigueur", "projet"]),
  supersedesEventId: z.string().uuid().optional(),
  affectedZoneIds: z.array(z.string().uuid()).default([]),
  affectedLotIds: z.array(z.string().uuid()).default([]),
  payload: z.record(z.unknown()).default({}),
  rawRef: z.string().min(1),
  mode: Mode.default("real"),
  verification: Verification,
  knownFrom: isoDateTimeSchema,
  evidence: z.array(EvidenceItem).default([]),
});
export type DesignationEventT = z.infer<typeof DesignationEvent>;
```

**(d) Esquisse table.**

```ts
export const designationEvents = pgTable("designation_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  citySlug: text("city_slug").notNull(),
  targetKind: text("target_kind").notNull(),      // zone | lot
  targetId: uuid("target_id").notNull(),
  type: text("type").notNull(),                   // DesignationEventType
  bylaw: text("bylaw"),
  bylawStage: text("bylaw_stage"),
  validFrom: date("valid_from").notNull(),
  effectKind: text("effect_kind").notNull(),
  supersedesEventId: uuid("supersedes_event_id"), // self-FK (chaîne de filiation)
  affectedZoneIds: jsonb("affected_zone_ids").notNull().default([]),
  affectedLotIds: jsonb("affected_lot_ids").notNull().default([]),
  payload: jsonb("payload").notNull().default({}),
  rawRef: text("raw_ref").notNull(),
  mode: text("mode").notNull().default("real"),
  verification: text("verification").notNull(),
  knownFrom: timestamp("known_from", { withTimezone: true }).notNull().defaultNow(),
  evidence: jsonb("evidence").notNull().default([]),
});
// Append-only : pas d'UPDATE/DELETE applicatif (cohérent journal V1, PROCESS_E2E §6).
// Index : (target_kind, target_id, valid_from) ; (bylaw, city_slug) ; (supersedes_event_id)
```

---

### 1.4 `Valuation`

**(a) Rôle.** Une **valeur datée** rattachée à un lot (ou une zone), de deux natures :
(1) **rôle d'évaluation** (foncière/bâtie/totale par année, cycle trisannuel QC),
(2) **estimation marché** (comparables/heuristique, souvent `non-disponible` Tier C).
Alimente les axes **marché** (valeur actuelle) et **potentiel** (upside) du scoring.

**(b) Champs.**

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `scopeKind` | enum | `lot \| zone` |
| `scopeId` | uuid | FK Lot ou Zone |
| `kind` | enum | `role-evaluation \| market-estimate` |
| `rolYear` | int? | année du rôle (ex. 2026) ; `dateReference` = 2024-07-01 pour le rôle 2026 |
| `valeurTerrain` | numeric? | RL0402A composante terrain |
| `valeurBatiment` | numeric? | composante bâtiment |
| `valeurTotale` | numeric? | RL0402A (valeur autoritaire) - devise CAD |
| `pricePerM2` | numeric? | dérivé (estimation marché), souvent null |
| `currency` | string | `CAD` |
| `temporal` | TemporalSpan | la valeur est vraie pour `[validFrom, validTo)` (= cycle de rôle) |
| `source` | string | `role-evaluation-mamh` / `jlr` / `heuristic-v1` |
| `confidence` | Confidence | |
| `verification` | Verification | rôle = `fait` ; estimation marché = souvent `non-disponible` |
| `rawRef` | string? | brut S3 (XML rôle) |
| `evidence` | jsonb | preuves |

> Le rôle livre la valeur **totale** comme autoritaire ; terrain+bâtiment peuvent
> dépasser le total (artefact historique, SPEC_EVOL_DATA_MODEL §1.1) → garder les 3
> mais ne jamais recalculer total = terrain + bâtiment.

**(c) Esquisse Zod.**

```ts
// packages/radar-domain/src/schemas/valuation.ts  (ESQUISSE)
import { z } from "zod";
import { Confidence } from "./common.js";
import { Verification, EvidenceItem } from "./opportunity.js";
import { TemporalSpan } from "./temporal.js";

export const ValuationKind = z.enum(["role-evaluation", "market-estimate"]);

export const Valuation = z.object({
  id: z.string().uuid(),
  scopeKind: z.enum(["lot", "zone"]),
  scopeId: z.string().uuid(),
  kind: ValuationKind,
  rolYear: z.number().int().min(2000).max(2100).nullable().default(null),
  valeurTerrain: z.number().nonnegative().nullable().default(null),
  valeurBatiment: z.number().nonnegative().nullable().default(null),
  valeurTotale: z.number().nonnegative().nullable().default(null),
  pricePerM2: z.number().nonnegative().nullable().default(null),
  currency: z.string().length(3).default("CAD"),
  temporal: TemporalSpan,
  source: z.string().min(1),
  confidence: Confidence,
  verification: Verification,
  rawRef: z.string().optional(),
  evidence: z.array(EvidenceItem).default([]),
});
export type ValuationT = z.infer<typeof Valuation>;
```

**(d) Esquisse table.**

```ts
export const valuations = pgTable("valuations", {
  id: uuid("id").primaryKey().defaultRandom(),
  scopeKind: text("scope_kind").notNull(),  // lot | zone
  scopeId: uuid("scope_id").notNull(),
  kind: text("kind").notNull(),             // role-evaluation | market-estimate
  rolYear: integer("rol_year"),
  valeurTerrain: numeric("valeur_terrain"),
  valeurBatiment: numeric("valeur_batiment"),
  valeurTotale: numeric("valeur_totale"),
  pricePerM2: numeric("price_per_m2"),
  currency: text("currency").notNull().default("CAD"),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  knownFrom: timestamp("known_from", { withTimezone: true }).notNull().defaultNow(),
  knownTo: timestamp("known_to", { withTimezone: true }),
  source: text("source").notNull(),
  confidence: text("confidence").notNull(),
  verification: text("verification").notNull(),
  rawRef: text("raw_ref"),
  evidence: jsonb("evidence").notNull().default([]),
});
// Index : (scope_kind, scope_id, rol_year) ; (scope_id, valid_from, valid_to)
```

---

### 1.5 `lot_zone_resolution` (assignation Lot ↔ Zone, datée + qualifiée)

**(a) Rôle.** Matérialise **quelle zone s'applique à quel lot à quelle date**, avec la
**qualité** de l'assignation (le cœur du gap polygone). C'est une projection, pas une
saisie : produite soit par **intersection géométrique** (quand `Zone.geom` ET
`Lot.geom` existent), soit par **hypothèse nom de rue** (état actuel Valleyfield).

**(b) Champs.**

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `lotId` | uuid | FK Lot |
| `zoneId` | uuid | FK Zone |
| `method` | enum | `geometric-intersection \| street-name-hypothesis \| manual` |
| `confirmed` | boolean | `true` ssi `geometric-intersection` (réutilise sémantique `confirmed` PROCESS_E2E §3) |
| `coveragePct` | numeric? | % du lot dans la zone (si géométrique) |
| `confidence` | Confidence | |
| `temporal` | TemporalSpan | l'assignation vaut pour une période |
| `evidence` | jsonb | preuves (ex. avis listant zones contiguës) |

**(c+d) Esquisse.**

```ts
// Zod (ESQUISSE)
export const LotZoneResolution = z.object({
  id: z.string().uuid(),
  lotId: z.string().uuid(),
  zoneId: z.string().uuid(),
  method: z.enum(["geometric-intersection", "street-name-hypothesis", "manual"]),
  confirmed: z.boolean().default(false),
  coveragePct: z.number().min(0).max(100).nullable().default(null),
  confidence: Confidence,
  temporal: TemporalSpan,
  evidence: z.array(EvidenceItem).default([]),
});

// Drizzle (ESQUISSE)
export const lotZoneResolutions = pgTable("lot_zone_resolutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull().references(() => lots.id, { onDelete: "cascade" }),
  zoneId: uuid("zone_id").notNull().references(() => zones.id, { onDelete: "cascade" }),
  method: text("method").notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  coveragePct: numeric("coverage_pct"),
  confidence: text("confidence").notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  knownFrom: timestamp("known_from", { withTimezone: true }).notNull().defaultNow(),
  knownTo: timestamp("known_to", { withTimezone: true }),
  evidence: jsonb("evidence").notNull().default([]),
});
// Index : (lot_id, valid_from, valid_to) ; (zone_id, valid_from, valid_to)
```

---

### 1.6 Rattachement à l'existant (`Signal`, `Opportunity`, `raw_document`)

- **`Signal`** (existant, `signal.ts`) : un **rezonage = `DesignationEvent` de type
  `zone-rezoning`** (changement densité/usage). Proposition : ajouter
  `signals.designationEventId` (FK) pour relier le signal de veille (T1) à l'événement
  qui le porte. Le `Signal.type = "residential-rezoning"` se dérive de
  `DesignationEvent.type ∈ {zone-rezoning, zone-creation avec usage H}`.
- **`Opportunity` / `OpportunityDossier`** (existant) : reste le **dossier T2** (score
  ancré au réel). Évolution : ses `lots[]` (strings) deviennent des **FK `lotId`** vers
  `lots` ; sa `zone` (string) devient une **FK `zoneId`** ; ses `lots[].valeur` (string)
  disparaissent au profit de jointures `valuations`. `evidence[]` reste sur le dossier
  (preuves de raisonnement de scoring), tandis que les preuves **factuelles** migrent
  vers les entités (Zone/Lot/Valuation).
- **`raw_document`** (à créer par le plan scraping, J1) : `rawRef` partout pointe sa
  clé S3 (`raw/<kind>/<city>/<Y>/<M>/<D>/<sha>.<ext>`). Le modèle normalisé ne
  re-fetch jamais.
- **`CityProfile`** (à créer par le plan scraping, J2) : `{ slug, nomOfficiel,
  codeMamh, dguidStatcan, mrcSlug, bbox, cms, sources[] }`. Toutes les entités portent
  `citySlug`.

---

## 2. Désignation dans le temps (la demande explicite)

### 2.1 Principe

Tout changement d'identité ou d'attribut = un `DesignationEvent` **daté + sourcé**.
Les entités Zone/Lot ne sont jamais mutées en place ; on **clôt** la version courante
(`validTo`) et on **ouvre** une nouvelle version (`validFrom`), reliée par
`supersedesEventId`. L'identité interne (`id`) est **stable** ; seul le `codeAffiche`
(zone) ou le `noLot` (lot) peut changer.

### 2.2 Patrons de changement (mapping cas réels → événements)

| Cas réel Valleyfield | `type` | Effet sur l'identité | Géométrie |
|---|---|---|---|
| H-609 → **création** H-609-4 (règl. 150-49) | `zone-creation` | nouvelle `Zone` (nouvel `id`), `createdByEventId` pointe l'événement | héritée de H-609 (sous-emprise) |
| U-521 → **renommage** H-521 (règl. 150-51, art.14 « mêmes limites ») | `zone-rename` + `zone-rezoning` | **même `id`**, nouvelle `ZoneVersion` (code U-521→H-521, usages U→H) | inchangée |
| H-143 → **scission** H-143 + H-143-1 (règl. 150-49-1) | `zone-split` | H-143 garde son `id` (version réduite) ; H-143-1 = nouvelle `Zone` | H-143-1 découpée dans H-143 |
| création tampon A-118-1 entre H-143-1 et A-118 | `zone-creation` | nouvelle `Zone` kind=CONS | sous-emprise |
| (générique) lot 123 → 123-1 / 123-2 | `lot-subdivision` | lot 123 `validTo` ; enfants `parentLotIds=[123]` | partition |

> **Renommage vs rezonage** : `zone-rename` change le code à limites/usages constants ;
> `zone-rezoning` change usage/densité. U-521 → H-521 est **les deux à la fois**
> (renommage U→H + passage utilité-publique→résidentiel) : on émet **deux événements**
> sur le même `targetId`, même `validFrom`, ce qui garde la sémantique propre (un
> renommage pur n'est pas un signal de potentiel ; un rezonage l'est).

### 2.3 Exemple travaillé - U-521 → H-521 (dossier 2, règl. 150-51)

État de départ (rôle 2026, avant adoption) : Zone `id=Z-521`, version V1 :
`codeAffiche="U-521"`, `kind="U"`, usages utilité publique, `geomSource="hypothese-street-name"`.

Règlement 150-51, 2e projet adopté **2026-04-14**, art.14 « U-521 remplacée par H-521,
mêmes limites », art.7 « grille U-521 remplacée par grille H-521 (multifamilial 8 log.,
3 étages, 12 m) ». Période référendaire ~22-30 avr. 2026.

**Événements émis** (tous `bylaw="150-51"`, `targetId=Z-521`) :

```jsonc
// E1 - renommage (identité)
{
  "id": "evt-150-51-rename",
  "targetKind": "zone", "targetId": "Z-521",
  "type": "zone-rename",
  "bylaw": "150-51", "bylawStage": "2e-projet",
  "validFrom": "2026-04-14", "effectKind": "adoption",
  "payload": { "codeAvant": "U-521", "codeApres": "H-521", "limites": "inchangees (art.14)" },
  "rawRef": "raw/reglement/salaberry/2026/.../Reglement-150-51-zonage.pdf.sha",
  "verification": "fait", "knownFrom": "2026-05-25T00:00:00Z"
}
// E2 - rezonage (usage/densité) => c'est le SIGNAL
{
  "id": "evt-150-51-rezoning",
  "targetKind": "zone", "targetId": "Z-521",
  "type": "zone-rezoning",
  "bylaw": "150-51", "bylawStage": "2e-projet",
  "validFrom": "2026-04-14", "effectKind": "adoption",
  "supersedesEventId": "evt-150-51-rename",
  "payload": {
    "usageAvant": "utilite-publique", "usageApres": "residentiel-multifamilial",
    "densiteApres": "8 log. / structure isolee-jumelee", "etagesMax": 3, "hauteurMaxM": 12,
    "grilleComplete": "non-disponible (PDF adopte non publie au 2026-05-25)"
  },
  "rawRef": "raw/avis/salaberry/2026/.../Avis-Approbation-referendaire-150-51.pdf.sha",
  "verification": "fait", "knownFrom": "2026-05-25T00:00:00Z"
}
```

**Projections résultantes** : `ZoneVersion` V1 (U-521) reçoit `validTo="2026-04-14"` ;
`ZoneVersion` V2 (`codeAffiche="H-521"`, `kind="H"`, usages multifamilial, etc.) reçoit
`validFrom="2026-04-14"`, `validTo=null`, `sourceEventId="evt-150-51-rezoning"`. Le
`Signal` de veille T1 reçoit `designationEventId="evt-150-51-rezoning"`,
`type="residential-rezoning"`.

> **Note maturité légale** : `bylawStage="2e-projet"` (et `effectKind="adoption"`)
> signale que l'entrée en vigueur n'est **pas** confirmée (référendaire ouvert). À
> l'« as of date » réel post-2026-04-30, on saura si un événement
> `bylawStage="en-vigueur"` existe ; sinon l'état reste « adopté, non en vigueur ».
> Cette nuance alimente l'axe **Timing** (PROCESS_E2E §4.3), pas Potentiel.

### 2.4 Exemple travaillé - H-143 → H-143-1 (dossier 3, règl. 150-49-1)

Zone `id=Z-143` (H-143). Règl. 150-49-1 (adopté 2026-04-14) crée H-143-1 **à même une
partie de H-143** (art.5), avec normes plus restrictives (2 log/ha à 55 % conservé ;
15 log/ha à 70 %), tandis que H-143 conserve 50 log/ha à ≥30 %.

Événements :
- `E3 = zone-split` sur `Z-143` : `payload.children=[Z-143-1]`, `affectedZoneIds=[Z-143, Z-143-1]`.
- `E4 = zone-creation` créant `Z-143-1` (nouvelle Zone, `createdByEventId=E4`,
  `parent` informatif = Z-143 dans payload), version avec densité conditionnelle 2/15.
- `E5 = zone-creation` créant `Z-118-1` (tampon CONS entre H-143-1 et A-118).

`ZoneVersion(Z-143)` reçoit une nouvelle version (emprise réduite) `validFrom=2026-04-14`.
La filiation est lisible : `Z-143-1.createdByEventId → E4 → supersedes E3 → cible Z-143`.

---

## 3. Résolution « as of date »

### 3.1 Règle (état réel, par temps de validité)

Pour reconstruire l'état d'une **zone** à une date T (temps de validité, courant tel
que radar le croit aujourd'hui - `known_to IS NULL`) :

```sql
-- ZoneVersion applicable à la date T (variante "réel")
SELECT zv.*
FROM zone_versions zv
WHERE zv.zone_id = :zoneId
  AND zv.valid_from <= :T
  AND (zv.valid_to IS NULL OR zv.valid_to > :T)
  AND zv.known_to IS NULL          -- on prend la connaissance la plus récente
ORDER BY zv.valid_from DESC
LIMIT 1;
```

Pour la **zone d'un lot** à la date T : composer la résolution Lot↔Zone puis la version
de zone :

```sql
-- Zone applicable au lot :lotId à la date T (réel)
SELECT z.id AS zone_id, zv.code_affiche, lzr.method, lzr.confirmed, lzr.coverage_pct
FROM lot_zone_resolutions lzr
JOIN zones z       ON z.id = lzr.zone_id
JOIN zone_versions zv ON zv.zone_id = z.id
WHERE lzr.lot_id = :lotId
  AND lzr.valid_from <= :T AND (lzr.valid_to IS NULL OR lzr.valid_to > :T)
  AND lzr.known_to IS NULL
  AND zv.valid_from <= :T AND (zv.valid_to IS NULL OR zv.valid_to > :T)
  AND zv.known_to IS NULL
ORDER BY lzr.valid_from DESC, zv.valid_from DESC
LIMIT 1;
```

**Invariant** : pour une entité versionnée donnée, au plus **une** version est
applicable à T parmi les versions `known_to IS NULL` (garanti par la contrainte
`EXCLUDE USING gist` de non-chevauchement, §1.1).

### 3.2 Règle (variante bitemporelle / audit - « as known at K »)

Pour reconstruire ce que radar **savait** à la date de connaissance K (audit,
reproductibilité d'un score passé) : ajouter le filtre knowledge time.

```sql
-- État de zone valide à T, tel que CONNU à la date K (audit bitemporel)
SELECT zv.*
FROM zone_versions zv
WHERE zv.zone_id = :zoneId
  AND zv.valid_from <= :T AND (zv.valid_to IS NULL OR zv.valid_to > :T)
  AND zv.known_from <= :K AND (zv.known_to IS NULL OR zv.known_to > :K)
ORDER BY zv.valid_from DESC, zv.known_from DESC
LIMIT 1;
```

`(T = K = now)` redonne l'état courant. `K` figé = reproduit exactement le contexte
d'un score calculé à K, même si une ré-extraction ultérieure a corrigé la donnée. Cela
réalise le **gel des scores sous leur version** demandé par PROCESS_E2E §4.5.

### 3.3 Reconstruction depuis les événements (source de vérité)

Les projections (`zone_versions`, `lot_zone_resolutions`) sont **dérivables** : un
job de projection rejoue les `designation_events` ordonnés par `(valid_from,
known_from)` et matérialise les versions. En cas de doute, **les événements priment** ;
les projections peuvent être détruites et reconstruites. C'est l'esprit
event-sourcing léger (option A2, §6).

### 3.4 Service applicatif (esquisse de signature, pas d'implémentation)

```ts
// packages/radar-domain  (ESQUISSE de contrat, non implémenté ici)
interface AsOfDate {
  resolveZone(zoneId: string, atValidity: Date, knownAt?: Date): ZoneVersionT | null;
  resolveLotZone(lotId: string, atValidity: Date, knownAt?: Date): {
    zoneId: string; codeAffiche: string; confirmed: boolean; method: string;
  } | null;
  resolveValuation(scope: { kind: "lot" | "zone"; id: string }, atValidity: Date): ValuationT | null;
}
```

---

## 4. Valuation et mapping vers le scoring

### 4.1 Ce que la valuation porte

- **Rôle d'évaluation** (`kind="role-evaluation"`) : `valeurTotale`, `valeurTerrain`,
  `valeurBatiment` par `rolYear`, `validFrom`/`validTo` = bornes du cycle. Source
  `role-evaluation-mamh`, `verification="fait"`. Universel (1 100+ municipalités QC).
- **Estimation marché** (`kind="market-estimate"`) : `pricePerM2` / comparables.
  Tier C (JLR/Centris) → `verification="non-disponible"` par défaut ; **jamais
  fabriquée** (PROCESS_E2E §4.4).

### 4.2 Mapping explicite valuation → axes de scoring

Le scoring (PROCESS, `scoring.ts`) a 5 axes pondérés
(potentiel 30 / risque 20 / timing 20 / faisabilité 15 / marché 15). La valuation
alimente **deux** axes :

| Axe | Pondération | Entrée valuation | Règle de dérivation |
|---|---|---|---|
| **marché** (15 %) | valeur de marché | `market-estimate.pricePerM2`, comparables | Si estimation marché `non-disponible` → axe `availability="non-disponible"`, renormaliser les poids (PROCESS_E2E §4.4) et **plafonner la reco à « surveillance »**. **Ne jamais** dériver le marché du rôle seul (le rôle ≠ prix de marché). |
| **potentiel** (30 %) | composante **upside** | `valeurTerrain` (rôle) + densité cible (`ZoneVersion.densiteLogHa` après rezonage) | `upside = potentiel_densification × valeur_actuelle` (SPEC_INTENT §5). La densité vient de l'événement de rezonage ; la valeur actuelle (terrain) du rôle. L'upside **module** le niveau de potentiel mais ne le **remplace** pas (le potentiel reste d'abord l'AMPLEUR réglementaire, PROCESS_E2E §4.3). |

Signal supplémentaire pour **faisabilité** (15 %) : le ratio
`valeurBatiment / valeurTerrain` du rôle est le **pré-filtre physique** de PROCESS_E2E
§3 (ratio < 80 % = terrain sous-densifié, candidat). Ce n'est pas un score d'axe mais
un **filtre d'éligibilité** des lots en amont de la création des dossiers T2. Donc :
valuation → faisabilité = **filtre**, pas pondération.

### 4.3 Pourquoi le rôle ne suffit pas pour l'axe marché (anti-invention)

Le rôle d'évaluation est une **valeur fiscale** (date de référence figée : 2024-07-01
pour le rôle 2026), pas un **prix de transaction**. Confondre les deux fabriquerait un
faux signal marché. Donc :

- rôle → **faisabilité** (filtre sous-densification) et **potentiel** (upside, en
  combinaison avec la densité) ;
- prix de marché réel (Tier C) → **marché**, ou `non-disponible` honnête.

C'est exactement l'état actuel des 3 dossiers (`marche.availability="non-disponible"`),
que ce modèle **rend explicite et reproductible** au lieu de l'enterrer dans une string.

### 4.4 Exemple - H-609-4 (dossier 1)

Lots du rôle 2026 (faits) : 4516943 (14 990 m², total 1 311 600 $), … Densité cible :
50 log/ha conditionnelle (≥30 % conservé), `verification="fait"` (règl. 150-49 art.12.7).

- **potentiel** = 4 : AMPLEUR réglementaire forte (création + densité conditionnelle),
  upside modulé par valeur terrain élevée mais tempéré (0 terrain libre).
- **faisabilité** = 2 : filtre ratio montre 0 TE (zone bâtie) → assemblage requis.
- **marché** = `non-disponible` : aucun `market-estimate` (Tier C absent) → poids
  renormalisés, reco plafonnée « surveillance ». Inchangé vs aujourd'hui, mais désormais
  **traçable** (la `Valuation` rôle existe et est datée ; l'absence d'estimation marché
  est une ligne explicite, pas un trou).

---

## 5. Stratégie de migration (depuis `valleyfield-dossiers.ts`)

### 5.1 Principe : extraction sans perte, dossier conservé

Le `OpportunityDossier` reste l'objet T2 (dossier de qualification). On **n'efface
rien** ; on **promeut** les données plates encastrées vers les nouvelles entités, en
gardant le dossier comme vue agrégée. Migration **idempotente, scriptable, réelle ↔
hypothèse préservée**.

### 5.2 Table de correspondance (champ plat → entité cible)

| Source (`valleyfield-dossiers.ts`) | Cible | Transformation |
|---|---|---|
| `dossier.zone` (string « H-609-4 ») | `Zone` + `ZoneVersion.codeAffiche` | parse code → kind (préfixe H/C/U/…) ; créer Zone+V1 |
| `dossier.bylaw` (« 150-49 ») | `DesignationEvent.bylaw` | dériver `type` du titre (creation/rename/split) |
| `dossier.title` (« U-521 → H-521 … ») | `DesignationEvent` (rename+rezoning) | parser la flèche → 2 événements (cf. §2.3) |
| `lots[].noLot` | `Lot.noLot` + `LotVersion` | clé `NO_LOT` |
| `lots[].superficie` (« 14 990 m² ») | `LotVersion.superficieM2` (numeric) | strip unités → number |
| `lots[].usage` (« RU - … ») | `LotVersion.usageCode` (enum) | parser le code avant le tiret |
| `lots[].valeur` (« 1 311 600 $ ») | `Valuation` (`role-evaluation`, rolYear=2026) | strip devise/espaces → number ; `validFrom` = cycle rôle |
| `lots[].confirmed`, `lots[].zonePolygonSource` | `lot_zone_resolution.confirmed/method` | mapping direct (déjà aligné) |
| `evidence[]` (phase `ancrage`/`contraintes`/…) | `EvidenceItem[]` réparti sur Zone/Lot/Valuation selon `phase` | rôle→Valuation+Lot ; règlement→Zone+Event ; contraintes→Zone |
| `evidence[]` (phase `scoring`) | reste sur `OpportunityDossier` | preuve de raisonnement, pas de fait |
| `scores`, `axes`, `scoreGlobal`, `recommendation` | inchangés sur `OpportunityDossier` | jointures FK remplacent les strings |

### 5.3 Étapes

1. **Backfill réel** : pour chaque dossier, créer `Zone(+V1)`, `Lot(+V1)`,
   `Valuation` (rôle 2026), `lot_zone_resolution` (method=`street-name-hypothesis`,
   confirmed=false - état honnête actuel), `DesignationEvent` (depuis bylaw+titre).
   `verification` reportée telle quelle (fait/hypothese) depuis l'evidence d'origine.
2. **Relier** : `OpportunityDossier.zoneId/lotIds` (FK) ; `Signal.designationEventId`.
3. **Vérifier** : un test de non-régression confirme que la **vue agrégée** du dossier
   (recomposée par jointures) est identique aux dossiers d'origine (mêmes valeurs,
   mêmes verifications). Anti-invention : aucune valeur nouvelle créée.
4. **Geler** l'ancien format derrière un adaptateur de lecture (compat UI) le temps de
   bascule.

### 5.4 Généralisation multi-villes (`CityProfile`)

- Aucune constante « Valleyfield » dans le modèle : tout passe par `citySlug`
  (FK `CityProfile`, créé au J2 du plan scraping).
- Les champs **universels** (Lot: noLot/superficie/usage ; Valuation rôle ; via code
  MAMH) sont peuplables pour toute municipalité QC sans travail spécifique.
- Les champs **municipaux** (Zone codes/grilles/géométrie) dépendent du connecteur de
  ville (un adaptateur par CMS). Le modèle ne change pas ; seules les sources varient.
- Ajouter une ville = ajouter une entrée `CityProfile` + (si CMS inédit) un adaptateur.
  Le schéma Zone/Lot/Event/Valuation est **identique** pour toutes les villes.

---

## 6. Choix de design (2-3 options par point dur) + RECOMMANDATIONS

### Choix A - Stockage de l'historique : event-sourcing vs snapshot vs hybride

- **A1 - Snapshots seuls** (versions datées, pas d'événements explicites). Simple à
  lire ; mais perd la **cause** (quel règlement, quelle filiation scission/fusion) et
  rend la reconstruction « pourquoi » impossible. Mauvais fit avec O1.
- **A2 - Hybride : événements source de vérité + snapshots matérialisés** (le présent
  design). Les `DesignationEvent` portent la cause + provenance ; `ZoneVersion` /
  `lot_zone_resolution` sont des projections rapides reconstructibles. Lecture rapide
  ET historique causal complet.
- **A3 - Event-sourcing pur** (pas de snapshot ; tout reconstruit à la volée). Audit
  parfait mais chaque requête « as of date » rejoue les événements → coût et complexité
  injustifiés pour le volume (quelques centaines d'événements/ville).

**RECOMMANDATION : A2 (hybride).** Coût modéré, couvre O1+O2, lecture performante,
projections jetables/reconstructibles. C'est le meilleur rapport rigueur/complexité.

### Choix B - Granularité de la géométrie de zone

- **B1 - Géométrie obligatoire** : bloque tout tant que les polygones de zone ne sont
  pas vectorisés. **Irréaliste** : Valleyfield n'a pas de vecteur open-data (gap
  structurant, SPEC_EVOL_DATA_MODEL §1.3) ; bloquerait le slice réel.
- **B2 - Géométrie nullable + `geomSource` + `lot_zone_resolution.method`** (présent
  design). On vit sans polygone (assignation par hypothèse nom de rue, `confirmed=false`)
  et on **monte en qualité** quand la vectorisation arrive (passage à
  `geometric-intersection`, `confirmed=true`) sans changer le schéma.
- **B3 - Géométrie séparée dans un service GIS externe** (PostGIS dédié hors modèle
  applicatif). Sur-ingénierie à ce stade (un seul Postgres+PostGIS suffit).

**RECOMMANDATION : B2.** C'est le seul choix compatible avec la réalité des données
(gap polygone) tout en gardant une trajectoire propre vers le géométrique confirmé.
La nullabilité + `geomSource` + `confirmed` rend le manque **honnête et visible**.

### Choix C - Profondeur de la bitemporalité

- **C1 - Validity time seul** (pas de knowledge time). Simple ; mais ne permet pas de
  **reproduire un score passé** après ré-extraction (échoue PROCESS_E2E §4.5 gel des
  scores).
- **C2 - Bitemporalité complète partout** (validity + knowledge sur toutes les tables,
  y compris les événements). Audit total ; mais lourd (doublement des lignes à chaque
  ré-extraction) et inutile sur les `DesignationEvent` (déjà append-only).
- **C3 - Bitemporalité ciblée** (présent design) : validity partout ; knowledge
  complète (`knownFrom`+`knownTo`) sur les **projections ré-extractibles**
  (`ZoneVersion`, `lot_zone_resolution`, `Valuation`) ; `knownFrom` seul (append-only)
  sur `DesignationEvent`.

**RECOMMANDATION : C3.** Couvre l'audit « que savait-on à K » et le gel des scores là
où c'est nécessaire (projections), sans payer le coût d'une bitemporalité totale sur
des tables déjà immuables.

### Choix D - Où vit la grille de normes (densité/usages/marges) par zone

- **D1 - Colonnes typées** par norme. Rigide ; les grilles varient par règlement et ne
  sont souvent **pas publiées** (post-150-49/51) → beaucoup de colonnes vides.
- **D2 - `jsonb` validé par Zod versionné** (présent design : `usages`, `normes`,
  `densiteCondition`). Souple, accepte le `non-disponible`, validé à l'écriture, promu
  en colonnes typées quand ≥10 villes stabilisent un motif (SPEC_EVOL_DATA_MODEL §3).

**RECOMMANDATION : D2.** Conforme à la politique « stable typé / instable jsonb » du
socle ; les seuls champs de densité **universellement** comparables (`densiteLogHa`,
`etagesMax`, `hauteurMaxM`) sont sortis en colonnes typées, le reste en jsonb.

---

## 7. Questions ouvertes (à trancher pour le sign-off)

1. **SRID canonique** : stocker en 4326 (lat/lon, lisible, standard) et reprojeter à
   l'ingestion depuis 3857 (cadastre allégé) ? Ou stocker en 3857 (évite la reprojection
   au fetch) ? *(Préco : 4326 canonique, index GiST ; reprojection une fois à
   l'ingestion.)*
2. **`validFrom` = adoption ou entrée en vigueur ?** Un règlement adopté mais en
   période référendaire n'est pas encore en vigueur. Préco : émettre l'événement à
   l'**adoption** avec `effectKind="adoption"`+`bylawStage`, puis un second événement
   `en-vigueur` quand confirmé. L'« as of date réel » prend l'adoption ; le statut légal
   alimente l'axe Timing. **À valider** : veut-on que l'état « zone H-521 » soit
   considéré effectif dès l'adoption, ou seulement à l'entrée en vigueur ?
3. **`DesignationEvent` strictement append-only applicatif** (révoquer = événement
   compensatoire, jamais UPDATE/DELETE) - confirmé cohérent avec le journal V1
   (PROCESS_E2E §6) ? *(Préco : oui, append-only ; aligne sur la mémoire multi-séances.)*
4. **Granularité d'un rezonage multi-zones** : un règlement touchant N zones émet N
   événements (1/zone) reliés par `bylaw`, ou 1 événement avec `affectedZoneIds[]` ?
   *(Préco : N événements ciblés + `bylaw` comme regroupeur ; `affectedZoneIds[]`
   réservé aux scissions/fusions où la cible est intrinsèquement multiple.)*
5. **Estimation marché** : se contente-t-on de `non-disponible` en V1 (honnête, Tier C),
   ou veut-on une heuristique `market-estimate` explicitement étiquetée `hypothese`
   (ex. rôle ± facteur secteur) ? *(Préco : V1 = `non-disponible` ; une heuristique
   `hypothese` étiquetée peut venir plus tard, jamais comptée comme `fait`.)*
6. **Fusion avec le plan scraping (J4)** : ce design est-il la spec d'implémentation de
   l'étage EXPLOITATION du plan, ou un document parallèle à réconcilier ? *(Préco : il
   **est** la spec EXPLOITATION ; les noms d'entités sont déjà alignés mot pour mot.)*
7. **PII / registre foncier** : confirme-t-on qu'aucun champ propriétaire n'entre dans
   ce modèle (LFM 72 + Loi 25), un éventuel ajout futur étant une table séparée à accès
   journalisé hors de ce design ? *(Préco : oui, hors périmètre.)*
8. **Versioning des grilles de score vs versions de données** : le gel des scores
   (PROCESS_E2E §4.5) combine `gridVersion` (déjà dans `AxisScore`) ET la knowledge time
   du modèle. Confirme-t-on que reproduire un score = (gridVersion figé) + (`knownAt`
   figé) ? *(Préco : oui, les deux ensemble.)*

---

## 8. Récapitulatif du périmètre de ce document

- **Écrit ici** : ce seul fichier (`docs/spec/SPEC_DESIGN_DATA_MODEL.md`).
- **Non écrit** : aucun schéma Zod réel, aucune migration Drizzle, aucun code
  applicatif. Les blocs `ts`/`sql` sont des **esquisses** de design pour le sign-off.
- **Prochain pas (après validation)** : jalon J4 du plan scraping - implémenter
  `temporal.ts`, `zone.ts`, `lot.ts`, `designation-event.ts`, `valuation.ts` dans
  `@radar/domain`, les tables Drizzle correspondantes, le service `AsOfDate`, et le
  script de backfill `valleyfield-dossiers.ts` → entités (§5).
