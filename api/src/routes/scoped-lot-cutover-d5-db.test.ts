/**
 * 6K cutover HTTP with D5 dispositions: a conflicted target stays out
 * until a moderator records an explicit winning head, then activates
 * exactly that projection while every chain stays queryable evidence.
 * Synthetic disposable data.
 */
import { expect, it } from "vitest";
import { describeDb, cutoverFixture } from "../services/facets/lots/cutover-fixture.js";
import { MAPPING, makeCutoverApp } from "./scoped-lot-cutover-harness.js";

describeDb("6K cutover HTTP with D5", () => {
  it("should require D5 over HTTP before activating a conflict", async () => {
    const f = await cutoverFixture();
    await f.pool.query(`INSERT INTO lot_versions
      (id, canonical_id, no_lot, city_slug, recon_status, valid_from, known_from, known_to, raw_ref)
      SELECT '6c000000-0000-4000-8000-0000000000dd', canonical_id, no_lot, city_slug,
        recon_status, valid_from, '2024-01-01', '2025-01-01', 'synthetic-historical-6k'
      FROM lot_versions WHERE id = '6c000000-0000-4000-8000-0000000000cc'`);
    await f.pool.query(`INSERT INTO prospect_marks
      (id, lot_version_id, no_lot, city_slug, dimension, statut, mode, author_id, created_at)
      VALUES
      ('7c000000-0000-4000-8000-000000000005',
        '6c000000-0000-4000-8000-0000000000cc', 'SYN-6K-0003', 'synthetic-6j-city',
        'pipeline', 'sollicite', 'real', $1, '2026-03-05T10:00:00.000Z'),
      ('7c000000-0000-4000-8000-000000000006',
        '6c000000-0000-4000-8000-0000000000dd', 'SYN-6K-0003', 'synthetic-6j-city',
        'pipeline', 'lettre_envoyee', 'real', $1, '2026-03-06T10:00:00.000Z')`,
    [f.moderator.id]);
    const moderator = makeCutoverApp(f, { sub: f.moderator.sub });
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`;
    const evaluation = await moderator.request(`${base}/evaluate`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapping: MAPPING }) });
    const gate = (await evaluation.json() as { gate: {
      activatable: boolean; requiresD5: boolean; unavailable: string[]; manifestSha: string } }).gate;
    expect(gate).toMatchObject({ activatable: false, requiresD5: true });
    expect(gate.unavailable).toHaveLength(1);
    expect((await moderator.request(base, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapping: MAPPING, confirmCutover: true }) })).status).toBe(409);
    const recorded = await moderator.request(`${base}/d5-dispositions`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifestSha: gate.manifestSha,
        decisions: [{ targetKey: gate.unavailable[0], decision: "activate",
          sourceId: "7c000000-0000-4000-8000-000000000005",
          reason: "evidenced pipeline head" }] }) });
    expect(recorded.status).toBe(200);
    const opened = await moderator.request(base, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapping: MAPPING, confirmCutover: true }) });
    expect(opened.status).toBe(200);
    const read = await moderator.request(
      `/api/v1/workspaces/${f.workspaceId}/lot-facets?citySlug=synthetic-6j-city` +
      "&canonicalId=lot-canonical-syn-6k-03&mode=real");
    expect((await read.json() as { pipeline: { pipelineStatus: string } | null }).pipeline)
      .toMatchObject({ pipelineStatus: "sollicite" });
  });
});
