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
  estimatedFacadeM,
  evaluatedLotScore,
  formatArea,
  formatYesNo,
  googleMapsUrl,
  googleStreetViewUrl,
  lotZoneCode,
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

// ── estimatedFacadeM ───────────────────────────────────────────────────────────

describe("estimatedFacadeM", () => {
  const LAT = 45.4;
  const M_PER_DEG_LAT = 111320;
  const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);

  /** Rectangle w×h mètres (axes lon/lat), coin SW à (-73.5, LAT). */
  function rectRing(wM: number, hM: number): number[][] {
    const dLon = wM / M_PER_DEG_LON;
    const dLat = hM / M_PER_DEG_LAT;
    return [
      [-73.5, LAT],
      [-73.5 + dLon, LAT],
      [-73.5 + dLon, LAT + dLat],
      [-73.5, LAT + dLat],
      [-73.5, LAT],
    ];
  }

  it("façade = petit côté du rectangle englobant orienté (20 m × 40 m → ≈20 m)", () => {
    const facade = estimatedFacadeM(makePolygonFeature("1", rectRing(20, 40)));
    expect(facade).not.toBeNull();
    expect(facade!).toBeGreaterThan(19);
    expect(facade!).toBeLessThan(21);
  });

  it("insensible à l'orientation (rectangle tourné de 30°)", () => {
    // Rectangle 15 m × 60 m tourné de 30° autour de son coin SW.
    const wM = 15, hM = 60, theta = Math.PI / 6;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const cornersM: Array<[number, number]> = [
      [0, 0],
      [wM * cos, wM * sin],
      [wM * cos - hM * sin, wM * sin + hM * cos],
      [-hM * sin, hM * cos],
      [0, 0],
    ];
    const ring = cornersM.map(([x, y]) => [
      -73.5 + x / M_PER_DEG_LON,
      LAT + y / M_PER_DEG_LAT,
    ]);
    const facade = estimatedFacadeM(makePolygonFeature("2", ring));
    expect(facade).not.toBeNull();
    expect(facade!).toBeGreaterThan(14);
    expect(facade!).toBeLessThan(16);
  });

  it("retourne null pour géométrie absente ou dégénérée", () => {
    const noGeom: LotFeature = {
      type: "Feature",
      geometry: null,
      properties: { noLot: "3" },
    };
    expect(estimatedFacadeM(noGeom)).toBeNull();
    // Ligne (aire nulle)
    const line = makePolygonFeature("4", [
      [-73.5, LAT],
      [-73.499, LAT],
      [-73.5, LAT],
    ]);
    expect(estimatedFacadeM(line)).toBeNull();
  });
});

// ── Champs enrichis + formatage partagé (carte lot Signaux, PR #314/#315) ─────

describe("evaluatedLotScore — jamais un 0 placeholder présenté comme mesuré", () => {
  it("score évalué (scored/fallback) → retourné tel quel", () => {
    expect(evaluatedLotScore({ potentialScore: 7.5, potentialScoreStatus: "scored" })).toBe(7.5);
    expect(evaluatedLotScore({ potentialScore: 4, potentialScoreStatus: "fallback" })).toBe(4);
    expect(evaluatedLotScore({ potentialScore: 0, potentialScoreStatus: "scored" })).toBe(0);
  });

  it("status unavailable → null (l'UI affiche « non évalué », pas « 0.0/10 »)", () => {
    expect(evaluatedLotScore({ potentialScore: 0, potentialScoreStatus: "unavailable" })).toBeNull();
  });

  it("fallback à 0 (dérivation sans évidence positive) → null, pas un faux « 0.0/10 »", () => {
    expect(evaluatedLotScore({ potentialScore: 0, potentialScoreStatus: "fallback" })).toBeNull();
  });

  it("score numérique legacy sans statut → retourné (compat sources historiques)", () => {
    expect(evaluatedLotScore({ potentialScore: 6 })).toBe(6);
  });

  it("score absent/non-numérique → null", () => {
    expect(evaluatedLotScore({})).toBeNull();
    expect(evaluatedLotScore({ potentialScore: null })).toBeNull();
  });
});

describe("lotZoneCode — zoneCode plat prioritaire, sinon zone jointe", () => {
  it("préfère le zoneCode plat de la collection", () => {
    expect(
      lotZoneCode({ zoneCode: "H-431", zone: { kind: "H", usages: [], densiteLogHa: null, code: "C-1" } }),
    ).toBe("H-431");
  });

  it("retombe sur le code de l'objet zone joint", () => {
    expect(
      lotZoneCode({ zone: { kind: "H", usages: [], densiteLogHa: null, code: "C-403" } }),
    ).toBe("C-403");
  });

  it("aucun code exposé → null (aucune invention)", () => {
    expect(lotZoneCode({})).toBeNull();
    expect(lotZoneCode({ zone: { kind: "H", usages: [], densiteLogHa: null } })).toBeNull();
  });
});

describe("formatArea / formatYesNo — copy client neutre, « — » discret", () => {
  it("formatArea arrondit en m² et rend « — » quand absent", () => {
    expect(formatArea(850.4)).toBe("850 m²");
    expect(formatArea(null)).toBe("—");
    expect(formatArea(undefined)).toBe("—");
  });

  it("formatYesNo rend Oui/Non et « — » quand absent", () => {
    expect(formatYesNo(true)).toBe("Oui");
    expect(formatYesNo(false)).toBe("Non");
    expect(formatYesNo(undefined)).toBe("—");
    expect(formatYesNo(null)).toBe("—");
  });
});
