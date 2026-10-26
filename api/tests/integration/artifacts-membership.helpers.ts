import type pg from "pg";

/** Legitimate artifact fixtures need an explicit membership as well as approval. */
export async function seedArtifactMemberships(pool: pg.Pool) {
  await pool.query("INSERT INTO workspaces (slug, label) VALUES ('artifacts-test', 'Artifacts test') ON CONFLICT DO NOTHING");
  await pool.query(`INSERT INTO workspace_memberships (workspace_id, account_id)
    SELECT w.id, a.id FROM workspaces w CROSS JOIN account_users a WHERE w.slug='artifacts-test'
    ON CONFLICT DO NOTHING`);
}
