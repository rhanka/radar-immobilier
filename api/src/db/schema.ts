import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { pwWriteSchema } from "./schema-pw-write.js";
export { pwWriteIntents, pwWriteKeyReservations, pwWriteReceiptLinks,
  pwWriteIntentTombstones, pwWriteAuthorityFences, pwWriteQuotaLedger,
  pwWriteAudit, pwWriteOutbox, pwWriteRejections, pwWriteStatusBudgets } from "./schema-pw-write.js";

/**
 * PostGIS geometry column (SRID 4326). Represented in TS as WKT/EWKT text; the
 * physical column is `geometry(Geometry,4326)` (see migration 0001). Always
 * nullable in WP5-V1: anti-invention forbids fabricating a polygon we did not
 * obtain (SPEC_ONTOLOGY §0.2, §4).
 */
const geometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(Geometry,4326)";
  },
});

/**
 * Minimal initial schema (SPEC_EVOL_SCAFFOLDING §7.3). Raw documents live
 * in object storage (S3/MinIO); Postgres holds metadata and scored
 * entities. Unstable fields stay in `jsonb`, validated by versioned Zod
 * schemas in @radar/domain, until BR-06 promotes stable patterns.
 */

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  city: text("city"),
  url: text("url").notNull(),
  config: jsonb("config").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ingestions = pgTable("ingestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  stats: jsonb("stats").notNull().default({}),
  error: jsonb("error"),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  ingestionId: uuid("ingestion_id")
    .notNull()
    .references(() => ingestions.id, { onDelete: "cascade" }),
  s3Key: text("s3_key").notNull(),
  contentType: text("content_type"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  sha256: text("sha256").notNull(),
  sourceUrl: text("source_url"),
  extracted: jsonb("extracted"),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
});

export const signals = pgTable("signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  summary: text("summary").notNull(),
  payload: jsonb("payload").notNull().default({}),
  confidence: numeric("confidence"),
});

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  signalId: uuid("signal_id")
    .notNull()
    .references(() => signals.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("watch"),
  fiche: jsonb("fiche").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scores = pgTable("scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  criterion: text("criterion").notNull(),
  weight: numeric("weight").notNull(),
  value: numeric("value").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const links = pgTable("links", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromKind: text("from_kind").notNull(),
  fromId: uuid("from_id").notNull(),
  toKind: text("to_kind").notNull(),
  toId: uuid("to_id").notNull(),
  rel: text("rel").notNull(),
  payload: jsonb("payload").notNull().default({}),
});

// ═══════════════════════════════════════════════════════════════════════════
// WP5-V1 — bitemporal ontology projections (SPEC_ONTOLOGY_DATA_MODEL.md v2).
//
// The relational store materialises the *validated* graphify canonicals. Each
// reconciled-entity row carries the canonical bridge (canonical_id + patch +
// knowledge-time, §4.1), nullable PostGIS geom + geom_source (§4), and — on the
// versioned tables — a bitemporal span. The non-overlap exclusion constraint
// (btree_gist EXCLUDE over (entity_id, validity range)) lives in migration 0001;
// drizzle-kit cannot express EXCLUDE, so the versioned tables are introspectable
// here and the constraint is hand-authored DDL.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Zone versions — bitemporal projection of a reconciled Zone (§4, §8.1). One row
 * per (zone canonical, validity span). `valid_from`/`valid_to` = regulatory
 * validity-time; `known_from`/`known_to` = knowledge-time (D5).
 */
export const zoneVersions = pgTable(
  "zone_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalId: text("canonical_id").notNull(), // bridge to the graphify canonical (§4.1)
    citySlug: text("city_slug").notNull(),
    codeAffiche: text("code_affiche").notNull(), // dated alias, not the identity (§2.4)
    kind: text("kind").notNull(),
    reconStatus: text("recon_status").notNull().default("validated"),
    reconPatchId: text("recon_patch_id"), // audit (§4.1)
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"), // null = current
    knownFrom: timestamp("known_from", { withTimezone: true }).notNull(),
    knownTo: timestamp("known_to", { withTimezone: true }), // null = still believed
    geom: geometry("geom"), // nullable PostGIS geometry (§4)
    geomSource: text("geom_source").notNull().default("none"),
    geomFetchedAt: timestamp("geom_fetched_at", { withTimezone: true }),
    codeNorm: text("code_norm"), // code normalisé pour le mapper G1 (migration 0006)
    rawRef: text("raw_ref").notNull(),
    evidence: jsonb("evidence").notNull().default([]),
  },
  (t) => ({
    byCanonical: index("zone_versions_canonical_idx").on(t.canonicalId),
    byCity: index("zone_versions_city_idx").on(t.citySlug),
    byCodeNormCity: index("zone_versions_code_norm_city_idx").on(t.codeNorm, t.citySlug),
  }),
);

/**
 * Lot versions — bitemporal projection of a reconciled Lot (cadastre registry,
 * §4). `no_lot` is the authoritative province-wide key.
 */
export const lotVersions = pgTable(
  "lot_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalId: text("canonical_id").notNull(),
    noLot: text("no_lot").notNull(), // cadastre du Québec (authoritative)
    citySlug: text("city_slug").notNull(),
    reconStatus: text("recon_status").notNull().default("validated"),
    reconPatchId: text("recon_patch_id"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    knownFrom: timestamp("known_from", { withTimezone: true }).notNull(),
    knownTo: timestamp("known_to", { withTimezone: true }),
    geom: geometry("geom"),
    geomSource: text("geom_source").notNull().default("none"),
    geomFetchedAt: timestamp("geom_fetched_at", { withTimezone: true }),
    noLotNorm: text("no_lot_norm"), // numéro de lot normalisé pour le mapper G1 (migration 0006)
    rawRef: text("raw_ref").notNull(),
    evidence: jsonb("evidence").notNull().default([]),
  },
  (t) => ({
    byCanonical: index("lot_versions_canonical_idx").on(t.canonicalId),
    byNoLot: index("lot_versions_no_lot_idx").on(t.noLot),
    byNoLotNorm: index("lot_versions_no_lot_norm_idx").on(t.noLotNorm),
  }),
);

/**
 * Regulatory stages — relational projection of a Bylaw legal lifecycle (§4.2).
 * HAS_STAGE is a relational FK in V1 (not a graphify relation).
 */
export const regulatoryStages = pgTable(
  "regulatory_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bylawCanonicalId: text("bylaw_canonical_id").notNull(),
    kind: text("kind").notNull(),
    occurredOn: date("occurred_on").notNull(),
    outcome: text("outcome").notNull().default("non-disponible"),
    rawRef: text("raw_ref").notNull(),
    evidence: jsonb("evidence").notNull().default([]),
  },
  (t) => ({
    byBylaw: index("regulatory_stages_bylaw_idx").on(t.bylawCanonicalId),
  }),
);

/**
 * Constraint hits — projection of a CONSTRAINS relation onto a lot/zone, read by
 * the auditable risk axis (§4.3, §7.3). Always carries source/date/confidence +
 * ≥1 evidence ref (enforced by the @radar/domain ConstraintHit schema).
 */
export const constraintHits = pgTable(
  "constraint_hits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constraintCanonicalId: text("constraint_canonical_id").notNull(),
    targetKind: text("target_kind").notNull(), // 'lot' | 'zone'
    targetCanonicalId: text("target_canonical_id").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    observedOn: date("observed_on"),
    confidence: text("confidence").notNull(),
    evidenceRefs: jsonb("evidence_refs").notNull().default([]),
  },
  (t) => ({
    byTarget: index("constraint_hits_target_idx").on(t.targetCanonicalId),
  }),
);

/**
 * Opportunity dossiers — relational only (§4, §8.1): assembled by scoring, never
 * a graphify node. Holds the scored axes + the knowledge-time freeze (§7.5).
 */
export const opportunityDossiers = pgTable(
  "opportunity_dossiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    citySlug: text("city_slug").notNull(),
    zoneCanonicalId: text("zone_canonical_id"),
    lotCanonicalId: text("lot_canonical_id"),
    status: text("status").notNull().default("surveillance"),
    axes: jsonb("axes").notNull().default({}),
    gridVersion: text("grid_version"),
    knownAt: timestamp("known_at", { withTimezone: true }), // score freeze (§7.5)
    reconPatchId: text("recon_patch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCity: index("opportunity_dossiers_city_idx").on(t.citySlug),
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// WP A.3.1 — Graph store (nodes + edges from graphify graph.json output).
//
// Lightweight Postgres-native graph persistence. No dedicated graph DB — the
// adjacency is a pair of plain tables with FK-like text ids (no hard FK to
// keep ingestion idempotent). Indexes cover the read patterns: by type, by
// citySlug, by kind, and neighbour lookups via srcId/dstId. A full graph-DB
// migration can be driven later by exporting these tables.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Graph nodes — one row per graphify node (entity or document concept).
 * `id` is the graphify node id (string slug, not a UUID). Ids are unique INSIDE
 * one city only (`bylaw-242` exists in several cities), exactly like S3
 * `graph/<city>/latest.json`: the primary key is `(city_slug, id)` (GH #812,
 * migration 0013_graph_city_key) and every upsert / read by id binds the city.
 *
 * Index additionnels (migration 0003_graph_indexes) :
 *   - composite (city_slug, type) → queryNeighbors / subgraphForCity filtres croisés
 *   - GIN JSONB sur props → requêtes @> sur les métadonnées
 *   - colonne générée label_tsv (tsvector french) + GIN → full-text FR
 *   - GIN trigram sur label (pg_trgm) → ILIKE / recherche approximative
 * Note : label_tsv est une colonne GENERATED ALWAYS AS STORED — non
 * représentable en Drizzle ORM ; elle est gérée uniquement dans la migration SQL.
 */
export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: text("id").notNull(),
    type: text("type").notNull().default("concept"), // graphify file_type
    label: text("label").notNull(),
    citySlug: text("city_slug").notNull(), // the city whose latest.json holds the node
    props: jsonb("props").notNull().default({}), // community, source_file, …
    sourceRef: text("source_ref"), // S3 key / raw ref
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: "graph_nodes_pkey", columns: [t.citySlug, t.id] }),
    byType: index("graph_nodes_type_idx").on(t.type),
    // Composite : filtre ville + type en une passe (migration 0003)
    byCityType: index("graph_nodes_city_type_idx").on(t.citySlug, t.type),
    // GIN JSONB sur props (migration 0003)
    propsGin: index("graph_nodes_props_gin_idx").using("gin", t.props),
  }),
);

/**
 * Graph edges — one row per graphify link of ONE city graph.
 * Composite natural key (citySlug, srcId, dstId, kind) drives idempotent upserts:
 * conflicting rows update props only (no duplicate edges). Both endpoints are
 * nodes of the same city (GH #812, migration 0013_graph_city_key).
 *
 * Index additionnel (migration 0003_graph_indexes) :
 *   - GIN JSONB sur props → requêtes @> sur les métadonnées d'arête
 */
export const graphEdges = pgTable(
  "graph_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    citySlug: text("city_slug").notNull(), // → graph_nodes.city_slug (soft ref)
    srcId: text("src_id").notNull(), // → graph_nodes (city_slug, id) (soft ref)
    dstId: text("dst_id").notNull(), // → graph_nodes (city_slug, id) (soft ref)
    kind: text("kind").notNull(), // graphify relation
    props: jsonb("props").notNull().default({}), // confidence, source_file, …
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byKind: index("graph_edges_kind_idx").on(t.kind),
    naturalKey: uniqueIndex("graph_edges_city_natural_key_idx").on(t.citySlug, t.srcId, t.dstId, t.kind),
    bySrc: index("graph_edges_city_src_idx").on(t.citySlug, t.srcId),
    byDst: index("graph_edges_city_dst_idx").on(t.citySlug, t.dstId),
    // GIN JSONB sur props (migration 0003)
    propsGin: index("graph_edges_props_gin_idx").using("gin", t.props),
  }),
);

export const accountUsers = pgTable("account_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  sub: text("sub").notNull().unique(),
  email: text("email"),
  name: text("name"),
  status: text("status").notNull().default("pending"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
}, (t) => ({
  bySub: index("account_users_sub_idx").on(t.sub),
  byStatus: index("account_users_status_idx").on(t.status),
}));

export const accountUserStatusEvents = pgTable(
  "account_user_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userSub: text("user_sub")
      .notNull()
      .references(() => accountUsers.sub, { onDelete: "restrict" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorSub: text("actor_sub").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("account_user_status_events_user_idx").on(t.userSub),
    byActor: index("account_user_status_events_actor_idx").on(t.actorSub),
    byCreatedAt: index("account_user_status_events_created_at_idx").on(t.createdAt),
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// Inc 1 — Marquage d'équipe Steve (SPEC_EVOL_INTEGRATION_CARTE_STEVE §4.1)
//
// Quatre tables :
//   prospect_marks              — marquages append-only par lot + dimension
//   prospect_notes              — notes libres append-only multi-auteurs
//   prospect_contacts           — couche CRM/PII séparée (Loi 25)
//   prospect_contact_access_log — journal d'accès PII (Loi 25)
//
// Les enums DB sont définis dans la migration 0005 ; les pgEnum Drizzle ici
// permettent le typage TS sans régénération de snapshot (hand-authored DDL,
// cohérent avec les patterns migrations 0001–0003).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deux dimensions orthogonales : pipeline (funnel commercial) ⊥ marche (état de vente).
 * Un lot peut avoir un marquage actif dans chacune des deux dimensions simultanément.
 */
export const prospectDimensionEnum = pgEnum("prospect_dimension", [
  "pipeline",
  "marche",
]);

/**
 * Statut unifié couvrant les deux dimensions.
 * pipeline : favori | ecarte | sollicite | lettre_envoyee
 * marche   : en_vente
 * La cohérence dimension↔statut est garantie par une CHECK constraint SQL.
 */
export const prospectStatutEnum = pgEnum("prospect_statut", [
  "favori",
  "ecarte",
  "sollicite",
  "lettre_envoyee",
  "en_vente",
]);

/**
 * Mode d'origine du marquage.
 * real       = saisie manuelle par l'équipe
 * simulation = import Steve (Inc 4, substrat Netlify)
 */
export const prospectModeEnum = pgEnum("prospect_mode", ["real", "simulation"]);

/**
 * Ancre d'une annotation (§2, contrat i-arch#1) : `lot` (dénormalisé
 * no_lot+city_slug) ou `signal` (signal_id, ON DELETE SET NULL). `zone` différé.
 */
export const prospectNoteTargetEnum = pgEnum("prospect_note_target", ["lot", "signal"]);

/**
 * Marquages append-only par lot et par dimension.
 *
 * Un marquage n'écrase jamais l'existant : on insère une nouvelle ligne.
 * Le serveur stampe superseded_by sur l'ancien en transaction (Inc 2).
 * Contrainte d'unicité de chaîne active :
 *   UNIQUE(lot_version_id, dimension) WHERE superseded_by IS NULL
 * (index partiel — non exprimable en Drizzle, géré dans la migration SQL).
 */
export const prospectMarks = pgTable(
  "prospect_marks",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Ancrage bitemporel principal
    lotVersionId: uuid("lot_version_id")
      .notNull()
      .references(() => lotVersions.id, { onDelete: "restrict" }),
    // Dénormalisés pour requêtes sans jointure bitemporale
    noLot: text("no_lot").notNull(),
    citySlug: text("city_slug").notNull(),

    // Dimension orthogonale
    dimension: prospectDimensionEnum("dimension").notNull(),

    // Statut unifié (cohérence garantie par CHECK SQL dans migration 0005)
    statut: prospectStatutEnum("statut").notNull(),

    // Mode d'origine
    mode: prospectModeEnum("mode").notNull().default("real"),

    // Auteur
    authorId: uuid("author_id")
      .notNull()
      .references(() => accountUsers.id, { onDelete: "restrict" }),

    // Chaîne append-only
    supersedes: uuid("supersedes").references(
      (): AnyPgColumn => prospectMarks.id,
      { onDelete: "restrict" },
    ),
    supersededBy: uuid("superseded_by").references(
      (): AnyPgColumn => prospectMarks.id,
      { onDelete: "restrict" },
    ),

    // Données métier dimension marche (null pour dimension pipeline)
    prixDemande: numeric("prix_demande", { precision: 14, scale: 2 }),
    lienAnnonce: text("lien_annonce"),

    // Immuable
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byLot: index("prospect_marks_lot_idx").on(t.lotVersionId),
    byNoLot: index("prospect_marks_nolot_idx").on(t.noLot),
    byAuthor: index("prospect_marks_author_idx").on(t.authorId),
    byMode: index("prospect_marks_mode_idx").on(t.mode),
    byStatut: index("prospect_marks_statut_idx").on(t.statut),
    // L'index partiel d'unicité de chaîne active vit dans la migration SQL :
    // UNIQUE(lot_version_id, dimension) WHERE superseded_by IS NULL
  }),
);

/**
 * Annotations libres multi-auteurs (§2, contrat i-arch#1 amendé — Option A
 * team-shared mono-client). Cutover 0011 ADDITIF de la table 0005 :
 *   - Ancre `target_type` ∈ {lot (no_lot+city_slug), signal (signal_id SET NULL)}.
 *   - Édition IN-PLACE (`updated_at` NULL = jamais éditée) + soft-delete
 *     (`deleted_at` NULL = active) — plus de chaîne append-only (cf. contrat §4).
 *   - `tenant_id` scoping forward-looking INERTE (mono-client, DEFAULT 'default').
 *   - Attribution `author_id` toujours peuplée + visible en lecture.
 * Authz (route) : lecture = tous approuvés ; mutation = author-only.
 * Le CHECK d'ancre + l'index partiel actif vivent dans la migration 0011 SQL.
 */
export const prospectNotes = pgTable(
  "prospect_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Ancre — target_type discrimine ; no_lot/city_slug conditionnels (CHECK 0011).
    targetType: prospectNoteTargetEnum("target_type").notNull().default("lot"),
    noLot: text("no_lot"),
    citySlug: text("city_slug"),
    // Ancre signal : UUID volatile → ON DELETE SET NULL (la note survit, §3.1).
    signalId: uuid("signal_id").references(() => signals.id, { onDelete: "set null" }),

    authorId: uuid("author_id")
      .notNull()
      .references(() => accountUsers.id, { onDelete: "restrict" }),

    body: text("body").notNull(),

    mode: prospectModeEnum("mode").notNull().default("real"),

    // Scoping forward-looking INERTE (mono-client, cf. contrat §3.3).
    tenantId: text("tenant_id").notNull().default("default"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Édition in-place : NULL = jamais éditée, IS NOT NULL = éditée (0-backfill).
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    // Soft-delete : NULL = active. Jamais de DELETE physique ; lecture filtre NULL.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    byLot: index("prospect_notes_lot_idx").on(t.noLot, t.citySlug),
    byAuthor: index("prospect_notes_author_idx").on(t.authorId),
    bySignal: index("prospect_notes_signal_idx").on(t.signalId),
    byTenant: index("prospect_notes_tenant_idx").on(t.tenantId),
    // L'index partiel des notes actives vit dans la migration 0011 SQL :
    // (tenant_id, deleted_at) WHERE deleted_at IS NULL
  }),
);

/**
 * Couche CRM/PII séparée — données personnelles propriétaire (Loi 25).
 *
 * FINALITÉ DOCUMENTÉE : prospection immobilière pour rachat de terrains.
 * Accès journalisé dans prospect_contact_access_log.
 *
 * INVARIANT ONTOLOGIQUE : le nom du propriétaire NE DOIT PAS apparaître dans
 * graph_nodes / graph_edges ni dans prospect_marks. Couche isolée uniquement.
 *
 * Append-only : supersedes / superseded_by tracent la chaîne de versions.
 * Contrainte d'unicité de chaîne active (index partiel dans migration SQL) :
 *   UNIQUE(no_lot, city_slug) WHERE superseded_by IS NULL
 */
export const prospectContacts = pgTable(
  "prospect_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    noLot: text("no_lot").notNull(),
    citySlug: text("city_slug").notNull(),

    // PII Loi 25 — collecte minimale, tous champs nullable
    proprietaireNom: text("proprietaire_nom"),
    proprietaireTel: text("proprietaire_tel"),
    proprietaireCourriel: text("proprietaire_courriel"),
    proprietaireAdresse: text("proprietaire_adresse"),

    sourceInfo: text("source_info"),

    authorId: uuid("author_id")
      .notNull()
      .references(() => accountUsers.id, { onDelete: "restrict" }),

    supersedes: uuid("supersedes").references(
      (): AnyPgColumn => prospectContacts.id,
      { onDelete: "restrict" },
    ),
    supersededBy: uuid("superseded_by").references(
      (): AnyPgColumn => prospectContacts.id,
      { onDelete: "restrict" },
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byLot: index("prospect_contacts_lot_idx").on(t.noLot, t.citySlug),
    byAuthor: index("prospect_contacts_author_idx").on(t.authorId),
    // Index partiel d'unicité de chaîne active dans migration SQL :
    // UNIQUE(no_lot, city_slug) WHERE superseded_by IS NULL
  }),
);

/**
 * Journal d'accès à la couche PII (Loi 25 — traçabilité).
 * Chaque consultation de prospect_contacts est enregistrée ici.
 * Le middleware applicatif (Inc 2) alimentera cette table.
 */
export const prospectContactAccessLog = pgTable(
  "prospect_contact_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    contactId: uuid("contact_id")
      .notNull()
      .references(() => prospectContacts.id, { onDelete: "restrict" }),

    accessorId: uuid("accessor_id")
      .notNull()
      .references(() => accountUsers.id, { onDelete: "restrict" }),

    // 'view' | 'export' | 'api' | …
    action: text("action").notNull().default("view"),

    accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),

    // IP, user-agent, session, endpoint…
    context: jsonb("context").notNull().default({}),
  },
  (t) => ({
    byContact: index("prospect_contact_access_log_contact_idx").on(t.contactId),
    byAccessor: index("prospect_contact_access_log_accessor_idx").on(t.accessorId),
    byAt: index("prospect_contact_access_log_at_idx").on(t.accessedAt),
  }),
);


// ═══════════════════════════════════════════════════════════════════════════
// G1 — Géo-mapper : résolution Signal/DesignationEvent → Zone/Lot (migration 0006).
//
// geo_resolutions : arêtes résolues (score >= seuil).
// geo_unresolved  : audit des non-résolus (mesure du taux).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Arêtes de résolution géo — Signal/DesignationEvent → Zone ou Lot.
 * Clé naturelle : (city_slug, node_id, relation_type, target_id) — idempotent.
 * Le nœud source est (city_slug, node_id) : un id de nœud n'est unique que dans
 * une ville (GH #812, migration 0013_graph_city_key).
 */
export const geoResolutions = pgTable(
  "geo_resolutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),           // 'Signal' | 'DesignationEvent'
    citySlug: text("city_slug").notNull(),
    relationType: text("relation_type").notNull(),   // 'concerns_zone' | 'concerns_lot'
    targetId: text("target_id").notNull(),           // canonical_id Zone ou Lot
    targetType: text("target_type").notNull(),        // 'Zone' | 'Lot'
    extraitBrut: text("extrait_brut"),
    scoreConfiance: numeric("score_confiance").notNull(),
    provenance: text("provenance").notNull(),         // 'zone_explicit' | 'zone_standard' | ...
    asOfDate: date("as_of_date"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    naturalKey: uniqueIndex("geo_resolutions_city_natural_key_idx").on(t.citySlug, t.nodeId, t.relationType, t.targetId),
    byNode: index("geo_resolutions_node_idx").on(t.nodeId),
    byCity: index("geo_resolutions_city_idx").on(t.citySlug),
  }),
);

/**
 * Nœuds non-résolus — audit + amélioration continue.
 * Enregistre les raisons d'échec de résolution.
 */
export const geoUnresolved = pgTable(
  "geo_unresolved",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    citySlug: text("city_slug").notNull(),
    extraitBrut: text("extrait_brut"),
    patternType: text("pattern_type").notNull(),      // 'zone_code' | 'no_lot'
    scoreConfiance: numeric("score_confiance"),
    raison: text("raison").notNull(),                 // 'no_polygon' | 'score_too_low' | 'ambiguous' | 'no_extract'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byNode: index("geo_unresolved_node_idx").on(t.nodeId),
    byCity: index("geo_unresolved_city_idx").on(t.citySlug),
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// WP3 LOT1 — Cohérence E2E : snapshot batch PG par ville (E0 PV↔signal,
// E1 signal↔zone). Un run du job réécrit la ligne de chaque ville ciblée
// (upsert sur city_slug) ; `payload` porte le contrat `CityConsistency`
// complet (edges/état/bloqueurs — cf. services/consistency/consistency-calc.ts),
// `state`/`generated_at` sont dupliqués en colonnes pour un tri/filtre SQL bon
// marché sans parser le JSON. Mode batch PG uniquement (JAMAIS 1104 requêtes
// live) — cf. docs/spec/reports/DESIGN_E2E_CONSISTENCY_SOURCES.md.
// ═══════════════════════════════════════════════════════════════════════════

export const consistencySnapshots = pgTable(
  "consistency_snapshots",
  {
    citySlug: text("city_slug").primaryKey(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    state: text("state").notNull(), // 'coherent' | 'partial' | 'unmeasured'
    payload: jsonb("payload").notNull(), // CityConsistency (edges, blockers, mode)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byState: index("consistency_snapshots_state_idx").on(t.state),
  }),
);

/**
 * Invitations envoyées par l'admin — associe un email à un token opaque.
 * Quand le user invité se logue via OIDC avec l'email correspondant, son
 * compte est auto-approuvé (matching par email dans le callback auth).
 */
export const accountInvitations = pgTable(
  "account_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    token: text("token").notNull().unique(),
    status: text("status").notNull().default("pending"),
    invitedBy: text("invited_by").notNull(),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => ({
    byEmail: index("account_invitations_email_idx").on(t.email),
    byToken: index("account_invitations_token_idx").on(t.token),
    byStatus: index("account_invitations_status_idx").on(t.status),
    byInvitedBy: index("account_invitations_invited_by_idx").on(t.invitedBy),
  }),
);

export const refreshOutcomeStatus = pgEnum("refresh_outcome_status", ["submitted", "accepted", "refused"]);
export const refreshOutcomeReason = pgEnum("refresh_outcome_reason",
  ["quota", "timeout", "empty-output", "transport", "quality", "forced", "circuit-open"]);
export const refreshOutcomeTransition = pgEnum("refresh_outcome_transition",
  ["primary", "same-model-retry", "fallback", "verification"]);

/** One immutable result per actual document submission; no document text or upstream errors. */
export const refreshDocumentOutcomes = pgTable("refresh_document_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  cycleId: uuid("cycle_id").notNull(),
  documentSha: text("document_sha").notNull(),
  citySlug: text("city_slug").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  pageCount: integer("page_count").notNull(),
  provider: text("provider"),
  model: text("model"),
  effort: text("effort"),
  transition: refreshOutcomeTransition("transition"),
  status: refreshOutcomeStatus("status").notNull(),
  failureReason: refreshOutcomeReason("failure_reason"),
  fallbackReason: refreshOutcomeReason("fallback_reason"),
  attempts: integer("attempts").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  unknownIds: integer("unknown_ids").notNull().default(0),
  keptNoValidDecision: integer("kept_no_valid_decision").notNull().default(0),
  supportedUngrounded: integer("supported_ungrounded").notNull().default(0),
  actsJudged: integer("acts_judged").notNull().default(0),
  actsRemoved: integer("acts_removed").notNull().default(0),
  skippedFallback: integer("skipped_fallback").notNull().default(0),
}, (t) => ({
  byCreatedAt: index("refresh_document_outcomes_created_at_idx").on(t.createdAt),
  byStatus: index("refresh_document_outcomes_status_idx").on(t.status),
}));

// Hand-authored CHECK constraints and composite reason FK: migration 0014.
export const facetReasonCodes = pgTable("facet_reason_codes", {
  profileId: text("profile_id").notNull(),
  code: text("code").notNull(),
  verdict: text("verdict").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.profileId, t.code] }),
  classifiedCode: unique("facet_reason_codes_classified_key")
    .on(t.profileId, t.code, t.verdict),
}));

// Partial indexes and immutability triggers are hand-authored in migration 0014.
// 6I workspace archives carry a null business owner attributed to the
// acting moderator (migration 0019); personal events keep owner = actor.
// 6J lot events carry an explicit mode, the observed lot version, market
// and pipeline values, and import-only provenance (migration 0021);
// signal rows keep every lot column null.
export const facetEvents = pgTable("facet_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull().default("personal"),
  ownerId: uuid("owner_id").references(() => accountUsers.id),
  actorId: uuid("actor_id").notNull().references(() => accountUsers.id),
  targetType: text("target_type").notNull().default("signal"),
  citySlug: text("city_slug").notNull(),
  nodeType: text("node_type").notNull(),
  nodeId: text("node_id").notNull(),
  facet: text("facet").notNull(),
  basket: text("basket"),
  state: text("state").notNull(),
  profileId: text("profile_id"),
  reasonCode: text("reason_code"),
  verdict: text("verdict"),
  observedFingerprint: text("observed_fingerprint").notNull(),
  commandKey: uuid("command_key").notNull(),
  commandDigest: text("command_digest").notNull(),
  mode: text("mode"),
  observedLotVersion: uuid("observed_lot_version"),
  askingPrice: numeric("asking_price", { precision: 14, scale: 2 }),
  listingUrl: text("listing_url"),
  pipelineStatus: text("pipeline_status"),
  sourceAuthor: text("source_author"),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  importRunId: uuid("import_run_id"),
  sourceRowId: text("source_row_id"),
  sourceChainId: text("source_chain_id"),
  supersedes: uuid("supersedes").references((): AnyPgColumn => facetEvents.id),
  supersededBy: uuid("superseded_by").references((): AnyPgColumn => facetEvents.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const facetCommands = pgTable("facet_commands", {
  ownerId: uuid("owner_id").notNull().references(() => accountUsers.id),
  commandKey: uuid("command_key").notNull(),
  commandDigest: text("command_digest").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.ownerId, t.commandKey] }) }));

// 6G workspace and membership authority. Explicit grants only: approval,
// invitation, or global administration never implies membership or capability.
// Partial indexes and the audit immutability trigger live in migration 0017.
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  scope: text("scope").notNull().default("all-municipalities"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMemberships = pgTable("workspace_memberships", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  accountId: uuid("account_id").notNull().references(() => accountUsers.id),
  status: text("status").notNull().default("active"),
  revision: integer("revision").notNull().default(1),
  moderateArchive: boolean("moderate_archive").notNull().default(false),
  manageMembers: boolean("manage_members").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.accountId] }) }));

export const workspaceMembershipEvents = pgTable("workspace_membership_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  accountId: uuid("account_id").notNull().references(() => accountUsers.id),
  kind: text("kind").notNull(),
  capability: text("capability"),
  actorId: uuid("actor_id").notNull().references(() => accountUsers.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 6H scoped attachment and activation. Partial indexes, immutability guards,
// the deferred binding check, and the protected index swap live in
// migration 0018; existing facet tables are untouched.
// 6J lot streams carry an explicit mode (migration 0021); signal streams
// keep mode null so their uniqueness is unchanged.
export const facetStreams = pgTable("facet_streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  scope: text("scope").notNull().default("personal"),
  ownerId: uuid("owner_id").references(() => accountUsers.id),
  targetType: text("target_type").notNull().default("signal"),
  mode: text("mode"),
  citySlug: text("city_slug").notNull(),
  nodeType: text("node_type").notNull(),
  nodeId: text("node_id").notNull(),
  facet: text("facet").notNull(),
  basket: text("basket"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const facetEventBindings = pgTable("facet_event_bindings", {
  eventId: uuid("event_id").primaryKey().references(() => facetEvents.id),
  streamId: uuid("stream_id").notNull().references(() => facetStreams.id),
  boundAt: timestamp("bound_at", { withTimezone: true }).notNull().defaultNow(),
});

export const facetHeads = pgTable("facet_heads", {
  streamId: uuid("stream_id").primaryKey().references(() => facetStreams.id),
  eventId: uuid("event_id").notNull().unique().references(() => facetEvents.id),
  boundAt: timestamp("bound_at", { withTimezone: true }).notNull().defaultNow(),
});

export const facetStreamAttachments = pgTable("facet_stream_attachments", {
  accountId: uuid("account_id").primaryKey().references(() => accountUsers.id),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  status: text("status").notNull(),
  detail: jsonb("detail").notNull().default({}),
  actorId: uuid("actor_id").notNull().references(() => accountUsers.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byWorkspace: index("facet_stream_attachments_workspace_idx").on(t.workspaceId),
}));

export const facetCommandContexts = pgTable("facet_command_contexts", {
  ownerId: uuid("owner_id").notNull().references(() => accountUsers.id),
  commandKey: uuid("command_key").notNull(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  status: text("status").notNull(),
  commandDigest: text("command_digest"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.ownerId, t.commandKey] }),
  byWorkspace: index("facet_command_contexts_workspace_idx").on(t.workspaceId),
}));

export const facetActivationState = pgTable("facet_activation_state", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id),
  writerEpoch: text("writer_epoch").notNull().default("legacy"),
  maintenanceBarrier: boolean("maintenance_barrier").notNull().default(false),
  oldIndexDropped: boolean("old_index_dropped").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 6J lot destination gate, import provenance, and distinct lot
// capabilities (D4). Writes stay disabled until 6K enables the gate.
// Partial indexes, append-only guards, and widened facet checks live in
// migration 0021; prospect_marks is untouched.
// 6K cutover state, append-only cutover events, immutable D5 dispositions,
// and source-writer coverage live in migration 0022. The cutover fence
// blocks legacy prospect_marks writes while a barrier is committed or the
// destination is open; prospect_notes and contacts stay separate.
export const lotDestinationState = pgTable("lot_destination_state", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id),
  enabled: boolean("enabled").notNull().default(false),
  selectionBasket: text("selection_basket"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lotImportRuns = pgTable("lot_import_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  importKey: uuid("import_key").notNull(),
  manifestSha: text("manifest_sha").notNull(),
  mappingVersion: text("mapping_version").notNull(),
  importerVersion: text("importer_version").notNull(),
  sourceSnapshotId: text("source_snapshot_id").notNull(),
  counts: jsonb("counts").notNull().default({}),
  status: text("status").notNull().default("complete"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lotSourceRows = pgTable("lot_source_rows", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  sourceId: text("source_id").notNull(),
  chainId: text("chain_id").notNull(),
  nativeTarget: text("native_target").notNull(),
  disposition: text("disposition").notNull(),
  diagnostics: text("diagnostics").array().notNull().default([]),
  destination: jsonb("destination"),
  observed: jsonb("observed").notNull(),
  manifestSha: text("manifest_sha").notNull(),
  importRunId: uuid("import_run_id").references(() => lotImportRuns.id),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.sourceId] }),
  byChain: index("lot_source_rows_chain_idx").on(t.workspaceId, t.chainId),
}));

export const lotCapabilityGrants = pgTable("lot_capability_grants", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  accountId: uuid("account_id").notNull().references(() => accountUsers.id),
  capability: text("capability").notNull(),
  granted: boolean("granted").notNull().default(false),
  revision: integer("revision").notNull().default(1),
  actorId: uuid("actor_id").notNull().references(() => accountUsers.id),
  reason: text("reason").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.accountId, t.capability] }),
}));

export const lotCapabilityEvents = pgTable("lot_capability_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  accountId: uuid("account_id").notNull().references(() => accountUsers.id),
  capability: text("capability").notNull(),
  kind: text("kind").notNull(),
  actorId: uuid("actor_id").notNull().references(() => accountUsers.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byWorkspace: index("lot_capability_events_workspace_idx").on(t.workspaceId, t.createdAt),
}));

/**
 * 6K guarded cutover state: one row per workspace. The maintenance
 * barrier is committed before any fencing; the destination opens only
 * through the explicit operator activation. The SQL fence and the route
 * layer read this row; legacy writes stay fenced once the barrier exists.
 */
export const lotCutoverState = pgTable("lot_cutover_state", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id),
  maintenanceBarrier: boolean("maintenance_barrier").notNull().default(false),
  destinationOpen: boolean("destination_open").notNull().default(false),
  manifestSha: text("manifest_sha"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Existing singleton also fences transactions carrying an older snapshot. */
export const lotLegacyFence = pgTable("lot_legacy_fence", {
  singleton: boolean("singleton").primaryKey().default(true),
  enabled: boolean("enabled").notNull().default(false),
});

/** 6K append-only audit of every cutover stage and D5 recording. */
export const lotCutoverEvents = pgTable("lot_cutover_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  stage: text("stage").notNull(),
  detail: jsonb("detail").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byWorkspace: index("lot_cutover_events_workspace_idx").on(t.workspaceId, t.createdAt),
}));

/**
 * 6K immutable D5 dispositions: one moderator decision per conflicted
 * target recorded against the exact manifest digest. A changed manifest
 * or a revised decision is a new row set, never an overwrite.
 */
export const lotD5Dispositions = pgTable("lot_d5_dispositions", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  manifestSha: text("manifest_sha").notNull(),
  targetKey: text("target_key").notNull(),
  decision: text("decision").notNull(),
  sourceId: text("source_id"),
  reason: text("reason").notNull(),
  recordedBy: uuid("recorded_by").notNull().references(() => accountUsers.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.manifestSha, t.targetKey] }),
}));

/**
 * 6K source-writer coverage attestations: every supported lot_versions
 * writer must be recorded as covered before activation. Seeded uncovered
 * by migration 0022; deployment qualifies each writer against the
 * canonical-target serialization protocol.
 */
export const lotSourceWriterCoverage = pgTable("lot_source_writer_coverage", {
  writer: text("writer").primaryKey(),
  covered: boolean("covered").notNull().default(false),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull().default(""),
});

/**
 * 6L1 per-viewer personal projection revisions: one monotonic counter per
 * (workspace, viewer, city, mode). Another member's personal mutation never
 * touches this viewer's row, so it never invalidates this viewer's token.
 * `mode` is restricted to `signal` until 6J/6K qualify lot modes.
 */
export const personalProjectionRevisions = pgTable("personal_projection_revisions", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  ownerId: uuid("owner_id").notNull().references(() => accountUsers.id),
  citySlug: text("city_slug").notNull(),
  mode: text("mode").notNull().default("signal"),
  revision: integer("revision").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.ownerId, t.citySlug, t.mode] }),
}));

/**
 * 6L1 shared workspace projection revisions: one monotonic counter per
 * (workspace, city, mode), bumped by moderator archive transitions visible
 * to every member.
 */
export const workspaceProjectionRevisions = pgTable("workspace_projection_revisions", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  citySlug: text("city_slug").notNull(),
  mode: text("mode").notNull().default("signal"),
  revision: integer("revision").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.citySlug, t.mode] }),
}));

/**
 * 6L1 per-city graph source revisions: the content digest covers served
 * signal content only (community excluded, like the 6B fingerprint), so a
 * community-only refresh or a backdated identical import bumps nothing.
 */
export const graphSourceRevisions = pgTable("graph_source_revisions", {
  citySlug: text("city_slug").primaryKey(),
  revision: integer("revision").notNull().default(0),
  contentDigest: text("content_digest").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  facetCommands,
  facetEvents,
  facetReasonCodes,
  facetStreams,
  facetEventBindings,
  facetHeads,
  facetStreamAttachments,
  facetCommandContexts,
  facetActivationState,
  personalProjectionRevisions,
  workspaceProjectionRevisions,
  graphSourceRevisions,
  workspaces,
  workspaceMemberships,
  workspaceMembershipEvents,
  lotDestinationState,
  lotImportRuns,
  lotSourceRows,
  lotCapabilityGrants,
  lotCapabilityEvents,
  lotCutoverState,
  lotCutoverEvents,
  lotD5Dispositions,
  lotSourceWriterCoverage,
  refreshDocumentOutcomes,
  sources,
  ingestions,
  documents,
  signals,
  opportunities,
  scores,
  links,
  zoneVersions,
  lotVersions,
  regulatoryStages,
  constraintHits,
  opportunityDossiers,
  graphNodes,
  graphEdges,
  accountUsers,
  accountUserStatusEvents,
  accountInvitations,
  // Inc 1 — marquage Steve
  prospectMarks,
  prospectNotes,
  prospectContacts,
  prospectContactAccessLog,
  // G1 — Géo-mapper
  geoResolutions,
  geoUnresolved,
  // WP3 LOT1 — Cohérence E2E
  consistencySnapshots,
  // PW-D — write persistence (DDL in migration 0027, types in schema-pw-write)
  ...pwWriteSchema,
};
