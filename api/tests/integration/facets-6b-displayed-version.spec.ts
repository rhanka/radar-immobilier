import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb, type Database } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { facetCommands, facetEvents } from "../../src/db/schema.js";
import { graphSignalsRoute } from "../../src/routes/graph-signals.js";
import { protect } from "../../src/routes/auth.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { createDiscardedSignalsReader } from "../../src/services/facets/discarded-reader.js";
import { readCityFacets } from "../../src/services/facets/reader.js";
import { digest, resolveTarget } from "../../src/services/facets/target.js";
import { writeFacet } from "../../src/services/facets/writer.js";
import { upsertGraphAtomic } from "../../src/services/graph/graph-store.js";
import { facetFixture } from "./facets-fixture.js";
import { facetAuth, facetCookie, facetHttp } from "./facets-http-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());

async function refresh(target: { citySlug: string; type: string; id: string }, label: string) {
  const result = await upsertGraphAtomic(db, target.citySlug, {
    nodes: [{ id: target.id, type: target.type, label, properties: { usage: "residential" } }],
    edges: [],
  }, new Set());
  expect(result.aborted).toBe(false);
}

async function removeNode(target: { citySlug: string; type: string; id: string }) {
  const result = await upsertGraphAtomic(db, target.citySlug, {
    nodes: [{ id: "keep-id", type: "Signal", label: "Keep signal",
      properties: { usage: "residential" } }],
    edges: [],
  }, new Set([target.id]));
  expect(result.aborted).toBe(false);
}

async function post(app: ReturnType<typeof facetHttp>, cookie: string,
  action: string, body: unknown, key: string = randomUUID()) {
  return app.request(`/api/v1/signal-facets/${action}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie, "Idempotency-Key": key },
  });
}

it("conflicts without mutation when the stored content changed since display", async () => {
  const { sub, ownerId, target } = await facetFixture(db);
  const shown = await resolveTarget(db, target);
  await refresh(target, "Changed synthetic content");
  const current = await resolveTarget(db, target);
  expect(current).not.toBe(shown);
  const failure = await writeFacet(db, sub, { action: "select", target, basket: "pertinent",
    expectedHeadId: null, displayedFingerprint: shown, commandKey: randomUUID() },
  ).catch((error: unknown) => error);
  expect(failure).toMatchObject({ status: 409, message: "target_version_conflict" });
  const disclosed = (failure as { current: {
    target: unknown; version: { fingerprint: string } | null; heads: unknown[];
  } }).current;
  expect(disclosed.target).toEqual(target);
  expect(disclosed.version).toEqual({ fingerprint: current });
  expect(disclosed.heads).toEqual([]);
  expect(await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId))).toHaveLength(0);
  expect(await db.select().from(facetCommands).where(eq(facetCommands.ownerId, ownerId))).toHaveLength(0);
});

it("succeeds when the displayed version matches and stores the verified fingerprint", async () => {
  const { sub, target } = await facetFixture(db);
  const shown = await resolveTarget(db, target);
  const event = await writeFacet(db, sub, { action: "select", target, basket: "pertinent",
    expectedHeadId: null, displayedFingerprint: shown, commandKey: randomUUID() });
  expect(event?.state).toBe("active");
  expect(event?.observedFingerprint).toBe(shown);
});

it("ignores community-only changes when comparing the displayed version", async () => {
  const { sub, target } = await facetFixture(db);
  const shown = await resolveTarget(db, target);
  const result = await upsertGraphAtomic(db, target.citySlug, {
    nodes: [{ id: target.id, type: target.type, label: "Synthetic signal",
      community: 7, community_name: "Synthetic community",
      properties: { usage: "residential" } }],
    edges: [],
  }, new Set());
  expect(result.aborted).toBe(false);
  expect(await resolveTarget(db, target)).toBe(shown);
  const event = await writeFacet(db, sub, { action: "discard", target, reasonCode: "N-ADMIN",
    expectedHeadId: null, displayedFingerprint: shown, commandKey: randomUUID() });
  expect(event?.state).toBe("active");
});

it("rejects missing or malformed displayed fingerprints", async () => {
  const { sub, target } = await facetFixture(db);
  const app = facetHttp(db);
  const cookie = await facetCookie(sub);
  const shown = await resolveTarget(db, target);
  expect((await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null })).status).toBe(400);
  expect((await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint: "0".repeat(63) },
  )).status).toBe(400);
  expect((await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint: `${shown}\n` },
  )).status).toBe(400);
  await expect(writeFacet(db, sub, { action: "select", target, basket: "pertinent",
    expectedHeadId: null, displayedFingerprint: "not-a-fingerprint", commandKey: randomUUID() },
  )).rejects.toMatchObject({ status: 400 });
  expect((await post(app, cookie, "select",
    { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint: shown },
  )).status).toBe(200);
});

it("answers a stale displayed version with the current fingerprint over HTTP", async () => {
  const { sub, ownerId, target } = await facetFixture(db);
  const app = facetHttp(db);
  const cookie = await facetCookie(sub);
  const shown = await resolveTarget(db, target);
  await refresh(target, "Changed synthetic content");
  const current = await resolveTarget(db, target);
  const conflict = await post(app, cookie, "discard",
    { target, reasonCode: "N-ADMIN", expectedHeadId: null, displayedFingerprint: shown });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: "target_version_conflict",
    current: { target, version: { fingerprint: current }, heads: [] } });
  expect(await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId))).toHaveLength(0);
});
