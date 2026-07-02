import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import RapportView from "./RapportView.svelte";

// jsdom ne fournit pas matchMedia (même mock défensif que TopNav.test.ts).
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

describe("RapportView", () => {
  it("rend l'en-tête de la vue et l'action slides", () => {
    const { getByText } = render(RapportView);
    expect(getByText("Rapport d'étude")).not.toBeNull();
    expect(getByText("Ouvrir les slides")).not.toBeNull();
    expect(getByText("Édition du 2026-07-02")).not.toBeNull();
  });

  it("rend le contenu markdown du rapport (titres réels du document)", () => {
    const { getByText } = render(RapportView);
    // Titre H1 du markdown compilé.
    expect(getByText("Rapport d'étude — Radar Immobilier")).not.toBeNull();
    // Une section restructurée « données par couche ».
    expect(getByText(/Données : état par couche/)).not.toBeNull();
  });
});
