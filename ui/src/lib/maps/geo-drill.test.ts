/**
 * geo-drill — logique PURE du drill Province / Ville / Zone partagée
 * Signaux ↔ Sources. Jamais de logique métier : segments + niveau actif.
 */
import { describe, it, expect } from "vitest";
import {
  buildDrillSegments,
  computeDrillLevel,
  zonesConfigured,
} from "./geo-drill.js";

describe("zonesConfigured", () => {
  it("null → non configuré", () => {
    expect(zonesConfigured(null)).toBe(false);
  });

  it("zoneCount 0 ou collection vide → non configuré", () => {
    expect(
      zonesConfigured({ zoneCount: 0, featureCollection: { features: [] } }),
    ).toBe(false);
    expect(
      zonesConfigured({ zoneCount: 3, featureCollection: { features: [] } }),
    ).toBe(false);
    expect(
      zonesConfigured({ zoneCount: 0, featureCollection: { features: [{}] } }),
    ).toBe(false);
  });

  it("au moins une vraie zone → configuré", () => {
    expect(
      zonesConfigured({ zoneCount: 2, featureCollection: { features: [{}, {}] } }),
    ).toBe(true);
  });
});

describe("buildDrillSegments", () => {
  it("toujours 3 segments Province / Ville / Zone", () => {
    const segments = buildDrillSegments({
      hasSelectedCity: false,
      zonesConfigured: false,
    });
    expect(segments.map((s) => s.label)).toEqual(["Province", "Ville", "Zone"]);
  });

  it("ville sélectionnée SANS zonage configuré → Zone grisé + aria explicite", () => {
    const segments = buildDrillSegments({
      hasSelectedCity: true,
      zonesConfigured: false,
    });
    const zone = segments[2];
    expect(zone.disabled).toBe(true);
    expect(zone.ariaLabel).toBe("Zone (zones non configurées)");
  });

  it("ville sélectionnée AVEC zonage configuré → Zone actif", () => {
    const segments = buildDrillSegments({
      hasSelectedCity: true,
      zonesConfigured: true,
    });
    expect(segments[2].disabled).toBe(false);
    expect(segments[2].ariaLabel).toBe("Zone");
  });

  it("niveau Province (pas de ville) → Zone reste actif (le clic ville est le geste attendu)", () => {
    const segments = buildDrillSegments({
      hasSelectedCity: false,
      zonesConfigured: false,
    });
    expect(segments[2].disabled).toBe(false);
  });

  // 01KZGM07 item 4 — niveau Lot optionnel (vue Signaux : drill jusqu'au lot).
  it("includeLotLevel → 4e segment « Lot », grisé tant qu'aucun lot n'est sélectionné", () => {
    const segments = buildDrillSegments({
      hasSelectedCity: true,
      zonesConfigured: true,
      includeLotLevel: true,
    });
    expect(segments.map((s) => s.label)).toEqual(["Province", "Ville", "Zone", "Lot"]);
    expect(segments[3].disabled).toBe(true);
    expect(segments[3].ariaLabel).toBe("Lot (sélectionnez un lot sur la carte)");
  });

  it("includeLotLevel + hasLotSelection → segment « Lot » actif", () => {
    const segments = buildDrillSegments({
      hasSelectedCity: true,
      zonesConfigured: true,
      includeLotLevel: true,
      hasLotSelection: true,
    });
    expect(segments[3].disabled).toBe(false);
    expect(segments[3].ariaLabel).toBe("Lot");
  });

  it("sans includeLotLevel → aucun segment « Lot » (parité vue Sources)", () => {
    const segments = buildDrillSegments({
      hasSelectedCity: true,
      zonesConfigured: true,
      hasLotSelection: true,
    });
    expect(segments.map((s) => s.label)).toEqual(["Province", "Ville", "Zone"]);
  });
});

describe("computeDrillLevel", () => {
  it("zone sélectionnée → Zone (prime sur la ville)", () => {
    expect(
      computeDrillLevel({ hasSelectedCity: true, hasZoneSelection: true }),
    ).toBe("Zone");
  });

  it("ville sans zone → Ville", () => {
    expect(
      computeDrillLevel({ hasSelectedCity: true, hasZoneSelection: false }),
    ).toBe("Ville");
  });

  it("rien de sélectionné → Province", () => {
    expect(
      computeDrillLevel({ hasSelectedCity: false, hasZoneSelection: false }),
    ).toBe("Province");
  });

  // 01KZGM07 item 4 — un lot sélectionné prime sur la zone (drill le plus profond).
  it("lot sélectionné → Lot (prime sur zone et ville)", () => {
    expect(
      computeDrillLevel({
        hasSelectedCity: true,
        hasZoneSelection: true,
        hasLotSelection: true,
      }),
    ).toBe("Lot");
  });
});
