import { afterEach, describe, expect, it } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import PalierMatrix from "./PalierMatrix.svelte";

afterEach(() => cleanup());

describe("PalierMatrix — scaffold vue matrice", () => {
  it("rend cartes sommaires + étiquette placeholder honnête", () => {
    const { getByTestId } = render(PalierMatrix);
    expect(getByTestId("palier-matrix")).toBeTruthy();
    // 7 villes × 4 KPI (placeholder proxy-immo) + label honnête.
    expect(getByTestId("palier-summary").textContent).toContain("7");
    expect(getByTestId("palier-summary").textContent).toContain("4");
    expect(getByTestId("palier-label").textContent).toContain(
      "proxy immo geo-lot pending",
    );
  });

  it("grille : une ligne par ville, statuts en copy NEUTRE (aucun jargon)", () => {
    const { getByTestId } = render(PalierMatrix);
    const grid = getByTestId("palier-grid");
    expect(getByTestId("palier-row-lery")).toBeTruthy();
    const txt = grid.textContent ?? "";
    // Libellés neutres présents ; jamais le mot brut 'unknown'.
    expect(txt).toContain("Complet");
    expect(txt).toContain("À qualifier");
    expect(txt).toContain("N-A");
    expect(txt.toLowerCase()).not.toContain("unknown");
    // % par-ville rendu.
    expect(txt).toContain("%");
  });

  it("toggle subset A/B : bascule l'état pressé", async () => {
    const { getByTestId } = render(PalierMatrix);
    const a = getByTestId("palier-subset-A");
    const b = getByTestId("palier-subset-B");
    // Défaut B actif.
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(a.getAttribute("aria-pressed")).toBe("false");
    await fireEvent.click(a);
    expect(a.getAttribute("aria-pressed")).toBe("true");
    expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("barres de résolution par-KPI rendues (une par KPI)", () => {
    const { getByTestId } = render(PalierMatrix);
    const bars = getByTestId("palier-kpi-bars");
    // 4 KPI → au moins 4 pourcentages « % » dans les barres.
    const pcts = (bars.textContent ?? "").match(/%/g) ?? [];
    expect(pcts.length).toBeGreaterThanOrEqual(4);
  });
});
