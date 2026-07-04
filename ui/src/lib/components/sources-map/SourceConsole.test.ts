/**
 * QA léger — SourceConsole : périmètre « Province (1104) / Villes à signaux
 * précoces ».
 *
 * Vérifie :
 *   1. Défaut = Province : toutes les villes (actives) sont listées, le segment
 *      « Province (1104) » est pressé.
 *   2. Focus actif : SEULES les villes portant ≥ 1 signal PRIORITAIRE z∩m∩p
 *      (`computeFocusScope` — zonage ∩ multifamilial 4+ ∩ précoce, la cohorte
 *      « 33 » de l'axe « 30 villes / 33 signaux précoces ») restent listées :
 *      - les villes SANS signal disparaissent MÊME proches de Montréal (bug
 *        Steve no 1 : priorityRank ≤ 30 gardait Kirkland/Brossard sans signal) ;
 *      - les villes à GROS volume de signaux SANS prioritaire disparaissent
 *        aussi (bug no 2 : le focus n'est pas un top-N par nombre de signaux).
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
  prioritySignals = 0,
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
      priority: prioritySignals,
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

// 3 villes à SIGNAUX PRIORITAIRES z∩m∩p (focus — chiffres réels S3 2026-07-03 :
// Mont-Tremblant 2 prioritaires, LOIN rang 351 ; Sainte-Catherine 1 ;
// Saint-Amable 1) + 2 villes SANS signal (hors-focus MÊME proches : Kirkland
// rang 30, Brossard rang 12) + 1 ville à GROS volume SANS prioritaire (Lyster,
// 400 signaux : hors-focus — le focus n'est PAS un top-N par volume).
const FOCUS_CITIES = [
  makeCity("mont-tremblant", "Mont-Tremblant", 351, 13, 2),
  makeCity("sainte-catherine", "Sainte-Catherine", 20, 16, 1),
  makeCity("saint-amable", "Saint-Amable", 61, 15, 1),
];
const NON_FOCUS_CITIES = [
  makeCity("kirkland", "Kirkland", 30, 0, 0),
  makeCity("brossard", "Brossard", 12, 0, 0),
  makeCity("lyster", "Lyster", 550, 400, 0),
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

const SEG_FOCUS = "Villes à signaux précoces";

describe("SourceConsole — périmètre Province / Villes à signaux précoces", () => {
  it("défaut : Province — toutes les villes actives listées, segment Province pressé", () => {
    const { container, getByRole } = renderConsole();
    const province = getByRole("button", { name: "Province (1104)" });
    const focus = getByRole("button", { name: SEG_FOCUS });
    expect(province.getAttribute("aria-pressed")).toBe("true");
    expect(focus.getAttribute("aria-pressed")).toBe("false");
    expect(listedCityNames(container).sort()).toEqual(
      CITIES.map((c) => c.cityName).sort(),
    );
  });

  it("focus actif : SEULES les villes à signaux PRIORITAIRES z∩m∩p sont listées", async () => {
    const { container, getByRole, getByTestId } = renderConsole();
    await fireEvent.click(getByRole("button", { name: SEG_FOCUS }));

    expect(getByRole("button", { name: SEG_FOCUS }).getAttribute("aria-pressed")).toBe("true");
    const names = listedCityNames(container);
    expect(names.sort()).toEqual(FOCUS_CITIES.map((c) => c.cityName).sort());
    // Mont-Tremblant (2 signaux prioritaires, rang proximité 351) EST focus.
    expect(names).toContain("Mont-Tremblant");
    // Ni les villes sans signal (Kirkland/Brossard, proches), ni Lyster
    // (400 signaux SANS prioritaire — le volume brut ne compte pas).
    for (const c of NON_FOCUS_CITIES) expect(names).not.toContain(c.cityName);
    // Compteur cohérent avec le périmètre filtré.
    expect(getByTestId("console-count").textContent).toContain("3 villes");
  });

  it("le périmètre se combine à la recherche existante", async () => {
    const { container, getByRole, getByPlaceholderText } = renderConsole();
    await fireEvent.click(getByRole("button", { name: SEG_FOCUS }));
    // « Lyster » est hors-focus (0 prioritaire) : la recherche ne retourne RIEN en focus.
    await fireEvent.input(getByPlaceholderText("Rechercher une ville / MRC…"), {
      target: { value: "lyster" },
    });
    expect(listedCityNames(container)).toEqual([]);
    expect(within(container).getByText("Aucune ville ne correspond au filtre.")).toBeTruthy();
  });

  it("retour Province : la liste complète revient", async () => {
    const { container, getByRole } = renderConsole();
    await fireEvent.click(getByRole("button", { name: SEG_FOCUS }));
    await fireEvent.click(getByRole("button", { name: "Province (1104)" }));
    expect(listedCityNames(container).sort()).toEqual(
      CITIES.map((c) => c.cityName).sort(),
    );
  });
});
