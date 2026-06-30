/**
 * Tests unitaires pour lot-fiche-utils — CS-L2.
 *
 * Couvre : centroid, googleMapsUrl, scoreTone, scoreLabel.
 * Anti-PII : les tests ne font jamais appel à des noms de propriétaire
 * ni à des données personnelles — uniquement noLot et géométrie publics.
 */

import { describe, it, expect } from "vitest";
import {
  centroid,
  googleMapsUrl,
  googleStreetViewUrl,
  scoreTone,
  scoreLabel,
} from "./lot-fiche-utils.js";
import type { LotFeature } from "$lib/maps/lots-client.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePolygonFeature(
  noLot: string,
  ring: number[][],
): LotFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
    properties: { noLot, citySlug: "test-city" },
  };
}

/** Carré 1°×1° centré sur (lon=-73.5, lat=45.5). */
const SQUARE_RING: number[][] = [
  [-74, 45],
  [-73, 45],
  [-73, 46],
  [-74, 46],
  [-74, 45],
];

// ── centroid ───────────────────────────────────────────────────────────────────

describe("centroid", () => {
  it("retourne null pour un lot sans géométrie", () => {
    const lot: LotFeature = {
      type: "Feature",
      geometry: null,
      properties: { noLot: "000001" },
    };
    expect(centroid(lot)).toBeNull();
  });

  it("retourne null pour une géométrie non-Polygon", () => {
    const lot: LotFeature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.5, 45.5] } as unknown as LotFeature["geometry"],
      properties: { noLot: "000002" },
    };
    expect(centroid(lot)).toBeNull();
  });

  it("retourne le centroïde approché du carré de test", () => {
    const lot = makePolygonFeature("000003", SQUARE_RING);
    const result = centroid(lot);
    expect(result).not.toBeNull();
    // Centroïde du carré : lon = -73.5, lat = 45.4
    // (moyenne des 5 points dont le premier = le dernier = [-74,45])
    expect(result!.lon).toBeCloseTo(-73.6, 0);
    expect(result!.lat).toBeCloseTo(45.4, 0);
  });

  it("retourne null pour un anneau vide", () => {
    const lot: LotFeature = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[]] },
      properties: { noLot: "000004" },
    };
    expect(centroid(lot)).toBeNull();
  });

  it("lot avec un seul point retourne ce point", () => {
    const lot = makePolygonFeature("000005", [[-73.5, 45.5]]);
    const result = centroid(lot);
    expect(result).not.toBeNull();
    expect(result!.lon).toBeCloseTo(-73.5, 5);
    expect(result!.lat).toBeCloseTo(45.5, 5);
  });
});

// ── googleMapsUrl ──────────────────────────────────────────────────────────────

describe("googleMapsUrl", () => {
  it("génère une URL Google Maps valide", () => {
    const url = googleMapsUrl(45.5, -73.5);
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\?q=/);
    expect(url).toContain("45.500000");
    expect(url).toContain("-73.500000");
  });

  it("lat et lon sont dans le bon ordre (lat,lon)", () => {
    const url = googleMapsUrl(45.123456, -73.654321);
    // Le format est ?q=lat,lon
    expect(url).toBe("https://www.google.com/maps?q=45.123456,-73.654321");
  });

  it("6 décimales de précision", () => {
    const url = googleMapsUrl(45.1, -73.9);
    expect(url).toContain("45.100000");
    expect(url).toContain("-73.900000");
  });
});

// ── googleStreetViewUrl ───────────────────────────────────────────────────────

describe("googleStreetViewUrl", () => {
  it("génère une URL Street View valide au centroïde", () => {
    const url = googleStreetViewUrl(45.123456, -73.654321);
    expect(url).toBe(
      "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=45.123456,-73.654321",
    );
  });
});

// ── scoreTone ──────────────────────────────────────────────────────────────────

describe("scoreTone", () => {
  it("undefined → neutral", () => {
    expect(scoreTone(undefined)).toBe("neutral");
  });

  it("0 → neutral", () => {
    expect(scoreTone(0)).toBe("neutral");
  });

  it("1 → info (faible)", () => {
    expect(scoreTone(1)).toBe("info");
  });

  it("3.5 → info (faible)", () => {
    expect(scoreTone(3.5)).toBe("info");
  });

  it("4 → warning (moyen)", () => {
    expect(scoreTone(4)).toBe("warning");
  });

  it("6.9 → warning (moyen)", () => {
    expect(scoreTone(6.9)).toBe("warning");
  });

  it("7 → success (élevé)", () => {
    expect(scoreTone(7)).toBe("success");
  });

  it("10 → success (élevé)", () => {
    expect(scoreTone(10)).toBe("success");
  });
});

// ── scoreLabel ─────────────────────────────────────────────────────────────────

describe("scoreLabel", () => {
  it("undefined → 'non calculé'", () => {
    expect(scoreLabel(undefined)).toBe("non calculé");
  });

  it("0 → 'Nul'", () => {
    expect(scoreLabel(0)).toBe("Nul");
  });

  it("1 → 'Faible'", () => {
    expect(scoreLabel(1)).toBe("Faible");
  });

  it("3.9 → 'Faible'", () => {
    expect(scoreLabel(3.9)).toBe("Faible");
  });

  it("4 → 'Moyen'", () => {
    expect(scoreLabel(4)).toBe("Moyen");
  });

  it("6.9 → 'Moyen'", () => {
    expect(scoreLabel(6.9)).toBe("Moyen");
  });

  it("7 → 'Élevé'", () => {
    expect(scoreLabel(7)).toBe("Élevé");
  });

  it("10 → 'Élevé'", () => {
    expect(scoreLabel(10)).toBe("Élevé");
  });
});

// ── LotProperties.potentialScore (intégration client) ────────────────────────

describe("LotProperties.potentialScore (type guard)", () => {
  it("un lot sans potentialScore a undefined", () => {
    const lot: LotFeature = {
      type: "Feature",
      geometry: null,
      properties: { noLot: "999999" },
    };
    expect(lot.properties.potentialScore).toBeUndefined();
  });

  it("un lot avec potentialScore=5 le retient correctement", () => {
    const lot: LotFeature = {
      type: "Feature",
      geometry: null,
      properties: { noLot: "999998", potentialScore: 5 },
    };
    expect(lot.properties.potentialScore).toBe(5);
  });

  it("scoreTone(5) → warning (moyen)", () => {
    expect(scoreTone(5)).toBe("warning");
  });

  it("scoreLabel(5) → 'Moyen'", () => {
    expect(scoreLabel(5)).toBe("Moyen");
  });
});
