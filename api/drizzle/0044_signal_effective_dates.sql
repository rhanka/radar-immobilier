SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- #872: materialize effective civil dates (document / scrap) on graph_nodes.
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS effective_document_dates text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS effective_scrap_dates text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS graph_nodes_doc_dates_gin_idx ON graph_nodes USING gin (effective_document_dates);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS graph_nodes_scrap_dates_gin_idx ON graph_nodes USING gin (effective_scrap_dates);
--> statement-breakpoint
-- Backfill mirroring @radar/domain resultCivilDates / signalStageCivilDate.
CREATE OR REPLACE FUNCTION effective_civil_date(v text) RETURNS text AS $$
BEGIN
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  IF substring(v,1,4)::int < 1 OR substring(v,6,2)::int NOT BETWEEN 1 AND 12
     OR substring(v,9,2)::int NOT BETWEEN 1 AND 31 THEN RETURN NULL; END IF;
  RETURN CASE WHEN to_date(v,'YYYY-MM-DD')::text = v THEN v ELSE NULL END;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
UPDATE graph_nodes g SET
  effective_document_dates = sub.doc_dates,
  effective_scrap_dates = sub.scrap_dates
FROM (
  SELECT city_slug, id,
    (SELECT coalesce(array_agg(DISTINCT d ORDER BY d), '{}') FROM (
      SELECT effective_civil_date(
        CASE WHEN r.ref->'documentDate' IS NOT NULL THEN
          CASE WHEN r.ref->'documentDate'->>'status'='known' AND r.ref->'documentDate'->>'precision'='day'
               AND (r.ref->>'publishedAt' IS NULL OR r.ref->>'publishedAt' = r.ref->'documentDate'->>'value')
               THEN r.ref->'documentDate'->>'value' END
        ELSE r.ref->>'publishedAt' END) AS d
      FROM jsonb_array_elements(coalesce(g0.props->'refs','[]'::jsonb) || coalesce(g0.props->'properties'->'refs','[]'::jsonb)) AS r(ref)
      UNION ALL
      SELECT stage.d FROM (
        SELECT effective_civil_date(substring(s.v,1,10)) AS d FROM (
          SELECT v FROM (VALUES
            (g0.props->'properties'->>'etapeDate'),(g0.props->'properties'->>'etape_date'),
            (g0.props->'properties'->>'meetingDate'),(g0.props->'properties'->>'meeting_date'),
            (g0.props->'properties'->>'documentDate'),(g0.props->'properties'->>'date'),
            (g0.props->>'etapeDate'),(g0.props->>'etape_date'),(g0.props->>'meetingDate'),
            (g0.props->>'meeting_date'),(g0.props->>'documentDate'),(g0.props->>'date')
          ) AS k(v) WHERE v IS NOT NULL AND btrim(v) <> '' LIMIT 1) s
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(g0.props->'refs','[]'::jsonb) || coalesce(g0.props->'properties'->'refs','[]'::jsonb)) AS r2(ref)
          WHERE effective_civil_date(CASE WHEN r2.ref->'documentDate' IS NOT NULL THEN
            CASE WHEN r2.ref->'documentDate'->>'status'='known' AND r2.ref->'documentDate'->>'precision'='day'
                 AND (r2.ref->>'publishedAt' IS NULL OR r2.ref->>'publishedAt' = r2.ref->'documentDate'->>'value')
                 THEN r2.ref->'documentDate'->>'value' END ELSE r2.ref->>'publishedAt' END) IS NULL)
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g0.props->'refs','[]'::jsonb) || coalesce(g0.props->'properties'->'refs','[]'::jsonb)) AS r3(ref))
      ) stage WHERE stage.d IS NOT NULL
    ) all_dates WHERE d IS NOT NULL) AS doc_dates,
    (SELECT coalesce(array_agg(DISTINCT d ORDER BY d), '{}') FROM (
      SELECT CASE WHEN r.ref->>'fetchedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN
        to_char(((r.ref->>'fetchedAt')::timestamptz AT TIME ZONE 'America/Toronto'), 'YYYY-MM-DD') END AS d
      FROM jsonb_array_elements(coalesce(g0.props->'refs','[]'::jsonb) || coalesce(g0.props->'properties'->'refs','[]'::jsonb)) AS r(ref)
    ) scrap WHERE d IS NOT NULL) AS scrap_dates
  FROM graph_nodes g0
) sub WHERE g.city_slug = sub.city_slug AND g.id = sub.id;
--> statement-breakpoint
DROP FUNCTION effective_civil_date(text);
