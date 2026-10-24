// B3.4 real source/facet transactions, deterministic order and SQL barriers.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { lotVersions } from "../../../db/schema.js";
import { upsertLotBatch, type OgcFeature } from "../../geo/ogc-pull.js";
import { upsertLotVersion } from "../../geo/populate-geo.js";
import { describeDb, lotFixture, type LotFixture } from "./lot-fixture.js";
import { resolveLotSource } from "./lot-target.js";
import { writeLotFacet } from "./lot-writer.js";
import { writeLotBatch } from "./lot-batch.js";
import { lotCommand, lotEventCount } from "./lot-test-helpers.js";
import { holdBarrierLock, releaseBarrier } from "./lot-source-writer-fixture.js";
import { lotSourceLockKey } from "./lot-source-serialization.js";

const CITY = "synthetic-race-city";
const NO_LOTS = ["9910001", "9910002"];
const canonical = (noLot: string) => `ogc:lots:${CITY}:${noLot}`;
const targetFor = (noLot: string) => ({ type: "Lot" as const,
  authority: "lot_versions" as const, citySlug: CITY, canonicalId: canonical(noLot) });
function polygon(noLot: string): OgcFeature {
  return { type: "Feature", properties: { NO_LOT: noLot }, geometry: {
    type: "Polygon", coordinates: [[[-73.55, 45.39], [-73.54, 45.39], [-73.54, 45.4], [-73.55, 45.39]]],
  } };
}

async function waitingPid(f: LotFixture, blocker: number, type = "advisory"): Promise<number> {
  const result = await f.pool.query(`SELECT DISTINCT pid FROM pg_locks
    WHERE locktype = $2 AND NOT granted AND $1::int = ANY(pg_blocking_pids(pid))`, [blocker, type]);
  return result.rows[0]?.pid ?? 0;
}
async function sourceLockCount(f: LotFixture, pid: number): Promise<number> {
  const keys = NO_LOTS.map((noLot) => lotSourceLockKey(CITY, canonical(noLot)));
  const result = await f.pool.query(`SELECT count(*)::int AS n FROM pg_locks
    WHERE pid = $1 AND locktype = 'advisory' AND granted AND objsubid = 1
      AND EXISTS (SELECT 1 FROM unnest($2::text[]) AS k(value)
        WHERE classid::bigint = ((hashtextextended(k.value, 0) >> 32) & 4294967295)
          AND objid::bigint = (hashtextextended(k.value, 0) & 4294967295))`, [pid, keys]);
  return result.rows[0].n;
}

describeDb("source lock order and facet races", () => {
  it.each([["source", 1], ["facet", 1], ["source", 2], ["facet", 2]] as const)(
    "should serialize %s-first with %i targets in canonical lock order", async (firstWriter, count) => {
    const f = await lotFixture();
    const noLots = NO_LOTS.slice(0, count);
    for (const noLot of noLots) {
      await f.db.insert(lotVersions).values({ id: randomUUID(), canonicalId: canonical(noLot),
        noLot, citySlug: CITY, reconStatus: "validated", validFrom: "2025-01-01",
        knownFrom: new Date("2025-01-01T00:00:00.000Z"), rawRef: `synthetic-race-before-${noLot}` });
    }
    const shown = await Promise.all(noLots.map(async (noLot) => {
      const target = targetFor(noLot);
      return { target, displayed: (await resolveLotSource(f.db, target)).displayed };
    }));
    const sourceFirst = firstWriter === "source";
    // The leader always receives descending inputs; the follower receives ascending inputs.
    const source = () => upsertLotBatch(f.db, f.pool, CITY,
      (sourceFirst ? [...noLots].reverse() : noLots).map(polygon));
    const facet = () => count === 1
      ? writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
        lotCommand(shown[0]!.target, shown[0]!.displayed, { action: "set_pipeline", status: "sollicite" }))
      : writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", {
        contract_version: "lot-facets-v1", command_key: randomUUID(), mode: "real",
        items: (sourceFirst ? shown : [...shown].reverse()).map(({ target, displayed }) => ({
          target, displayed_version: displayed, expected_head_id: null,
          mutation: { action: "set_pipeline", status: "sollicite" },
        })),
      });
    const orderBarrier = await f.pool.connect();
    const mutationBarrier = await f.pool.connect();
    await holdBarrierLock(orderBarrier, CITY, canonical(noLots[count - 1]!));
    await mutationBarrier.query("BEGIN");
    await mutationBarrier.query(sourceFirst
      ? "LOCK TABLE lot_versions IN SHARE MODE" : "LOCK TABLE facet_events IN SHARE MODE");
    const orderPid = (await orderBarrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const mutationPid = (await mutationBarrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const leading = Promise.allSettled([sourceFirst ? source() : facet()]);
    let trailing: Promise<PromiseSettledResult<unknown>[]> = Promise.resolve([]);
    let results: PromiseSettledResult<unknown>[] = [];
    let leaderPid = 0;
    let followerPid = 0;
    let orderReleased = false;
    try {
      await expect.poll(async () => (leaderPid = await waitingPid(f, orderPid)),
        { message: "leader must wait on the final canonical source lock" }).toBeGreaterThan(0);
      expect(await sourceLockCount(f, leaderPid), "ascending acquisition must hold the earlier identity").toBe(count - 1);
      await releaseBarrier(orderBarrier, true);
      orderReleased = true;
      await expect.poll(() => waitingPid(f, mutationPid, "relation"),
        { message: "same backend must reach DML with all canonical locks retained" }).toBe(leaderPid);
      expect(await sourceLockCount(f, leaderPid)).toBe(count);
      trailing = Promise.allSettled([sourceFirst ? facet() : source()]);
      await expect.poll(async () => (followerPid = await waitingPid(f, leaderPid)),
        { message: "the other real writer must contend on the leader transaction" }).toBeGreaterThan(0);
      expect(followerPid).not.toBe(leaderPid);
      expect(await sourceLockCount(f, followerPid)).toBe(0);
      expect(await lotEventCount(f)).toBe(0);
      expect((await f.pool.query("SELECT geom FROM lot_versions WHERE city_slug = $1", [CITY])).rows)
        .toEqual(noLots.map(() => ({ geom: null })));
    } finally {
      if (!orderReleased) await releaseBarrier(orderBarrier, false);
      await releaseBarrier(mutationBarrier, false);
      results = [...await leading, ...await trailing];
    }
    const sourceResult = results[sourceFirst ? 0 : 1];
    const facetResult = results[sourceFirst ? 1 : 0];
    expect(sourceResult).toEqual({ status: "fulfilled", value: { upserted: count, skipped: 0 } });
    if (sourceFirst) {
      expect(facetResult).toMatchObject({ status: "rejected",
        reason: { status: 409, message: "target_version_conflict" } });
    } else {
      expect(facetResult).toMatchObject({ status: "fulfilled",
        value: count === 1 ? { events: [expect.anything()] } : { targets: 2, eventsAppended: 2 } });
    }
    const expectedEvents = sourceFirst ? 0 : count;
    expect(await lotEventCount(f)).toBe(expectedEvents);
    for (const { target, displayed } of shown) {
      const current = (await resolveLotSource(f.db, target)).displayed;
      expect(current.lot_version_id).toBe(displayed.lot_version_id);
      expect(current.fingerprint).not.toBe(displayed.fingerprint);
    }
    expect((await f.pool.query(`SELECT geom_source, geom IS NOT NULL AS has_geom
      FROM lot_versions WHERE city_slug = $1`, [CITY])).rows)
      .toEqual(noLots.map(() => ({ geom_source: "ogc-api", has_geom: true })));
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(shown[0]!.target, shown[0]!.displayed, { action: "set_pipeline", status: "sollicite" })))
      .rejects.toMatchObject({ status: 409, message: "target_version_conflict" });
    expect(await lotEventCount(f)).toBe(expectedEvents);
    expect(await sourceLockCount(f, leaderPid)).toBe(0);
    expect(await sourceLockCount(f, followerPid)).toBe(0);
  });
});

const POP_RACE_CITY = "synthetic-pop-race-city";
const POP_RACE_NO_LOT = "8810001";
const POP_RACE_CANONICAL = `lot-${POP_RACE_NO_LOT}`;
const POP_RACE_FETCHED_AT = "2026-01-01T00:00:00.000Z";

function popRaceGeom() {
  return { type: "Polygon", coordinates: [[[-73.55, 45.39], [-73.54, 45.39], [-73.54, 45.4], [-73.55, 45.39]]] };
}

async function popRaceLockCount(f: LotFixture, pid: number): Promise<number> {
  const result = await f.pool.query(`SELECT count(*)::int AS n FROM pg_locks
    WHERE pid = $1 AND locktype = 'advisory' AND granted AND objsubid = 1
      AND classid::bigint = ((hashtextextended($2, 0) >> 32) & 4294967295)
      AND objid::bigint = (hashtextextended($2, 0) & 4294967295)`,
    [pid, lotSourceLockKey(POP_RACE_CITY, POP_RACE_CANONICAL)]);
  return result.rows[0].n;
}

describeDb("populate source and facet races", () => {
  it.each([["source", "single"], ["facet", "single"], ["source", "batch"], ["facet", "batch"]] as const)(
    "should serialize populate %s-first with %s facet commands", async (firstWriter, commandKind) => {
      const f = await lotFixture();
      const target = { type: "Lot" as const, authority: "lot_versions" as const,
        citySlug: POP_RACE_CITY, canonicalId: POP_RACE_CANONICAL };
      const seedId = randomUUID();
      await f.db.insert(lotVersions).values({ id: seedId, canonicalId: POP_RACE_CANONICAL,
        noLot: POP_RACE_NO_LOT, citySlug: POP_RACE_CITY, reconStatus: "validated",
        validFrom: "2025-01-01", knownFrom: new Date("2025-01-01T00:00:00.000Z"),
        rawRef: `synthetic-pop-race-before-${POP_RACE_NO_LOT}` });
      const displayed = (await resolveLotSource(f.db, target)).displayed;
      expect(displayed.lot_version_id).toBe(seedId);
      const sourceFirst = firstWriter === "source";
      const source = () => upsertLotVersion(f.db, POP_RACE_CITY, POP_RACE_NO_LOT, popRaceGeom(), POP_RACE_FETCHED_AT);
      const facet = () => commandKind === "single"
        ? writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
          lotCommand(target, displayed, { action: "set_pipeline", status: "sollicite" }))
        : writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", {
          contract_version: "lot-facets-v1", command_key: randomUUID(), mode: "real",
          items: [{ target, displayed_version: displayed, expected_head_id: null,
            mutation: { action: "set_pipeline", status: "sollicite" } }],
        });
      const orderBarrier = await f.pool.connect();
      const mutationBarrier = await f.pool.connect();
      await holdBarrierLock(orderBarrier, POP_RACE_CITY, POP_RACE_CANONICAL);
      await mutationBarrier.query("BEGIN");
      await mutationBarrier.query(sourceFirst
        ? "LOCK TABLE lot_versions IN SHARE MODE" : "LOCK TABLE facet_events IN SHARE MODE");
      const orderPid = (await orderBarrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const mutationPid = (await mutationBarrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const leading = Promise.allSettled([sourceFirst ? source() : facet()]);
      let trailing: Promise<PromiseSettledResult<unknown>[]> = Promise.resolve([]);
      let results: PromiseSettledResult<unknown>[] = [];
      let leaderPid = 0;
      let followerPid = 0;
      let orderReleased = false;
      try {
        await expect.poll(async () => (leaderPid = await waitingPid(f, orderPid)),
          { message: "populate leader must wait on the canonical source lock" }).toBeGreaterThan(0)
          .catch((error: unknown) => expect.fail(String(error)));
        expect(await popRaceLockCount(f, leaderPid)).toBe(0);
        await releaseBarrier(orderBarrier, true);
        orderReleased = true;
        await expect.poll(() => waitingPid(f, mutationPid, "relation"),
          { message: "populate leader must retain its lock into DML" }).toBe(leaderPid);
        expect(await popRaceLockCount(f, leaderPid)).toBe(1);
        trailing = Promise.allSettled([sourceFirst ? facet() : source()]);
        await expect.poll(async () => (followerPid = await waitingPid(f, leaderPid)),
          { message: "the other real writer must contend on the populate leader" }).toBeGreaterThan(0)
          .catch((error: unknown) => expect.fail(String(error)));
        expect(followerPid).not.toBe(leaderPid);
        expect(await popRaceLockCount(f, followerPid)).toBe(0);
        expect(await lotEventCount(f)).toBe(0);
        expect((await f.pool.query("SELECT geom FROM lot_versions WHERE id = $1", [seedId])).rows)
          .toEqual([{ geom: null }]);
      } finally {
        if (!orderReleased) await releaseBarrier(orderBarrier, false);
        await releaseBarrier(mutationBarrier, false);
        results = [...await leading, ...await trailing];
      }
      const sourceResult = results[sourceFirst ? 0 : 1];
      const facetResult = results[sourceFirst ? 1 : 0];
      expect(sourceResult).toEqual({ status: "fulfilled", value: "upserted" });
      if (sourceFirst) {
        expect(facetResult).toMatchObject({ status: "rejected",
          reason: { status: 409, message: "target_version_conflict" } });
      } else {
        expect(facetResult).toMatchObject({ status: "fulfilled",
          value: commandKind === "single" ? { events: [expect.anything()] } : { targets: 1, eventsAppended: 1 } });
      }
      expect(await lotEventCount(f)).toBe(sourceFirst ? 0 : 1);
      const current = (await resolveLotSource(f.db, target)).displayed;
      expect(current.lot_version_id).toBe(seedId);
      expect(current.fingerprint).not.toBe(displayed.fingerprint);
      expect((await f.pool.query("SELECT geom IS NOT NULL AS has_geom FROM lot_versions WHERE id = $1",
        [seedId])).rows).toEqual([{ has_geom: true }]);
      expect(await popRaceLockCount(f, leaderPid)).toBe(0);
      expect(await popRaceLockCount(f, followerPid)).toBe(0);
    });
});

