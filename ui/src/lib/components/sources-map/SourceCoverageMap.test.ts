/**
 * SourceCoverageMap — intégration de la vue Couverture avec le MÊME mode
 * d'interaction que Signaux (socle stubé, loader zones mocké) :
 *
 *   1. DRAWER droit = scorecard de couverture (SourceScorecard) de la ville
 *      sélectionnée — mêmes lignes PV · Signaux · Zones · Normes · Lots · TOD.
 *   2. Sélection ville (carte OU rail) → drill ZONES : chargement tiéré +
 *      peinture des aplats via le socle + segmented Province/Ville/Zone.
 *   3. Radio de PORTÉE (exclusif) → filtre la liste de villes ET la
 *      coloration carte (expression d'opacité passée au socle).
 *
 * Aucun docker, aucune API : jsdom + stub du socle + loader mocké.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  fireEvent,
  cleanup,
  waitFor,
  getAllByRole,
} from "@testing-library/svelte";

vi.mock("$lib/components/maps/GeoCityMapBase.svelte", async () => {
  const stub = await import("./test-stubs/GeoCityMapBaseStub.svelte");
  return { default: stub.default };
});

vi.mock("$lib/maps/signaux-zones-loader.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/maps/signaux-zones-loader.js")>();
  return {
    ...actual,
    loadSignauxZones: vi.fn(async (citySlug: string) => ({
      tier: "collection" as const,
      response: fixtureZones(citySlug),
    })),
  };
});

import SourceCoverageMap from "./SourceCoverageMap.svelte";
import {
  callsOf,
  resetStubCalls,
} from "./test-stubs/GeoCityMapBaseStub.svelte";
import { loadSignauxZones } from "$lib/maps/signaux-zones-loader.js";
import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";
import type {
  CityCoverage,
  CoverageResponse,
  CoverageState,
} from "$lib/sources/source-coverage-client.js";

afterEach(() => cleanup());
beforeEach(() => {
  resetStubCalls();
  vi.mocked(loadSignauxZones).mockClear();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Deux vraies zones (H-01 / C-02) avec géométrie — drill zones alimenté. */
function fixtureZones(citySlug: string): GeoZonesResponse {
  const polygon = (dx: number) => ({
    type: "Polygon" as const,
    coordinates: [
      [
        [-73.55 + dx, 45.37],
        [-73.54 + dx, 45.37],
        [-73.54 + dx, 45.38],
        [-73.55 + dx, 45.38],
        [-73.55 + dx, 45.37],
      ],
    ],
  });
  return {
    ok: true,
    citySlug,
    source: "official",
    resolutionStatus: "official",
    geometryStatus: "official",
    zoneCount: 2,
    warnings: [],
    featureCollection: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: polygon(0),
          properties: {
            code: "H-01",
            citySlug,
            geometryStatus: "official",
            confidence: 1,
            source: "official-zone",
            lotCount: 0,
            lots: [],
            kind: "habitation",
          },
        },
        {
          type: "Feature",
          geometry: polygon(0.02),
          properties: {
            code: "C-02",
            citySlug,
            geometryStatus: "official",
            confidence: 1,
            source: "official-zone",
            lotCount: 0,
            lots: [],
            kind: "commerce",
          },
        },
      ],
    },
  };
}

function city(
  citySlug: string,
  cityName: string,
  priorityRank: number | null,
  worstStatus: CoverageState = "absent",
  signalCount = 3,
): CityCoverage {
  return {
    citySlug,
    cityName,
    mrc: `MRC-${cityName}`,
    priorityRank,
    l1Raw: { state: "verified", count: 9, freshness: "fresh" },
    l2Graph: { state: "verified", ontologyVersion: "2.2", freshness: "fresh" },
    signals: {
      state: signalCount > 0 ? "verified" : "absent",
      count: signalCount,
      withCitation: signalCount > 0 ? 2 : 0,
      freshness: signalCount > 0 ? "fresh" : "unknown",
    },
    // served: false → la scorecard NE déclenche PAS le fetch lazy des grilles.
    l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus,
    nextMarginalGain: null,
  };
}

// Portée « 30 villes à signaux » = présence de signaux (plus priorityRank) :
// rimouski a 0 signal → exclue du focus30 même si listée en « Toutes ».
const CITIES: CityCoverage[] = [
  city("delson", "Delson", 12, "declared", 17),
  city("sainte-catherine", "Sainte-Catherine", 20, "verified", 16),
  city("la-prairie", "La Prairie", 5, "absent", 14),
  city("rimouski", "Rimouski", 480, "verified", 0),
];

const RESPONSE: CoverageResponse = {
  generatedAt: "2026-07-01T00:00:00Z",
  totals: { cities: 4, l1Raw: 4, l2Graph: 4, signals: 4, l4Zonage: 0, l5Lots: 0 },
  cities: CITIES,
};

function renderView() {
  return render(SourceCoverageMap, {
    props: {
      cities: CITIES,
      response: RESPONSE,
      loading: false,
      error: null,
      onReload: () => {},
    },
  });
}

/** Dernier syncGeoLayers → collection zones peinte. */
function lastPaintedZones(): {
  features: Array<{ properties: Record<string, unknown> }>;
} {
  const calls = callsOf("syncGeoLayers");
  expect(calls.length).toBeGreaterThan(0);
  const input = calls[calls.length - 1].args[0] as {
    zones: { features: Array<{ properties: Record<string, unknown> }> };
  };
  return input.zones;
}

// ── 1. Drawer droit = scorecard couverture ────────────────────────────────────

describe("SourceCoverageMap — drawer droit = carte de couverture", () => {
  it("sans sélection : placeholder, AUCUNE scorecard", () => {
    const { container } = renderView();
    expect(container.querySelector('[data-testid="source-scorecard"]')).toBeNull();
    expect(container.textContent).toContain("Cliquez une ville");
  });

  it("clic ville sur la CARTE → scorecard complète dans le drawer", async () => {
    const { container, getByTestId } = renderView();
    await fireEvent.click(getByTestId("stub-city-delson"));

    const scorecard = container.querySelector('[data-testid="source-scorecard"]');
    expect(scorecard).not.toBeNull();
    // En-tête : nom + MRC + rang + badge tri-état de couverture.
    expect(scorecard!.textContent).toContain("Delson");
    expect(scorecard!.textContent).toContain("MRC-Delson");
    expect(scorecard!.textContent).toContain("rang 12");
    expect(scorecard!.textContent).toContain("Couverture");
    expect(scorecard!.textContent).toContain("Partiel");
    // Les lignes par couche (contenu EXACT du pane droit Sources).
    for (const label of [
      "PV collectés",
      "Signaux extraits",
      "Zones servies",
      "Normes (grilles)",
      "Lots (cadastre)",
      "Périmètres TOD",
    ]) {
      expect(scorecard!.textContent).toContain(label);
    }
    // Preuve signaux : « n signaux · n avec citation vérifiable ».
    expect(scorecard!.textContent).toContain("2 avec citation vérifiable");
  });

  it("clic ville dans le RAIL → même drawer scorecard", async () => {
    const { container } = renderView();
    const delsonRow = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.rail-city-row"),
    ).find((r) => r.textContent?.includes("Delson"));
    expect(delsonRow).toBeDefined();
    await fireEvent.click(delsonRow!);
    const scorecard = container.querySelector('[data-testid="source-scorecard"]');
    expect(scorecard).not.toBeNull();
    expect(scorecard!.textContent).toContain("Delson");
  });
});

// ── 2. Sélection ville → drill zones ─────────────────────────────────────────

describe("SourceCoverageMap — sélection ville → drill zones", () => {
  it("clic ville → zones chargées et PEINTES via le socle, segment Ville actif", async () => {
    const { getByTestId } = renderView();
    await fireEvent.click(getByTestId("stub-city-delson"));

    expect(loadSignauxZones).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadSignauxZones).mock.calls[0][0]).toBe("delson");

    await waitFor(() => {
      const zones = lastPaintedZones();
      expect(zones.features.length).toBe(2);
      expect(zones.features.map((f) => f.properties.code)).toEqual([
        "H-01",
        "C-02",
      ]);
    });

    // Drill segmenté : Ville actif, Zone ACTIVÉ (zones configurées).
    expect(getByTestId("stub-segment-Ville").dataset.active).toBe("true");
    expect(
      (getByTestId("stub-segment-Zone") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("segment « Zone » → sélectionne la 1re zone (exergue) + zoom bbox", async () => {
    const { getByTestId } = renderView();
    await fireEvent.click(getByTestId("stub-city-delson"));
    await waitFor(() => expect(lastPaintedZones().features.length).toBe(2));

    await fireEvent.click(getByTestId("stub-segment-Zone"));

    expect(getByTestId("stub-segment-Zone").dataset.active).toBe("true");
    const zones = lastPaintedZones();
    const h01 = zones.features.find((f) => f.properties.code === "H-01");
    expect(h01?.properties.isSelected).toBe(true);
    // #12 — cadrage caméra sur la bbox de la zone sélectionnée.
    expect(callsOf("fitMapToBounds").length).toBeGreaterThan(0);
  });

  it("clic aplat zone → sélection exclusive ; re-clic → retour niveau Ville", async () => {
    const { getByTestId } = renderView();
    await fireEvent.click(getByTestId("stub-city-delson"));
    await waitFor(() => expect(lastPaintedZones().features.length).toBe(2));

    await fireEvent.click(getByTestId("stub-zone-h01"));
    expect(getByTestId("stub-segment-Zone").dataset.active).toBe("true");

    await fireEvent.click(getByTestId("stub-zone-h01"));
    expect(getByTestId("stub-segment-Ville").dataset.active).toBe("true");
    const zones = lastPaintedZones();
    expect(zones.features.every((f) => f.properties.isSelected !== true)).toBe(
      true,
    );
  });

  it("segment « Province » → désélection (drawer fermé) + dézoom initial", async () => {
    const { container, getByTestId } = renderView();
    await fireEvent.click(getByTestId("stub-city-delson"));
    expect(
      container.querySelector('[data-testid="source-scorecard"]'),
    ).not.toBeNull();

    await fireEvent.click(getByTestId("stub-segment-Province"));

    expect(
      container.querySelector('[data-testid="source-scorecard"]'),
    ).toBeNull();
    expect(callsOf("resetToInitialView").length).toBeGreaterThan(0);
    expect(getByTestId("stub-segment-Province").dataset.active).toBe("true");
  });
});

// ── 3. Portée (radio exclusif) → liste + carte ───────────────────────────────

describe("SourceCoverageMap — la portée pilote la liste ET la carte", () => {
  it("défaut « Toutes » : 4 villes listées, opacité UNIFORME passée au socle", () => {
    const { container, getByTestId } = renderView();
    expect(container.querySelectorAll("button.rail-city-row").length).toBe(4);
    expect(getByTestId("stub-map").dataset.fillOpacity).toBe("0.62");
  });

  it("radio « Focus QA » → liste réduite aux villes QA ET surbrillance carte", async () => {
    const { container, getByTestId } = renderView();
    const radios = getAllByRole(container, "radio") as HTMLInputElement[];
    await fireEvent.click(radios[0]); // « Focus QA : 4 villes »

    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.rail-city-row"),
    );
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Delson"),
      expect.stringContaining("Sainte-Catherine"),
    ]);

    // Coloration carte : expression match — QA opaques, le reste atténué.
    const expr = JSON.parse(
      getByTestId("stub-map").dataset.fillOpacity ?? "null",
    ) as unknown[];
    expect(expr[0]).toBe("match");
    expect(expr).toContain(0.88);
    expect(expr).toContain(0.18);
  });

  it("radio « 30 villes à signaux » → villes à signaux listées, expression focus-30", async () => {
    const { container, getByTestId } = renderView();
    const radios = getAllByRole(container, "radio") as HTMLInputElement[];
    await fireEvent.click(radios[1]); // « 30 villes à signaux »

    const rows = container.querySelectorAll("button.rail-city-row");
    // delson(17) · sainte-catherine(16) · la-prairie(14) ont des signaux ;
    // rimouski (0 signal) est exclue MALGRÉ sa présence en « Toutes ».
    expect(rows.length).toBe(3);

    const expr = JSON.parse(
      getByTestId("stub-map").dataset.fillOpacity ?? "null",
    ) as unknown[];
    expect(expr[0]).toBe("match");
  });

  it("EXCLUSIF : revenir sur « Toutes » restaure la liste et l'opacité uniforme", async () => {
    const { container, getByTestId } = renderView();
    const radios = getAllByRole(container, "radio") as HTMLInputElement[];
    await fireEvent.click(radios[0]);
    await fireEvent.click(radios[2]); // « Toutes »
    expect(container.querySelectorAll("button.rail-city-row").length).toBe(4);
    expect(getByTestId("stub-map").dataset.fillOpacity).toBe("0.62");
  });
});
