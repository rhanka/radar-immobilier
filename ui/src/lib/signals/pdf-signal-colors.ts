/**
 * Palette de couleurs STABLE pour le surlignage multi-signaux d'un même PV
 * (LOT 2 viewer de preuve, track #84).
 *
 * Un procès-verbal (même `rawRef`) peut porter plusieurs signaux ; chacun est
 * surligné dans le PDF avec une couleur distincte + un badge ID, et la même
 * couleur est répétée dans le panneau de droite (pastille devant l'ID du
 * signal) pour faire le lien visuel surlignage ↔ fiche.
 *
 * Le mapping couleur↔signal est une PURE FONCTION de la POSITION du signal dans
 * la liste ordonnée des signaux du PV (le signal courant d'abord), pour que
 * l'overlay et le panneau attribuent EXACTEMENT la même couleur au même signal
 * sans partager d'état. La palette est volontairement bornée et qualitative
 * (teintes distinctes, contraste suffisant sur fond clair). Au-delà de la
 * palette on boucle (modulo) — acceptable car un PV affiche rarement assez de
 * signaux DISTINCTS sur une même page pour épuiser la palette ; le badge ID
 * lève l'ambiguïté résiduelle.
 */

/**
 * Teintes qualitatives distinctes (hex), pensées pour rester lisibles en
 * surlignage semi-transparent (mix-blend multiply) sur du texte noir.
 */
export const SIGNAL_HIGHLIGHT_PALETTE: readonly string[] = [
  "#f59e0b", // ambre (défaut historique LOT 1)
  "#3b82f6", // bleu
  "#10b981", // émeraude
  "#ec4899", // rose
  "#8b5cf6", // violet
  "#ef4444", // rouge
  "#14b8a6", // sarcelle
  "#f97316", // orange foncé
];

/** Couleur stable d'un signal d'après son rang dans la liste du PV. */
export function signalColorAt(index: number): string {
  const n = SIGNAL_HIGHLIGHT_PALETTE.length;
  const i = ((index % n) + n) % n;
  return SIGNAL_HIGHLIGHT_PALETTE[i]!;
}
