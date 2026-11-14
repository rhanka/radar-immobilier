SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS signal_metadata (
  city_slug text NOT NULL,
  node_type text NOT NULL,
  node_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  document_dates text[] NOT NULL,
  scrap_dates text[] NOT NULL,
  filter_bits varchar(5),
  rank_key jsonb NOT NULL,
  attachments jsonb NOT NULL,
  PRIMARY KEY (city_slug, node_type, node_id),
  FOREIGN KEY (city_slug, node_id) REFERENCES graph_nodes(city_slug, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS signal_metadata_cells_idx ON signal_metadata(city_slug, filter_bits, node_type, node_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS signal_metadata_versions (
  city_slug text PRIMARY KEY,
  version integer NOT NULL,
  target_count integer NOT NULL
);
