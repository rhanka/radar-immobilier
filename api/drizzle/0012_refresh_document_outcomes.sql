-- Append-only submission results in the same radar database as the graph projection.
-- No references to legacy documents/ingestions and no document or error payloads.
CREATE TYPE "refresh_outcome_status" AS ENUM ('submitted', 'accepted', 'refused');
--> statement-breakpoint
CREATE TYPE "refresh_outcome_reason" AS ENUM ('quota', 'timeout', 'empty-output', 'transport', 'quality', 'forced', 'circuit-open');
--> statement-breakpoint
CREATE TYPE "refresh_outcome_transition" AS ENUM ('primary', 'same-model-retry', 'fallback', 'verification');
--> statement-breakpoint
CREATE TABLE "refresh_document_outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cycle_id" uuid NOT NULL,
  "document_sha" text NOT NULL,
  "city_slug" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "page_count" integer NOT NULL,
  "provider" text,
  "model" text,
  "effort" text,
  "transition" "refresh_outcome_transition",
  "status" "refresh_outcome_status" NOT NULL,
  "failure_reason" "refresh_outcome_reason",
  "fallback_reason" "refresh_outcome_reason",
  "attempts" integer NOT NULL,
  "latency_ms" integer NOT NULL,
  "unknown_ids" integer NOT NULL DEFAULT 0,
  "kept_no_valid_decision" integer NOT NULL DEFAULT 0,
  "supported_ungrounded" integer NOT NULL DEFAULT 0,
  "acts_judged" integer NOT NULL DEFAULT 0,
  "acts_removed" integer NOT NULL DEFAULT 0,
  "skipped_fallback" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX "refresh_document_outcomes_created_at_idx" ON "refresh_document_outcomes" ("created_at");
--> statement-breakpoint
CREATE INDEX "refresh_document_outcomes_status_idx" ON "refresh_document_outcomes" ("status");
