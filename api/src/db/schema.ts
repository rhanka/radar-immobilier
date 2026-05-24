import {
  boolean,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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

export const schema = {
  sources,
  ingestions,
  documents,
  signals,
  opportunities,
  scores,
  links,
};
