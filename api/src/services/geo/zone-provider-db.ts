/**
 * ZoneVersionProvider réel basé sur la table `zone_versions` DB.
 *
 * ## Situation actuelle (2026-06-12)
 *
 * La table `zone_versions` existe et peut être peuplée depuis le pipeline
 * d'exploitation (graphify → projection). Cependant, la résolution
 * `noLot → zoneId` nécessite la table `lot_zone_resolution` (SPEC_DESIGN_DATA_MODEL
 * §1.5), qui n'est pas encore projetée.
 *
 * En attendant, ce provider expose deux stratégies :
 *
 * 1. `makeCityZoneIndex` — charge toutes les ZoneVersions actuelles (known_to IS NULL)
 *    d'une ville dans un Map `codeAffiche → ZoneVersionInput`. Permet un lookup O(1)
 *    quand le code de zone d'un lot est connu (injection manuelle ou future résolution).
 *
 * 2. `makeDbZoneVersionProvider` — crée un `ZoneVersionProvider` injectable dans la
 *    route geo-lots qui consulte la DB. Retourne null si aucune zone ne peut être
 *    résolue pour le lot (score = 0, honnête).
 *
 * ## Anti-invention
 * - Ne fabrique JAMAIS de ZoneVersion fictive.
 * - Retourne null si la ville n'a pas de zones peuplées → score 0.
 * - Retourne null si le lot n'a pas de zone résolue.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { zoneVersions } from "../../db/schema.js";
import type { ZoneVersionProvider } from "../../routes/geo-lots.js";
import type { ZoneVersionInput, ZoneKind } from "../scoring/lot-potential.js";

// ─── Chargement index de zones par ville ──────────────────────────────────────

/**
 * Index des zones actuelles pour une ville (known_to IS NULL = encore valides).
 * Map : codeAffiche → ZoneVersionInput.
 *
 * Note : `codeAffiche` n'est pas unique par ville dans l'absolu (un code peut
 * changer de zone après réutilisation), mais pour un instant T = now, la
 * contrainte EXCLUDE garantit une seule version active par canonical.
 * Ici on prend simplement la dernière version connue.
 */
export interface CityZoneIndex {
  citySlug: string;
  byCode: Map<string, ZoneVersionInput>;
  totalZones: number;
}

/**
 * Charge l'index de zones actuelles pour une ville depuis la DB.
 * Retourne un index vide si la ville n'a pas de zones peuplées.
 *
 * @param db        Drizzle Database handle
 * @param citySlug  Slug de la ville (ex. "salaberry-de-valleyfield")
 */
export async function makeCityZoneIndex(
  db: Database,
  citySlug: string,
): Promise<CityZoneIndex> {
  const rows = await db
    .select({
      codeAffiche: zoneVersions.codeAffiche,
      kind: zoneVersions.kind,
      // JSON arrays stockés en JSONB : drizzle les retourne déjà parsés
      evidence: zoneVersions.evidence,
    })
    .from(zoneVersions)
    .where(
      and(
        eq(zoneVersions.citySlug, citySlug),
        isNull(zoneVersions.knownTo), // version encore valide
      ),
    );

  const byCode = new Map<string, ZoneVersionInput>();

  for (const row of rows) {
    if (byCode.has(row.codeAffiche)) continue; // garder la première (ordre stable)

    // La densiteLogHa n'est pas exposée sur la table actuelle (SPEC_DESIGN_DATA_MODEL
    // esquisse §1.1). La table `zone_versions` dans schema.ts n'a pas encore le champ
    // `densite_log_ha` ni `usages`. Ces champs seront ajoutés dans une prochaine
    // migration. En attendant : densiteLogHa=null, usages=[] (honnête, non inventé).
    byCode.set(row.codeAffiche, {
      densiteLogHa: null,
      usages: [],
      kind: (row.kind as ZoneKind) ?? "AUTRE",
    });
  }

  return {
    citySlug,
    byCode,
    totalZones: rows.length,
  };
}

// ─── Provider ZoneVersion injectable ─────────────────────────────────────────

/**
 * Crée un `ZoneVersionProvider` qui résout `(noLot, citySlug)` → ZoneVersionInput.
 *
 * ## Stratégie de résolution actuelle
 *
 * Sans `lot_zone_resolution`, on ne peut pas résoudre `noLot → codeAffiche`
 * de manière fiable. Ce provider retourne **null** (score 0 honnête) dans ce cas.
 *
 * Quand `lot_zone_resolution` sera disponible, la logique sera :
 *   1. lookup `lot_zone_resolution` par `noLot + citySlug` → `codeAffiche`
 *   2. lookup `byCode.get(codeAffiche)` → ZoneVersionInput
 *
 * @param db         Drizzle handle (pour charger l'index à la demande)
 * @param citySlug   Ville pour laquelle on crée le provider
 */
export async function makeDbZoneVersionProvider(
  db: Database,
  citySlug: string,
): Promise<ZoneVersionProvider> {
  const index = await makeCityZoneIndex(db, citySlug);

  if (index.totalZones === 0) {
    // Aucune zone peuplée pour cette ville → toujours null (score 0).
    return () => null;
  }

  // Zones peuplées, mais sans lot_zone_resolution on ne peut pas résoudre noLot → zone.
  // Provider retourne null pour l'instant (honnête : score 0, pas de valeur inventée).
  // TODO: brancher lot_zone_resolution quand disponible.
  return (_noLot: string, _city: string) => null;
}

// ─── Provider synchrone depuis un index pré-chargé ──────────────────────────

/**
 * Crée un `ZoneVersionProvider` synchrone depuis un `CityZoneIndex` pré-chargé.
 * Utile pour les tests et pour les scenarios où le codeAffiche d'un lot est connu
 * (ex. via `lot_zone_resolution` future).
 *
 * @param index   Index pré-chargé (`makeCityZoneIndex`)
 * @param resolve Fonction de résolution `noLot → codeAffiche | null`
 */
export function makeIndexedZoneProvider(
  index: CityZoneIndex,
  resolve: (noLot: string) => string | null,
): ZoneVersionProvider {
  return (noLot: string): ZoneVersionInput | null => {
    const code = resolve(noLot);
    if (!code) return null;
    return index.byCode.get(code) ?? null;
  };
}
