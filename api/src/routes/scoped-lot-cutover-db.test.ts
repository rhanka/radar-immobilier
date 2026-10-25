/**
 * 6K cutover HTTP contract: closed-gate status and barrier fencing.
 *
 * While the gate is closed, legacy mark readers and writers keep their
 * established behavior. Behind a committed barrier they answer 503;
 * notes are never fenced. Synthetic data; disposable databases.
 */
import { expect, it } from "vitest";
import { lotCutoverState } from "../db/schema.js";
import { describeDb, cutoverFixture } from "../services/facets/lots/cutover-fixture.js";
import {
  MAPPING,
  makeCutoverApp,
  seedLegacyChain,
} from "./scoped-lot-cutover-harness.js";

describeDb("6K cutover HTTP status and barrier", () => {
  it("should gate reads on session and report a closed gate before activation", async () => {
    const f = await cutoverFixture();
    const anon = makeCutoverApp(f, null);
    expect((await anon.request(
      `/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`)).status).toBe(401);
    const outsider = makeCutoverApp(f, { sub: f.outsider.sub });
    expect((await outsider.request(
      `/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`)).status).toBe(403);
    const member = makeCutoverApp(f, { sub: f.contributor.sub });
    const closed = await member.request(`/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`);
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ ok: true,
      maintenanceBarrier: false, destinationOpen: false,
      unavailable: [], pending: [] });
    const bearer = makeCutoverApp(f, { sub: f.contributor.sub, via: "bearer" });
    expect((await bearer.request(`/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`,
      { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapping: MAPPING }) })).status).toBe(403);
  });

  it("should fence legacy traffic with 503 while a barrier is committed", async () => {
    const f = await cutoverFixture();
    await seedLegacyChain(f, f.moderator.id);
    await f.db.insert(lotCutoverState)
      .values({ workspaceId: f.workspaceId, maintenanceBarrier: true });
    const moderator = makeCutoverApp(f, { sub: f.moderator.sub });
    expect((await moderator.request(
      "/api/v1/prospects/zones/synthetic-6j-city/marks")).status).toBe(503);
    expect((await moderator.request("/api/v1/prospects/marks/batch", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lotVersionIds: ["6a000000-0000-4000-8000-0000000000aa"],
        lotMeta: { "6a000000-0000-4000-8000-0000000000aa":
          { noLot: "SYN-6J-0001", citySlug: "synthetic-6j-city" } },
        dimension: "pipeline", statut: "favori", authorId: f.moderator.id }) })).status)
      .toBe(503);
    const note = await moderator.request("/api/v1/prospects/notes?target_type=lot", {
      headers: { "content-type": "application/json" } });
    expect(note.status).toBe(400);
  });
});
