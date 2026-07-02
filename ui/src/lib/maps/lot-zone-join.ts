/**
 * lot-zone-join — JOIN pur lot↔zone pour la vue Évaluation.
 *
 * Le lot cadastral porte un `zoneCode` brut (ex. "H-104", extrait par
 * lots-client) mais, selon la source, pas toujours l'objet `zone` complet
 * (kind, usages, grille PDF). La couche zonage géo (`zones-client`) porte ces
 * attributs par zone. Ce module joint les deux SANS refetch :
 *
 *   zone.code (couche zonage) ── zoneRefComparableKey ── lot.zoneCode
 *
 * La normalisation d'appariement est EXACTEMENT celle du join signal↔zone
 * (`zoneRefComparableKey`, partagé avec signaux-map-geo) : casse, espaces,
 * tirets, suffixe secteur. Un code vide ou placeholder ("N/D", "N/A"…) ne
 * matche JAMAIS.
 *
 * Anti-invention : le join ne FABRIQUE aucune donnée — il recopie les
 * attributs publics de la zone quand le lot ne les porte pas déjà. Les
 * valeurs déjà présentes sur le lot (fournies par l'API) ont priorité.
 */

import { zoneRefComparableKey } from "./signaux-map-geo.js";
import type { ZoneFeature } from "./zones-client.js";
import type { LotFeature, LotProperties } from "./lots-client.js";

/** Index zone : clé comparable normalisée → feature de zone. */
export type ZoneIndex = Map<string, ZoneFeature>;

/** Placeholders fréquents qui ne sont PAS des codes de zone. */
const ZONE_CODE_PLACEHOLDERS = new Set(["ND", "N/D", "NA", "N/A", "-", "—"]);

/**
 * Clé comparable du code de zone d'un LOT (zoneCode brut, ou zone.code).
 * Retourne null si absent ou placeholder — jamais de faux-match.
 */
export function lotZoneKey(properties: LotProperties): string | null {
  const raw = properties.zoneCode ?? properties.zone?.code ?? null;
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length === 0 || ZONE_CODE_PLACEHOLDERS.has(trimmed)) return null;
  const key = zoneRefComparableKey(raw);
  return key.length > 0 ? key : null;
}

/**
 * Construit l'index code→zone depuis les features de la couche zonage.
 * En cas de doublon de code (multi-polygones d'une même zone), la PREMIÈRE
 * feature portant des attributs (kind/grille) gagne ; sinon la première vue.
 */
export function buildZoneIndex(zones: readonly ZoneFeature[]): ZoneIndex {
  const index: ZoneIndex = new Map();
  for (const zone of zones) {
    const key = zoneRefComparableKey(zone.properties.code);
    if (key.length === 0) continue;
    const existing = index.get(key);
    if (!existing) {
      index.set(key, zone);
      continue;
    }
    // Doublon : préfère la feature la plus renseignée (kind ou grille PDF).
    const existingHasMeta = !!(existing.properties.kind || existing.properties.grillePdfUrl);
    const candidateHasMeta = !!(zone.properties.kind || zone.properties.grillePdfUrl);
    if (!existingHasMeta && candidateHasMeta) index.set(key, zone);
  }
  return index;
}

/** Zone de la couche géo correspondant au lot, ou null si pas de join. */
export function zoneForLot(properties: LotProperties, index: ZoneIndex): ZoneFeature | null {
  const key = lotZoneKey(properties);
  if (key === null) return null;
  return index.get(key) ?? null;
}

/**
 * Retourne le lot enrichi de sa zone jointe (copie non destructive).
 *
 * - Pas de join → le lot est retourné TEL QUEL (même référence).
 * - Join → `properties.zone` est complété : les champs déjà fournis par
 *   l'API sur le lot gardent priorité, la couche zonage remplit les trous
 *   (code, kind, usages, grillePdfUrl). `zoneCode`/`grillePdfUrl` top-level
 *   sont également remplis s'ils manquaient.
 */
export function enrichLotWithZone(lot: LotFeature, index: ZoneIndex): LotFeature {
  const joined = zoneForLot(lot.properties, index);
  if (!joined) return lot;

  const own = lot.properties.zone;
  const zone: NonNullable<LotProperties["zone"]> = {
    kind: own?.kind && own.kind !== "non précisé" ? own.kind : (joined.properties.kind ?? own?.kind ?? "non précisé"),
    usages: own?.usages?.length ? own.usages : (joined.properties.usages ?? []),
    densiteLogHa: own?.densiteLogHa ?? null,
    code: own?.code ?? joined.properties.code,
    grillePdfUrl: own?.grillePdfUrl ?? joined.properties.grillePdfUrl ?? null,
  };

  return {
    ...lot,
    properties: {
      ...lot.properties,
      zone,
      zoneCode: lot.properties.zoneCode ?? joined.properties.code,
      grillePdfUrl: lot.properties.grillePdfUrl ?? joined.properties.grillePdfUrl ?? null,
    },
  };
}
