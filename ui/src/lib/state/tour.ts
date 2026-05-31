import { writable } from "svelte/store";

/** Cle localStorage pour marquer la visite guidee comme deja vue. */
export const TOUR_SEEN_KEY = "radar-tour-seen";

/** La visite est-elle en cours ? */
export const tourActive = writable<boolean>(false);

/** Index de l'etape courante (0-based). */
export const tourStep = writable<number>(0);

/** Lance la visite depuis l'etape 0. */
export function startTour(): void {
  tourStep.set(0);
  tourActive.set(true);
}

/** Ferme la visite et marque "vu" dans localStorage. */
export function closeTour(): void {
  tourActive.set(false);
  try {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // Stockage indisponible (mode prive, SSR) : on ignore silencieusement.
  }
}

/** Retourne true si c'est la premiere visite (localStorage vide). */
export function isFirstVisit(): boolean {
  try {
    return !localStorage.getItem(TOUR_SEEN_KEY);
  } catch {
    return false;
  }
}
