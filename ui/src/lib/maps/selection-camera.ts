/**
 * m4 / #12 — Décision de CADRAGE caméra pour une clé de sélection géo.
 *
 * Centralise la logique « faut-il recadrer, et sur quoi » pour que TOUS les
 * chemins de sélection (clic carte, clic dans le pane droit, restauration
 * d'URL) se comportent de façon cohérente :
 *
 *   - ZONE : toujours cadrée sur son étendue.
 *   - LOT  : cadré UNIQUEMENT sur une sélection utilisateur explicite
 *            (`fitLot`) — clic carte OU clic dans la liste Lots. L'auto-
 *            sélection du 1er lot d'une ville sans zones NE cadre PAS (on ne
 *            plonge pas dans un lot arbitraire à l'ouverture d'une ville).
 *
 * Conséquence m4 : sélectionner un 2e lot alors qu'un 1er est zoomé renvoie le
 * cadrage du lot B — JAMAIS un repli vers la zone parente ou la ville, donc
 * jamais de dézoom/reset du viewport.
 */
import { parseKey, type SelectionKey } from "./selection-bucket.js";

export type SelectionCameraTarget =
  | { kind: "zone"; citySlug: string; code: string }
  | { kind: "lot"; citySlug: string; noLot: string };

export function resolveSelectionCameraTarget(
  key: SelectionKey,
  options: { fitLot?: boolean } = {},
): SelectionCameraTarget | null {
  const parsed = parseKey(key);
  if (!parsed || (parsed.kind !== "zone" && parsed.kind !== "lot")) return null;
  const sep = parsed.id.indexOf("/");
  // Id attendu : `${citySlug}/${ref}` (séparateur interne, ni en tête ni en fin).
  if (sep <= 0 || sep === parsed.id.length - 1) return null;
  const citySlug = parsed.id.slice(0, sep);
  const ref = parsed.id.slice(sep + 1);
  if (parsed.kind === "zone") return { kind: "zone", citySlug, code: ref };
  // Lot : cadrage seulement si demandé explicitement (sélection utilisateur).
  if (options.fitLot) return { kind: "lot", citySlug, noLot: ref };
  return null;
}
