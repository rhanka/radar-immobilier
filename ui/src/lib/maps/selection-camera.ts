/**
 * m4 / #12 — Décision de COMMANDE caméra pour une clé de sélection géo.
 *
 * Centralise la logique « faut-il bouger la caméra, et comment » pour que TOUS
 * les chemins de sélection (clic carte, clic dans le pane droit, restauration
 * d'URL) se comportent de façon cohérente :
 *
 *   - ZONE : toujours cadrée sur son étendue (fitBounds — peut changer le zoom).
 *   - LOT  : commandé UNIQUEMENT sur une sélection utilisateur explicite
 *            (`fitLot`) — clic carte OU clic dans la liste Lots. L'auto-
 *            sélection du 1er lot d'une ville sans zones NE bouge PAS la caméra.
 *
 * Contrat caméra « lot suivant » (PO : « recentrer sur le lot MAIS garder le
 * zoom ») — pour un lot sélectionné par l'utilisateur :
 *
 *   - PREMIER lot (aucun lot déjà ciblé par la caméra) → `mode: "frame"`
 *     (cadrage existant, fitBounds — inchangé).
 *   - RECLIC sur le MÊME lot → `null` : AUCUNE commande caméra.
 *   - AUTRE lot de la MÊME zone (ou zone indéterminée) → `mode: "recenter"` :
 *     recentrage sur le centre du lot EN GARDANT le zoom courant (easeTo,
 *     jamais fitBounds — fitBounds change le zoom).
 *   - Lot d'une AUTRE zone (ou d'une autre ville) → `mode: "frame"` : le
 *     cadrage existant reste permis (peut changer le zoom).
 *
 * Zone indéterminée ⇒ recentrage : l'intention PO est de ne JAMAIS surprendre
 * l'utilisateur par un changement de zoom pendant la navigation lot à lot ; on
 * ne re-cadre que si le lot est POSITIVEMENT dans une autre zone.
 */
import { parseKey, type SelectionKey } from "./selection-bucket.js";

export type SelectionCameraTarget =
  | { kind: "zone"; citySlug: string; code: string }
  | { kind: "lot"; citySlug: string; noLot: string; mode: "frame" | "recenter" };

/** Dernier lot ciblé par une commande caméra (frame OU recenter). */
export interface PreviousCameraLot {
  citySlug: string;
  noLot: string;
  /** Code de la zone contenant ce lot au moment de la commande (`null` = indéterminé). */
  zoneCode: string | null;
}

export interface SelectionCameraOptions {
  /** Sélection utilisateur explicite d'un lot (clic carte / clic liste). */
  fitLot?: boolean;
  /** Dernier lot ciblé par la caméra — `null`/absent : aucun (premier lot). */
  previousLot?: PreviousCameraLot | null;
  /** Résout le code de zone contenant un lot (`null` = indéterminé). */
  zoneCodeForLot?: (citySlug: string, noLot: string) => string | null;
}

export function resolveSelectionCameraTarget(
  key: SelectionKey,
  options: SelectionCameraOptions = {},
): SelectionCameraTarget | null {
  const parsed = parseKey(key);
  if (!parsed || (parsed.kind !== "zone" && parsed.kind !== "lot")) return null;
  const sep = parsed.id.indexOf("/");
  // Id attendu : `${citySlug}/${ref}` (séparateur interne, ni en tête ni en fin).
  if (sep <= 0 || sep === parsed.id.length - 1) return null;
  const citySlug = parsed.id.slice(0, sep);
  const ref = parsed.id.slice(sep + 1);
  if (parsed.kind === "zone") return { kind: "zone", citySlug, code: ref };

  // Lot : commande caméra seulement sur sélection utilisateur explicite.
  if (!options.fitLot) return null;

  const previous = options.previousLot ?? null;
  // Premier lot : cadrage existant inchangé (fitBounds permis).
  if (!previous) return { kind: "lot", citySlug, noLot: ref, mode: "frame" };
  // Reclic sur le MÊME lot : aucune commande caméra.
  if (previous.citySlug === citySlug && previous.noLot === ref) return null;
  // Autre ville ⇒ autre zone : cadrage existant permis.
  if (previous.citySlug !== citySlug) {
    return { kind: "lot", citySlug, noLot: ref, mode: "frame" };
  }
  const nextZone = options.zoneCodeForLot?.(citySlug, ref) ?? null;
  // Lot POSITIVEMENT dans une autre zone : cadrage existant permis.
  if (previous.zoneCode !== null && nextZone !== null && previous.zoneCode !== nextZone) {
    return { kind: "lot", citySlug, noLot: ref, mode: "frame" };
  }
  // Autre lot, même zone (ou indéterminée) : recentrer EN GARDANT le zoom.
  return { kind: "lot", citySlug, noLot: ref, mode: "recenter" };
}
