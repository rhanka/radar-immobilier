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
  syntheticLotVersion,
  syntheticMark,
} from "../lot-migration-report/fixtures.js";
import { eq } from "drizzle-orm";
import { lotCutoverState, lotVersions } from "../../../db/schema.js";
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
  await f.db.delete(lotCutoverState).where(eq(lotCutoverState.workspaceId, f.workspaceId));
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

/** Manifest with one real converged conflict plus two mapped targets. */
export interface ConflictedCutoverReport {
  report: LotMigrationReport;
  conflictTargetKey: string;
  winnerSourceId: string;
  loserSourceId: string;
  mappedTargetKeys: string[];
}

/**
 * Build the conflicted qualified manifest. Marks `mark-6k-0001..0003`
 * form a clean favori → sollicite → ecarte chain (archive head),
 * `mark-6k-0004` is a clean market head, and `mark-6k-0005`/`mark-6k-0006`
 * are two terminal pipeline heads on the same target (`heads-converged`
 * plus `destination-collision`). The D5 dossier must name
 * `winnerSourceId` explicitly; nothing selects it automatically.
 */
export function conflictedCutoverReport(): ConflictedCutoverReport {
  const marks = [
    syntheticMark({ id: "mark-6k-0001", lotVersionId: LOT_6J_AA, noLot: "SYN-6J-0001",
      citySlug: CUTOVER_CITY, dimension: "pipeline", statut: "favori",
      mode: "real", authorId: "documentary-6k-1",
      supersededBy: "mark-6k-0002", createdAt: "2026-02-01T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6k-0002", lotVersionId: LOT_6J_AA, noLot: "SYN-6J-0001",
      citySlug: CUTOVER_CITY, dimension: "pipeline", statut: "sollicite",
      mode: "real", authorId: "documentary-6k-1",
      supersedes: "mark-6k-0001", supersededBy: "mark-6k-0003",
      createdAt: "2026-02-02T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6k-0003", lotVersionId: LOT_6J_AA, noLot: "SYN-6J-0001",
      citySlug: CUTOVER_CITY, dimension: "pipeline", statut: "ecarte",
      mode: "real", authorId: "documentary-6k-2",
      supersedes: "mark-6k-0002", createdAt: "2026-02-03T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6k-0004", lotVersionId: LOT_6J_BB, noLot: "SYN-6J-0002",
      citySlug: CUTOVER_CITY, dimension: "marche", statut: "en_vente",
      mode: "real", authorId: "documentary-6k-3",
      prixDemande: "250000.00",
      lienAnnonce: "https://synthetic.invalid/annonce/6k",
      createdAt: "2026-02-04T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6k-0005", lotVersionId: LOT_6K_CC, noLot: "SYN-6K-0003",
      citySlug: CUTOVER_CITY, dimension: "pipeline", statut: "sollicite",
      mode: "real", authorId: "documentary-6k-4",
      createdAt: "2026-02-05T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6k-0006", lotVersionId: LOT_6K_CC, noLot: "SYN-6K-0003",
      citySlug: CUTOVER_CITY, dimension: "pipeline", statut: "lettre_envoyee",
      mode: "real", authorId: "documentary-6k-5",
      createdAt: "2026-02-06T10:00:00.000Z" }),
  ];
  const versions = [
    syntheticLotVersion({ id: LOT_6J_AA, canonicalId: "lot-canonical-syn-6j-01",
      noLot: "SYN-6J-0001", citySlug: CUTOVER_CITY }),
    syntheticLotVersion({ id: LOT_6J_BB, canonicalId: "lot-canonical-syn-6j-02",
      noLot: "SYN-6J-0002", citySlug: CUTOVER_CITY }),
    syntheticLotVersion({ id: LOT_6K_CC, canonicalId: "lot-canonical-syn-6k-03",
      noLot: "SYN-6K-0003", citySlug: CUTOVER_CITY }),
  ];
  const report = buildLotMigrationReport(
    syntheticInput(marks, versions, "mapping-syn-6k-v1", true));
  const conflictRows = report.rows.filter((row) => row.disposition === "conflict");
  const conflictTargetKey = cutoverTargetKey(conflictRows[0]!);
  return {
    report,
    conflictTargetKey,
    winnerSourceId: "mark-6k-0005",
    loserSourceId: "mark-6k-0006",
    mappedTargetKeys: [...new Set(report.rows.filter((row) => row.disposition === "mapped")
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
