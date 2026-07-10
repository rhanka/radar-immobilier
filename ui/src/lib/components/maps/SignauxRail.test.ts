/**
 * QA léger — SignauxRail : état initial des filtres et callbacks onFilterChange.
 *
 * Vérifie :
 *   1. Par défaut (initialSubsetKey="z|m|p"), les 3 checkboxes sont cochées.
 *   2. Avec initialSubsetKey="", les 3 checkboxes sont décochées.
 *   3. Avec initialSubsetKey="z", seul Zonage est coché.
 *   4. onFilterChange N'EST PAS appelé au montage (post-#283 : pas de
 *      ré-émission de la clé restaurée → pas d'écrasement du filtre au reload).
 *   5. Cliquer sur "Zonage uniquement" appelle onFilterChange sans le flag "z".
 *
 * Aucun docker, aucune API. jsdom + @testing-library/svelte.
 */
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

/**
 * Récupère les 3 checkboxes de filtre dans l'ordre attendu : [zonage, multi4, précoce].
 * getByLabelText avec "Multifamilial 4+" échoue à cause du "+" interprété comme
 * modificateur regex. On utilise getAllByRole("checkbox") à la place.
 */
function getFilterCheckboxes(container: HTMLElement): [HTMLInputElement, HTMLInputElement, HTMLInputElement] {
  const checkboxes = getAllByRole(container, "checkbox") as HTMLInputElement[];
  // Les 3 checkboxes de filtre sont les 3 premières dans le rail (zonage, multi4, précoce).
  return [checkboxes[0], checkboxes[1], checkboxes[2]];
}

describe("SignauxRail — état initial des filtres", () => {
  it("initialSubsetKey=z|m|p → les 3 checkboxes sont cochées par défaut", () => {
    const { container } = renderRail("z|m|p");
    const [zonage, multi, precoce] = getFilterCheckboxes(container);
    expect(zonage.checked).toBe(true);
    expect(multi.checked).toBe(true);
    expect(precoce.checked).toBe(true);
  });

  it("initialSubsetKey='' → les 3 checkboxes sont décochées", () => {
    const { container } = renderRail("");
    const [zonage, multi, precoce] = getFilterCheckboxes(container);
    expect(zonage.checked).toBe(false);
    expect(multi.checked).toBe(false);
    expect(precoce.checked).toBe(false);
  });

  it("initialSubsetKey='z' → seul Zonage est coché", () => {
    const { container } = renderRail("z");
    const [zonage, multi, precoce] = getFilterCheckboxes(container);
    expect(zonage.checked).toBe(true);
    expect(multi.checked).toBe(false);
    expect(precoce.checked).toBe(false);
  });

  it("initialSubsetKey='z|m' → Zonage et Multi sont cochés, Précoces non", () => {
    const { container } = renderRail("z|m");
    const [zonage, multi, precoce] = getFilterCheckboxes(container);
    expect(zonage.checked).toBe(true);
    expect(multi.checked).toBe(true);
    expect(precoce.checked).toBe(false);
  });

  it("onFilterChange N'EST PAS appelé au montage (clé restaurée z|m|p non ré-émise)", () => {
    // Contrat post-#283 : au mount, le composant NE propage PLUS la clé active.
    // Ré-émettre `initialSubsetKey` écraserait le filtre que le parent vient de
    // restaurer (URL > localStorage), d'où la perte du filtre au reload/Ctrl+R.
    // La propagation ne doit venir QUE d'un toggle utilisateur (cf. bloc suivant).
    const spy = vi.fn();
    renderRail("z|m|p", spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it("onFilterChange N'EST PAS appelé au montage avec '' (aucun filtre, pas d'écrasement)", () => {
    // Même contrat avec une clé restaurée vide : pas de propagation au mount.
    const spy = vi.fn();
    renderRail("", spy);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("SignauxRail — toggle filtre", () => {
  it("décocher Zonage → onFilterChange appelé avec clé sans 'z'", async () => {
    const calls: string[] = [];
    const { container } = renderRail("z|m|p", (key) => calls.push(key));

    const [zonageCheckbox] = getFilterCheckboxes(container);
    expect(zonageCheckbox.checked).toBe(true);

    await fireEvent.click(zonageCheckbox);

    // Le dernier appel doit ne pas contenir "z"
    const lastCall = calls[calls.length - 1];
    expect(lastCall).not.toContain("z");
    // Mais doit encore contenir m et p
    expect(lastCall).toContain("m");
    expect(lastCall).toContain("p");
  });

  it("cocher Zonage depuis '' → onFilterChange appelé avec 'z'", async () => {
    const calls: string[] = [];
    const { container } = renderRail("", (key) => calls.push(key));

    const [zonageCheckbox] = getFilterCheckboxes(container);
    await fireEvent.click(zonageCheckbox);

    const lastCall = calls[calls.length - 1];
    expect(lastCall).toContain("z");
    expect(lastCall).not.toContain("m");
    expect(lastCall).not.toContain("p");
  });

  it("décocher Multi → onFilterChange appelé sans 'm'", async () => {
    const calls: string[] = [];
    const { container } = renderRail("z|m|p", (key) => calls.push(key));

    const [, multiCheckbox] = getFilterCheckboxes(container);
    await fireEvent.click(multiCheckbox);

    const lastCall = calls[calls.length - 1];
    expect(lastCall).not.toContain("m");
    expect(lastCall).toContain("z");
  });
});

// ── Liste PLATE de villes (accordéon signaux SUPPRIMÉ du rail gauche) ────────
// Les signaux de la ville active vivent à DROITE (SignauxSelPanel → bucket
// « Signaux »), plus jamais inline sous la ligne ville du rail.

/** Fixture minimale CityMapEntry — seuls slug/name/mrc + subsetCounts comptent ici. */
function cityEntry(slug: string, name: string, mrc: string, count: number): CityMapEntry {
  const subsetCounts: Record<string, number> = {};
  for (const key of ["", "z", "m", "p", "z|m", "z|p", "m|p", "z|m|p"]) {
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

// ── Cohérence compteur rail ↔ panneau (axe « précoce » neutre) ────────────────
//
// Régression du bug « rail sous-compte » : sous la clé défaut "z|m|p", le rail
// lisait subsetCounts["z|m|p"] (cohorte RESTRICTIVE z∩m∩p) alors que le panneau
// affiche z∩m (« p » ne masque pas). Rosemère : rail=1 vs panneau=2. Le rail
// doit désormais afficher le compte p-neutre (= panneau).

/**
 * Entrée « discordante » : subsetCounts où z|m = 2 mais z|m|p = 1 (un signal
 * z∩m NON précoce). Reproduit rosemère / mont-saint-hilaire (panneau=2, rail=1).
 */
function discordantEntry(): CityMapEntry {
  return {
    municipality: {
      slug: "rosemere",
      name: "Rosemere",
      mrc: "MRC Discordante",
    } as CityMapEntry["municipality"],
    signalCount6m: 2,
    subsetCounts: { "": 2, z: 2, m: 2, p: 1, "z|m": 2, "z|p": 1, "m|p": 1, "z|m|p": 1 },
  };
}

describe("SignauxRail — cohérence compteur rail ↔ panneau", () => {
  it("badge ville = compte p-neutre (z|m=2), PAS la cohorte restrictive z|m|p=1", () => {
    const { container } = render(SignauxRail, {
      props: {
        entries: [discordantEntry()],
        selectedSlug: null,
        initialSubsetKey: "z|m|p",
        onSelectCity: () => {},
      },
    });
    const row = Array.from(container.querySelectorAll("button.rail-city-row")).find(
      (r) => r.textContent?.includes("Rosemere"),
    );
    expect(row).toBeDefined();
    // Rail = 2 (= panneau z∩m). Le 1 (restrictif z∩m∩p) était le bug.
    expect(row!.textContent).toContain("2");
    expect(row!.textContent).not.toContain("1");
  });
});
