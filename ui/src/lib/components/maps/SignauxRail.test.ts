/** SignauxRail A/B mode and flat city-list contracts. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, getAllByRole } from "@testing-library/svelte";
import SignauxRail from "./SignauxRail.svelte";
import type { CityMapEntry } from "$lib/maps/maps-data.js";
import type { VivierV2Counts } from "@radar/domain";

afterEach(() => cleanup());

/** Comptes v2 serveur : total = qualified + residentialUnknown + Σ exclusions. */
function vivierCounts(
  qualified: number,
  residentialUnknown = 0,
  excluded = 0,
): VivierV2Counts {
  return {
    qualified,
    residentialUnknown,
    excludedByReason: {
      non_residentiel_franc: excluded,
      piia_non_pertinent: 0,
      hors_zonage: 0,
      derogation_hors_sujet: 0,
    },
    stageCounts: {
      avis_motion: qualified,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    total: qualified + residentialUnknown + excluded,
  };
}

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

/** Sutton : 1 signal en A, 2 qualifiés en B (B retire le gate multi4). */
const SUTTON: CityMapEntry = {
  municipality: {
    slug: "sutton",
    name: "Sutton",
    mrc: "Brome-Missisquoi",
  } as CityMapEntry["municipality"],
  signalCount6m: 5,
  subsetCounts: { "": 5, "z|m|p": 1, "z|p": 2 },
  vivierV2Counts: vivierCounts(2, 7, 3),
};

describe("SignauxRail — A / B", () => {
  it("defaults empty or invalid state to immutable A", () => {
    const { container } = renderRail("");
    const [a, b] = getModeRadios(container);
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);
  });

  it("restores A from a retired z|p key instead of selecting B", () => {
    const { container } = renderRail("z|p");
    const [a, b] = getModeRadios(container);
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);
  });

  it("offers A and B, and drops the retired transition mode", () => {
    const { container } = renderRail();
    expect(container.textContent).toContain("Vivier A · référence");
    expect(container.textContent).toContain("Vivier B");
    expect(container.textContent).toContain("zonage + résidentiel");
    expect(container.textContent).not.toContain("Transition vers B");
    expect(container.textContent).not.toContain("non final");
    expect(container.textContent).not.toContain("Résidentiel pertinent");
  });

  it("does not rewrite restored A on mount", () => {
    const spy = vi.fn();
    renderRail("z|m|p", spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it("switches to B on the explicit vivier-v2 key and counts from vivierV2Counts", async () => {
    const calls: string[] = [];
    const { container } = render(SignauxRail, {
      props: {
        entries: [SUTTON],
        initialSubsetKey: "z|m|p",
        onFilterChange: (key: string) => calls.push(key),
      },
    });
    // A : subsetCounts["z|m|p"].
    expect(container.textContent).toMatch(/1\s+signal/);

    await fireEvent.click(getModeRadios(container)[1]);

    expect(calls).toEqual(["vivier-v2"]);
    // B : vivierV2Counts.qualified, jamais un sous-ensemble z|p.
    expect(container.textContent).toMatch(/2\s+signaux/);
  });

  it("shows B's three counts side by side and never a merged total", async () => {
    const { container } = render(SignauxRail, {
      props: { entries: [SUTTON], initialSubsetKey: "vivier-v2" },
    });
    const counts = container.querySelector(".vivier-b-counts");
    expect(counts).not.toBeNull();
    expect(counts!.textContent).toMatch(/2\s*retenus/);
    expect(counts!.textContent).toMatch(/7\s*à confirmer/);
    expect(counts!.textContent).toMatch(/3\s*exclus/);
    // Copy produit neutre : aucun jargon interne.
    expect(container.textContent).not.toMatch(/honnête|pire statut|anti-survente/i);
  });

  it("checks both B exclusions by default and reports each toggle", async () => {
    const changes: unknown[] = [];
    const { container } = render(SignauxRail, {
      props: {
        entries: [SUTTON],
        initialSubsetKey: "vivier-v2",
        onExclusionsChange: (next: unknown) => changes.push(next),
      },
    });
    const boxes = Array.from(
      container.querySelectorAll<HTMLInputElement>(".vivier-b-exclusions input[type=checkbox]"),
    );
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(container.textContent).toContain("Exclure PIIA sans projet résidentiel");
    expect(container.textContent).toContain("Exclure dérogations mineures");

    await fireEvent.click(boxes[0]!);
    expect(changes).toEqual([
      { piiaSansProjetResidentiel: false, derogationsMineures: true },
    ]);
  });

  it("hides the B-only exclusions while A is active", () => {
    const { container } = render(SignauxRail, {
      props: { entries: [SUTTON], initialSubsetKey: "z|m|p" },
    });
    expect(container.querySelector(".vivier-b-exclusions")).toBeNull();
    expect(container.querySelector(".vivier-b-counts")).toBeNull();
  });

  it("shows unavailable badges instead of aggregate zeros after a load error", () => {
    const { container } = render(SignauxRail, {
      props: { entries: [], dataUnavailable: true },
    });
    const rows = container.querySelectorAll(".axis-toggle-row");
    expect(rows[0]?.textContent).toContain("n/d");
    expect(rows[1]?.textContent).toContain("n/d");
    expect(container.textContent).not.toContain(">0<");
  });
});

// ── Liste PLATE de villes (accordéon signaux SUPPRIMÉ du rail gauche) ────────
// Les signaux de la ville active vivent à DROITE (SignauxSelPanel → bucket
// « Signaux »), plus jamais inline sous la ligne ville du rail.

/** Fixture minimale CityMapEntry — seuls slug/name/mrc + comptes importent ici. */
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
    vivierV2Counts: vivierCounts(count),
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
      initialSubsetKey: "z|m|p",
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
