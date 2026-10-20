import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { createDiscardedSignalsReader } from "../../src/services/facets/discarded-reader.js";
import { writeFacet } from "../../src/services/facets/writer.js";
import { discardedSignalKey } from "../../src/services/graph/discarded-signals.js";
import { facetFixture } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should read only the viewer's active personal archives using native keys", async () => {
  const alice = await facetFixture(db);
  const bob = await facetFixture(db);
  const reader = createDiscardedSignalsReader(db);
  expect((await reader.forViewer(null)).size).toBe(0);
  expect((await reader.forViewer(alice.sub)).size).toBe(0);
  await writeFacet(db, alice.sub, { action: "select", target: alice.target, basket: "pertinent", commandKey: randomUUID() });
  expect((await reader.forViewer(alice.sub)).size).toBe(0);
  await writeFacet(db, alice.sub, { action: "discard", target: alice.target, reasonCode: "N-ADMIN", commandKey: randomUUID() });
  expect(await reader.forViewer(alice.sub)).toEqual(new Set([discardedSignalKey(alice.target.citySlug, alice.target.type, alice.target.id)]));
  expect((await reader.forViewer(bob.sub)).size).toBe(0);
  await writeFacet(db, alice.sub, { action: "restore", target: alice.target, commandKey: randomUUID() });
  expect((await reader.forViewer(alice.sub)).size).toBe(0);
  await expect(reader.forViewer("missing-account")).rejects.toMatchObject({ status: 403 });
});
