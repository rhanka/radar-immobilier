/**
 * Score de potentiel par lot — mode simulation CS-L6.
 *
 * Ce scorer calcule un score [0, 1] par lot à partir des données
 * de la fixture Steve (zone + superficie + TOD).
 *
 * DISTINCTION (SPEC_EVOL_INTEGRATION_CARTE_STEVE.md §S-1) :
 *   - Ce score est le "score de potentiel par lot" (colorie CS-L1),
 *     distinct du score T2 de dossier (0-5 sur OpportunityDossier).
 *   - Il est calculable pour 100 % des lots (tout lot a une zone ou
 *     une géométrie, même si partielle).
 *   - Il N'EST PAS le scoreGlobal /100 legacy.
 *
 * Formule :
 *   score = densiteW * densiteScore
 *         + todW    * todScore
 *         + supW    * superficieScore
 *
 * Pondérations :
 *   densiteW  = 0.50  (densité de logements permise par la zone)
 *   todW      = 0.30  (position dans périmètre TOD)
 *   supW      = 0.20  (superficie du lot)
 *
 * Honnêteté :
 *   - Si zone absente ("" / "N/D") → densiteScore = 0 ; score partiel.
 *   - Si TOD indisponible pour la ville → todScore = 0 ; score partiel.
 *   - Candiac : 0 zones, 0 TOD → score = superficieScore * 0.20 uniquement.
 */

import { zoneKindFromCode, densiteLogHaFromKind } from "./zone-kind.js";
import type { SimulationScoreDetail } from "./types.js";

/** Pondérations du score de potentiel par lot (somme = 1.0). */
export const LOT_POTENTIAL_WEIGHTS = {
  densite:    0.50,
  tod:        0.30,
  superficie: 0.20,
} as const;

/** Superficie minimale pour être éligible (m²). */
const MIN_SUPERFICIE_M2 = 300;

/** Superficie de référence pour le score max (m²). */
const REF_SUPERFICIE_M2 = 2000;

/** Densité de référence pour le score max (log/ha). */
const REF_DENSITE_LOG_HA = 40;

/**
 * Calcule le score de potentiel d'un lot à partir de ses données Steve.
 *
 * @param zone        Code de zone (ex. "H-104", "" si inconnu)
 * @param superficieM2 Superficie calculée (m²)
 * @param tod         Flag TOD (issu du JSON Steve, true si dans périmètre)
 * @param isRue       True si emprise de rue (exclut l'affichage)
 * @returns           Score [0, 1] et détail, ou null si lot non éligible
 */
export function lotPotentialScore(
  zone: string,
  superficieM2: number,
  tod: boolean,
  isRue: boolean,
): { score: number; detail: SimulationScoreDetail } {
  const eligible = !isRue;
  const kind = zoneKindFromCode(zone);
  const densiteLogHa = densiteLogHaFromKind(kind);
  const hasDensiteLogHa = densiteLogHa > 0;
  const superficieSuffisante = superficieM2 >= MIN_SUPERFICIE_M2;

  // Score densité : proportionnel à densiteLogHa, cap à REF_DENSITE_LOG_HA
  const densiteScore = hasDensiteLogHa
    ? Math.min(densiteLogHa / REF_DENSITE_LOG_HA, 1.0)
    : 0;

  // Score TOD : 1.0 si dans le périmètre, 0 sinon
  const todScore = tod ? 1.0 : 0;

  // Score superficie : proportionnel entre MIN et REF, cap à 1.0
  const superficieScore = superficieSuffisante
    ? Math.min(
        (superficieM2 - MIN_SUPERFICIE_M2) / (REF_SUPERFICIE_M2 - MIN_SUPERFICIE_M2),
        1.0,
      )
    : 0;

  const rawScore =
    densiteScore * LOT_POTENTIAL_WEIGHTS.densite +
    todScore     * LOT_POTENTIAL_WEIGHTS.tod +
    superficieScore * LOT_POTENTIAL_WEIGHTS.superficie;

  // Score arrondi à 4 décimales
  const score = Math.round(rawScore * 10000) / 10000;

  const detail: SimulationScoreDetail = {
    hasDensiteLogHa,
    densiteLogHa,
    inTod: tod,
    superficieSuffisante,
    zoneKind: kind,
    eligible,
  };

  return { score: eligible ? score : 0, detail };
}
