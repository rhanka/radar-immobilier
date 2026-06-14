/**
 * Router SPA léger — synchronise activeView avec l'URL via History API.
 *
 * Stratégie : hash-fragment (`/#/signaux`) pour rester compatible avec le
 * serveur nginx actuel (pas de réécriture côté serveur nécessaire).
 *
 * Intégration :
 *  - App.svelte remplace `let activeView = "signaux"` par `$activeRouteView`
 *  - `navigateTo(view)` remplace `activeView = view` partout
 *  - Guard auth : inchangé (App.svelte continue de gérer la redirection)
 */

import { writable } from "svelte/store";
import type { DemoView } from "$lib/demo/views.js";

/** Les vues valides connues du routeur. */
const VALID_VIEWS = new Set<string>([
  "signaux",
  "opportunity",
  "evaluation",
  "sources",
  "admin",
  "onboarding",
  "ciblage",
  "grilles",
  "console",
  "ontologie",
  "coordination",
  "backlog",
  "carte-signaux",
  "carte-opportunites",
  "carte-evaluation",
]);

/** Vue par défaut si l'URL ne contient pas de vue valide. */
const DEFAULT_VIEW: DemoView = "signaux";

/** Extrait la vue depuis le hash de l'URL courante. */
function viewFromHash(hash: string): DemoView {
  // Hash attendu : `#/signaux`, `#/opportunity`, etc.
  const segment = hash.replace(/^#\//, "").split("?")[0].split("/")[0];
  return VALID_VIEWS.has(segment) ? (segment as DemoView) : DEFAULT_VIEW;
}

/** Store réactif de la vue courante (synchronisé avec l'URL). */
export const activeRouteView = writable<DemoView>(
  typeof window !== "undefined"
    ? viewFromHash(window.location.hash)
    : DEFAULT_VIEW,
);

/** Navigue vers une vue : met à jour le hash + le store. */
export function navigateTo(view: DemoView): void {
  if (typeof window === "undefined") return;
  const newHash = `#/${view}`;
  if (window.location.hash !== newHash) {
    window.history.pushState({ view }, "", newHash);
  }
  activeRouteView.set(view);
}

/**
 * Initialise le listener `popstate` (boutons Précédent/Suivant du navigateur).
 * À appeler une seule fois dans `onMount` de App.svelte.
 * Retourne une fonction de cleanup (pour `onDestroy`).
 */
export function initRouter(): () => void {
  if (typeof window === "undefined") return () => {};

  function onPopState(): void {
    activeRouteView.set(viewFromHash(window.location.hash));
  }

  window.addEventListener("popstate", onPopState);

  // Synchroniser le hash initial si vide
  if (!window.location.hash || window.location.hash === "#") {
    window.history.replaceState({ view: DEFAULT_VIEW }, "", `#/${DEFAULT_VIEW}`);
  }

  return () => window.removeEventListener("popstate", onPopState);
}
