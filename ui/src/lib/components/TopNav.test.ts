/**
 * QA léger — TopNav (migré sur `AppChrome`, 0-custo) : nav DS centrée, identité
 * = avatar à initiale + dropdown natif, outils admin sous « Paramètres ».
 *
 * Vérifie :
 *   1. Les liens de nav DS portent la classe `st-appHeader__navLink` (rendus par
 *      AppChrome en tant que <a href="#/<view>"> — SPA via hashchange).
 *   2. Les liens de nav sont des <a> avec un href hash SPA (`#/<view>`).
 *   3. L'item actif porte `aria-current="page"` ; les inactifs non.
 *   4. La nav top-level PAR DÉFAUT se limite à 2 vues (Signaux/Sources) :
 *      « Évaluation » est une feature beta MASQUÉE (flag $lib/state/beta),
 *      Grilles / Console sources ABSENTS.
 *   5. Flag beta activé (Ctrl+Shift+X → evaluationBeta=true) : « Évaluation »
 *      apparaît dans la nav (3 liens, href #/evaluation).
 *   6. Aucun bouton « Admin » séparé dans le header (même pour un admin).
 *   7. Identité connectée : avatar à initiale + dropdown « Appareils /
 *      Paramètres / Se déconnecter » ; « Paramètres » route vers le hub admin
 *      pour un compte admin (gating isAdmin).
 *
 * Environnement jsdom — aucun docker, aucun MapLibre, aucune API.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import TopNav from "./TopNav.svelte";
import type { DemoView } from "$lib/demo/views";
import type { AuthState } from "$lib/auth/auth-store";
import { evaluationBeta } from "$lib/state/beta";

/**
 * jsdom ne fournit pas window.matchMedia — TopNav/DS l'utilisent pour le mode
 * couleur `auto`. On le mocke avec un stub non-matché.
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

// Flag beta remis à OFF avant chaque test : la nav par défaut est SANS Évaluation.
beforeEach(() => {
  evaluationBeta.set(false);
});

afterEach(() => cleanup());

/** Nav par défaut (flag beta OFF) : Évaluation est masquée. */
const DEFAULT_VIEWS = ["Signaux", "Sources"] as const;

const ADMIN_AUTH: AuthState = {
  loading: false,
  authenticated: true,
  authDisabled: false,
  loginBlocked: false,
  user: { sub: "u1", name: "Admin", email: "a@b.com", isAdmin: true },
};

function renderNav(activeView: DemoView = "signaux") {
  return render(TopNav, {
    props: { activeView, onSelect: () => {} },
  });
}

function renderAdmin(activeView: DemoView = "signaux") {
  return render(TopNav, {
    props: { activeView, onSelect: () => {}, authState: ADMIN_AUTH },
  });
}

describe("TopNav — nav DS, état actif, identité", () => {
  it("rend les 2 vues principales par défaut (Évaluation masquée)", () => {
    const { getByText, queryByText } = renderNav("signaux");
    for (const label of DEFAULT_VIEWS) {
      expect(getByText(label)).not.toBeNull();
    }
    expect(queryByText("Évaluation")).toBeNull();
  });

  it("chaque lien principal porte la classe DS st-appHeader__navLink", () => {
    const { getByText } = renderNav("signaux");
    for (const label of DEFAULT_VIEWS) {
      const el = getByText(label);
      expect(
        el.classList.contains("st-appHeader__navLink"),
        `${label} doit avoir st-appHeader__navLink`,
      ).toBe(true);
    }
  });

  it("chaque lien principal est un <a> avec un href hash SPA (#/<view>)", () => {
    const { getByText } = renderNav("signaux");
    for (const label of DEFAULT_VIEWS) {
      const el = getByText(label);
      expect(el.tagName, `${label} doit être un <a>`).toBe("A");
      expect(
        (el.getAttribute("href") ?? "").startsWith("#/"),
        `${label} doit avoir un href hash SPA`,
      ).toBe(true);
    }
  });

  it("la nav top-level a exactement 2 liens par défaut (Évaluation/Grilles/Console absents)", () => {
    const { container, queryByText } = renderNav("signaux");
    const navLinks = container.querySelectorAll("a.st-appHeader__navLink");
    expect(navLinks.length).toBe(2);
    expect(queryByText("Évaluation")).toBeNull();
    expect(queryByText("Grilles")).toBeNull();
    expect(queryByText("Console sources")).toBeNull();
  });

  it("l'item actif (signaux) porte aria-current=page", () => {
    const { getByText } = renderNav("signaux");
    expect(getByText("Signaux").getAttribute("aria-current")).toBe("page");
  });

  it("les items inactifs n'ont pas aria-current=page", () => {
    const { getByText } = renderNav("signaux");
    expect(getByText("Sources").getAttribute("aria-current")).toBeNull();
  });

  it("quand activeView=sources, Sources est actif", () => {
    const { getByText } = renderNav("sources");
    expect(getByText("Sources").getAttribute("aria-current")).toBe("page");
  });

  it("aucun bouton Admin séparé dans le header, même pour un admin", () => {
    const { container } = renderAdmin();
    // L'ancien déclencheur Admin était un `button.st-appHeader__control` avec
    // aria-haspopup="menu". Il ne doit plus exister.
    const adminTrigger = container.querySelector(
      'button.st-appHeader__control[aria-haspopup="menu"]',
    );
    expect(adminTrigger).toBeNull();
  });

  it("identité non rendue (avatar à initiale) tant qu'il n'y a pas d'utilisateur", () => {
    const { container } = renderNav("signaux");
    // Pas d'utilisateur → IdentityMenu rend l'icône anonyme, pas l'avatar.
    expect(container.querySelector(".st-identityMenu__avatar")).toBeNull();
  });

  it("admin connecté : avatar à initiale (A)", () => {
    const { container } = renderAdmin();
    const avatar = container.querySelector(".st-identityMenu__avatar");
    expect(avatar).not.toBeNull();
    expect(avatar!.textContent?.trim()).toBe("A");
  });

  it("dropdown identité : Appareils / Paramètres / Se déconnecter, Paramètres → #/admin", async () => {
    const { container, getByText } = renderAdmin();
    const trigger = container.querySelector(
      "button.st-identityMenu__trigger",
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    await fireEvent.click(trigger!);

    expect(getByText("Appareils")).not.toBeNull();
    const settings = getByText("Paramètres");
    expect(settings).not.toBeNull();
    expect(settings.getAttribute("href")).toBe("#/admin");
    expect(getByText("Se déconnecter")).not.toBeNull();
  });
});

describe("TopNav — flag beta Évaluation (Ctrl+Shift+X)", () => {
  it("flag beta ON : Évaluation apparaît dans la nav (3 liens, href #/evaluation)", () => {
    evaluationBeta.set(true);
    const { container, getByText } = renderNav("signaux");

    const navLinks = container.querySelectorAll("a.st-appHeader__navLink");
    expect(navLinks.length).toBe(3);

    const evaluation = getByText("Évaluation");
    expect(evaluation.tagName).toBe("A");
    expect(evaluation.getAttribute("href")).toBe("#/evaluation");
    expect(
      evaluation.classList.contains("st-appHeader__navLink"),
    ).toBe(true);
  });

  it("flag beta ON + activeView=evaluation : Évaluation est actif, Signaux non", () => {
    evaluationBeta.set(true);
    const { getByText } = renderNav("evaluation");
    expect(getByText("Évaluation").getAttribute("aria-current")).toBe("page");
    expect(getByText("Signaux").getAttribute("aria-current")).toBeNull();
  });

  it("bascule du flag APRÈS rendu : la nav se met à jour (révèle puis masque)", async () => {
    const { container, queryByText } = renderNav("signaux");
    expect(queryByText("Évaluation")).toBeNull();

    evaluationBeta.set(true);
    await Promise.resolve(); // tick svelte
    expect(queryByText("Évaluation")).not.toBeNull();
    expect(
      container.querySelectorAll("a.st-appHeader__navLink").length,
    ).toBe(3);

    evaluationBeta.set(false);
    await Promise.resolve();
    expect(queryByText("Évaluation")).toBeNull();
    expect(
      container.querySelectorAll("a.st-appHeader__navLink").length,
    ).toBe(2);
  });
});
