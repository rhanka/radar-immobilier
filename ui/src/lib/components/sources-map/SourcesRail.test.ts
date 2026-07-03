/**
 * QA léger — SourcesRail : sélecteur RADIO de portée MUTUELLEMENT EXCLUSIF
 * (« Focus QA : 4 villes » / « 30 villes à signaux » / « Toutes ») + liste
 * plate de villes filtrée par la portée (parité d'interaction SignauxRail).
 *
 * Aucun docker, aucune API. jsdom + @testing-library/svelte.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, getAllByRole } from "@testing-library/svelte";
import SourcesRail from "./SourcesRail.svelte";
import type { CoverageScope } from "$lib/sources/coverage-scope.js";
import type {
  CityCoverage,
  CoverageState,
} from "$lib/sources/source-coverage-client.js";

afterEach(() => cleanup());

/** Fixture minimale — slug/nom/MRC/rang/pire statut + nb de signaux (focus30). */
function city(
  citySlug: string,
  cityName: string,
  priorityRank: number | null,
  worstStatus: CoverageState = "absent",
  signalCount = 0,
): CityCoverage {
  return {
    citySlug,
    cityName,
    mrc: `MRC-${cityName}`,
    priorityRank,
    l1Raw: { state: "absent", count: 0, freshness: "unknown" },
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
    worstStatus,
    nextMarginalGain: null,
  };
}

// delson + sainte-catherine = villes QA (REFERENCE_CITIES), à signaux ;
// la-prairie = à signaux seulement (focus30) ; rimouski = 0 signal → hors
// focus30 (présence de signaux, plus priorityRank).
const CITIES: CityCoverage[] = [
  city("delson", "Delson", 12, "declared", 17),
  city("sainte-catherine", "Sainte-Catherine", 20, "verified", 16),
  city("la-prairie", "La Prairie", 5, "absent", 14),
  city("rimouski", "Rimouski", 480, "verified", 0),
];

function renderRail(
  props: Partial<{
    scope: CoverageScope;
    selectedSlug: string | null;
    onScopeChange: (s: CoverageScope) => void;
    onSelectCity: (c: CityCoverage) => void;
  }> = {},
) {
  return render(SourcesRail, {
    props: {
      cities: CITIES,
      scope: props.scope ?? "all",
      selectedSlug: props.selectedSlug ?? null,
      onScopeChange: props.onScopeChange ?? (() => {}),
      onSelectCity: props.onSelectCity ?? (() => {}),
    },
  });
}

/** Radios de portée dans l'ordre [QA 4, focus 30, Toutes]. */
function getScopeRadios(
  container: HTMLElement,
): [HTMLInputElement, HTMLInputElement, HTMLInputElement] {
  const radios = getAllByRole(container, "radio") as HTMLInputElement[];
  expect(radios.length).toBe(3);
  return [radios[0], radios[1], radios[2]];
}

function cityRows(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button.rail-city-row"),
  );
}

describe("SourcesRail — radio de portée MUTUELLEMENT EXCLUSIF", () => {
  it("3 radios, libellés attendus, défaut « Toutes » coché seul", () => {
    const { container } = renderRail();
    const [qa, focus, all] = getScopeRadios(container);
    expect(qa.checked).toBe(false);
    expect(focus.checked).toBe(false);
    expect(all.checked).toBe(true);
    // Radios natifs partageant le même name → exclusivité garantie.
    expect(new Set([qa.name, focus.name, all.name]).size).toBe(1);
    expect(container.textContent).toContain("Focus QA : 4 villes");
    expect(container.textContent).toContain("30 villes à signaux");
    expect(container.textContent).toContain("Toutes");
  });

  it("scope=qa4 → SEUL le radio QA est coché (exclusif)", () => {
    const { container } = renderRail({ scope: "qa4" });
    const [qa, focus, all] = getScopeRadios(container);
    expect(qa.checked).toBe(true);
    expect(focus.checked).toBe(false);
    expect(all.checked).toBe(false);
  });

  it("cocher « 30 villes à signaux » → onScopeChange('focus30'), une fois", async () => {
    const spy = vi.fn();
    const { container } = renderRail({ onScopeChange: spy });
    const [, focus] = getScopeRadios(container);
    await fireEvent.click(focus);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("focus30");
  });

  it("cocher « Focus QA » → onScopeChange('qa4')", async () => {
    const spy = vi.fn();
    const { container } = renderRail({ onScopeChange: spy });
    const [qa] = getScopeRadios(container);
    await fireEvent.click(qa);
    expect(spy).toHaveBeenCalledWith("qa4");
  });
});

describe("SourcesRail — la liste de villes reflète la portée", () => {
  it("« Toutes » → les 4 villes, triées par rang puis nom", () => {
    const { container } = renderRail({ scope: "all" });
    const rows = cityRows(container);
    expect(rows.length).toBe(4);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("La Prairie"),
      expect.stringContaining("Delson"),
      expect.stringContaining("Sainte-Catherine"),
      expect.stringContaining("Rimouski"),
    ]);
  });

  it("« 30 villes à signaux » → seules les villes À SIGNAUX (Rimouski 0 signal exclue)", () => {
    const { container } = renderRail({ scope: "focus30" });
    const rows = cityRows(container);
    // delson (17), sainte-catherine (16), la-prairie (14) ont des signaux.
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.textContent?.includes("Rimouski"))).not.toContain(true);
  });

  it("« Focus QA : 4 villes » → seules les villes de contrôle (Delson incluse)", () => {
    const { container } = renderRail({ scope: "qa4" });
    const rows = cityRows(container);
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("Delson");
    expect(rows[1].textContent).toContain("Sainte-Catherine");
  });

  it("chaque ligne porte le badge tri-état Servi / Partiel / Non couvert", () => {
    const { container } = renderRail({ scope: "qa4" });
    const rows = cityRows(container);
    expect(rows[0].textContent).toContain("Partiel"); // Delson declared
    expect(rows[1].textContent).toContain("Servi"); // Sainte-Catherine verified
  });

  it("#5 (parité Signaux) — la ville sélectionnée reste listée hors portée", () => {
    const { container } = renderRail({ scope: "qa4", selectedSlug: "rimouski" });
    const rows = cityRows(container);
    expect(rows.length).toBe(3);
    const active = container.querySelector(".rail-city-row--active");
    expect(active).not.toBeNull();
    expect(active!.textContent).toContain("Rimouski");
  });

  it("cliquer une ville appelle onSelectCity avec la CityCoverage", async () => {
    const spy = vi.fn();
    const { container } = renderRail({ scope: "qa4", onSelectCity: spy });
    const delson = cityRows(container).find((r) =>
      r.textContent?.includes("Delson"),
    );
    expect(delson).toBeDefined();
    await fireEvent.click(delson!);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].citySlug).toBe("delson");
  });
});
