/**
 * QA — Tests documentant les bugs NON COUVERTS sans stack API/postgres.
 *
 * Ces tests sont en SKIP intentionnel. Ils seront activés quand un environnement
 * e2e léger (vite preview + API mock ou stack de test isolée) sera disponible.
 *
 * Chaque `it.todo` documente le comportement attendu et l'obstacle technique.
 *
 * Bugs référencés :
 *   - Rendu PDF via route /api/documents/:id (DocumentOverlay / SignalPdfOverlay)
 *   - Colorisation carte MapLibre (couche fill-color selon score → token DS)
 *   - Flux auth/enroll (guard SPA → redirect → session cookie)
 *   - Font DS « Inter » via token --st-font-sans (getComputedStyle en vrai navigateur)
 *   - Soulignement état actif sur le header (border-bottom DS dans vrai navigateur)
 */
import { describe, it } from "vitest";

describe("NON COUVERT sans stack — rendu PDF", () => {
  it.todo("DocumentOverlay : GET /api/documents/:id → blob PDF → rendu dans iframe (nécessite api)");
  it.todo("SignalPdfOverlay : citation surlignée dans le PDF chargé depuis scrapeStore (nécessite api)");
});

describe("NON COUVERT sans stack — carte MapLibre", () => {
  it.todo(
    "Colorisation lot fill-color : un lot avec signal 'rezonage' doit avoir la couleur DS du score " +
    "(getComputedStyle MapLibre → token --st-semantic-surface-*) — nécessite vrai navigateur + canvas WebGL"
  );
  it.todo(
    "Opacité de sélection MapLibre : lot sélectionné = opacité 1, non sélectionné = 0.5 " +
    "(DIMMED_SELECTION_OPACITY) — nécessite layer MapLibre renderé"
  );
});

describe("NON COUVERT sans stack — auth/session", () => {
  it.todo(
    "SPA auth guard : accès sans session → redirect vers /login → pas de boucle infinie " +
    "(nécessite api /api/auth/me + session cookie)"
  );
  it.todo(
    "Logout corrigé : POST /logout → cookie purgé → reload propre vers / " +
    "(nécessite api + cookie store)"
  );
});

describe("NON COUVERT sans vrai navigateur — police DS et styles rendus", () => {
  it.todo(
    "Header : getComputedStyle(navLink).fontFamily contient 'Inter' " +
    "(--st-font-sans token chargé) — nécessite Playwright + vite preview avec CSS compilé"
  );
  it.todo(
    "Header : navLink actif a border-bottom-color != transparent " +
    "(soulignement DS visible) — nécessite Playwright + vite preview"
  );
  it.todo(
    "Header : hauteur header = 56px (token DS --st-appHeader-height) — nécessite Playwright"
  );
  it.todo(
    "Filtre : régler → recharger vite preview → état préservé (localStorage lu au boot SPA) " +
    "— nécessite Playwright + vite preview"
  );
});
