/** SignauxRail A/transition mode and flat city-list contracts. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, getAllByRole } from "@testing-library/svelte";
import SignauxRail from "./SignauxRail.svelte";
import type { CityMapEntry } from "$lib/maps/maps-data.js";

afterEach(() => cleanup());

function renderRail(initialSubsetKey = "z|m|p", onFilterChange?: (key: string) => void) {
  return render(SignauxRail, {
    props: {
      entries: [],
      initialSubsetKey,
      onFilterChange: onFilterChange ?? (() => {}),
    },
  });
}

function getModeRadios(container: HTMLElement): [HTMLInputElement, HTMLInputElement] {
  const radios = getAllByRole(container, "radio") as HTMLInputElement[];
  return [radios[0]!, radios[1]!];
}

describe("SignauxRail — A / transition", () => {
  it("defaults empty or invalid state to immutable A", () => {
    const { container } = renderRail("");
    const [a, transition] = getModeRadios(container);
    expect(a.checked).toBe(true);
    expect(transition.checked).toBe(false);
  });

  it("labels transition as non-final and exposes no free-form axes or Vivier v2", () => {
    const { container } = renderRail();
    expect(container.textContent).toContain("Vivier A · référence");
    expect(container.textContent).toContain("Transition vers B");
    expect(container.textContent).toContain("non final");
    expect(container.textContent).not.toContain("Résidentiel pertinent");
    expect(container.textContent).not.toContain("Zonage uniquement");
    expect(container.textContent).not.toContain("Vivier v2");
  });

  it("does not rewrite restored A on mount", () => {
    const spy = vi.fn();
    renderRail("z|m|p", spy);
    expect(spy).not.toHaveBeenCalled();
  });
  it("switches only to exact transition z|p and keeps Sutton count parity", async () => {
    const calls: string[] = [];
    const entry: CityMapEntry = {
      municipality: { slug: "sutton", name: "Sutton", mrc: "Brome-Missisquoi" } as CityMapEntry["municipality"],
      signalCount6m: 5,
      subsetCounts: { "": 5, "z|m|p": 1, "z|p": 2 },
    };
    const { container } = render(SignauxRail, {
      props: { entries: [entry], initialSubsetKey: "z|m|p", onFilterChange: (key) => calls.push(key) },
    });
    expect(container.textContent).toMatch(/1\s+signal/);
    await fireEvent.click(getModeRadios(container)[1]);
    expect(calls).toEqual(["z|p"]);
    expect(container.textContent).toMatch(/2\s+signaux/);
  });
});

// ── Liste PLATE de villes (accordéon signaux SUPPRIMÉ du rail gauche) ────────
// Les signaux de la ville active vivent à DROITE (SignauxSelPanel → bucket
// « Signaux »), plus jamais inline sous la ligne ville du rail.

/** Fixture minimale CityMapEntry — seuls slug/name/mrc + subsetCounts comptent ici. */
function cityEntry(slug: string, name: string, mrc: string, count: number): CityMapEntry {
  const subsetCounts: Record<string, number> = {};
  for (const key of ["", "z|p", "z|m|p"]) {
    subsetCounts[key] = count;
  }
  return {
    municipality: {
      slug,
      name,
      mrc,
    } as CityMapEntry["municipality"],
    signalCount6m: count,
    subsetCounts,
  };
}

function renderRailWithCities(selectedSlug: string | null, onSelectCity?: (e: CityMapEntry) => void) {
  return render(SignauxRail, {
    props: {
      // MRC distinctes VOLONTAIREMENT : le sous-libellé MRC est rendu dans la
      // ligne, un find() par texte ne doit matcher qu'une seule ville.
      entries: [
        cityEntry("salaberry-de-valleyfield", "Salaberry-de-Valleyfield", "MRC-Test-A", 7),
        cityEntry("beauharnois", "Beauharnois", "MRC-Test-B", 3),
      ],
      selectedSlug,
      initialSubsetKey: "z|p",
      onSelectCity: onSelectCity ?? (() => {}),
    },
  });
}

describe("SignauxRail — liste plate de villes (sans accordéon signaux)", () => {
  it("les villes sont rendues en lignes plates (boutons), sans <details> par ville", () => {
    const { container } = renderRailWithCities("salaberry-de-valleyfield");
    const list = container.querySelector(".rail-city-list");
    expect(list).not.toBeNull();
    // Lignes plates : un bouton par ville
    const rows = list!.querySelectorAll("button.rail-city-row");
    expect(rows.length).toBe(2);
    // Plus AUCUN accordéon par ville dans la liste
    expect(list!.querySelectorAll("details").length).toBe(0);
  });

  it("la ville sélectionnée est mise en évidence, SANS signaux inline en dessous", () => {
    const { container } = renderRailWithCities("salaberry-de-valleyfield");
    const active = container.querySelector(".rail-city-row--active");
    expect(active).not.toBeNull();
    expect(active!.textContent).toContain("Salaberry-de-Valleyfield");
    // Aucun rendu inline de signaux (ancien accordéon) nulle part dans le rail
    expect(container.querySelector(".ws-acc")).toBeNull();
    expect(container.querySelector(".ws-acc-body")).toBeNull();
    expect(container.querySelector(".signal-item")).toBeNull();
  });

  it("cliquer une ville appelle onSelectCity avec l'entrée correspondante", async () => {
    const spy = vi.fn();
    const { container } = renderRailWithCities(null, spy);
    const rows = container.querySelectorAll<HTMLButtonElement>("button.rail-city-row");
    const beauharnois = Array.from(rows).find((r) => r.textContent?.includes("Beauharnois"));
    expect(beauharnois).toBeDefined();

    await fireEvent.click(beauharnois!);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].municipality.slug).toBe("beauharnois");
  });

  it("le badge compteur de signaux reste affiché à droite de la ligne ville", () => {
    const { container } = renderRailWithCities(null);
    const rows = Array.from(container.querySelectorAll("button.rail-city-row"));
    const valleyfield = rows.find((r) => r.textContent?.includes("Salaberry-de-Valleyfield"));
    expect(valleyfield).toBeDefined();
    expect(valleyfield!.textContent).toContain("7");
  });
});
