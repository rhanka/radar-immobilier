/**
 * Destination and import-decision tests: collisions, pending scopes,
 * and market value shapes. Projections never select a winner.
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

describe("buildLotMigrationReport destinations", () => {
  it("requires explicit import treatment for malformed market values", () => {
    const report = buildLotMigrationReport(
      syntheticInput(
        [
          syntheticMark({
            id: "mark-syn-0001",
            dimension: "marche",
            statut: "en_vente",
            prixDemande: "12.345",
            lienAnnonce: "annonce-sans-protocole.synthese.invalid/lot",
          }),
          syntheticMark({ id: "mark-syn-0002", prixDemande: "100.00" }),
          syntheticMark({
            id: "mark-syn-0003",
            dimension: "marche",
            statut: "en_vente",
            prixDemande: "250000.00",
            lienAnnonce: "https://annonces.synthese.invalid/lot-3",
          }),
        ],
        [syntheticLotVersion()],
      ),
    );
    const byId = diagnosticsById(report.rows);
    expect(byId["mark-syn-0001"]).toContain("import-treatment-required");
    expect(byId["mark-syn-0002"]).toContain("import-treatment-required");
    expect(byId["mark-syn-0003"]).not.toContain("import-treatment-required");
  });

  it("flags destination collisions between same-facet same-mode heads", () => {
    const firstLot = syntheticLotVersion({
      id: "lot-version-syn-0001",
      canonicalId: "lot-canonical-syn-shared",
    });
    const secondLot = syntheticLotVersion({
      id: "lot-version-syn-0002",
      canonicalId: "lot-canonical-syn-shared",
      noLot: "LOT-SYN-0002",
    });
    const colliding = buildLotMigrationReport(
      syntheticInput(
        [
          syntheticMark({
            id: "mark-syn-0001",
            lotVersionId: firstLot.id,
            statut: "sollicite",
          }),
          syntheticMark({
            id: "mark-syn-0002",
            lotVersionId: secondLot.id,
            noLot: secondLot.noLot,
            statut: "lettre_envoyee",
          }),
        ],
        [firstLot, secondLot],
      ),
    );
    const byId = diagnosticsById(colliding.rows);
    expect(byId["mark-syn-0001"]).toContain("destination-collision");
    expect(byId["mark-syn-0002"]).toContain("destination-collision");

    const separate = buildLotMigrationReport(
      syntheticInput(
        [
          syntheticMark({
            id: "mark-syn-0001",
            lotVersionId: firstLot.id,
            statut: "sollicite",
          }),
          syntheticMark({
            id: "mark-syn-0002",
            lotVersionId: secondLot.id,
            noLot: secondLot.noLot,
            statut: "en_vente",
            dimension: "marche",
          }),
        ],
        [firstLot, secondLot],
      ),
    );
    expect(
      separate.rows.every(
        (row) => !row.diagnostics.includes("destination-collision"),
      ),
    ).toBe(true);
  });

  it("keeps unqualified destinations informational, never a conflict", () => {
    const pending = buildLotMigrationReport(
      syntheticInput([syntheticMark({ id: "mark-syn-0001" })], [
        syntheticLotVersion(),
      ]),
    );
    expect(pending.rows[0]?.diagnostics).toContain("destination-unqualified");
    expect(pending.rows[0]?.disposition).toBe("mapped");
    expect(pending.counts.conflicts).toBe(0);

    const qualified = buildLotMigrationReport(
      syntheticInput(
        [syntheticMark({ id: "mark-syn-0001" })],
        [syntheticLotVersion()],
        "mapping-syn-v1",
        true,
      ),
    );
    expect(qualified.rows[0]?.diagnostics).not.toContain(
      "destination-unqualified",
    );
    expect(qualified.destinationsQualified).toBe(true);
  });
});
