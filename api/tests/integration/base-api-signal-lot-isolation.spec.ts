// Signal routes never expose lot streams from a still-closed 6K destination.
// One workspace and one city carry both a signal and lot archives in real
// and simulation modes; while the lot destination stays closed, the signal
// archive, personal-city and coherent-city routes serve signals only.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { graphNodes, lotCutoverState } from "../../src/db/schema.js";
import { targetFingerprint } from "../../src/services/facets/target.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { describeDb, lotFixture } from "../../src/services/facets/lots/lot-fixture.js";
import { displayedFor, lotCommand } from "../../src/services/facets/lots/lot-test-helpers.js";
import { writeLotFacet } from "../../src/services/facets/lots/lot-writer.js";
import type { LotMutation } from "../../src/services/facets/lots/lot-commands.js";
import type { LotMode } from "../../src/services/facets/lots/lot-target.js";

const CITY = "synthetic-6j-city";
const MODES: LotMode[] = ["real", "simulation"];

describeDb("signal routes hide closed-destination lots", () => {
  it("serves signals only on signal routes while 6K stays closed", async () => {
    const f = await lotFixture();
    const [node, visible] = await f.db.insert(graphNodes).values([
      { id: randomUUID(), type: "Signal", citySlug: CITY, label: "Synthetic archived signal" },
      { id: randomUUID(), type: "Signal", citySlug: CITY, label: "Synthetic visible signal" },
    ]).returning();
    const target = { citySlug: CITY, type: "Signal" as const, id: node!.id };
    const fingerprint = targetFingerprint(node!);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "select", basket: "pertinent", target, expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const { target: lot, displayed } = await displayedFor(f);
    for (const mode of MODES) {
      const command = (mutation: LotMutation) =>
        ({ ...lotCommand(lot, displayed, mutation), mode, command_key: randomUUID() });
      await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
        command({ action: "select", basket_id: f.selectionBasket }));
      await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
        command({ action: "discard", reasonCode: "N-NON-RES" }));
      await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "personal",
        command({ action: "discard", reasonCode: "N-NON-RES" }));
    }
    const app = createApp({ checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }), store: {} as ObjectStore,
      db: f.db, discarded: EMPTY_DISCARDED_SIGNALS, auth: baseAuth });
    const get = async (url: string) => app.request(url,
      { headers: { cookie: await baseCookie(f.contributor.sub) } });
    const workspace = `/api/v1/workspaces/${f.workspaceId}`;
    for (const mode of MODES) {
      const heads = await get(`${workspace}/lot-facets/heads?citySlug=${CITY}&mode=${mode}`);
      expect(heads.status).toBe(200);
      const projection = await heads.json() as { heads: Array<{ target: { canonicalId: string } }> };
      expect(projection.heads.map((head) => head.target.canonicalId))
        .toContain(lot.canonicalId);
    }
    await f.db.update(lotCutoverState).set({ destinationOpen: false })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    for (const mode of MODES) {
      const closed = await get(`${workspace}/lot-facets/heads?citySlug=${CITY}&mode=${mode}`);
      expect(closed.status).toBe(503);
    }
    const archive = await get(`${workspace}/signal-facets/archive/cities/${CITY}`);
    expect(archive.status).toBe(200);
    const archived = await archive.json() as { heads: Array<{ target: { type: string; id: string } }> };
    expect(archived.heads.length).toBeGreaterThan(0);
    for (const head of archived.heads) expect(head.target.type).not.toBe("Lot");
    expect(archived.heads.map((head) => head.target.id)).toContain(node!.id);
    const personal = await get(`${workspace}/signal-facets/personal/cities/${CITY}`);
    expect(personal.status).toBe(200);
    const owned = await personal.json() as { heads: Array<{ target: { type: string; id: string } }> };
    expect(owned.heads.length).toBeGreaterThan(0);
    for (const head of owned.heads) expect(head.target.type).not.toBe("Lot");
    expect(owned.heads.map((head) => head.target.id)).toContain(node!.id);
    const coherent = await get(
      `${workspace}/signal-facets/coherent-city?citySlug=${CITY}&mode=signal`);
    expect(coherent.status).toBe(200);
    const city = await coherent.json() as {
      heads: Array<{ target: { type: string; id: string } }>;
      selection: Array<{ target: { type: string; id: string } }>;
      signals: Array<{ id: string }>;
    };
    for (const head of city.heads) expect(head.target.type).not.toBe("Lot");
    for (const head of city.selection) expect(head.target.type).not.toBe("Lot");
    expect(city.heads.map((head) => head.target.id)).toContain(node!.id);
    expect(city.selection.map((head) => head.target.id)).toContain(node!.id);
    expect(city.signals.map((signal) => signal.id)).toEqual([visible!.id]);
  });
});
