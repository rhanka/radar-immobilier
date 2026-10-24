// B3.1 OGC source-lock contention on disposable PostgreSQL/PostGIS.
// Real upsertLotBatch invocations on synthetic identities; no network fetch.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { lotVersions } from "../../db/schema.js";
import { upsertLotBatch, type OgcFeature } from "./ogc-pull.js";
import { describeDb, lotFixture, type LotFixture } from "../facets/lots/lot-fixture.js";
import { resolveLotSource } from "../facets/lots/lot-target.js";
import { writeLotFacet } from "../facets/lots/lot-writer.js";
import { lotCommand, lotEventCount } from "../facets/lots/lot-test-helpers.js";
import { holdBarrierLock, releaseBarrier } from "../facets/lots/lot-source-writer-fixture.js";

const CITY = "synthetic-ogc-city";

function polygonFeature(noLot: string): OgcFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[-73.55, 45.39], [-73.54, 45.39], [-73.54, 45.4], [-73.55, 45.4], [-73.55, 45.39]]],
    },
    properties: { NO_LOT: noLot },
  };
}

function evidenceFeature(noLot: string): OgcFeature {
  return { type: "Feature", geometry: null, properties: { NO_LOT: noLot } };
}

async function seedOgcLot(f: LotFixture, noLot: string, canonicalId: string): Promise<string> {
  const id = randomUUID();
  await f.db.insert(lotVersions).values({
    id, canonicalId, noLot, citySlug: CITY, reconStatus: "validated",
    validFrom: "2025-01-01", knownFrom: new Date("2025-01-01T00:00:00.000Z"),
    rawRef: `synthetic-ogc-before-${noLot}`,
  });
  return id;
}

async function storedByNoLot(f: LotFixture, noLot: string) {
  const rows = await f.db.select().from(lotVersions).where(and(
    eq(lotVersions.citySlug, CITY), eq(lotVersions.noLot, noLot)));
  return rows.filter((row) => row.knownTo === null);
}

describeDb("ogc-pull source locks", () => {
  it("should contend on the stored mismatched identity through mutation", async () => {
    const f = await lotFixture();
    const id = await seedOgcLot(f, "4516943", "ogc:lots:legacy:4516943");
    const barrier = await f.pool.connect();
    const rowBarrier = await f.pool.connect();
    let released = false;
    await holdBarrierLock(barrier, CITY, "ogc:lots:legacy:4516943");
    await rowBarrier.query("BEGIN");
    await rowBarrier.query("SELECT id FROM lot_versions WHERE id = $1 FOR UPDATE", [id]);
    const blocker = (await barrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const rowBlocker = (await rowBarrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const writing = upsertLotBatch(f.db, f.pool, CITY, [polygonFeature("4516943")]);
    let writerPid = 0;
    try {
      await expect.poll(async () => {
        const waiting = await f.pool.query(`SELECT pid FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND $1::int = ANY(pg_blocking_pids(pid))`, [blocker]);
        writerPid = waiting.rows[0]?.pid ?? 0;
        return writerPid;
      }).toBeGreaterThan(0).catch((error: unknown) => expect.fail(String(error)));
      expect((await storedByNoLot(f, "4516943"))[0]!.geom).toBeNull();
      expect(await upsertLotBatch(f.db, f.pool, CITY, [polygonFeature("9999999")]))
        .toEqual({ upserted: 1, skipped: 0 });
      expect(await storedByNoLot(f, "9999999")).toHaveLength(1);
      await releaseBarrier(barrier, true);
      released = true;
      await expect.poll(async () => (await f.pool.query(`SELECT pid FROM pg_locks
        WHERE pid = $1 AND locktype = 'advisory' AND granted
          AND $2::int = ANY(pg_blocking_pids(pid))`, [writerPid, rowBlocker])).rowCount)
        .toBe(1).catch((error: unknown) => expect.fail(String(error)));
      expect((await storedByNoLot(f, "4516943"))[0]!.geom).toBeNull();
    } finally {
      if (!released) await releaseBarrier(barrier, false);
      await releaseBarrier(rowBarrier, false);
      await writing;
    }
    expect(await writing).toEqual({ upserted: 1, skipped: 0 });
    const rows = await storedByNoLot(f, "4516943");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.canonicalId).toBe("ogc:lots:legacy:4516943");
    expect(rows[0]!.geomSource).toBe("ogc-api");
    expect(rows[0]!.geom).not.toBeNull();
  });

  it("should invalidate a stale facet command after an evidence-only change", async () => {
    const f = await lotFixture();
    const id = await seedOgcLot(f, "7654321", "ogc:lots:legacy:7654321");
    const target = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: CITY, canonicalId: "ogc:lots:legacy:7654321" };
    const displayed = (await resolveLotSource(f.db, target)).displayed;
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    expect(first.events).toHaveLength(1);
    const result = await upsertLotBatch(f.db, f.pool, CITY, [evidenceFeature("7654321")]);
    expect(result).toEqual({ upserted: 1, skipped: 0 });
    expect((await storedByNoLot(f, "7654321"))[0]!.id).toBe(id);
    expect((await resolveLotSource(f.db, target)).displayed).not.toEqual(displayed);
    const before = await lotEventCount(f);
    const conflict = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_pipeline", status: "sollicite" }))
      .then(() => { throw new Error("expected target_version_conflict"); }, (error) => error);
    expect(conflict).toMatchObject({ status: 409, message: "target_version_conflict" });
    expect(await lotEventCount(f)).toBe(before);
  });

  it("should roll back the whole batch when a later insert conflicts", async () => {
    const f = await lotFixture();
    await seedOgcLot(f, "BLOCKED-2222222", `ogc:lots:${CITY}:2222222`);
    await expect(upsertLotBatch(f.db, f.pool, CITY,
      [polygonFeature("1111111"), polygonFeature("2222222")])).rejects.toMatchObject({ code: "23P01" });
    expect(await storedByNoLot(f, "1111111")).toHaveLength(0);
    const retry = await upsertLotBatch(f.db, f.pool, CITY, [polygonFeature("1111111")]);
    expect(retry).toEqual({ upserted: 1, skipped: 0 });
    expect(await storedByNoLot(f, "1111111")).toHaveLength(1);
  });
});
