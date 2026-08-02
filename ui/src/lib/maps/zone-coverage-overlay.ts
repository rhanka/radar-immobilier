/**
 * zone-coverage-overlay — SQUELETTE (désactivé par défaut) de la couche
 * « couverture de preuve » au niveau CARTE (vues Signaux / Évaluation).
 *
 * Objectif : quand la donnée des 167 tombera, permettre d'afficher AU FIL
 * quelles zones portent une preuve servie (« Servi ») et lesquelles n'en ont
 * pas (« Non couvert »), sans jamais escamoter l'information pendant la
 * navigation.
 *
 * Contrat respecté : une preuve MORTE est ABSENTE du contrat (geo
 * re-capture/archive S3 les URL mortes) → elle ressort naturellement
 * « Non couvert ». AUCUNE sonde de liveness/CORS ici : on lit uniquement
 * l'enveloppe `proof` DÉJÀ validée par geo-provenance.
 *
 * Le drapeau reste OFF : zéro changement visuel en production tant que la
 * cohorte des 167 n'est pas prête et QA sur donnée réelle (recette = critère
 * de sortie). Les vues gatent leur rendu derrière ce drapeau.
 */
import { featureProof } from "./geo-provenance.js";
import { STATE_COLOR, STATE_LABEL } from "$lib/sources/source-coverage-client.js";

/** Drapeau unique : la couche reste désactivée jusqu'au feu vert donnée 167. */
export const ZONE_COVERAGE_LAYER_ENABLED = false;

export type ZoneCoverageState = "covered" | "uncovered";

/** Forme minimale de légende acceptée par le socle carte (GeoMapLegend). */
export interface CoverageLegend {
  title: string;
  items: { color: string; label: string }[];
}

/**
 * État de couverture d'une zone, DÉRIVÉ de l'enveloppe `proof` DÉJÀ validée
 * par geo-provenance (aucune revalidation, aucune sonde). Preuve valide
 * présente → « covered » ; absente ou invalide → « uncovered » (« Non couvert »).
 */
export function zoneCoverageState(
  zoneProperties: Record<string, unknown> | null | undefined,
): ZoneCoverageState {
  if (!zoneProperties) return "uncovered";
  return featureProof(zoneProperties["proof"]) ? "covered" : "uncovered";
}

/**
 * Légende « Couverture de preuve » — vocabulaire produit neutre (Servi /
 * Non couvert), couleurs partagées avec la Vue Sources.
 */
export function zoneCoverageLegend(): CoverageLegend {
  return {
    title: "Couverture de preuve",
    items: [
      { color: STATE_COLOR.verified, label: STATE_LABEL.verified }, // « Servi »
      { color: STATE_COLOR.absent, label: STATE_LABEL.absent }, // « Non couvert »
    ],
  };
}
