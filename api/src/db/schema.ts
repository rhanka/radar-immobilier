import {
  boolean,
  customType,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

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
    rawRef: text("raw_ref").notNull(),
    evidence: jsonb("evidence").notNull().default([]),
  },
  (t) => ({
    byCanonical: index("zone_versions_canonical_idx").on(t.canonicalId),
    byCity: index("zone_versions_city_idx").on(t.citySlug),
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
    rawRef: text("raw_ref").notNull(),
    evidence: jsonb("evidence").notNull().default([]),
  },
  (t) => ({
    byCanonical: index("lot_versions_canonical_idx").on(t.canonicalId),
    byNoLot: index("lot_versions_no_lot_idx").on(t.noLot),
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
 * `id` is the graphify node id (string slug, not a UUID) so upserts are
 * purely idempotent on the natural key.
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
    id: text("id").primaryKey(),
    type: text("type").notNull().default("concept"), // graphify file_type
    label: text("label").notNull(),
    citySlug: text("city_slug"), // null = cross-city / global
    props: jsonb("props").notNull().default({}), // community, source_file, …
    sourceRef: text("source_ref"), // S3 key / raw ref
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byType: index("graph_nodes_type_idx").on(t.type),
    byCity: index("graph_nodes_city_idx").on(t.citySlug),
    // Composite : filtre ville + type en une passe (migration 0003)
    byCityType: index("graph_nodes_city_type_idx").on(t.citySlug, t.type),
    // GIN JSONB sur props (migration 0003)
    propsGin: index("graph_nodes_props_gin_idx").using("gin", t.props),
  }),
);

/**
 * Graph edges — one row per graphify link.
 * Composite natural key (srcId, dstId, kind) drives idempotent upserts:
 * conflicting rows update props only (no duplicate edges).
 *
 * Index additionnel (migration 0003_graph_indexes) :
 *   - GIN JSONB sur props → requêtes @> sur les métadonnées d'arête
 */
export const graphEdges = pgTable(
  "graph_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    srcId: text("src_id").notNull(), // → graph_nodes.id (soft ref)
    dstId: text("dst_id").notNull(), // → graph_nodes.id (soft ref)
    kind: text("kind").notNull(), // graphify relation
    props: jsonb("props").notNull().default({}), // confidence, source_file, …
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byKind: index("graph_edges_kind_idx").on(t.kind),
    bySrc: index("graph_edges_src_idx").on(t.srcId),
    byDst: index("graph_edges_dst_idx").on(t.dstId),
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
 * Notes append-only multi-auteurs par lot.
 * Jamais mises à jour : une nouvelle ligne par note.
 * Ancrées sur (no_lot, city_slug) — pas de FK bitemporale stricte.
 */
export const prospectNotes = pgTable(
  "prospect_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    noLot: text("no_lot").notNull(),
    citySlug: text("city_slug").notNull(),

    authorId: uuid("author_id")
      .notNull()
      .references(() => accountUsers.id, { onDelete: "restrict" }),

    body: text("body").notNull(),

    mode: prospectModeEnum("mode").notNull().default("real"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byLot: index("prospect_notes_lot_idx").on(t.noLot, t.citySlug),
    byAuthor: index("prospect_notes_author_idx").on(t.authorId),
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

export const schema = {
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
  // Inc 1 — marquage Steve
  prospectMarks,
  prospectNotes,
  prospectContacts,
  prospectContactAccessLog,
};
