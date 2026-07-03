/**
 * QA léger — SourceConsole : périmètre « Province (1104) / Focus 30 ».
 *
 * Vérifie :
 *   1. Défaut = Province : toutes les villes (actives) sont listées, le segment
 *      « Province (1104) » est pressé.
 *   2. Focus 30 actif : SEULES les villes À SIGNAUX (`computeFocusScope`, même
 *      critère que le toggle de la carte Couverture) restent listées ; les
 *      villes SANS signal disparaissent MÊME proches de Montréal (bug Steve :
 *      l'ancien critère priorityRank ≤ 30 gardait Kirkland/Brossard sans signal
 *      et excluait Mont-Tremblant, 13 signaux, rang proximité 351).
 *   3. Le périmètre se COMBINE aux filtres existants (statut + recherche).
 *   4. Retour Province : la liste complète revient.
 *
 * Environnement jsdom — aucun docker, aucune API (données fabriquées).
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/svelte";
import SourceConsole from "./SourceConsole.svelte";
import type {
  CityCoverage,
  CoverageResponse,
} from "$lib/sources/source-coverage-client.js";

/** jsdom ne fournit pas window.matchMedia (mode couleur DS). Stub non-matché. */
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => cleanup());

/** Ville fabriquée : ACTIVE (PV vérifiés) pour passer le filtre « Actives ». */
function makeCity(
  slug: string,
  name: string,
  priorityRank: number | null,
  signalCount = 0,
): CityCoverage {
  return {
    citySlug: slug,
    cityName: name,
    mrc: null,
    priorityRank,
    l1Raw: { state: "verified", count: 3, freshness: "fresh" },
    l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
    signals: {
      state: signalCount > 0 ? "verified" : "absent",
      count: signalCount,
      withCitation: 0,
      freshness: signalCount > 0 ? "fresh" : "unknown",
    },
    l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus: "declared",
    nextMarginalGain: null,
  };
}

// 3 villes À SIGNAUX (focus — dont Mont-Tremblant, LOIN : rang proximité 351)
// + 2 villes SANS signal (hors-focus MÊME proches : Kirkland rang 30, Brossard
// rang 12 — l'ancien critère proximité les gardait à tort).
const FOCUS_CITIES = [
  makeCity("mont-tremblant", "Mont-Tremblant", 351, 13),
  makeCity("saint-eustache", "Saint-Eustache", 55, 221),
  makeCity("lery", "Léry", 35, 28),
];
const NON_FOCUS_CITIES = [
  makeCity("kirkland", "Kirkland", 30, 0),
  makeCity("brossard", "Brossard", 12, 0),
];
const CITIES = [...FOCUS_CITIES, ...NON_FOCUS_CITIES];

const RESPONSE: CoverageResponse = {
  generatedAt: "2026-07-01T00:00:00Z",
  totals: { cities: CITIES.length, l1Raw: CITIES.length, l2Graph: 0, signals: 0, l4Zonage: 0, l5Lots: 0 },
  cities: CITIES,
};

function renderConsole() {
  return render(SourceConsole, {
    props: {
      cities: CITIES,
      response: RESPONSE,
      loading: false,
      error: null,
      onReload: () => {},
    },
  });
}

/** Noms de villes affichés dans le corps de la table. */
function listedCityNames(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll("tbody td .font-medium"),
  ).map((el) => el.textContent?.trim() ?? "");
}

describe("SourceConsole — périmètre Province / Focus 30", () => {
  it("défaut : Province — toutes les villes actives listées, segment Province pressé", () => {
    const { container, getByRole } = renderConsole();
    const province = getByRole("button", { name: "Province (1104)" });
    const focus = getByRole("button", { name: "Focus 30" });
    expect(province.getAttribute("aria-pressed")).toBe("true");
    expect(focus.getAttribute("aria-pressed")).toBe("false");
    expect(listedCityNames(container).sort()).toEqual(
      CITIES.map((c) => c.cityName).sort(),
    );
  });

  it("Focus 30 actif : SEULES les villes À SIGNAUX sont listées (bug Steve corrigé)", async () => {
    const { container, getByRole, getByTestId } = renderConsole();
    await fireEvent.click(getByRole("button", { name: "Focus 30" }));

    expect(getByRole("button", { name: "Focus 30" }).getAttribute("aria-pressed")).toBe("true");
    const names = listedCityNames(container);
    expect(names.sort()).toEqual(FOCUS_CITIES.map((c) => c.cityName).sort());
    // Mont-Tremblant (13 signaux, rang proximité 351) EST focus.
    expect(names).toContain("Mont-Tremblant");
    // Aucune ville SANS signal ne reste, même proche (Kirkland 30, Brossard 12).
    for (const c of NON_FOCUS_CITIES) expect(names).not.toContain(c.cityName);
    // Compteur cohérent avec le périmètre filtré.
    expect(getByTestId("console-count").textContent).toContain("3 villes");
  });

  it("le périmètre se combine à la recherche existante", async () => {
    const { container, getByRole, getByPlaceholderText } = renderConsole();
    await fireEvent.click(getByRole("button", { name: "Focus 30" }));
    // « Kirkland » est hors-focus (0 signal) : la recherche ne retourne RIEN en Focus 30.
    await fireEvent.input(getByPlaceholderText("Rechercher une ville / MRC…"), {
      target: { value: "kirkland" },
    });
    expect(listedCityNames(container)).toEqual([]);
    expect(within(container).getByText("Aucune ville ne correspond au filtre.")).toBeTruthy();
  });

  it("retour Province : la liste complète revient", async () => {
    const { container, getByRole } = renderConsole();
    await fireEvent.click(getByRole("button", { name: "Focus 30" }));
    await fireEvent.click(getByRole("button", { name: "Province (1104)" }));
    expect(listedCityNames(container).sort()).toEqual(
      CITIES.map((c) => c.cityName).sort(),
    );
  });
});
