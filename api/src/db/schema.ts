import {
  boolean,
  customType,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
  }),
);

/**
 * Graph edges — one row per graphify link.
 * Composite natural key (srcId, dstId, kind) drives idempotent upserts:
 * conflicting rows update props only (no duplicate edges).
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
};
