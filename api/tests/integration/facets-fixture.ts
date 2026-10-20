import { randomUUID } from "node:crypto";
import type { Database } from "../../src/db/client.js";
import { accountUsers, graphNodes } from "../../src/db/schema.js";
import type { SignalTarget } from "../../src/services/facets/target.js";

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
