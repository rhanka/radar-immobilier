/**
 * Reload-by-icon contract for SignauxSelPanel bucket headers.
 *
 * Owner contract: no big « X indisponibles » cards, no « Réessayer »
 * buttons. A failed section shows an exclamation trigger at the TOP RIGHT
 * of its nested-card header, in place of « n/d ». The trigger opens a DS
 * menu with « Recharger »; during the reload a spinning wheel replaces
 * the exclamation; on success the counter comes back; on a new failure
 * the exclamation comes back.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import type { MunicipalityT } from "@radar/domain";
import type { CityMapEntry } from "$lib/maps/maps-data.js";
import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";
import Harness from "./SignauxSelPanelHarness.svelte";

function makeCity(): CityMapEntry {
  const municipality: MunicipalityT = {
    slug: "delson",
    name: "Delson",
    mrc: "Roussillon",
    lat: 45.27,
    lon: -73.55,
    population: 11000,
    distanceToMtlKm: 20,
    priorityRank: 12,
    excluded: false,
    excludedReason: null,
    deprioritized: false,
  };
  return { municipality, signalCount6m: 0, subsetCounts: {}, vivierV2Counts: null };
}

function makeZonesResponse(codes: string[]): GeoZonesResponse {
  return {
    ok: true,
    citySlug: "delson",
    source: "official",
    resolutionStatus: "official",
    geometryStatus: "official",
    zoneCount: codes.length,
    warnings: [],
    featureCollection: {
      type: "FeatureCollection",
      features: codes.map((code) => ({
        type: "Feature" as const,
        geometry: null,
        properties: {
          code,
          citySlug: "delson",
          geometryStatus: "official" as const,
          confidence: 1,
          source: "official-zone" as const,
          lotCount: 0,
          lots: [],
        },
      })),
    },
  };
}

afterEach(() => cleanup());

describe("SignauxSelPanel — rechargement par icône (en-têtes Zones/Lots)", () => {
  it("échec zones : icône ! en haut à droite, ni grande carte ni Réessayer ni n/d", () => {
    const { container, getByTestId, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesError: "Zones indisponibles.",
      },
    });
    const head = getByTestId("zones-bucket-head");
    const trigger = getByTestId("zones-reload-trigger");
    expect(head.contains(trigger)).toBe(true);
    expect(trigger.getAttribute("aria-label")).toBe(
      "Rechargement impossible, ouvrir les actions",
    );
    expect(head.textContent).not.toContain("n/d");
    expect(queryByText("Réessayer")).toBeNull();
    expect(container.querySelector(".sel-alert")).toBeNull();
    expect(getByTestId("lots-bucket-head").textContent).not.toContain("n/d");
  });

  it("clic icône → menu DS « Recharger » → callback, menu refermé", async () => {
    const onRetryGeo = vi.fn();
    const { getByTestId, queryByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesError: "Zones indisponibles.",
        onRetryGeo,
      },
    });
    await fireEvent.click(getByTestId("zones-reload-trigger"));
    const action = getByTestId("zones-reload-action");
    expect(action.textContent).toContain("Recharger");
    expect(action.getAttribute("role")).toBe("menuitem");
    await fireEvent.click(action);
    expect(onRetryGeo).toHaveBeenCalledTimes(1);
    expect(queryByTestId("zones-reload-action")).toBeNull();
  });

  it("clavier : flèche bas ouvre le menu, Échap le ferme et rend le focus", async () => {
    const { getByTestId, queryByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsError: "Lots indisponibles.",
        onRetryGeo: vi.fn(),
      },
    });
    const trigger = getByTestId("lots-reload-trigger");
    await fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(getByTestId("lots-reload-action")).toBeTruthy();
    await fireEvent.keyDown(getByTestId("lots-reload-action"), { key: "Escape" });
    expect(queryByTestId("lots-reload-action")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("cycle complet : échec → Recharger → wheel → succès (compteur) → nouvel échec", async () => {
    const onRetryGeo = vi.fn();
    const view = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesError: "Zones indisponibles.",
        onRetryGeo,
      },
    });
    await fireEvent.click(view.getByTestId("zones-reload-trigger"));
    await fireEvent.click(view.getByTestId("zones-reload-action"));
    expect(onRetryGeo).toHaveBeenCalledTimes(1);

    await view.rerender({
      selectedCity: makeCity(),
      detailNodes: [],
      zonesError: null,
      zonesLoading: true,
      onRetryGeo,
    });
    expect(view.getByTestId("zones-reload-spinner")).toBeTruthy();
    expect(view.queryByTestId("zones-reload-trigger")).toBeNull();

    await view.rerender({
      selectedCity: makeCity(),
      detailNodes: [],
      zonesError: null,
      zonesLoading: false,
      zonesResponse: makeZonesResponse(["H-431"]),
      onRetryGeo,
    });
    expect(view.queryByTestId("zones-reload-spinner")).toBeNull();
    expect(view.queryByTestId("zones-reload-trigger")).toBeNull();
    expect(view.getByTestId("zones-bucket-head").textContent).toContain("1");

    await view.rerender({
      selectedCity: makeCity(),
      detailNodes: [],
      zonesError: "Zones indisponibles.",
      zonesResponse: null,
      onRetryGeo,
    });
    expect(view.getByTestId("zones-reload-trigger")).toBeTruthy();
    expect(view.getByTestId("zones-bucket-head").textContent).not.toContain("n/d");
  });

  it("échec signaux : même patron sur Signaux et Règlement (retry détail)", async () => {
    const onRetryDetail = vi.fn();
    const { getByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        detailError: "Projection du vivier indisponible.",
        onRetryDetail,
      },
    });
    await fireEvent.click(getByTestId("signaux-reload-trigger"));
    await fireEvent.click(getByTestId("signaux-reload-action"));
    expect(onRetryDetail).toHaveBeenCalledTimes(1);
    expect(getByTestId("reglements-bucket-count").textContent).not.toContain("n/d");
  });
});
