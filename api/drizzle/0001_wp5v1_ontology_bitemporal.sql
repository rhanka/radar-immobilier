-- WP5-V1 — bitemporal ontology projections + PostGIS (SPEC_ONTOLOGY_DATA_MODEL.md v2).
-- Additive DDL only: new extensions + new tables + non-overlap EXCLUDE constraints.
-- Hand-authored (drizzle-kit cannot express PostGIS geometry columns nor EXCLUDE).

CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "zone_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_id" text NOT NULL,
	"city_slug" text NOT NULL,
	"code_affiche" text NOT NULL,
	"kind" text NOT NULL,
	"recon_status" text DEFAULT 'validated' NOT NULL,
	"recon_patch_id" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"known_from" timestamp with time zone NOT NULL,
	"known_to" timestamp with time zone,
	"geom" geometry(Geometry,4326),
	"geom_source" text DEFAULT 'none' NOT NULL,
	"raw_ref" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lot_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_id" text NOT NULL,
	"no_lot" text NOT NULL,
	"city_slug" text NOT NULL,
	"recon_status" text DEFAULT 'validated' NOT NULL,
	"recon_patch_id" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"known_from" timestamp with time zone NOT NULL,
	"known_to" timestamp with time zone,
	"geom" geometry(Geometry,4326),
	"geom_source" text DEFAULT 'none' NOT NULL,
	"raw_ref" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulatory_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bylaw_canonical_id" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"outcome" text DEFAULT 'non-disponible' NOT NULL,
	"raw_ref" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "constraint_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constraint_canonical_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_canonical_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"observed_on" date,
	"confidence" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_dossiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_slug" text NOT NULL,
	"zone_canonical_id" text,
	"lot_canonical_id" text,
	"status" text DEFAULT 'surveillance' NOT NULL,
	"axes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"grid_version" text,
	"known_at" timestamp with time zone,
	"recon_patch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zone_versions_canonical_idx" ON "zone_versions" ("canonical_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zone_versions_city_idx" ON "zone_versions" ("city_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lot_versions_canonical_idx" ON "lot_versions" ("canonical_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lot_versions_no_lot_idx" ON "lot_versions" ("no_lot");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regulatory_stages_bylaw_idx" ON "regulatory_stages" ("bylaw_canonical_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "constraint_hits_target_idx" ON "constraint_hits" ("target_canonical_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_dossiers_city_idx" ON "opportunity_dossiers" ("city_slug");--> statement-breakpoint

-- Non-overlap exclusion constraint (SPEC_ONTOLOGY §4, §8.1): for a given canonical
-- entity, no two CURRENTLY-BELIEVED (known_to IS NULL) versions may have overlapping
-- validity ranges. btree_gist enables an equality predicate (=) on the text
-- canonical_id alongside the range overlap (&&). The partial WHERE keeps the
-- constraint scoped to live knowledge (append-only superseded rows stay valid).
DO $$ BEGIN
 ALTER TABLE "zone_versions" ADD CONSTRAINT "zone_versions_no_overlap"
   EXCLUDE USING gist (
     "canonical_id" WITH =,
     daterange("valid_from", "valid_to", '[)') WITH &&
   ) WHERE ("known_to" IS NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot_versions" ADD CONSTRAINT "lot_versions_no_overlap"
   EXCLUDE USING gist (
     "canonical_id" WITH =,
     daterange("valid_from", "valid_to", '[)') WITH &&
   ) WHERE ("known_to" IS NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
