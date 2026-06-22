/**
 * QA auth-store — prouve les garanties de sécurité côté SPA SANS stack :
 *   - /me est sondé avec `cache: "no-store"` (jamais resservir un user périmé
 *     après logout/reconnexion — symptôme « reconnect = compte précédent ») ;
 *   - le clic « Se connecter » envoie `/api/v1/auth/login?prompt=login` — la
 *     SEULE valeur `prompt` honorée par l'IdP sentropic (qui ignore
 *     `select_account`), pour forcer le ré-affichage du login au lieu de
 *     réutiliser silencieusement la session SSO du dernier user.
 *
 * On mocke `fetch` et on stubbe `window.location` pour observer l'URL de
 * redirection sans naviguer réellement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { authStore } from "./auth-store.js";

describe("auth-store — sondage /me non-caché", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appelle /api/v1/auth/me avec cache:'no-store'", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        json: async () => ({ authenticated: true, user: { sub: "u1" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await authStore.checkSession();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/me",
      expect.objectContaining({ cache: "no-store" }),
    );
    // L'état reflète bien la réponse fraîche.
    expect(get(authStore).user?.sub).toBe("u1");
  });

  it("résout authenticated:false quand /me ne renvoie pas de user", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => ({ authenticated: false }) });
    vi.stubGlobal("fetch", fetchMock);

    await authStore.checkSession();

    const state = get(authStore);
    expect(state.authenticated).toBe(false);
    expect(state.user).toBeNull();
  });
});

describe("auth-store — le login explicite ouvre le sélecteur de comptes IdP", () => {
  let assignedHref: string | undefined;
  let originalLocation: Location;

  beforeEach(() => {
    assignedHref = undefined;
    originalLocation = window.location;
    // jsdom interdit l'affectation réelle de location.href ; on remplace
    // l'objet location par un proxy qui capture `href` sans naviguer.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        get href() {
          return assignedHref ?? "";
        },
        set href(v: string) {
          assignedHref = v;
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it("redirectToLogin() pointe sur /api/v1/auth/login?prompt=login (seule valeur honorée par l'IdP)", () => {
    authStore.redirectToLogin();
    // `prompt=login` est la SEULE valeur `prompt` que l'IdP sentropic honore :
    // son authorize-handler traite login/none/consent mais IGNORE
    // `select_account` (aucun sélecteur de comptes). Un ancien fix envoyait
    // `select_account` — silencieusement jeté par l'IdP, d'où la persistance du
    // symptôme « reconnect = compte précédent ». `prompt=login` force au moins
    // le ré-affichage du login. LIMITE : changer réellement de compte tant que
    // le cookie SSO de l'IdP vit dépend d'une évolution IdP.
    expect(assignedHref).toBe("/api/v1/auth/login?prompt=login");
  });
});
