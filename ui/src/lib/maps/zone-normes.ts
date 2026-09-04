/**
 * zone-normes — normes de zonage AFFICHABLES d'une zone du drawer Signaux,
 * DÉRIVÉES des lots de cette zone.
 *
 * Aucun endpoint ne sert les normes AU NIVEAU ZONE : geo les folde par lot via
 * `zone_code` (tous les lots d'une même zone partagent la grille — hauteur max,
 * densité, marges, façade/superficie min — ainsi que l'usage dominant de la
 * zone). On REMONTE donc ces valeurs au niveau zone en prenant le premier lot
 * porteur d'une valeur servie, pour les surfacer dans la sous-section « Normes »
 * du drawer « Règlement et Normes ».
 *
 * Contrat anti-invention STRICT (règle owner) :
 *   - on lit UNIQUEMENT ce que geo sert sur les lots (`zone.usageDominant`,
 *     `normes.*`) via les utilitaires purs existants (`usageDominantDisplay`,
 *     `lotNormesRows`) — rien n'est calculé, dérivé ni deviné ;
 *   - `served=false` quand AUCUN lot de la zone ne porte d'usage dominant ni de
 *     norme (ex. villes en source cadastrale sans grille — le drawer affiche
 *     alors une copy neutre « non renseigné », jamais une valeur fabriquée) ;
 *   - `zoneCode` absent (aucune zone active) → `served=false`, lignes par défaut.
 */
import type { LotFeature, LotProperties } from "$lib/maps/lots-client.js";
import {
  lotNormesRows,
  lotZoneCode,
  reglementProvenance,
  usageDominantDisplay,
  type ReglementProvenanceDisplay,
} from "$lib/components/maps/lot-fiche-utils.js";
import { zoneRefComparableKey } from "$lib/maps/signaux-map-geo.js";

export interface ZoneNormesDisplay {
  /** Usage dominant affichable (`usageDominantDisplay`) ou null si non servi. */
  usageDominant: string | null;
  /** Lignes de grille [libellé, valeur servie ou « — »] (`lotNormesRows`). */
  rows: Array<[string, string]>;
  /** true dès qu'au moins un champ (usage OU une norme) est réellement servi. */
  served: boolean;
  /**
   * Provenance affichable du règlement en vigueur porteur de la norme
   * (`reglementProvenance` du lot représentatif de la zone), ou null si aucun
   * lot de la zone ne porte de numéro/URL de règlement. Anti-invention : lu
   * UNIQUEMENT du servi (`qc-zonage-norms-<slug>` foldé sur le lot), jamais deviné.
   */
  reglement: ReglementProvenanceDisplay | null;
}

function hasAnyNorme(
  normes: LotProperties["normes"] | null | undefined,
): boolean {
  if (!normes) return false;
  return Object.values(normes).some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

/**
 * Normes de zonage AFFICHABLES d'une zone (par son code), dérivées des `lots`
 * chargés. Réutilise `usageDominantDisplay` + `lotNormesRows` (mêmes utilitaires
 * que la fiche lot) — un seul contrat d'affichage, testé une fois.
 */
export function zoneNormesFromLots(
  zoneCode: string | null | undefined,
  lots: readonly LotFeature[],
): ZoneNormesDisplay {
  const fallback: ZoneNormesDisplay = {
    usageDominant: null,
    rows: lotNormesRows(null),
    served: false,
    reglement: null,
  };
  if (!zoneCode) return fallback;
  const key = zoneRefComparableKey(zoneCode);
  if (key.length === 0) return fallback;

  // Lot représentatif : le premier lot de la zone porteur d'un usage dominant
  // (pour la ligne « Usage dominant ») et le premier porteur d'au moins une
  // norme (pour la grille). Séparés car un lot peut porter l'un sans l'autre.
  let usageZone: LotProperties["zone"] | null = null;
  let normes: LotProperties["normes"] | null = null;
  // Lot représentatif porteur de la PROVENANCE règlement (numéro OU URL servi) —
  // séparé car un lot peut porter l'usage/la grille sans provenance, ou l'inverse.
  let reglementZone: LotProperties["zone"] | null = null;
  for (const lot of lots) {
    const code = lotZoneCode(lot.properties);
    if (!code || zoneRefComparableKey(code) !== key) continue;
    if (!usageZone && usageDominantDisplay(lot.properties.zone)) {
      usageZone = lot.properties.zone ?? null;
    }
    if (!normes && hasAnyNorme(lot.properties.normes)) {
      normes = lot.properties.normes ?? null;
    }
    if (
      !reglementZone &&
      (lot.properties.zone?.reglementNumero || lot.properties.zone?.reglementUrl)
    ) {
      reglementZone = lot.properties.zone ?? null;
    }
    if (usageZone && normes && reglementZone) break;
  }

  const usageDominant = usageDominantDisplay(usageZone);
  const rows = lotNormesRows(normes);
  const served = usageDominant !== null || rows.some(([, value]) => value !== "—");
  return { usageDominant, rows, served, reglement: reglementProvenance(reglementZone) };
}
