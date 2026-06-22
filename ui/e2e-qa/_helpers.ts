import type { Page, Route } from "@playwright/test";

/**
 * Mocke les routes /api minimales pour rendre l'app AUTHENTIFIÉE sans backend.
 * - /api/v1/auth/me : session valide (admin) → l'App rend le chrome + TopNav.
 * - Toute autre /api/* : 200 vide par défaut (les vues data restent inertes,
 *   on teste le CHROME/HEADER, pas les données métier).
 *
 * À appeler AVANT page.goto pour intercepter le checkSession du onMount.
 */
export async function mockAuthenticated(
  page: Page,
  opts: { isAdmin?: boolean } = {},
): Promise<void> {
  const isAdmin = opts.isAdmin ?? true;

  await page.route("**/api/v1/auth/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        authDisabled: false,
        user: {
          sub: "qa-user",
          name: "QA User",
          email: "qa@example.com",
          status: "active",
          isAdmin,
        },
      }),
    }),
  );

  // Catch-all pour les autres appels /api : réponse vide stable (pas de 500).
  await page.route("**/api/**", (route: Route) => {
    const url = route.request().url();
    if (url.includes("/api/v1/auth/me")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
}
