import { describe, expect, it } from "vitest";
import { cleanChainInput, syntheticInput, syntheticLotVersion, syntheticMark } from "./fixtures.js";
import { buildLotMigrationReport } from "./report.js";

describe("migration integrity regressions", () => {
  it.each(["supersedes", "supersededBy"] as const)(
    "flags nonreciprocal %s links on the whole chain", (link) => {
      const input = cleanChainInput();
      const marks = input.marks.map((mark) => ({ ...mark, [link]: null }));
      const report = buildLotMigrationReport({ ...input, marks });
      expect(report.rows).toHaveLength(2);
      for (const row of report.rows) {
        expect(row.diagnostics).toContain("chain-broken");
        expect(row.disposition).toBe("conflict");
      }
    });

  it("detects cycles recorded only in successor links", () => {
    const marks = [syntheticMark({ id: "a", supersededBy: "b" }),
      syntheticMark({ id: "b", supersededBy: "a" })];
    const report = buildLotMigrationReport(syntheticInput(marks, [syntheticLotVersion()]));
    expect(report.rows.every((row) => row.diagnostics.includes("chain-cycle"))).toBe(true);
    expect(report.counts.conflicts).toBe(2);
  });

  it.each(["https://", "https://?x=1", "http://user:pass@synthetic.invalid", "http://[broken"])(
    "requires import treatment for malformed or credentialed URL %s", (lienAnnonce) => {
      const report = buildLotMigrationReport(syntheticInput([
        syntheticMark({ dimension: "marche", statut: "en_vente", lienAnnonce }),
      ], [syntheticLotVersion()]));
      expect(report.rows[0]?.diagnostics).toContain("import-treatment-required");
    });

  it("requires treatment for a listing URL on a pipeline row", () => {
    const report = buildLotMigrationReport(syntheticInput([
      syntheticMark({ lienAnnonce: "https://synthetic.invalid/listing" }),
    ], [syntheticLotVersion()]));
    expect(report.rows[0]?.diagnostics).toContain("import-treatment-required");
  });

  it("accounts exactly once for mapped, conflicting and unresolved rows together", () => {
    const marks = [syntheticMark({ id: "mapped" }),
      syntheticMark({ id: "conflict", dimension: "marche", statut: "en_vente", prixDemande: "-1" }),
      syntheticMark({ id: "unresolved", lotVersionId: "absent" })];
    const report = buildLotMigrationReport(syntheticInput(marks, [syntheticLotVersion()]));
    expect(report.rows.map((row) => [row.sourceId, row.disposition])).toEqual([
      ["conflict", "conflict"], ["mapped", "mapped"], ["unresolved", "unresolved"],
    ]);
    expect(report.counts).toMatchObject({ sourceEvents: 3, conflicts: 2, projectedHeads: 2 });
  });
});
