import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { schema } from "../../src/db/schema.js";
import { loadConfig } from "../../src/config.js";
import { readCityFacets, readReasonCodes } from "../../src/services/facets/reader.js";
import { createDiscardedSignalsReader } from "../../src/services/facets/discarded-reader.js";
import { facetFixture, writeDisplayedFacet as writeFacet } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it.each(["codes", "heads", "discarded"] as const)("should read %s in a read-only transaction", async (kind) => {
  const { sub, target } = await facetFixture(db);
  await writeFacet(db, sub, { action: "discard", target, reasonCode: "N-ADMIN", expectedHeadId: null, commandKey: randomUUID() });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const replica = drizzle(client, { schema });
    if (kind === "codes") expect(await readReasonCodes(replica, sub)).toHaveLength(28);
    if (kind === "heads") expect(await readCityFacets(replica, sub, target.citySlug)).toHaveLength(1);
    if (kind === "discarded") expect((await createDiscardedSignalsReader(replica).forViewer(sub)).size).toBe(1);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
