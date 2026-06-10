-- WP A.3.1 — Graph store: graph_nodes + graph_edges tables.
-- Lightweight Postgres-native persistence for graphify graph.json output.
-- Hand-authored (additive DDL only). drizzle-kit cannot express the unique
-- index used for edge upserts, so this migration is kept manual.

CREATE TABLE IF NOT EXISTS "graph_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'concept' NOT NULL,
	"label" text NOT NULL,
	"city_slug" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "graph_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"src_id" text NOT NULL,
	"dst_id" text NOT NULL,
	"kind" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_nodes_type_idx" ON "graph_nodes" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_nodes_city_idx" ON "graph_nodes" ("city_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_edges_kind_idx" ON "graph_edges" ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_edges_src_idx" ON "graph_edges" ("src_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_edges_dst_idx" ON "graph_edges" ("dst_id");--> statement-breakpoint

-- Unique index to drive idempotent upserts on edges (one edge per src/dst/kind triple).
CREATE UNIQUE INDEX IF NOT EXISTS "graph_edges_natural_key_idx" ON "graph_edges" ("src_id", "dst_id", "kind");
