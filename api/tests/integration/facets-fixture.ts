import { randomUUID } from "node:crypto";
import type { Database } from "../../src/db/client.js";
import { accountUsers, graphNodes } from "../../src/db/schema.js";
import { resolveTarget, type SignalTarget } from "../../src/services/facets/target.js";
import { writeFacet, type FacetCommand } from "../../src/services/facets/writer.js";

export async function facetFixture(db: Database) {
  const sub = randomUUID();
  const [owner] = await db.insert(accountUsers).values({ sub, status: "approved" }).returning();
  const target: SignalTarget = { citySlug: `synthetic-${sub}`, type: "Signal", id: "native-id" };
  await db.insert(graphNodes).values({
    citySlug: target.citySlug, type: target.type, id: target.id,
    label: "Synthetic signal", props: { properties: { usage: "residential" } },
  });
  return { sub, ownerId: owner!.id, target };
}

type DisplayedFacetCommand = Omit<FacetCommand, "displayedFingerprint">;

/** Fill the displayed fingerprint from the current stored node, like the UI capture. */
export async function writeDisplayedFacet(db: Database, sub: string, command: DisplayedFacetCommand) {
  return writeFacet(db, sub, { ...command, displayedFingerprint: await resolveTarget(db, command.target) });
}
