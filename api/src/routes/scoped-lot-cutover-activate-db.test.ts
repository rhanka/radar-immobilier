/**
 * 6K cutover HTTP activation: evaluate, open, and legacy retirement.
 *
 * The full operator flow over HTTP: the pre-cutover legacy reads keep
 * working, evaluation needs no approval on a clean manifest, activation
 * requires an explicit confirmation, and afterwards legacy marks answer
 * 410 while notes and contacts keep working. Synthetic disposable data.
 */
import { expect, it } from "vitest";
import { describeDb, cutoverFixture } from "../services/facets/lots/cutover-fixture.js";
import {
  MAPPING,
  makeCutoverApp,
  seedLegacyChain,
} from "./scoped-lot-cutover-harness.js";

describeDb("6K cutover HTTP activation", () => {
  it("should evaluate, activate, and retire legacy marks over HTTP", async () => {
    const f = await cutoverFixture();
    await seedLegacyChain(f, f.moderator.id);
    const moderator = makeCutoverApp(f, { sub: f.moderator.sub });
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`;
    const preMarks = await moderator.request(
      "/api/v1/prospects/zones/synthetic-6j-city/marks");
    expect(preMarks.status).toBe(200);
    const evaluation = await moderator.request(`${base}/evaluate`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapping: MAPPING }) });
    expect(evaluation.status).toBe(200);
    const gate = (await evaluation.json() as { gate: {
      activatable: boolean; requiresD5: boolean; ready: string[]; manifestSha: string } }).gate;
    expect(gate).toMatchObject({ activatable: true, requiresD5: false });
    expect(gate.ready).toHaveLength(2);
    const refused = await moderator.request(base, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapping: MAPPING, confirmCutover: false }) });
    expect(refused.status).toBe(400);
    const opened = await moderator.request(base, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapping: MAPPING, confirmCutover: true }) });
    expect(opened.status).toBe(200);
    const receipt = (await opened.json() as { receipt: {
      status: string; stages: string[]; manifestSha: string } }).receipt;
    expect(receipt.status).toBe("complete");
    expect(receipt.stages).toHaveLength(9);
    expect(receipt.manifestSha).toBe(gate.manifestSha);
    const read = await moderator.request(
      `/api/v1/workspaces/${f.workspaceId}/lot-facets?citySlug=synthetic-6j-city` +
      "&canonicalId=lot-canonical-syn-6j-02&mode=real");
    expect(read.status).toBe(200);
    expect((await read.json() as { market: { askingPrice: string } | null }).market)
      .toMatchObject({ askingPrice: "250000.00" });
    expect((await moderator.request(
      "/api/v1/prospects/zones/synthetic-6j-city/marks")).status).toBe(410);
    expect((await moderator.request("/api/v1/prospects/marks", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lotVersionId: "6a000000-0000-4000-8000-0000000000aa",
        noLot: "SYN-6J-0001", citySlug: "synthetic-6j-city",
        dimension: "pipeline", statut: "favori", authorId: f.moderator.id }) })).status)
      .toBe(410);
    const note = await moderator.request("/api/v1/prospects/notes", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_type: "lot", no_lot: "SYN-6J-0001",
        city_slug: "synthetic-6j-city", body: "still works after cutover",
        authorId: f.moderator.id }) });
    expect(note.status).toBe(201);
    expect((await moderator.request(
      "/api/v1/prospects/contacts/SYN-6J-0001/synthetic-6j-city")).status).toBe(501);
    const status = await moderator.request(base);
    expect((await status.json() as { destinationOpen: boolean }).destinationOpen).toBe(true);
  });
});
