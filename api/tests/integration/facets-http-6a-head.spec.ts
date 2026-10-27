import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { accountUsers, facetCommands, facetEvents, graphNodes } from "../../src/db/schema.js";
import { digest, resolveTarget } from "../../src/services/facets/target.js";
import { facetFixture } from "./facets-fixture.js";
import { facetCookie, facetHttp } from "./facets-http-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());

async function post(app: ReturnType<typeof facetHttp>, cookie: string,
  action: string, body: unknown, key: string = randomUUID()) {
  const response = await app.request(`/api/v1/signal-facets/${action}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie, "Idempotency-Key": key },
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return response;
}

it("requires explicit head expectations and a displayed fingerprint", async () => {
  const { sub, target } = await facetFixture(db);
  const app = facetHttp(db);
  const cookie = await facetCookie(sub);
  const displayedFingerprint = await resolveTarget(db, target);
  expect((await post(app, cookie, "select", { target, basket: "pertinent" })).status).toBe(400);
  expect((await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null })).status).toBe(400);
  expect((await post(app, cookie, "deselect", { target, basket: "pertinent", expectedHeadId: null,
    displayedFingerprint })).status).toBe(200);
  expect((await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint: "x".repeat(64) })).status,
  ).toBe(400);
  expect((await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint,
      expectedSelectionHeads: { pertinent: null } })).status,
  ).toBe(400);
  expect((await post(app, cookie, "restore", { target })).status).toBe(400);
  expect((await post(app, cookie, "discard", { target, reasonCode: "N-ADMIN", expectedHeadId: null,
    displayedFingerprint })).status).toBe(200);
});

it("discard rejects mismatched selection-head maps", async () => {
  const { sub, target } = await facetFixture(db);
  const app = facetHttp(db);
  const cookie = await facetCookie(sub);
  const displayedFingerprint = await resolveTarget(db, target);
  await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint });
  const selected = await (await post(app, cookie, "select",
    { target, basket: "a_surveiller", expectedHeadId: null, displayedFingerprint },
  )).json() as { event: { id: string } };
  expect((await post(app, cookie, "discard", { target, reasonCode: "N-ADMIN", expectedHeadId: null,
    displayedFingerprint, deselect: ["a_surveiller"] })).status).toBe(400);
  expect((await post(app, cookie, "discard", { target, reasonCode: "N-ADMIN", expectedHeadId: null,
    displayedFingerprint, deselect: ["a_surveiller"],
    expectedSelectionHeads: { pertinent: null } })).status).toBe(400);
  expect((await post(app, cookie, "discard", { target, reasonCode: "N-ADMIN", expectedHeadId: null,
    displayedFingerprint, deselect: ["a_surveiller"],
    expectedSelectionHeads: { a_surveiller: selected.event.id } })).status,
  ).toBe(200);
});

it("returns 409 with the authorized current state on a stale write", async () => {
  const { sub, target } = await facetFixture(db);
  const app = facetHttp(db);
  const cookie = await facetCookie(sub);
  const displayedFingerprint = await resolveTarget(db, target);
  const created = await (await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint },
  )).json() as { event: { id: string } };
  const other = await facetFixture(db);
  expect((await post(app, await facetCookie(other.sub), "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint },
  )).status).toBe(200);
  const conflict = await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint });
  expect(conflict.status).toBe(409);
  const body = await conflict.json() as {
    error: string; current: { target: unknown; version: null; heads: Array<Record<string, unknown>> };
  };
  expect(body.error).toBe("facet_head_conflict");
  expect(body.current.target).toEqual(target);
  expect(body.current.version).toBeNull();
  expect(body.current.heads).toHaveLength(1);
  expect(body.current.heads[0]).toMatchObject({
    id: created.event.id, target, facet: "selection", basket: "pertinent", state: "active",
  });
  expect(body.current.heads[0]).not.toHaveProperty("ownerId");
  expect(body.current.heads[0]).not.toHaveProperty("actorId");
  expect(body.current.heads[0]).not.toHaveProperty("commandDigest");
  const key = randomUUID();
  await post(app, cookie, "deselect",
    { target, basket: "pertinent", expectedHeadId: created.event.id, displayedFingerprint }, key);
  const replayed = await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint }, key);
  expect(replayed.status).toBe(409);
  expect(await replayed.json()).toMatchObject({ error: "idempotency_key_conflict" });
});

it("recovers only exact authorized historical receipts, even after source deletion", async () => {
  const { sub, ownerId, target } = await facetFixture(db);
  const app = facetHttp(db);
  const cookie = await facetCookie(sub);
  const key = randomUUID();
  const body = { target, basket: "pertinent" };
  // Frozen pre-6A contract; no version or head expectations in its digest.
  const commandDigest = digest({ action: "select", target, basket: "pertinent", reasonCode: null, deselect: [] });
  const [event] = await db.insert(facetEvents).values({
    ownerId, actorId: ownerId, citySlug: target.citySlug, nodeType: target.type, nodeId: target.id,
    facet: "selection", basket: "pertinent", state: "active", observedFingerprint: "0".repeat(64),
    commandKey: key, commandDigest,
  }).returning();
  await db.insert(facetCommands).values({ ownerId, commandKey: key, commandDigest,
    result: { event: { ...event, createdAt: event!.createdAt.toISOString() } } });
  await db.delete(graphNodes).where(eq(graphNodes.citySlug, target.citySlug));
  const recovered = await post(app, cookie, "select", body, key.toUpperCase());
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toMatchObject({ event: { id: event!.id, target } });
  expect((await post(app, cookie, "select", body)).status).toBe(400);
  expect((await post(app, cookie, "select", { ...body, reasonCode: "P-DENSITE" }, key)).status).toBe(409);
  const other = await facetFixture(db);
  expect((await post(app, await facetCookie(other.sub), "select", body, key)).status).toBe(400);
  await db.update(accountUsers).set({ status: "suspended" }).where(eq(accountUsers.id, ownerId));
  expect((await post(app, cookie, "select", body, key)).status).toBe(403);
  expect(await db.select().from(facetCommands).where(eq(facetCommands.ownerId, ownerId))).toHaveLength(1);
});

it("keeps historical null receipts reserved without inventing their context", async () => {
  const { sub, ownerId, target } = await facetFixture(db);
  const app = facetHttp(db);
  const cookie = await facetCookie(sub);
  const displayedFingerprint = await resolveTarget(db, target);
  const key = randomUUID();
  await db.insert(facetCommands).values({ ownerId, commandKey: key,
    commandDigest: digest({ action: "restore", target, basket: null, reasonCode: null, deselect: [] }),
    result: { event: null } });
  for (const body of [{ target }, { target, expectedHeadId: null, displayedFingerprint }]) {
    const response = await post(app, cookie, "restore", body, key);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "command_context_unresolved" });
  }
  const missingFingerprint = await post(app, cookie, "restore",
    { target, expectedHeadId: null }, key);
  expect(missingFingerprint.status).toBe(409);
  expect(await missingFingerprint.json()).toEqual({ error: "command_context_unresolved" });
  expect(await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId))).toHaveLength(0);
  expect(await db.select().from(facetCommands).where(eq(facetCommands.ownerId, ownerId))).toHaveLength(1);
});
