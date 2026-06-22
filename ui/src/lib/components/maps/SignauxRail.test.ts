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
