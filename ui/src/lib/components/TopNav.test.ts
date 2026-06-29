/**
 * QA léger — TopNav (migré sur `AppChrome`, 0-custo) : nav DS, état actif, Admin
 * gaté au rôle.
 *
 * Vérifie :
 *   1. Les liens de nav DS portent la classe `st-appHeader__navLink` (rendus par
 *      AppChrome en tant que <a href="#/<view>"> — SPA via hashchange).
 *   2. Les liens de nav sont des <a> avec un href hash SPA (`#/<view>`).
 *   3. L'item actif porte `aria-current="page"`.
 *   4. Les items inactifs n'ont PAS `aria-current="page"`.
 *   5. Les vues principales attendues sont bien rendues.
 *   6. Le dropdown Admin (zone utilitaire `extraSelectors`) est gaté au rôle.
 *
 * Environnement jsdom — aucun docker, aucun MapLibre, aucune API.
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import TopNav from "./TopNav.svelte";
import type { DemoView } from "$lib/demo/views";

/**
 * jsdom ne fournit pas window.matchMedia — TopNav l'utilise dans onMount pour
 * détecter le mode compact (burger). On le mocke avec un stub non-compact.
 */
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

const MAIN_VIEWS = ["Signaux", "Évaluation", "Sources"] as const;

function renderNav(activeView: DemoView = "signaux") {
  return render(TopNav, {
    props: {
      activeView,
      onSelect: () => {},
    },
  });
}

describe("TopNav — classe DS navLink et état actif", () => {
  it("rend les 3 vues principales", () => {
    const { getByText } = renderNav("signaux");
    for (const label of MAIN_VIEWS) {
      expect(getByText(label)).not.toBeNull();
    }
  });

  it("chaque lien principal porte la classe DS st-appHeader__navLink", () => {
    const { getByText } = renderNav("signaux");
    for (const label of MAIN_VIEWS) {
      const el = getByText(label);
      expect(el.classList.contains("st-appHeader__navLink"), `${label} doit avoir st-appHeader__navLink`).toBe(true);
    }
  });

  it("chaque lien principal est un <a> avec un href hash SPA (#/<view>)", () => {
    // AppChrome rend la nav en <a href="#/<view>"> ; le routeur intercepte
    // hashchange pour la navigation SPA (plus de pont <button> maison).
    const { getByText } = renderNav("signaux");
    for (const label of MAIN_VIEWS) {
      const el = getByText(label);
      expect(el.tagName, `${label} doit être un <a>`).toBe("A");
      expect(
        (el.getAttribute("href") ?? "").startsWith("#/"),
        `${label} doit avoir un href hash SPA`,
      ).toBe(true);
    }
  });

  it("l'item actif (signaux) porte aria-current=page", () => {
    const { getByText } = renderNav("signaux");
    const el = getByText("Signaux");
    expect(el.getAttribute("aria-current")).toBe("page");
  });

  it("les items inactifs n'ont pas aria-current=page", () => {
    const { getByText } = renderNav("signaux");
    expect(getByText("Évaluation").getAttribute("aria-current")).toBeNull();
    expect(getByText("Sources").getAttribute("aria-current")).toBeNull();
  });

  it("quand activeView=evaluation, Évaluation est actif et Signaux ne l'est pas", () => {
    const { getByText } = renderNav("evaluation");
    expect(getByText("Évaluation").getAttribute("aria-current")).toBe("page");
    expect(getByText("Signaux").getAttribute("aria-current")).toBeNull();
  });

  it("quand activeView=sources, Sources est actif", () => {
    const { getByText } = renderNav("sources");
    expect(getByText("Sources").getAttribute("aria-current")).toBe("page");
  });

  it("le menu Admin n'est PAS rendu pour un utilisateur non-admin", () => {
    const { queryByText } = renderNav("signaux");
    expect(queryByText("Admin")).toBeNull();
  });

  it("le menu Admin est rendu pour un admin", () => {
    const { container } = render(TopNav, {
      props: {
        activeView: "signaux",
        onSelect: () => {},
        authState: {
          loading: false,
          authenticated: true,
          authDisabled: false,
          loginBlocked: false,
          user: { sub: "u1", name: "Admin", email: "a@b.com", isAdmin: true },
        },
      },
    });
    // Le déclencheur Admin (zone utilitaire `extraSelectors`) = pill DS
    // `st-appHeader__control` + aria-haspopup="menu". Sélecteur scopé pour ne
    // pas heurter le trigger d'IdentityMenu (qui partage aria-haspopup="menu"
    // mais porte la classe `st-identityMenu__trigger`).
    const adminTrigger = container.querySelector(
      'button.st-appHeader__control[aria-haspopup="menu"]',
    );
    expect(adminTrigger).not.toBeNull();
    expect(adminTrigger!.textContent).toContain("Admin");
  });
});
