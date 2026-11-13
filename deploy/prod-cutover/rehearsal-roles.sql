-- Local disposable instance only. No production passwords or login grants.
-- radar is created by the image and owns the production archive objects.
CREATE ROLE radar_db_ro_prod NOLOGIN;
CREATE ROLE radar_snapshot_ro NOLOGIN;
CREATE ROLE immo_mcp_account_reader NOLOGIN;
CREATE ROLE immo_mcp_artifact_writer NOLOGIN;
