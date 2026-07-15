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
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/svelte";
import SourceConsole from "./SourceConsole.svelte";
import type {
  CityCoverage,
  CityGrilles,
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    normes: {
      state: "absent",
      freshness: "unknown",
      measured: false,
      available: null,
    },
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

function responseFor(
  cities: CityCoverage[],
  generatedAt = RESPONSE.generatedAt,
): CoverageResponse {
  return { ...RESPONSE, generatedAt, cities };
}

function renderConsole(cities = CITIES, generatedAt = RESPONSE.generatedAt) {
  return render(SourceConsole, {
    props: {
      cities,
      response: responseFor(cities, generatedAt),
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

describe("SourceConsole — Règlements & normes", () => {
  it("conserve une seule colonne et distingue cache froid et échec geo", () => {
    const cold = makeCity("froide", "Ville Froide", null);
    const unavailable: CityCoverage = {
      ...makeCity("indisponible", "Ville Indisponible", null),
      normes: {
        state: "declared",
        freshness: "unknown",
        measured: true,
        available: false,
        error: "geo-unreachable",
      },
    };
    const { container, getByRole, queryByRole } = renderConsole([cold, unavailable]);

    expect(getByRole("columnheader", { name: "Règlements & normes" })).toBeTruthy();
    expect(queryByRole("columnheader", { name: "Normes (grilles)" })).toBeNull();
    expect(container.querySelectorAll('[aria-label="Règlements & normes : Non mesuré"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="Règlements & normes : Indisponible"]')).toHaveLength(1);
    expect(container.textContent).not.toMatch(/densifie/i);
  });

  it("opens and dismisses a 24px detailed control from the keyboard", async () => {
    const measured: CityCoverage = {
      ...makeCity("mesuree", "Ville Mesurée", null),
      normes: {
        state: "verified",
        freshness: "fresh",
        measured: true,
        available: true,
        zoneCount: 4,
        numberMatched: 4,
        complete: true,
        zonesWithGrille: 1,
        zonesWithReglement: 2,
        zonesWithLegacyNormes: 1,
        zonesWithNormativeValues: 3,
        covered: 4,
      },
    };
    const { getByRole, queryByRole } = renderConsole([measured]);
    const control = getByRole("button", {
      name: "Règlements & normes : Servi",
    });

    expect(control.className).toContain("h-6");
    expect(control.className).toContain("w-6");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    await fireEvent.keyDown(control, { key: "Enter" });
    const tooltip = getByRole("tooltip");
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(tooltip.textContent).toContain("2/4 sources règlementaires");
    expect(tooltip.textContent).toContain("3/4 valeurs normatives");
    expect(tooltip.textContent).toContain("1/4 normes historiques");
    expect(tooltip.textContent).toContain("1/4 grilles PDF");
    expect(tooltip.textContent).toContain("delta ancien↔nouveau requis");

    await fireEvent.keyDown(control, { key: "Escape" });
    expect(queryByRole("tooltip")).toBeNull();
    await fireEvent.keyDown(control, { key: " " });
    expect(getByRole("tooltip")).toBeTruthy();
    await fireEvent.blur(control);
    expect(queryByRole("tooltip")).toBeNull();
  });

  it("announces zero served zones without four misleading zero ratios", async () => {
    const zeroZones: CityCoverage = {
      ...makeCity("zero-zones", "Ville Sans Zones", null),
      normes: {
        state: "absent",
        freshness: "fresh",
        measured: true,
        available: true,
        zoneCount: 0,
        numberMatched: 0,
        complete: true,
        zonesWithGrille: 0,
        zonesWithReglement: 0,
        zonesWithLegacyNormes: 0,
        zonesWithNormativeValues: 0,
        covered: 0,
      },
    };
    const { getByRole } = renderConsole([zeroZones]);
    const control = getByRole("button", {
      name: "Règlements & normes : Aucune zone servie",
    });
    await fireEvent.keyDown(control, { key: "Enter" });
    expect(getByRole("tooltip").textContent).toContain("Aucune zone servie");
    expect(getByRole("tooltip").textContent).not.toContain("0/0");
  });

  it("replaces Non mesuré with the scorecard lazy success immediately", async () => {
    const payload: CityGrilles = {
      citySlug: "transition-ok",
      available: true,
      zoneCount: 1,
      numberMatched: 1,
      complete: true,
      zonesWithGrille: 0,
      zonesWithReglement: 1,
      zonesWithLegacyNormes: 0,
      zonesWithNormativeValues: 1,
      covered: 1,
      state: "verified",
    };
    stubConsoleFetch(payload);
    const city = zonedCity(payload.citySlug, "Transition OK");
    const { getByRole } = renderConsole([city]);
    expect(getByRole("button", { name: /Non mesuré/ })).toBeTruthy();

    const cityControl = getByRole("button", {
      name: "Ouvrir la couverture de Transition OK",
    });
    await fireEvent.keyDown(cityControl, { key: "Enter" });
    await flushConsole();
    expect(cityControl.getAttribute("aria-expanded")).toBe("true");
    expect(getByRole("button", { name: /Règlements & normes : Servi/ })).toBeTruthy();
  });

  it("replaces Non mesuré with the scorecard lazy failure immediately", async () => {
    const payload: CityGrilles = {
      citySlug: "transition-fail",
      available: false,
      error: "invalid-response",
    };
    stubConsoleFetch(payload);
    const city = zonedCity(payload.citySlug, "Transition Fail");
    const { getByRole } = renderConsole([city]);
    expect(getByRole("button", { name: /Non mesuré/ })).toBeTruthy();

    await fireEvent.keyDown(
      getByRole("button", {
        name: "Ouvrir la couverture de Transition Fail",
      }),
      { key: "Enter" },
    );
    await flushConsole();
    expect(getByRole("button", { name: /Règlements & normes : Indisponible/ })).toBeTruthy();
  });

  it("ignores an in-flight lazy success after a refreshed bulk failure", async () => {
    const resolveLazy = stubDeferredConsoleFetch();
    const original = zonedCity("refresh-in-flight", "Refresh In Flight");
    const view = renderConsole([original], "2026-07-01T00:00:00Z");
    await fireEvent.keyDown(
      view.getByRole("button", { name: "Ouvrir la couverture de Refresh In Flight" }),
      { key: "Enter" },
    );
    await flushConsole();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/grilles"))).toBe(true);

    const refreshed: CityCoverage = {
      ...original,
      normes: {
        state: "declared",
        freshness: "unknown",
        measured: true,
        available: false,
        error: "geo-unreachable",
      },
    };
    await view.rerender({
      cities: [refreshed],
      response: responseFor([refreshed], "2026-07-02T00:00:00Z"),
    });
    expect(view.getByRole("button", { name: /Règlements & normes : Indisponible/ })).toBeTruthy();

    resolveLazy({
      citySlug: original.citySlug,
      available: true,
      zoneCount: 1,
      numberMatched: 1,
      complete: true,
      zonesWithGrille: 0,
      zonesWithReglement: 1,
      zonesWithLegacyNormes: 0,
      zonesWithNormativeValues: 1,
      covered: 1,
      state: "verified",
    });
    await flushConsole();

    expect(view.getByRole("button", { name: /Règlements & normes : Indisponible/ })).toBeTruthy();
    expect(view.queryByRole("button", { name: /Règlements & normes : Servi/ })).toBeNull();
  });

  it("ignores an in-flight lazy failure after refreshed verified bulk data", async () => {
    const resolveLazy = stubDeferredConsoleFetch();
    const original = zonedCity("refresh-in-flight-error", "Refresh In Flight Error");
    const view = renderConsole([original], "2026-07-01T00:00:00Z");
    await fireEvent.keyDown(
      view.getByRole("button", { name: "Ouvrir la couverture de Refresh In Flight Error" }),
      { key: "Enter" },
    );
    await flushConsole();

    const refreshed: CityCoverage = {
      ...original,
      normes: {
        state: "verified",
        freshness: "fresh",
        measured: true,
        available: true,
        zoneCount: 1,
        numberMatched: 1,
        complete: true,
        zonesWithGrille: 1,
        zonesWithReglement: 0,
        zonesWithLegacyNormes: 0,
        zonesWithNormativeValues: 0,
        covered: 1,
      },
    };
    await view.rerender({
      cities: [refreshed],
      response: responseFor([refreshed], "2026-07-02T00:00:00Z"),
    });
    expect(view.getByRole("button", { name: /Règlements & normes : Servi/ })).toBeTruthy();

    resolveLazy({
      citySlug: original.citySlug,
      available: false,
      error: "geo-unreachable",
    });
    await flushConsole();

    expect(view.getByRole("button", { name: /Règlements & normes : Servi/ })).toBeTruthy();
    expect(view.queryByRole("button", { name: /Règlements & normes : Indisponible/ })).toBeNull();
  });

  it("drops a verified overlay when refresh returns a newer failure", async () => {
    const lazy: CityGrilles = {
      citySlug: "refresh-verified",
      available: true,
      zoneCount: 1,
      numberMatched: 1,
      complete: true,
      zonesWithGrille: 0,
      zonesWithReglement: 1,
      zonesWithLegacyNormes: 0,
      zonesWithNormativeValues: 0,
      covered: 1,
      state: "verified",
    };
    stubConsoleFetch(lazy);
    const original = zonedCity(lazy.citySlug, "Refresh Verified");
    const view = renderConsole([original], "2026-07-01T00:00:00Z");
    await fireEvent.keyDown(
      view.getByRole("button", { name: "Ouvrir la couverture de Refresh Verified" }),
      { key: "Enter" },
    );
    await flushConsole();
    expect(view.getByRole("button", { name: /Règlements & normes : Servi/ })).toBeTruthy();

    const refreshed: CityCoverage = {
      ...original,
      normes: {
        state: "absent",
        freshness: "unknown",
        measured: true,
        available: false,
        error: "geo-unreachable",
      },
    };
    await view.rerender({
      cities: [refreshed],
      response: responseFor([refreshed], "2026-07-02T00:00:00Z"),
    });
    expect(view.getByRole("button", { name: /Indisponible/ })).toBeTruthy();
    expect(view.queryByRole("button", { name: /Règlements & normes : Servi/ })).toBeNull();
  });

  it("drops an error overlay when refresh returns newer verified bulk data", async () => {
    const lazy: CityGrilles = {
      citySlug: "refresh-error",
      available: false,
      error: "invalid-response",
    };
    stubConsoleFetch(lazy);
    const original = zonedCity(lazy.citySlug, "Refresh Error");
    const view = renderConsole([original], "2026-07-01T00:00:00Z");
    await fireEvent.keyDown(
      view.getByRole("button", { name: "Ouvrir la couverture de Refresh Error" }),
      { key: "Enter" },
    );
    await flushConsole();
    expect(view.getByRole("button", { name: /Indisponible/ })).toBeTruthy();

    const refreshed: CityCoverage = {
      ...original,
      normes: {
        state: "verified",
        freshness: "fresh",
        measured: true,
        available: true,
        zoneCount: 1,
        numberMatched: 1,
        complete: true,
        zonesWithGrille: 1,
        zonesWithReglement: 0,
        zonesWithLegacyNormes: 0,
        zonesWithNormativeValues: 0,
        covered: 1,
      },
    };
    await view.rerender({
      cities: [refreshed],
      response: responseFor([refreshed], "2026-07-01T00:00:00Z"),
    });
    expect(view.getByRole("button", { name: /Règlements & normes : Servi/ })).toBeTruthy();
    expect(view.queryByRole("button", { name: /Indisponible/ })).toBeNull();
  });
});

function zonedCity(slug: string, name: string): CityCoverage {
  return {
    ...makeCity(slug, name, null),
    l4Zonage: {
      state: "verified",
      served: true,
      servedBy: "geo",
      freshness: "fresh",
    },
  };
}

function stubConsoleFetch(payload: CityGrilles): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/grilles")
      ? payload
      : { generatedAt: null, cities: [] };
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  }));
}

function stubDeferredConsoleFetch(): (payload: CityGrilles) => void {
  let resolveGrilles!: (response: Response) => void;
  const grillesResponse = new Promise<Response>((resolve) => {
    resolveGrilles = resolve;
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/grilles")) return grillesResponse;
    return new Response(JSON.stringify({ generatedAt: null, cities: [] }), {
      headers: { "content-type": "application/json" },
    });
  }));
  return (payload) => resolveGrilles(new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  }));
}

async function flushConsole(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}
