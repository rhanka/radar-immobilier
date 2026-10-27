import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { facetEventBindings, facetEvents, facetHeads, facetStreams } from "../../../db/schema.js";
import { writeLotFacet } from "./lot-writer.js";
import { displayedFor, lotCommand } from "./lot-test-helpers.js";
import { describeDb, lotFixture } from "./lot-fixture.js";

describeDb("6J stream mode identity", () => {
  it("should reject cross-mode bindings and stream mode changes", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    const [event] = await f.db.select().from(facetEvents);
    const [stream] = await f.db.select().from(facetStreams);
    await expect(f.db.transaction(async (tx) => {
      const id = randomUUID();
      await tx.update(facetEvents).set({ supersededBy: id }).where(eq(facetEvents.id, event!.id));
      await tx.insert(facetEvents).values({ ...event!, id, mode: "simulation", supersedes: event!.id });
      await tx.insert(facetEventBindings).values({ eventId: id, streamId: stream!.id });
      await tx.update(facetHeads).set({ eventId: id }).where(eq(facetHeads.streamId, stream!.id));
    })).rejects.toMatchObject({ cause: { message: "lot stream mode mismatch" } });
    await expect(f.pool.query("UPDATE facet_streams SET mode = 'simulation'"))
      .rejects.toThrow("facet event bindings are immutable");
  });
});
