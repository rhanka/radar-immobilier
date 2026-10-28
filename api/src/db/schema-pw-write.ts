import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * PW-D durable write store. DDL lives in migration 0025; this file only
 * types it. Foreign keys are enforced by the migration and intentionally
 * not repeated here to keep this module free of schema import cycles.
 */
export const pwWriteIntents = pgTable("pw_write_intents", {
  intentId: uuid("intent_id").primaryKey().defaultRandom(),
  invocationId: uuid("invocation_id").notNull().unique().defaultRandom(),
  operation: text("operation").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  principal: jsonb("principal").notNull(),
  artifactRef: jsonb("artifact_ref").notNull(),
  authorityReferences: jsonb("authority_references").notNull(),
  challengeKeyId: text("challenge_key_id").notNull(),
  pageSessionId: text("page_session_id").notNull(),
  pageInstanceId: text("page_instance_id").notNull(),
  grantReference: text("grant_reference").notNull(),
  citySlug: text("city_slug").notNull(),
  target: jsonb("target").notNull(),
  command: jsonb("command").notNull(),
  operationDigest: text("operation_digest").notNull(),
  intentDigest: text("intent_digest").notNull(),
  commandKey: uuid("command_key").notNull(),
  expectedProjectionToken: text("expected_projection_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  executionState: text("execution_state").notNull().default("pending"),
  challengeId: text("challenge_id").notNull().unique(),
  challengeState: text("challenge_state").notNull().default("pending"),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byActorKey: index("pw_write_intents_actor_key_idx").on(t.actorId, t.commandKey),
}));

export const pwWriteKeyReservations = pgTable("pw_write_key_reservations", {
  actorId: uuid("actor_id").notNull(),
  commandKey: uuid("command_key").notNull(),
  intentId: uuid("intent_id").notNull().unique(),
  operationDigest: text("operation_digest").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.actorId, t.commandKey] }) }));

export const pwWriteReceiptLinks = pgTable("pw_write_receipt_links", {
  intentId: uuid("intent_id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  commandKey: uuid("command_key").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pwWriteIntentTombstones = pgTable("pw_write_intent_tombstones", {
  intentId: uuid("intent_id").primaryKey(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
  revokedBy: uuid("revoked_by").notNull(),
  reason: text("reason").notNull().default(""),
});

export const pwWriteAuthorityFences = pgTable("pw_write_authority_fences", {
  kind: text("kind").notNull(),
  reference: text("reference").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull().default(""),
}, (t) => ({ pk: primaryKey({ columns: [t.kind, t.reference] }) }));

export const pwWriteQuotaLedger = pgTable("pw_write_quota_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  bucket: text("bucket").notNull(),
  intentId: uuid("intent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byBucket: index("pw_write_quota_ledger_bucket_idx").on(t.kind, t.bucket, t.createdAt),
}));

export const pwWriteAudit = pgTable("pw_write_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  intentId: uuid("intent_id").notNull(),
  invocationId: uuid("invocation_id").notNull(),
  commandId: uuid("command_id"),
  operation: text("operation").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  target: jsonb("target"),
  scope: text("scope"),
  artifactRef: jsonb("artifact_ref").notNull().default({}),
  grantRef: text("grant_ref"),
  principal: jsonb("principal").notNull(),
  operationDigest: text("operation_digest").notNull(),
  intentDigest: text("intent_digest"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  result: text("result").notNull(),
}, (t) => ({
  byIntent: index("pw_write_audit_intent_idx").on(t.intentId, t.decidedAt),
}));

export const pwWriteOutbox = pgTable("pw_write_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id").notNull(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
});

export const pwWriteRejections = pgTable("pw_write_rejections", {
  intentId: uuid("intent_id").primaryKey(),
  status: integer("status").notNull(),
  code: text("code").notNull(),
});

export const pwWriteStatusBudgets = pgTable("pw_write_status_budgets", {
  intentId: uuid("intent_id").notNull(),
  pageSessionId: text("page_session_id").notNull(),
  firstReadAt: timestamp("first_read_at", { withTimezone: true }).notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
  initialReads: integer("initial_reads").notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.intentId, t.pageSessionId] }) }));

export const pwWriteSchema = {
  pwWriteIntents,
  pwWriteKeyReservations,
  pwWriteReceiptLinks,
  pwWriteIntentTombstones,
  pwWriteAuthorityFences,
  pwWriteQuotaLedger,
  pwWriteAudit,
  pwWriteOutbox,
  pwWriteRejections,
  pwWriteStatusBudgets,
};
