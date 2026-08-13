/**
 * SourceCoverageMap — intégration de la vue Couverture avec le MÊME mode
 * d'interaction que Signaux (socle stubé, loader zones mocké) :
 *
 *   1. DRAWER droit + carte = les 20 nouveaux KPI de la matrice.
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
import {
  PALIER_KPIS_20,
  type PalierCellStatus,
  type PalierMatrix,
} from "$lib/palier/palier-matrix-client.js";

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
  prioritySignals = 0,
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
      priority: prioritySignals,
      freshness: signalCount > 0 ? "fresh" : "unknown",
    },
    // served: false → la scorecard NE déclenche PAS le fetch lazy des grilles.
    l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    normes: {
      state: "absent",
      freshness: "unknown",
      measured: false,
      available: null,
    },
    l5Lots: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus,
    nextMarginalGain: null,
  };
}

// Portée « Villes à signaux précoces » = villes portant ≥ 1 signal PRIORITAIRE
// z∩m∩p (ni proximité, ni volume brut) : rimouski a 12 signaux mais 0
// prioritaire → exclue du focus30 même si listée en « Toutes ».
const CITIES: CityCoverage[] = [
  city("delson", "Delson", 12, "declared", 17, 1),
  city("sainte-catherine", "Sainte-Catherine", 20, "verified", 16, 1),
  city("la-prairie", "La Prairie", 5, "absent", 14, 1),
  city("rimouski", "Rimouski", 480, "verified", 12, 0),
];

const RESPONSE: CoverageResponse = {
  generatedAt: "2026-07-01T00:00:00Z",
  totals: { cities: 4, l1Raw: 4, l2Graph: 4, signals: 4, l4Zonage: 0, l5Lots: 0 },
  cities: CITIES,
};

const KPI1_STATUS: PalierCellStatus[] = [
  "complete",
  "incomplete",
  "na",
  "unknown",
];
const MATRIX: PalierMatrix = {
  contract: "palier-matrix/v1",
  subset: "B",
  label: "cohorte B′ by-city",
  kpis: PALIER_KPIS_20,
  cities: CITIES.map((c, cityIndex) => ({
    citySlug: c.citySlug,
    cityName: c.cityName,
    cells: PALIER_KPIS_20.map((kpi) => ({
      kpiId: kpi.id,
      status: kpi.id === "kpi01" ? KPI1_STATUS[cityIndex]! : "unknown",
      source: "fixture",
    })),
  })),
  denominator: CITIES.length,
};

function renderView() {
  return render(SourceCoverageMap, {
    props: {
      cities: CITIES,
      response: RESPONSE,
      loading: false,
      error: null,
      onReload: () => {},
      matrixLoader: async () => MATRIX,
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

// ── 1. Carte + drawer = nouveaux KPI ─────────────────────────────────────────

describe("SourceCoverageMap — nouveaux KPI", () => {
  it("colore la carte avec le KPI actif et expose les 20 vrais libellés", async () => {
    const { getByTestId } = renderView();
    await waitFor(() => {
      expect(getByTestId("stub-legend").textContent).toContain("KPI 01 · Zonage");
      const expr = JSON.parse(getByTestId("stub-map").dataset.fillColor ?? "null") as unknown[];
      expect(expr).toContain("#16a34a");
      expect(expr).toContain("#f59e0b");
    });
    const select = getByTestId("coverage-kpi-select") as HTMLSelectElement;
    expect(select.options).toHaveLength(20);
    expect(Array.from(select.options).every((option) => !/^KPI \d{2}$/.test(option.text))).toBe(true);
    await fireEvent.change(select, { target: { value: "kpi15" } });
    expect(getByTestId("stub-legend").textContent).toContain("Champs lot · superficie");
  });

  it("sans sélection : placeholder, AUCUN ancien panneau", () => {
    const { container } = renderView();
    expect(container.querySelector('[data-testid="source-scorecard"]')).toBeNull();
    expect(container.querySelector('[data-testid="coverage-kpi-panel"]')).toBeNull();
    expect(container.textContent).toContain("Cliquez une ville");
  });

  it("clic ville sur la CARTE → panneau des 20 KPI dans le drawer", async () => {
    const { container, getByTestId } = renderView();
    await fireEvent.click(getByTestId("stub-city-delson"));

    const panel = container.querySelector('[data-testid="coverage-kpi-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("Delson");
    expect(panel!.querySelectorAll('[data-testid^="coverage-kpi-kpi"]')).toHaveLength(20);
    expect(panel!.textContent).toContain("KPI 04 · PV");
    expect(panel!.textContent).toContain("(déf. KPI en attente contrat API geo)");
    expect(container.querySelector('[data-testid="source-scorecard"]')).toBeNull();
  });

  it("clic ville dans le RAIL → même panneau KPI", async () => {
    const { container } = renderView();
    const delsonRow = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.rail-city-row"),
    ).find((r) => r.textContent?.includes("Delson"));
    expect(delsonRow).toBeDefined();
    await fireEvent.click(delsonRow!);
    const panel = container.querySelector('[data-testid="coverage-kpi-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("Delson");
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
      container.querySelector('[data-testid="coverage-kpi-panel"]'),
    ).not.toBeNull();

    await fireEvent.click(getByTestId("stub-segment-Province"));

    expect(
      container.querySelector('[data-testid="coverage-kpi-panel"]'),
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

  it("radio « Villes à signaux précoces » → villes à signal prioritaire listées, expression focus", async () => {
    const { container, getByTestId } = renderView();
    const radios = getAllByRole(container, "radio") as HTMLInputElement[];
    await fireEvent.click(radios[1]); // « Villes à signaux précoces »

    const rows = container.querySelectorAll("button.rail-city-row");
    // delson · sainte-catherine · la-prairie portent 1 signal prioritaire
    // z∩m∩p ; rimouski (12 signaux, 0 prioritaire) est exclue MALGRÉ son
    // volume — le focus n'est pas un top-N par nombre de signaux.
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
