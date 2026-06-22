/**
 * QA auth-store — prouve les garanties de sécurité côté SPA SANS stack :
 *   - /me est sondé avec `cache: "no-store"` (jamais resservir un user périmé
 *     après logout/reconnexion — symptôme « reconnect = compte précédent ») ;
 *   - le clic « Se connecter » force la RÉ-AUTHENTIFICATION IdP
 *     (`/api/v1/auth/login?prompt=login`), au lieu de réutiliser silencieusement
 *     la session SSO du dernier user.
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

describe("auth-store — le login explicite force la ré-authentification IdP", () => {
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

  it("redirectToLogin() pointe sur /api/v1/auth/login?prompt=login (kill SSO reuse)", () => {
    authStore.redirectToLogin();
    // prompt=login : sans lui, l'IdP resservirait silencieusement la session
    // SSO du DERNIER user après une déconnexion — la faille rapportée.
    expect(assignedHref).toBe("/api/v1/auth/login?prompt=login");
  });
});
