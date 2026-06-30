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

describe("auth-store — prompt=login CONDITIONNEL (session durable, wp5 §B)", () => {
  let assignedHref: string | undefined;
  let originalLocation: Location;

  beforeEach(() => {
    assignedHref = undefined;
    // Repart d'un sessionStorage propre : pas de marqueur de ré-auth résiduel.
    try {
      globalThis.sessionStorage?.clear();
    } catch {
      /* indisponible : on continue */
    }
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
    try {
      globalThis.sessionStorage?.clear();
    } catch {
      /* no-op */
    }
    vi.restoreAllMocks();
  });

  it("re-login ORDINAIRE → /api/v1/auth/login SANS prompt (réutilise la session SSO + le consentement)", () => {
    // Le coeur du fix P2 : un re-login courant (session radar expirée) ne force
    // PLUS `prompt=login`, donc l'IdP réutilise sa session SSO et le consentement
    // mémorisé → reconnexion silencieuse, plus d'écran « Autoriser l'application ».
    authStore.redirectToLogin();
    expect(assignedHref).toBe("/api/v1/auth/login");
  });

  it("flux sensible explicite (forceReauth) → /api/v1/auth/login?prompt=login", () => {
    // `prompt=login` reste la SEULE valeur honorée par l'IdP (login/none/consent ;
    // `select_account` ignoré). Réservé aux flux sensibles (switch-account...).
    authStore.redirectToLogin({ forceReauth: true });
    expect(assignedHref).toBe("/api/v1/auth/login?prompt=login");
  });

  it("logout explicite (marqueur markForceReauth) → prompt=login, consommé une seule fois", () => {
    // Le logout pose le marqueur avant le reload ; le prochain redirectToLogin()
    // force la ré-auth, puis le marqueur est consommé (one-shot).
    authStore.markForceReauth();
    authStore.redirectToLogin();
    expect(assignedHref).toBe("/api/v1/auth/login?prompt=login");

    // Deuxième tentative SANS reposer le marqueur : re-login ordinaire (silencieux).
    assignedHref = undefined;
    authStore.redirectToLogin();
    expect(assignedHref).toBe("/api/v1/auth/login");
  });
});
