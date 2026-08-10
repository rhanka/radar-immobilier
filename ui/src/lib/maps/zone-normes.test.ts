/**
 * Tests unitaires pour zone-normes — sous-section « Normes » du drawer
 * « Règlement et Normes ».
 *
 * Vérifie le contrat anti-invention : usage dominant / normes affichés VERBATIM
 * quand geo les sert au niveau lot (foldés par zone_code), copy neutre « non
 * renseigné » (served=false) sinon — JAMAIS de valeur fabriquée.
 *
 * Anti-PII (Loi 25) : fixtures publiques uniquement (noLot, code de zone).
 */
import { describe, it, expect } from "vitest";
import { zoneNormesFromLots } from "./zone-normes.js";
import type { LotFeature, LotProperties } from "$lib/maps/lots-client.js";

function makeLot(properties: Partial<LotProperties> & { noLot: string }): LotFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-73.5, 45.5] } as LotFeature["geometry"],
    properties: { citySlug: "delson", ...properties },
  };
}

describe("zoneNormesFromLots", () => {
  it("zoneCode null → non servi (served=false), lignes par défaut « — »", () => {
    const result = zoneNormesFromLots(null, [makeLot({ noLot: "1" })]);
    expect(result.served).toBe(false);
    expect(result.usageDominant).toBeNull();
    // lotNormesRows(null) : 7 lignes toutes à « — ».
    expect(result.rows.every(([, value]) => value === "—")).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("zoneCode sans lot correspondant → non servi", () => {
    const lots = [makeLot({ noLot: "1", zoneCode: "M-107" })];
    const result = zoneNormesFromLots("H-315", lots);
    expect(result.served).toBe(false);
    expect(result.usageDominant).toBeNull();
  });

  it("lots à zone « N/D » sans normes (cas delson carte-steve) → « non renseigné » (served=false)", () => {
    // Reproduit la donnée LIVE delson : zone chaîne, aucune norme servie.
    const lots = [
      makeLot({ noLot: "2 181 127", zoneCode: null }),
      makeLot({ noLot: "2 181 128", zoneCode: null }),
    ];
    const result = zoneNormesFromLots("H-315", lots);
    expect(result.served).toBe(false);
    expect(result.usageDominant).toBeNull();
    expect(result.rows.every(([, value]) => value === "—")).toBe(true);
  });

  it("zone avec usage dominant servi → ligne rendue (verbatim + source)", () => {
    const lots = [
      makeLot({
        noLot: "10",
        zoneCode: "H-315",
        zone: {
          code: "H-315",
          densiteLogHa: null,
          usageDominant: "résidentiel",
          usageDominantSource: "zone-nomenclature",
        } as LotProperties["zone"],
      }),
    ];
    const result = zoneNormesFromLots("H-315", lots);
    expect(result.served).toBe(true);
    expect(result.usageDominant).toBe("résidentiel (nomenclature de zone)");
  });

  it("normes de grille servies → valeurs verbatim ; champs absents → « — »", () => {
    const lots = [
      makeLot({
        noLot: "11",
        zoneCode: "H-315",
        normes: { hauteur: "12 m", densite: "60 log/ha", margeAvant: "6 m" },
      }),
    ];
    const result = zoneNormesFromLots("H-315", lots);
    expect(result.served).toBe(true);
    const byLabel = new Map(result.rows);
    expect(byLabel.get("Hauteur max")).toBe("12 m");
    expect(byLabel.get("Densité")).toBe("60 log/ha");
    expect(byLabel.get("Marge avant")).toBe("6 m");
    // Champ non servi → « — » (jamais une valeur inventée).
    expect(byLabel.get("Marge arrière")).toBe("—");
  });

  it("jointure de code tiret-insensible (« H315 » ↔ « H-315 »)", () => {
    const lots = [
      makeLot({
        noLot: "12",
        zoneCode: "H315",
        zone: {
          code: "H315",
          densiteLogHa: null,
          usageDominant: "résidentiel",
        } as LotProperties["zone"],
      }),
    ];
    const result = zoneNormesFromLots("H-315", lots);
    expect(result.served).toBe(true);
    expect(result.usageDominant).toBe("résidentiel");
  });

  it("usage sur un lot, normes sur un autre lot de la même zone → les deux remontés", () => {
    const lots = [
      makeLot({
        noLot: "13",
        zoneCode: "H-315",
        zone: {
          code: "H-315",
          densiteLogHa: null,
          usageDominant: "résidentiel",
        } as LotProperties["zone"],
      }),
      makeLot({
        noLot: "14",
        zoneCode: "H-315",
        normes: { hauteur: "10 m" },
      }),
    ];
    const result = zoneNormesFromLots("H-315", lots);
    expect(result.served).toBe(true);
    expect(result.usageDominant).toBe("résidentiel");
    expect(new Map(result.rows).get("Hauteur max")).toBe("10 m");
  });
});
