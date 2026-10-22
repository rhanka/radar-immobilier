/**
 * 6K cutover fixtures: disposable synthetic databases and manifests.
 *
 * Builds on the 6J lot fixture (moderator, contributor, outsider, two
 * workspaces, scoped signal epoch, enabled lot destination, seeded lot
 * versions, distinct D4 rights) and additionally attests every supported
 * `lot_versions` writer as covered, which simulates the explicit
 * deployment qualification the activation gate requires. Every
 * identifier, city, lot number, price, and URL is invented; no
 * operational data is read or written.
 */
import { buildLotMigrationReport } from "../lot-migration-report/report.js";
import type { LotMigrationReport } from "../lot-migration-report/manifest.js";
import {
  syntheticInput,
} from "../lot-migration-report/fixtures.js";
import { lotVersions } from "../../../db/schema.js";
import {
  attestLotSourceWriter,
  KNOWN_LOT_SOURCE_WRITERS,
} from "./lot-source-coverage.js";
import { cutoverTargetKey } from "./lot-project.js";
import {
  describeDb,
  lotFixture,
  type LotFixture,
} from "./lot-fixture.js";
import { LOT_6J_AA, LOT_6J_BB, lot6jMarks, lot6jVersions } from "./lot-import-input.js";

export { describeDb };
export type { LotFixture };

/** 6K-qualified fixture: 6J lot state plus covered source writers. */
export type CutoverFixture = LotFixture;

/** Third seeded lot version carrying the converged 6K conflict pair. */
export const LOT_6K_CC = "6c000000-0000-4000-8000-0000000000cc";

/**
 * Build a 6K-qualified fixture. Seeds a third validated lot version and
 * attests every known `lot_versions` writer as covered with an explicit
 * synthetic reason.
 */
export async function cutoverFixture(): Promise<CutoverFixture> {
  const f = await lotFixture();
  await f.db.insert(lotVersions).values({
    id: LOT_6K_CC,
    canonicalId: "lot-canonical-syn-6k-03",
    noLot: "SYN-6K-0003",
    citySlug: CUTOVER_CITY,
    reconStatus: "validated",
    validFrom: "2025-01-01",
    knownFrom: new Date("2025-01-01T00:00:00.000Z"),
    rawRef: "synthetic-6k-cc",
  });
  await f.db.transaction(async (tx) => {
    for (const writer of KNOWN_LOT_SOURCE_WRITERS) {
      await attestLotSourceWriter(tx, writer, true, "synthetic 6K qualification");
    }
  });
  return f;
}

/** Synthetic city shared by the 6K manifests (matches the seeded versions). */
export const CUTOVER_CITY = "synthetic-6j-city";

/** Manifest without conflicts: every row maps, no D5 step is required. */
export interface CleanCutoverReport {
  report: LotMigrationReport;
  targetKeys: string[];
}

/** Build the conflict-free qualified manifest (chain A archive + lot 02 market). */
export function cleanCutoverReport(): CleanCutoverReport {
  const report = buildLotMigrationReport(
    syntheticInput(lot6jMarks().slice(0, 4), lot6jVersions(), "mapping-syn-6k-v1", true));
  return {
    report,
    targetKeys: [...new Set(report.rows.filter((row) => row.disposition === "mapped")
      .map((row) => cutoverTargetKey(row)))],
  };
}

/** Recording safety probe for cutover tests. */
export interface RecordingCutoverSafety {
  drainCalls: string[];
  readbackCalls: string[];
  safety: {
    drainDeliveryPaths: (workspaceId: string) => Promise<void>;
    readbackAuthorized: (workspaceId: string) => Promise<void>;
  };
}

/** Build a safety probe that records every invocation in order. */
export function recordingCutoverSafety(): RecordingCutoverSafety {
  const drainCalls: string[] = [];
  const readbackCalls: string[] = [];
  return {
    drainCalls,
    readbackCalls,
    safety: {
      drainDeliveryPaths: async (workspaceId: string) => {
        drainCalls.push(workspaceId);
      },
      readbackAuthorized: async (workspaceId: string) => {
        readbackCalls.push(workspaceId);
      },
    },
  };
}
