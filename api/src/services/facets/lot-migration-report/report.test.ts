/**
 * Report aggregation tests: determinism and exactly-once accounting.
 * Synthetic inputs only.
 */

import { describe, expect, it } from "vitest";
import {
  cleanChainInput,
  syntheticInput,
  syntheticLotVersion,
  syntheticMark,
} from "./fixtures.js";
import { buildLotMigrationReport } from "./report.js";

describe("buildLotMigrationReport accounting", () => {
  it("emits exactly one manifest row per source row", () => {
    const input = cleanChainInput();
    const report = buildLotMigrationReport(input);
    expect(report.rows.map((row) => row.sourceId).sort()).toEqual(
      input.marks.map((mark) => mark.id).sort(),
    );
    expect(report.counts.sourceEvents).toBe(input.marks.length);
    expect(report.counts.sourceEvents).toBe(report.rows.length);
  });

  it("counts chains, targets, heads and projections on a clean chain", () => {
    const report = buildLotMigrationReport(cleanChainInput());
    expect(report.counts.chains).toBe(1);
    expect(report.counts.nativeTargets).toBe(1);
    expect(report.counts.sourceHeads).toBe(1);
    expect(report.counts.projectedHeads).toBe(1);
    expect(report.counts.conflicts).toBe(0);
    expect(report.rows.every((row) => row.disposition === "mapped")).toBe(
      true,
    );
  });

  it("stays byte-identical across runs and independent of input order", () => {
    const input = cleanChainInput();
    const first = buildLotMigrationReport(input);
    const second = buildLotMigrationReport(input);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const shuffled = syntheticInput(
      [...input.marks].reverse(),
      [...input.lotVersions].reverse(),
      input.mapping.mappingVersion,
      input.mapping.destinationsQualified,
    );
    expect(buildLotMigrationReport(shuffled)).toEqual(first);
  });

  it("changes the manifest digest when source data changes", () => {
    const input = cleanChainInput();
    const first = buildLotMigrationReport(input);
    const altered = syntheticInput(
      [
        syntheticMark({
          id: "mark-syn-0001",
          statut: "favori",
          supersededBy: "mark-syn-0002",
        }),
        syntheticMark({
          id: "mark-syn-0002",
          statut: "lettre_envoyee",
          supersedes: "mark-syn-0001",
        }),
      ],
      [syntheticLotVersion()],
    );
    expect(buildLotMigrationReport(altered).manifestSha256).not.toBe(
      first.manifestSha256,
    );
  });

  it("changes the manifest digest when the mapping version changes", () => {
    const input = cleanChainInput();
    const first = buildLotMigrationReport(input);
    const remapped = syntheticInput(
      [...input.marks],
      [...input.lotVersions],
      "mapping-syn-v2",
      input.mapping.destinationsQualified,
    );
    expect(remapped.mapping.mappingVersion).not.toBe(first.mappingVersion);
    expect(buildLotMigrationReport(remapped).manifestSha256).not.toBe(
      first.manifestSha256,
    );
    expect(buildLotMigrationReport(remapped).sourceSnapshotId).toBe(
      first.sourceSnapshotId,
    );
  });

  it("preserves exact market values as inventory without ownership", () => {
    const input = syntheticInput(
      [
        syntheticMark({
          dimension: "marche",
          statut: "en_vente",
          prixDemande: "250000.00",
          lienAnnonce: "https://annonces.synthese.invalid/lot-1",
        }),
      ],
      [syntheticLotVersion()],
    );
    const row = buildLotMigrationReport(input).rows[0];
    expect(row?.observed.prixDemande).toBe("250000.00");
    expect(row?.observed.lienAnnonce).toBe("https://annonces.synthese.invalid/lot-1");
    expect(row?.observed.authorId).toBe(input.marks[0]?.authorId);
    expect(row?.destination).not.toHaveProperty("ownerId");
  });

  it("classifies exact decimal text without rounding", () => {
    const report = buildLotMigrationReport(
      syntheticInput(
        [
          syntheticMark({
            id: "mark-syn-0001",
            dimension: "marche",
            statut: "en_vente",
            prixDemande: "250000.10",
          }),
          syntheticMark({
            id: "mark-syn-0002",
            dimension: "marche",
            statut: "en_vente",
            prixDemande: "0.00",
          }),
        ],
        [syntheticLotVersion()],
      ),
    );
    expect(report.rows[0]?.observed.priceShape).toBe("canonical-decimal");
    expect(report.rows[0]?.diagnostics).not.toContain(
      "import-treatment-required",
    );
    expect(report.rows[1]?.observed.priceShape).toBe("non-canonical");
  });
});
