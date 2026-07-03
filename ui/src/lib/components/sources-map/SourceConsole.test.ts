/**
 * QA léger — SourceConsole : périmètre « Province (1104) / Focus 30 ».
 *
 * Vérifie :
 *   1. Défaut = Province : toutes les villes (actives) sont listées, le segment
 *      « Province (1104) » est pressé.
 *   2. Focus 30 actif : SEULES les villes focus (priorityRank ≤ 30, même
 *      critère `isFocusCity` que le toggle de la carte Couverture) restent
 *      listées ; les hors-focus (rank > 30 ou null) disparaissent.
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
): CityCoverage {
  return {
    citySlug: slug,
    cityName: name,
    mrc: null,
    priorityRank,
    l1Raw: { state: "verified", count: 3, freshness: "fresh" },
    l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
    signals: { state: "absent", count: 0, withCitation: 0, freshness: "unknown" },
    l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus: "declared",
    nextMarginalGain: null,
  };
}

// 3 villes focus (rank ≤ 30) + 2 hors-focus (rank > 30 / rank null).
const FOCUS_CITIES = [
  makeCity("longueuil", "Longueuil", 1),
  makeCity("brossard", "Brossard", 12),
  makeCity("chambly", "Chambly", 30),
];
const NON_FOCUS_CITIES = [
  makeCity("delson", "Delson", 45),
  makeCity("st-damase", "Saint-Damase", null),
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

  it("Focus 30 actif : SEULES les villes focus (priorityRank ≤ 30) sont listées", async () => {
    const { container, getByRole, getByTestId } = renderConsole();
    await fireEvent.click(getByRole("button", { name: "Focus 30" }));

    expect(getByRole("button", { name: "Focus 30" }).getAttribute("aria-pressed")).toBe("true");
    const names = listedCityNames(container);
    expect(names.sort()).toEqual(FOCUS_CITIES.map((c) => c.cityName).sort());
    // Aucune hors-focus (rank > 30 ou null) ne doit rester.
    for (const c of NON_FOCUS_CITIES) expect(names).not.toContain(c.cityName);
    // Compteur cohérent avec le périmètre filtré.
    expect(getByTestId("console-count").textContent).toContain("3 villes");
  });

  it("le périmètre se combine à la recherche existante", async () => {
    const { container, getByRole, getByPlaceholderText } = renderConsole();
    await fireEvent.click(getByRole("button", { name: "Focus 30" }));
    // « Delson » est hors-focus : la recherche ne doit RIEN retourner en Focus 30.
    await fireEvent.input(getByPlaceholderText("Rechercher une ville / MRC…"), {
      target: { value: "delson" },
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
