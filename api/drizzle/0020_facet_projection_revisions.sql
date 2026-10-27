-- 6L1 authorized revisions and coherent refetch. Additive only.
-- Per-viewer personal counters, shared workspace counters, and per-city
-- graph source revisions. No global event counter, no timestamp ordering:
-- identical authorized content yields an identical token even when
-- timestamps match or imports arrive backdated.
-- Every statement below is replayable on a schema that already has it.
-- 6J also develops against 0019; final integration must allocate distinct
-- consecutive numbers before merging either journal addition.
CREATE TABLE IF NOT EXISTS personal_projection_revisions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  city_slug text NOT NULL CHECK (city_slug <> ''),
  mode text NOT NULL DEFAULT 'signal' CHECK (mode = 'signal'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_projection_revisions_pkey PRIMARY KEY (workspace_id, owner_id, city_slug, mode)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workspace_projection_revisions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  city_slug text NOT NULL CHECK (city_slug <> ''),
  mode text NOT NULL DEFAULT 'signal' CHECK (mode = 'signal'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_projection_revisions_pkey PRIMARY KEY (workspace_id, city_slug, mode)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS graph_source_revisions (
  city_slug text PRIMARY KEY CHECK (city_slug <> ''),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  content_digest text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
