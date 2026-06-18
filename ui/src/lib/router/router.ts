import { writable } from "svelte/store";
import type { DemoView } from "$lib/demo/views.js";
import {
  buildGeoRoute,
  isGeoRoutePathname,
  parseGeoRoute,
  type GeoRoute,
  type GeoRouteTarget,
} from "./geo-route.js";

export {
  buildFallbackZoneKey,
  buildGeoPath,
  buildGeoQuery,
  buildGeoRoute,
  isFallbackZoneKey,
  isGeoRoutePathname,
  normalizeGeoRouteState,
  parseGeoQuery,
  parseGeoRoute,
} from "./geo-route.js";
export type {
  GeoCityRoute,
  GeoEntityRef,
  GeoMode,
  GeoRegionRoute,
  GeoRoute,
  GeoRouteParseIssue,
  GeoRouteParseResult,
  GeoRouteState,
  GeoRouteStateInput,
  GeoRouteTarget,
  GeoSelectionKind,
  GeoViewportState,
  GeoZoneRoute,
} from "./geo-route.js";

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
  // G3 — Vue géo intégration
  "geo",
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

function geoRouteFromLocation(
  location: Pick<Location, "pathname" | "search">,
): GeoRoute | null {
  const result = parseGeoRoute(location);
  return result.ok ? result.route : null;
}

/** Store réactif de la vue courante (synchronisé avec l'URL). */
export const activeRouteView = writable<DemoView>(
  typeof window !== "undefined"
    ? viewFromHash(window.location.hash)
    : DEFAULT_VIEW,
);

export const activeGeoRoute = writable<GeoRoute | null>(
  typeof window !== "undefined" ? geoRouteFromLocation(window.location) : null,
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

export function navigateToGeoRoute(
  route: GeoRouteTarget,
  options: { replace?: boolean } = {},
): void {
  if (typeof window === "undefined") return;

  const url = buildGeoRoute(route);
  const currentUrl = `${window.location.pathname}${window.location.search}`;

  if (currentUrl !== url || window.location.hash) {
    if (options.replace) {
      window.history.replaceState({ geoRoute: route }, "", url);
    } else {
      window.history.pushState({ geoRoute: route }, "", url);
    }
  }

  activeGeoRoute.set(geoRouteFromLocation(window.location));
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
    activeGeoRoute.set(geoRouteFromLocation(window.location));
  }

  window.addEventListener("popstate", onPopState);

  // Synchroniser le hash initial si vide
  if (
    !isGeoRoutePathname(window.location.pathname) &&
    (!window.location.hash || window.location.hash === "#")
  ) {
    window.history.replaceState({ view: DEFAULT_VIEW }, "", `#/${DEFAULT_VIEW}`);
  }

  activeGeoRoute.set(geoRouteFromLocation(window.location));

  return () => window.removeEventListener("popstate", onPopState);
}
