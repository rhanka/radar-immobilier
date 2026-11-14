-- Local disposable instance only. No production passwords or login grants.
-- radar is created by the image and owns the production archive objects.
CREATE ROLE radar_db_ro_prod NOLOGIN;
CREATE ROLE radar_snapshot_ro NOLOGIN;
CREATE ROLE immo_mcp_account_reader NOLOGIN;
CREATE ROLE immo_mcp_artifact_writer NOLOGIN;
-- The image preloads PostGIS/tiger/topology in POSTGRES_DB. Restore needs template0.
\connect postgres
DROP DATABASE radar_cutover_owner_20261113;
CREATE DATABASE radar_cutover_owner_20261113 OWNER radar TEMPLATE template0;
