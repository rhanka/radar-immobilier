import { describe, expect, it } from "vitest";
import { cleanChainInput, syntheticInput, syntheticLotVersion, syntheticMark } from "./fixtures.js";
import { buildLotMigrationReport } from "./report.js";

describe("lossless source inventory", () => {
  it("preserves documentary authorship, exact values and both link IDs", () => {
    const mark = {
      ...syntheticMark({ dimension: "marche", statut: "en_vente",
        prixDemande: "999999999999.99", lienAnnonce: "https://synthetic.invalid/?x=%2F" }),
      authorId: "author-synthetic-1",
    };
    const report = buildLotMigrationReport(syntheticInput([mark], [syntheticLotVersion()]));
    expect(report.rows[0]?.observed).toMatchObject({
      authorId: mark.authorId, prixDemande: mark.prixDemande, lienAnnonce: mark.lienAnnonce,
      supersedes: null, supersededBy: null,
    });
    const chain = cleanChainInput();
    const rows = buildLotMigrationReport(chain).rows;
    expect(rows[0]?.observed).toMatchObject({ supersededBy: chain.marks[1]?.id });
    expect(rows[1]?.observed).toMatchObject({ supersedes: chain.marks[0]?.id });
  });

  it("never derives destination ownership from documentary authorship", () => {
    const mark = { ...syntheticMark(), authorId: "author-synthetic-1" };
    const first = buildLotMigrationReport(syntheticInput([mark], [syntheticLotVersion()]));
    const changed = buildLotMigrationReport(syntheticInput(
      [{ ...mark, authorId: "author-synthetic-2" }], [syntheticLotVersion()]));
    expect(first.rows[0]?.destination).toEqual(changed.rows[0]?.destination);
    expect(first.sourceSnapshotId).not.toBe(changed.sourceSnapshotId);
  });

  it("reports unqualified reconciliation without projecting a destination", () => {
    const report = buildLotMigrationReport(syntheticInput([syntheticMark()],
      [syntheticLotVersion({ reconStatus: "pending" })]));
    expect(report.rows[0]?.disposition).toBe("unresolved");
    expect(report.rows[0]?.diagnostics).toContain("target-unresolved");
    expect(report.rows[0]?.destination).toBeNull();
    expect(report.counts.projectedHeads).toBe(0);
  });

  it("keeps same-spelling canonical IDs in different cities separate", () => {
    const lots = [syntheticLotVersion(), syntheticLotVersion({
      id: "version-synthetic-2", citySlug: "ville-synthetic-2",
    })];
    const marks = lots.map((lot, i) => syntheticMark({
      id: `mark-synthetic-${i}`, lotVersionId: lot.id, citySlug: lot.citySlug,
    }));
    const report = buildLotMigrationReport(syntheticInput(marks, lots));
    expect(report.counts.nativeTargets).toBe(2);
    expect(report.counts.conflicts).toBe(0);
    expect(report.rows[0]?.destination).toMatchObject({ citySlug: lots[0]?.citySlug });
    expect(report.rows[1]?.destination).toMatchObject({ citySlug: lots[1]?.citySlug });
    expect(buildLotMigrationReport(syntheticInput([...marks].reverse(), [...lots].reverse())))
      .toEqual(report);
  });

  it("hashes qualification changes even for an empty source snapshot", () => {
    const first = buildLotMigrationReport(syntheticInput([], []));
    const qualified = buildLotMigrationReport(syntheticInput([], [], "mapping-syn-v1", true));
    expect(first.manifestSha256).not.toBe(qualified.manifestSha256);
    expect(first.sourceSnapshotId).toBe(qualified.sourceSnapshotId);
  });

  it("rejects ambiguous duplicate IDs without exposing source values", () => {
    const mark = syntheticMark();
    const lot = syntheticLotVersion();
    expect(() => buildLotMigrationReport(syntheticInput([mark, mark], [lot])))
      .toThrow("Migration snapshot contains duplicate source IDs");
    expect(() => buildLotMigrationReport(syntheticInput([mark], [lot, lot])))
      .toThrow("Migration snapshot contains duplicate source IDs");
  });

  it("binds the manifest to the configured importer version", () => {
    const input = cleanChainInput();
    const first = buildLotMigrationReport(input);
    const changed = buildLotMigrationReport({ ...input, mapping: {
      ...input.mapping, importerVersion: "importer-syn-v2",
    } });
    expect(changed.manifestSha256).not.toBe(first.manifestSha256);
    expect(changed.sourceSnapshotId).toBe(first.sourceSnapshotId);
    expect(changed.importerVersion).toBe("importer-syn-v2");
  });
});
