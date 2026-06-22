/**
 * QA léger — TopNav : classe de nav DS, état actif, aucune classe custom seule.
 *
 * Vérifie :
 *   1. Les liens de nav portent bien la classe DS `st-appHeader__navLink`.
 *   2. La classe `topnav-navbtn` (pont <button>) est présente — c'est le pont
 *      intentionnel documenté dans TopNav.svelte, pas un bug.
 *   3. L'item actif porte `aria-current="page"`.
 *   4. Les items inactifs n'ont PAS `aria-current="page"`.
 *   5. Les vues principales attendues sont bien rendues.
 *
 * Environnement jsdom — aucun docker, aucun MapLibre, aucune API.
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import TopNav from "./TopNav.svelte";

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

function renderNav(activeView = "signaux") {
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

  it("chaque lien principal porte la classe pont topnav-navbtn (bridge button→navLink)", () => {
    // topnav-navbtn est le pont <button> → style DS, son existence est intentionnelle.
    const { getByText } = renderNav("signaux");
    for (const label of MAIN_VIEWS) {
      const el = getByText(label);
      expect(el.classList.contains("topnav-navbtn"), `${label} doit avoir topnav-navbtn`).toBe(true);
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
          authenticated: true,
          user: { sub: "u1", name: "Admin", email: "a@b.com", isAdmin: true },
        },
      },
    });
    // Le déclencheur Admin doit avoir aria-haspopup="menu"
    const adminTrigger = container.querySelector('button[aria-haspopup="menu"]');
    expect(adminTrigger).not.toBeNull();
    // Il doit porter les classes DS nav
    expect(adminTrigger!.classList.contains("st-appHeader__navLink")).toBe(true);
  });
});
