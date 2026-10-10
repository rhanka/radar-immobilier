-- GH #812 — graph city key: graph_nodes primary key (city_slug, id), graph_edges.city_slug,
-- geo_resolutions natural key widened with city_slug.
-- Spec: docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md §5 (owner decision D2 option C, Q1 NULL-city
-- rows deleted, Q5 forward-fix only: no down-migration).
--
-- Hand-authored (like 0002/0003): drizzle-kit cannot express the drift-safe PK swap.
-- The drizzle migrator runs every pending migration inside ONE transaction, so this file is
-- all or nothing; `SET LOCAL lock_timeout` makes it fail fast instead of queueing an
-- ACCESS EXCLUSIVE lock behind a long refresh transaction (the CD stops before set-image).
--
-- IDEMPOTENT: when graph_nodes already has the primary key (city_slug, id) the node/edge
-- block is a no-op (NOTICE), and every index statement is guarded. A replay after a journal
-- drift (see 0012) changes nothing.
--
-- Counts (deleted NULL-city nodes, incident edges, edges without a resolvable city) are
-- raised as NOTICE; api/src/db/migrate.ts logs every NOTICE in the migrate Job log.
SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
DO $$
DECLARE
  pk_name text;
  pk_cols text[];
  nodes_before bigint;
  edges_before bigint;
  null_nodes bigint;
  null_city_edges bigint;
  unplaced_edges bigint;
  nodes_after bigint;
  edges_after bigint;
BEGIN
  SELECT c.conname,
         array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO pk_name, pk_cols
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.graph_nodes'::regclass AND c.contype = 'p'
   GROUP BY c.conname;

  IF pk_cols = ARRAY['city_slug', 'id'] THEN
    RAISE NOTICE 'graph-city-key: graph_nodes primary key is already (city_slug, id); node and edge steps skipped';
    RETURN;
  END IF;

  -- Take both locks up front, in a fixed order (no lock upgrade in the middle).
  LOCK TABLE graph_nodes, graph_edges IN ACCESS EXCLUSIVE MODE;

  SELECT count(*) INTO nodes_before FROM graph_nodes;
  SELECT count(*) INTO edges_before FROM graph_edges;

  -- Step 1 (K2, owner Q1): NULL-city rows are deleted, never attached to a city. Ids are
  -- still unique here, so an id of a NULL-city node belongs to no city: every incident edge
  -- (either endpoint) goes first, then the nodes.
  DELETE FROM graph_edges e
   WHERE e.src_id IN (SELECT n.id FROM graph_nodes n WHERE n.city_slug IS NULL)
      OR e.dst_id IN (SELECT n.id FROM graph_nodes n WHERE n.city_slug IS NULL);
  GET DIAGNOSTICS null_city_edges = ROW_COUNT;
  DELETE FROM graph_nodes WHERE city_slug IS NULL;
  GET DIAGNOSTICS null_nodes = ROW_COUNT;

  -- Step 2 (K4): place every edge in a city while graph_nodes.id is still unique: city of
  -- the src node, else of the dst node. A placement, not a provenance proof: the per-city
  -- projection (and the repair) reconciles each city's edges with its latest.json.
  ALTER TABLE graph_edges ADD COLUMN IF NOT EXISTS city_slug text;
  UPDATE graph_edges e SET city_slug = n.city_slug
    FROM graph_nodes n
   WHERE e.city_slug IS NULL AND n.id = e.src_id;
  UPDATE graph_edges e SET city_slug = n.city_slug
    FROM graph_nodes n
   WHERE e.city_slug IS NULL AND n.id = e.dst_id;
  -- Neither endpoint exists: never served (subgraph reads require both endpoints), no city
  -- to attach it to. Deleted (owner Q4: no archive).
  DELETE FROM graph_edges WHERE city_slug IS NULL;
  GET DIAGNOSTICS unplaced_edges = ROW_COUNT;
  ALTER TABLE graph_edges ALTER COLUMN city_slug SET NOT NULL;

  -- Step 3 (K3): edge keys carry the city. No duplicate is possible: the old triple was
  -- unique and the city is a function of it.
  DROP INDEX IF EXISTS graph_edges_natural_key_idx;
  DROP INDEX IF EXISTS graph_edges_src_idx;
  DROP INDEX IF EXISTS graph_edges_dst_idx;
  CREATE UNIQUE INDEX IF NOT EXISTS graph_edges_city_natural_key_idx
    ON graph_edges (city_slug, src_id, dst_id, kind);
  CREATE INDEX IF NOT EXISTS graph_edges_city_src_idx ON graph_edges (city_slug, src_id);
  CREATE INDEX IF NOT EXISTS graph_edges_city_dst_idx ON graph_edges (city_slug, dst_id);

  -- Step 4 (K1): node primary key (city_slug, id). The current PK name is read from
  -- pg_constraint (prod has a schema drift on graph_nodes), never hard-coded.
  ALTER TABLE graph_nodes ALTER COLUMN city_slug SET NOT NULL;
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE graph_nodes DROP CONSTRAINT %I', pk_name);
  END IF;
  ALTER TABLE graph_nodes ADD CONSTRAINT graph_nodes_pkey PRIMARY KEY (city_slug, id);
  -- Redundant with the PK prefix.
  DROP INDEX IF EXISTS graph_nodes_city_idx;

  -- Step 6 (postcheck): only the rows counted above were deleted.
  SELECT count(*) INTO nodes_after FROM graph_nodes;
  SELECT count(*) INTO edges_after FROM graph_edges;
  IF nodes_after <> nodes_before - null_nodes THEN
    RAISE EXCEPTION 'graph-city-key postcheck: graph_nodes % <> % - %', nodes_after, nodes_before, null_nodes;
  END IF;
  IF edges_after <> edges_before - null_city_edges - unplaced_edges THEN
    RAISE EXCEPTION 'graph-city-key postcheck: graph_edges % <> % - % - %', edges_after, edges_before, null_city_edges, unplaced_edges;
  END IF;

  RAISE NOTICE 'graph-city-key: nodes % -> % (deleted NULL-city nodes: %); edges % -> % (deleted edges incident to a NULL-city node: %, deleted edges without any existing endpoint: %)',
    nodes_before, nodes_after, null_nodes, edges_before, edges_after, null_city_edges, unplaced_edges;
END $$;
--> statement-breakpoint
-- Step 5 (K5): two cities can hold the same node id and resolve the same lot; the natural
-- key of geo_resolutions gains the city. Existing rows stay unique under the wider key.
DROP INDEX IF EXISTS geo_resolutions_natural_key_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS geo_resolutions_city_natural_key_idx
  ON geo_resolutions (city_slug, node_id, relation_type, target_id);
