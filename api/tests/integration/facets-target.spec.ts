import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { graphNodes } from "../../src/db/schema.js";
import { resolveTarget } from "../../src/services/facets/target.js";
import { facetFixture } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should resolve only the exact native triple, including designation events", async () => {
  const { target } = await facetFixture(db);
  expect(await resolveTarget(db, target)).toMatch(/^[a-f0-9]{64}$/);
  for (const wrong of [{ ...target, citySlug: "absent-city" }, { ...target, id: "gn-native-id" }, { ...target, type: "DesignationEvent" as const }]) {
    await expect(resolveTarget(db, wrong)).rejects.toMatchObject({ status: 404 });
  }
  const event = { ...target, id: "native-event", type: "DesignationEvent" as const };
  await db.insert(graphNodes).values({ citySlug: event.citySlug, type: event.type, id: event.id, label: "Synthetic designation" });
  expect(await resolveTarget(db, event)).toMatch(/^[a-f0-9]{64}$/);
});
