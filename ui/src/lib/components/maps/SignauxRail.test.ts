/** SignauxRail A/B tabs, combinable A axes, and flat city-list contracts. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, getByRole, getByText } from "@testing-library/svelte";
import SignauxRail from "./SignauxRail.svelte";
import type { CityMapEntry } from "$lib/maps/maps-data.js";
import type { VivierV2Counts } from "@radar/domain";

afterEach(() => cleanup());

/** Comptes v2 serveur : total = qualified + residentialUnknown + Σ exclusions. */
function vivierCounts(
  qualified: number,
  residentialUnknown = 0,
  excluded = 0,
  stageCounts?: Partial<VivierV2Counts["stageCounts"]>,
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
      ...stageCounts,
    },
    stageCountsHorsZonage: {
      avis_motion: 0,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    stageCountsResEligible: {
      avis_motion: qualified,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
      ...stageCounts,
    },
    stageCountsResEligibleHorsZonage: {
      avis_motion: 0,
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

function renderRail(initialSubsetKey = "vivier-v2", onFilterChange?: (key: string) => void) {
  return render(SignauxRail, {
    props: {
      entries: [],
      initialSubsetKey,
      onFilterChange: onFilterChange ?? (() => {}),
    },
  });
}

/** Les checkboxes du panneau de vivier B (axes zonage/résidentiel/précoce). */
function toggleBoxes(container: HTMLElement): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(".vivier-toggles input[type=checkbox]"),
  );
}

/**
 * Sutton : subsetCounts distincts par clé A (z|m|p → 1, z|p → 2, z|m → 4),
 * et un vivier v2 dont seule une partie est précoce (2 qualifiés, 1 précoce).
 */
const SUTTON: CityMapEntry = {
  municipality: {
    slug: "sutton",
    name: "Sutton",
    mrc: "Brome-Missisquoi",
  } as CityMapEntry["municipality"],
  signalCount6m: 5,
  subsetCounts: { "": 5, "z|m|p": 1, "z|p": 2, "z|m": 4, z: 5 },
  vivierV2Counts: vivierCounts(2, 7, 3, { avis_motion: 1, adoption: 1 }),
};

describe("SignauxRail — vivier B (vue unique, sans onglets)", () => {
  it("ne rend AUCUN bandeau à onglets A-B : panelB visible d'emblée", () => {
    const { container } = renderRail();
    // Plus aucun onglet/switcher : ni role=tab, ni les libellés A/B retirés.
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.querySelector(".vivier-tabs-wrap")).toBeNull();
    expect(container.textContent).not.toContain("Référence A");
    expect(container.textContent).not.toContain("Nouveau B");
    // Le panneau B est rendu directement (axes + exclusions B présents).
    expect(container.querySelector(".vivier-b-exclusions")).not.toBeNull();
    expect(container.textContent).toContain("Résidentiel");
    expect(container.textContent).toContain("Exclure PIIA sans projet résidentiel");
  });

  it("défaut vierge = B (trois axes B cochés, aucun axe A « Multifamilial 4+ »)", () => {
    const { container } = renderRail();
    const boxes = toggleBoxes(container);
    expect(boxes).toHaveLength(3);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(container.textContent).toContain("Zonage");
    expect(container.textContent).toContain("Résidentiel");
    expect(container.textContent).toContain("Précoce");
    // Plus aucun axe du pipeline A retiré.
    expect(container.textContent).not.toContain("Multifamilial 4+");
  });

  it("une clé A résiduelle (z|m|p) dégrade vers le défaut B — jamais un panneau blanc", () => {
    const { container } = renderRail("z|m|p");
    // Le rail reçoit une clé A résiduelle mais rend la vue B par défaut.
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.querySelector(".vivier-b-exclusions")).not.toBeNull();
    const boxes = toggleBoxes(container);
    expect(boxes).toHaveLength(3);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(container.textContent).toContain("Résidentiel");
    expect(container.textContent).not.toContain("Multifamilial 4+");
  });

  it("does not emit a filter change on mount", () => {
    const spy = vi.fn();
    renderRail("vivier-v2", spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it("renders the canonical New Relic-style DS time range picker in the B view", () => {
    const { container } = renderRail();
    expect(container.textContent).toContain("Période des signaux");
    expect(container.querySelector(".st-timeRangePicker")).toBeInstanceOf(HTMLElement);
    expect(container.querySelector(".signals-time-range-picker-wrap")).toBeInstanceOf(HTMLElement);
    expect(container.querySelector(".signals-time-range-picker")).toBeInstanceOf(HTMLElement);
    expect(container.querySelector(".st-datePicker")).toBeNull();
    expect(getByRole(container, "button", { name: /Période des signaux.*6 derniers mois/i })).toBeInstanceOf(HTMLButtonElement);
  });

  it("emits the selected DS relative period for the parent-owned A/B lens", async () => {
    const onTimeRangeChange = vi.fn();
    const { container } = render(SignauxRail, {
      props: { entries: [], onTimeRangeChange },
    });

    await fireEvent.click(
      getByRole(container, "button", { name: /Période des signaux.*6 derniers mois/i }),
    );
    await fireEvent.click(getByText(document.body, "3 derniers mois"));

    expect(onTimeRangeChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "relative", relative: "3mo" }),
    );
  });

  it("allows every relative period to be selected sequentially", async () => {
    const onTimeRangeChange = vi.fn();
    const { container } = render(SignauxRail, {
      props: { entries: [], onTimeRangeChange },
    });
    const trigger = () =>
      getByRole(container, "button", { name: /Période des signaux.*derniers mois/i });

    for (const [label, relative] of [
      ["3 derniers mois", "3mo"],
      ["6 derniers mois", "6mo"],
      ["12 derniers mois", "12mo"],
    ] as const) {
      await fireEvent.click(trigger());
      await fireEvent.click(getByText(document.body, label));
      expect(onTimeRangeChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode: "relative", relative }),
      );
    }
  });

  it("positions the opened temporal overlay from its trigger and refreshes it on scroll", async () => {
    const { container } = renderRail();
    const trigger = getByRole(container, "button", {
      name: /Période des signaux.*6 derniers mois/i,
    });
    let triggerTop = 36;
    vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(16, triggerTop, 400, 32),
    );
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await fireEvent.click(trigger);
    await nextFrame();

    const popover = getByRole(document.body, "dialog", { name: "Période des signaux" });
    expect(popover.parentElement).toBe(document.body);
    expect(popover.style.position).toBe("fixed");
    expect(popover.style.top).toBe("72px");
    expect(popover.style.left).toBe("16px");

    triggerTop = 84;
    window.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(popover.style.top).toBe("120px");
  });

  it("direct/reload B key vivier-v2 defaults its three axes to Z✓ R✓ P✓, none locked", async () => {
    const { container } = render(SignauxRail, {
      props: { entries: [SUTTON], initialSubsetKey: "vivier-v2" },
    });
    const boxes = toggleBoxes(container);
    expect(boxes).toHaveLength(3);
    // `vivier-v2` is a mode key: it infers the current B default, including Précoce.
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(true);
    expect(boxes[2]!.checked).toBe(true);
    expect(boxes.every((box) => box.disabled)).toBe(false);
    expect(boxes.some((box) => box.disabled)).toBe(false);
    expect(container.textContent).toContain("Zonage");
    expect(container.textContent).toContain("Résidentiel");
    expect(container.textContent).toContain("Précoce");
    // m1.2 : plus de ligne résumé « zonage + résidentiel ».
    expect(container.textContent).not.toContain("zonage + résidentiel");
  });

  it("recomposes the B key when an axis is unchecked (m1.4)", async () => {
    const calls: string[] = [];
    const { container } = render(SignauxRail, {
      props: {
        entries: [SUTTON],
        initialSubsetKey: "vivier-v2",
        onFilterChange: (key: string) => calls.push(key),
      },
    });
    const boxes = toggleBoxes(container);
    // Décocher « Résidentiel » (2e case) → vivier-v2|-r|p (Précoce remains explicitly checked).
    await fireEvent.click(boxes[1]!);
    expect(calls.at(-1)).toBe("vivier-v2|-r|p");
    // Puis décocher « Zonage » (1re case) → vivier-v2|-z|-r|p.
    await fireEvent.click(toggleBoxes(container)[0]!);
    expect(calls.at(-1)).toBe("vivier-v2|-z|-r|p");
  });

  it("restricts B to precoce stages when the axis is checked", async () => {
    const calls: string[] = [];
    const { container } = render(SignauxRail, {
      props: {
        entries: [SUTTON],
        initialSubsetKey: "vivier-v2",
        onFilterChange: (key: string) => calls.push(key),
      },
    });
    // B direct/reload default is already Précoce: stageCounts précoce = 1.
    expect(container.textContent).toMatch(/1\s+signal/);

    // Explicitly uncheck Précoce → the live key preserves that session intent.
    await fireEvent.click(toggleBoxes(container)[2]!);
    expect(calls.at(-1)).toBe("vivier-v2|-p");
    expect(container.textContent).toMatch(/2\s+signaux/);

    // Check it again → vivier-v2|p.
    await fireEvent.click(toggleBoxes(container)[2]!);
    expect(calls.at(-1)).toBe("vivier-v2|p");
    expect(container.textContent).toMatch(/1\s+signal/);
  });

  it("drops the B counts line and keeps neutral copy (m1.5)", () => {
    const { container } = render(SignauxRail, {
      props: { entries: [SUTTON], initialSubsetKey: "vivier-v2" },
    });
    // m1.5 : la mention « retenus · à confirmer · exclus » a disparu.
    expect(container.querySelector(".vivier-b-counts")).toBeNull();
    expect(container.textContent).not.toMatch(/retenus/);
    expect(container.textContent).not.toMatch(/à confirmer/);
    expect(container.textContent).not.toMatch(/exclus/);
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
    // m1.3 : la phrase d'aide confusante a été retirée.
    expect(container.textContent).not.toContain("Un PIIA portant un projet résidentiel reste affiché");

    await fireEvent.click(boxes[0]!);
    expect(changes).toEqual([
      { piiaSansProjetResidentiel: false, derogationsMineures: true },
    ]);
  });

  it("shows unavailable badges instead of aggregate zeros after a load error", () => {
    const { container } = render(SignauxRail, {
      props: { entries: [], dataUnavailable: true },
    });
    expect(container.textContent).toContain("Données des signaux indisponibles");
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
      initialSubsetKey: "vivier-v2",
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

// ── #378 (régression m1.7) — stabilité de la ville sélectionnée ──────────────
// Le compte LIVE (`selectedCityLiveCount`) ne participe JAMAIS au tri ni à
// l'appartenance : la ligne sélectionnée garde sa position (tri bulk) et reste
// listée même à 0. Le badge devient honnête : « live/bulk » quand la lentille
// client (plage de dates, exclusions) masque une partie du bulk.

function renderRailB(selectedSlug: string | null, selectedCityLiveCount: number | null) {
  return render(SignauxRail, {
    props: {
      entries: [
        cityEntry("notre-dame-du-bon-conseil--drummond", "Notre-Dame-du-Bon-Conseil", "Drummond", 4),
        cityEntry("acton-vale", "Acton Vale", "Acton", 3),
        cityEntry("roxton-falls", "Roxton Falls", "Acton", 2),
      ],
      selectedSlug,
      initialSubsetKey: "vivier-v2",
      selectedCityLiveCount,
    },
  });
}

function rowNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button.rail-city-row .rail-row-label")).map(
    (el) => el.childNodes[0]?.textContent?.trim() ?? "",
  );
}

function badgeOf(container: HTMLElement, name: string): string {
  const row = Array.from(container.querySelectorAll("button.rail-city-row")).find((r) =>
    r.textContent?.includes(name),
  );
  expect(row).toBeDefined();
  return row!.querySelector(".st-badge")?.textContent?.trim() ?? "";
}

describe("SignauxRail — la ville sélectionnée ne saute ni ne disparaît (#378)", () => {
  it("tri par bulk STABLE : le compte live (1 < bulk 4) ne déplace pas la ligne", () => {
    const { container } = renderRailB("notre-dame-du-bon-conseil--drummond", 1);
    expect(rowNames(container)).toEqual([
      "Notre-Dame-du-Bon-Conseil",
      "Acton Vale",
      "Roxton Falls",
    ]);
  });

  it("badge honnête « live/bulk » (1/4) quand la lentille client masque une partie du bulk", () => {
    const { container } = renderRailB("notre-dame-du-bon-conseil--drummond", 1);
    expect(badgeOf(container, "Notre-Dame-du-Bon-Conseil")).toBe("1/4");
    // Les autres villes restent au bulk sec.
    expect(badgeOf(container, "Acton Vale")).toBe("3");
  });

  it("live 0 : la ligne reste listée, à sa place bulk, badge 0/4", () => {
    const { container } = renderRailB("notre-dame-du-bon-conseil--drummond", 0);
    expect(rowNames(container)[0]).toBe("Notre-Dame-du-Bon-Conseil");
    expect(badgeOf(container, "Notre-Dame-du-Bon-Conseil")).toBe("0/4");
  });

  it("live null (fetch en cours) : repli bulk sans dénominateur — aucun flash", () => {
    const { container } = renderRailB("notre-dame-du-bon-conseil--drummond", null);
    expect(rowNames(container)[0]).toBe("Notre-Dame-du-Bon-Conseil");
    expect(badgeOf(container, "Notre-Dame-du-Bon-Conseil")).toBe("4");
  });

  it("live = bulk : badge simple (pas de dénominateur superflu)", () => {
    const { container } = renderRailB("notre-dame-du-bon-conseil--drummond", 4);
    expect(badgeOf(container, "Notre-Dame-du-Bon-Conseil")).toBe("4");
  });
});
