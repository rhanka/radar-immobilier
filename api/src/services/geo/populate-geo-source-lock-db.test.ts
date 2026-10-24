// B3.2 populate-geo source-lock contention on disposable PostgreSQL/PostGIS.
// Real upsertLotVersion invocations on synthetic identities; no network fetch.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { lotVersions } from "../../db/schema.js";
import { upsertLotVersion } from "./populate-geo.js";
import { describeDb, lotFixture, type LotFixture } from "../facets/lots/lot-fixture.js";
import { resolveLotSource } from "../facets/lots/lot-target.js";
import { writeLotFacet } from "../facets/lots/lot-writer.js";
import { lotCommand, lotEventCount } from "../facets/lots/lot-test-helpers.js";
import { holdBarrierLock, releaseBarrier } from "../facets/lots/lot-source-writer-fixture.js";

const CITY = "synthetic-pop-city";
const OTHER_CITY = "synthetic-pop-other";
const FETCHED_AT = "2026-01-01T00:00:00.000Z";

function geom(dx: number) {
  const x = -73.55 + dx;
  return { type: "Polygon", coordinates: [[[x, 45.39], [x + 0.01, 45.39], [x + 0.01, 45.4], [x, 45.4], [x, 45.39]]] };
}

async function seed(f: LotFixture, noLot: string, city: string): Promise<string> {
  const id = randomUUID();
  await f.db.insert(lotVersions).values({
    id, canonicalId: `lot-${noLot}`, noLot, citySlug: city, reconStatus: "validated",
    validFrom: "2025-01-01", knownFrom: new Date("2025-01-01T00:00:00.000Z"),
    rawRef: `synthetic-pop-before-${noLot}`,
  });
  return id;
}

async function live(f: LotFixture, noLot: string, city: string) {
  const rows = await f.db.select().from(lotVersions)
    .where(and(eq(lotVersions.noLot, noLot), eq(lotVersions.citySlug, city)));
  return rows.filter((row) => row.knownTo === null);
}

describeDb("populate-geo source locks", () => {
  it.each([
    ["update", "7654321", true, CITY, CITY],
    ["insert", "7654333", false, CITY, CITY],
    ["city change against stored identity", "7654344", true, OTHER_CITY, CITY],
    ["city change against incoming identity", "7654344", true, OTHER_CITY, OTHER_CITY],
  ] as const)("should serialize %s through its mutation transaction", async (_case, noLot, exists, incoming, lockedCity) => {
    const f = await lotFixture();
    const id = exists ? await seed(f, noLot, CITY) : null;
    const barrier = await f.pool.connect();
    const mutationBarrier = await f.pool.connect();
    await holdBarrierLock(barrier, lockedCity, `lot-${noLot}`);
    await mutationBarrier.query("BEGIN");
    await mutationBarrier.query("LOCK TABLE lot_versions IN SHARE MODE");
    const blocker = (await barrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const mutationBlocker = (await mutationBarrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const writing = upsertLotVersion(f.db, incoming, noLot, geom(0.03), FETCHED_AT);
    let writerPid = 0;
    let released = false;
    try {
      await expect.poll(async () => {
        const waiting = await f.pool.query(`SELECT pid FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND $1::int = ANY(pg_blocking_pids(pid))`, [blocker]);
        writerPid = waiting.rows[0]?.pid ?? 0;
        return writerPid;
      }, { message: "writer must wait on the protected source identity" }).toBeGreaterThan(0)
        .catch((error: unknown) => expect.fail(String(error)));
      expect(await live(f, noLot, CITY)).toHaveLength(exists ? 1 : 0);
      if (exists) expect((await live(f, noLot, CITY))[0]!.geom).toBeNull();
      await releaseBarrier(barrier, true);
      released = true;
      await expect.poll(async () => (await f.pool.query(`SELECT pid FROM pg_locks
        WHERE pid = $1 AND locktype = 'advisory' AND granted
          AND $2::int = ANY(pg_blocking_pids(pid))`, [writerPid, mutationBlocker])).rowCount,
      { message: "mutation backend must retain every source lock" }).toBe(incoming === CITY ? 1 : 2)
        .catch((error: unknown) => expect.fail(String(error)));
      expect(await live(f, noLot, CITY)).toHaveLength(exists ? 1 : 0);
      if (exists) expect((await live(f, noLot, CITY))[0]!.geom).toBeNull();
    } finally {
      if (!released) await releaseBarrier(barrier, false);
      await releaseBarrier(mutationBarrier, false);
      await writing;
    }
    expect(await writing).toBe("upserted");
    const rows = await live(f, noLot, incoming);
    expect(rows).toHaveLength(1);
    if (id) expect(rows[0]!.id).toBe(id);
    else expect(rows[0]!.geomSource).toBe("cadastre-allege");
    expect(rows[0]!.canonicalId).toBe(`lot-${noLot}`);
    expect(rows[0]!.geom).not.toBeNull();
    if (incoming !== CITY) expect(await live(f, noLot, CITY)).toHaveLength(0);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND locktype = 'advisory'", [writerPid])).rows[0].n).toBe(0);
  });

  it("should invalidate a stale facet command after a geometry change", async () => {
    const f = await lotFixture();
    await seed(f, "7654355", CITY);
    const target = { type: "Lot" as const, authority: "lot_versions" as const, citySlug: CITY, canonicalId: "lot-7654355" };
    const displayed = (await resolveLotSource(f.db, target)).displayed;
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    expect(first.events).toHaveLength(1);
    expect(await upsertLotVersion(f.db, CITY, "7654355", geom(0.05), FETCHED_AT)).toBe("upserted");
    expect((await live(f, "7654355", CITY))[0]!.id).toBe(displayed.lot_version_id);
    expect((await resolveLotSource(f.db, target)).displayed).not.toEqual(displayed);
    const before = await lotEventCount(f);
    const conflict = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_pipeline", status: "sollicite" }))
      .then(() => { throw new Error("expected target_version_conflict"); }, (error) => error);
    expect(conflict).toMatchObject({ status: 409, message: "target_version_conflict" });
    expect(await lotEventCount(f)).toBe(before);
  });
});
