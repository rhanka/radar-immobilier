// B3.4 evidence-backed source-writer coverage on disposable PostgreSQL/PostGIS.
// Synthetic coverage here never records operational qualification.
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { lotSourceWriterCoverage } from "../../../db/schema.js";
import {
  KNOWN_LOT_SOURCE_WRITERS,
  attestLotSourceWriter,
  uncoveredLotSourceWriters,
} from "./lot-source-coverage.js";
import { assertLotSourceWriter } from "./lot-source-serialization.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { cleanCutoverReport, cutoverFixture } from "./cutover-fixture.js";
import { evaluateActivationGate } from "./lot-cutover.js";

const EVIDENCE = {
  "geo/ogc-pull": "synthetic B3 evidence: ogc-pull-source-lock-db stored-identity contention plus races-db source-first and facet-first",
  "geo/populate-geo": "synthetic B3 evidence: populate-geo-source-lock-db update, insert and city-change contention",
  "exploitation/projection": "synthetic B3 evidence: projection-source-lock-db insert, lock wait and scope rejection",
} as const;

describeDb("source writer coverage", () => {
  it("should name exactly the three supported writers", () => {
    expect([...KNOWN_LOT_SOURCE_WRITERS]).toEqual([
      "geo/ogc-pull",
      "geo/populate-geo",
      "exploitation/projection",
    ]);
    expect(() => assertLotSourceWriter("geo/unknown-writer")).toThrow("unknown_lot_source_writer");
  });

  it("should keep writers uncovered when any row is missing or false", async () => {
    const f = await lotFixture();
    expect(await uncoveredLotSourceWriters(f.db)).toEqual([...KNOWN_LOT_SOURCE_WRITERS]);
    await f.db.transaction(async (tx) => {
      await attestLotSourceWriter(tx, "geo/ogc-pull", true, EVIDENCE["geo/ogc-pull"]);
    });
    expect(await uncoveredLotSourceWriters(f.db)).toEqual([
      "geo/populate-geo",
      "exploitation/projection",
    ]);
    await f.db.transaction(async (tx) => {
      await attestLotSourceWriter(tx, "geo/populate-geo", false, EVIDENCE["geo/populate-geo"]);
    });
    expect(await uncoveredLotSourceWriters(f.db)).toEqual([
      "geo/populate-geo",
      "exploitation/projection",
    ]);
  });

  it("should open only with explicit executed-case evidence for all three writers", async () => {
    const f = await lotFixture();
    await f.db.transaction(async (tx) => {
      for (const writer of KNOWN_LOT_SOURCE_WRITERS) {
        await attestLotSourceWriter(tx, writer, true, EVIDENCE[writer]);
      }
    });
    expect(await uncoveredLotSourceWriters(f.db)).toEqual([]);
    await f.db.transaction(async (tx) => {
      await attestLotSourceWriter(tx, "geo/ogc-pull", false, EVIDENCE["geo/ogc-pull"]);
    });
    expect(await uncoveredLotSourceWriters(f.db)).toEqual(["geo/ogc-pull"]);
    await expect(
      f.db.transaction(async (tx) => {
        await attestLotSourceWriter(tx, "geo/ogc-pull", true, "");
      }),
    ).rejects.toThrow("invalid_coverage_reason");
    await expect(
      f.db.transaction(async (tx) => {
        await attestLotSourceWriter(tx, "geo/ogc-pull", true, "   ");
      }),
    ).rejects.toThrow("invalid_coverage_reason");
    await expect(
      f.db.transaction(async (tx) => {
        await attestLotSourceWriter(tx, "geo/ogc-pull", true, "x".repeat(1025));
      }),
    ).rejects.toThrow("invalid_coverage_reason");
  });

  it.each(KNOWN_LOT_SOURCE_WRITERS)(
    "should block activation for %s with missing, false or invalid evidence", async (writer) => {
      const f = await cutoverFixture();
      const { report } = cleanCutoverReport();
      const gate = () => evaluateActivationGate(f.db, f.workspaceId, report);
      expect(await gate()).toMatchObject({ activatable: true, reasons: [] });
      await f.db.delete(lotSourceWriterCoverage).where(eq(lotSourceWriterCoverage.writer, writer));
      const blocked = {
        activatable: false, reasons: ["source_writers_uncovered:" + writer],
      };
      expect(await uncoveredLotSourceWriters(f.db)).toEqual([writer]);
      expect(await gate()).toMatchObject(blocked);
      for (const reason of ["", "   ", "x".repeat(1025)]) {
        await expect(f.db.transaction(async (tx) => {
          await attestLotSourceWriter(tx, writer, true, reason);
        })).rejects.toThrow("invalid_coverage_reason");
        expect(await uncoveredLotSourceWriters(f.db)).toEqual([writer]);
        expect(await gate()).toMatchObject(blocked);
      }
      await f.db.transaction(async (tx) => {
        await attestLotSourceWriter(tx, writer, false, EVIDENCE[writer]);
      });
      expect(await uncoveredLotSourceWriters(f.db)).toEqual([writer]);
      expect(await gate()).toMatchObject(blocked);
      await f.db.transaction(async (tx) => {
        await attestLotSourceWriter(tx, writer, true, EVIDENCE[writer]);
      });
      expect(await f.db.select().from(lotSourceWriterCoverage)
        .where(eq(lotSourceWriterCoverage.writer, writer)))
        .toMatchObject([{ writer, covered: true, reason: EVIDENCE[writer] }]);
      expect(await uncoveredLotSourceWriters(f.db)).toEqual([]);
      expect(await gate()).toMatchObject({ activatable: true, reasons: [] });
    },
  );
});
