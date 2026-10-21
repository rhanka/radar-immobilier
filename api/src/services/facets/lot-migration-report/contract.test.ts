/**
 * Conflict classification tests: target resolution and chain integrity.
 * No conflict is ever resolved; both converged heads keep projecting.
 * Synthetic inputs only.
 */

import { describe, expect, it } from "vitest";
import {
  diagnosticsById,
  syntheticInput,
  syntheticLotVersion,
  syntheticMark,
} from "./fixtures.js";
import { buildLotMigrationReport } from "./report.js";

describe("buildLotMigrationReport chain conflicts", () => {
  it("flags heads converging across versions without selecting a winner", () => {
    const firstLot = syntheticLotVersion({ id: "lot-version-syn-0001" });
    const secondLot = syntheticLotVersion({
      id: "lot-version-syn-0002",
      noLot: "LOT-SYN-0002",
    });
    const report = buildLotMigrationReport(
      syntheticInput(
        [
          syntheticMark({ id: "mark-syn-0001", lotVersionId: firstLot.id }),
          syntheticMark({
            id: "mark-syn-0002",
            lotVersionId: secondLot.id,
            noLot: secondLot.noLot,
          }),
        ],
        [firstLot, secondLot],
      ),
    );
    const byId = diagnosticsById(report.rows);
    expect(byId["mark-syn-0001"]).toContain("heads-converged");
    expect(byId["mark-syn-0002"]).toContain("heads-converged");
    expect(report.rows.map((row) => row.destination)).toEqual([
      expect.objectContaining({ facet: "selection" }),
      expect.objectContaining({ facet: "selection" }),
    ]);
    expect(report.rows.every((row) => row.disposition === "conflict")).toBe(
      true,
    );
    expect(report.counts.conflicts).toBe(2);
  });

  it("marks rows with a missing lot version as unresolved", () => {
    const report = buildLotMigrationReport(
      syntheticInput(
        [syntheticMark({ id: "mark-syn-0001", lotVersionId: "missing" })],
        [syntheticLotVersion()],
      ),
    );
    expect(report.rows[0]?.diagnostics).toContain("target-unresolved");
    expect(report.rows[0]?.disposition).toBe("unresolved");
    expect(report.rows[0]?.destination).toBeNull();
    expect(report.counts.projectedHeads).toBe(0);
  });

  it("flags inconsistent denormalized city and lot numbers", () => {
    const report = buildLotMigrationReport(
      syntheticInput(
        [syntheticMark({ id: "mark-syn-0001", noLot: "LOT-SYN-9999" })],
        [syntheticLotVersion()],
      ),
    );
    expect(report.rows[0]?.diagnostics).toContain("target-inconsistent");
    expect(report.rows[0]?.disposition).toBe("conflict");
  });

  it("flags broken supersession links and supersession cycles", () => {
    const broken = buildLotMigrationReport(
      syntheticInput(
        [syntheticMark({ id: "mark-syn-0001", supersedes: "mark-syn-absent" })],
        [syntheticLotVersion()],
      ),
    );
    expect(broken.rows[0]?.diagnostics).toContain("chain-broken");

    const cyclic = buildLotMigrationReport(
      syntheticInput(
        [
          syntheticMark({
            id: "mark-syn-0001",
            supersedes: "mark-syn-0002",
            supersededBy: "mark-syn-0002",
          }),
          syntheticMark({
            id: "mark-syn-0002",
            supersedes: "mark-syn-0001",
            supersededBy: "mark-syn-0001",
          }),
        ],
        [syntheticLotVersion()],
      ),
    );
    const byId = diagnosticsById(cyclic.rows);
    expect(byId["mark-syn-0001"]).toContain("chain-cycle");
    expect(byId["mark-syn-0002"]).toContain("chain-cycle");
  });

  it("flags chains spanning versions and chains mixing real with simulation", () => {
    const firstLot = syntheticLotVersion({ id: "lot-version-syn-0001" });
    const secondLot = syntheticLotVersion({ id: "lot-version-syn-0002" });
    const report = buildLotMigrationReport(
      syntheticInput(
        [
          syntheticMark({
            id: "mark-syn-0001",
            lotVersionId: firstLot.id,
            mode: "real",
            supersededBy: "mark-syn-0002",
          }),
          syntheticMark({
            id: "mark-syn-0002",
            lotVersionId: secondLot.id,
            noLot: secondLot.noLot,
            mode: "simulation",
            supersedes: "mark-syn-0001",
          }),
        ],
        [firstLot, secondLot],
      ),
    );
    const byId = diagnosticsById(report.rows);
    expect(byId["mark-syn-0001"]).toContain("chain-cross-target");
    expect(byId["mark-syn-0002"]).toContain("chain-cross-target");
    expect(byId["mark-syn-0001"]).toContain("chain-mixed-mode");
    expect(byId["mark-syn-0002"]).toContain("chain-mixed-mode");
  });
});
