/**
 * G1 — Service de résolution géo : Signal/DesignationEvent → Zone/Lot.
 *
 * ## Rôle
 * Pour un noeud graphify (Signal ou DesignationEvent) :
 *   1. Extrait les codes zone et numéros de lot depuis le texte (label + description).
 *   2. Matche aux zone_versions / lot_versions DE LA MÊME commune (city_slug).
 *   3. Écrit les arêtes résolues dans `geo_resolutions` (si score >= seuil).
 *   4. Écrit les non-résolus dans `geo_unresolved` (score trop bas, aucun polygone).
 *
 * ## Propriétés
 * - Idempotent : un noeud déjà résolu est re-résolu (INSERT ... ON CONFLICT DO NOTHING).
 * - Ne lance PAS l'acquisition réelle des polygones (G2 — hors périmètre G1).
 * - Anti-invention : zéro match honnête → geo_unresolved, jamais d'arête fictive.
 * - Loi 25 : aucune PII. zone_versions.code_affiche = code de zone public.
 *            lot_versions.no_lot = numéro cadastral public.
 *
 * ## Matching
 * Zone : zones.code_norm = normalize(extracted_code) AND zones.city_slug = node.city_slug.
 *        Si plusieurs résultats (ne devrait pas arriver avec EXCLUDE constraint) → premier.
 * Lot  : lots.no_lot_norm = normalize(extracted_no_lot).
 *        Pas de filtre city_slug (cadastre province-entière).
 *
 * ## Taux de résolution attendu (V1)
 * ~30–60 % pour les villes avec couche vectorielle peuplée (G2 encore à faire).
 * En V1 la couche vectorielle est vide → résolution zone = 0 % par construction.
 * La résolution lot est possible dès que lot_versions.no_lot_norm est peuplé.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { zoneVersions, lotVersions } from "../../db/schema.js";
import {
  extractRefsFromFields,
  normalizeLotRef,
  normalizeZoneCode,
  RESOLUTION_THRESHOLD,
} from "./extract-refs.js";
import {
  matchZoneMultiLevel,
  isMatchResult,
  type GeoMatchDb,
} from "./match-refs.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Paramètres d'entrée pour un noeud à résoudre. */
export interface GeoResolveInput {
  /** ID graphify du noeud (ex. "signal-valleyfield-42"). */
  nodeId: string;
  /** Type du noeud : 'Signal' | 'DesignationEvent'. */
  nodeType: "Signal" | "DesignationEvent";
  /** Slug de la commune (ex. "salaberry-de-valleyfield"). */
  citySlug: string;
  /** Champ label du noeud. */
  label: string;
  /** Champ props.properties.description (peut être absent). */
  description?: string | null;
  /** Champ structuré props.properties.zone_ref (levier A direct). */
  zoneRef?: string | null | undefined;
  /** Champ structuré props.properties.no_lot (levier B direct). */
  noLot?: string | null | undefined;
  /** Citation/extrait du PV props.properties.citation (source texte riche). */
  citation?: string | null | undefined;
  /** Extraits additionnels (props.properties.excerpt, refs[].excerpt). */
  excerpts?: Array<string | null | undefined> | undefined;
  /** Date du signal/événement pour as_of_date. */
  asOfDate?: string | null;
}

/** Résultat de la résolution pour un noeud. */
export interface GeoResolveResult {
  nodeId: string;
  resolvedZones: number;
  resolvedLots: number;
  unresolvedZones: number;
  unresolvedLots: number;
}

// ─── Requêtes DB (raw SQL pour les tables sans ORM Drizzle défini dans schema.ts) ──
// Les tables geo_resolutions et geo_unresolved sont créées par la migration 0006
// mais ne sont pas encore dans schema.ts (hand-authored DDL).
// On utilise db.execute(sql`...`) pour les inserts dans ces tables.

/** INSERT dans geo_resolutions (idempotent via ON CONFLICT DO NOTHING). */
async function insertResolution(
  db: Database,
  params: {
    nodeId: string;
    nodeType: string;
    citySlug: string;
    relationType: "concerns_zone" | "concerns_lot";
    targetId: string;
    targetType: "Zone" | "Lot";
    extraitBrut: string;
    scoreConfiance: number;
    provenance: string;
    asOfDate: string | null | undefined;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO geo_resolutions
      (node_id, node_type, city_slug, relation_type, target_id, target_type,
       extrait_brut, score_confiance, provenance, as_of_date)
    VALUES
      (${params.nodeId}, ${params.nodeType}, ${params.citySlug},
       ${params.relationType}, ${params.targetId}, ${params.targetType},
       ${params.extraitBrut}, ${params.scoreConfiance}, ${params.provenance},
       ${params.asOfDate ?? null})
    ON CONFLICT (node_id, relation_type, target_id) DO NOTHING
  `);
}

/** INSERT dans geo_unresolved. */
async function insertUnresolved(
  db: Database,
  params: {
    nodeId: string;
    nodeType: string;
    citySlug: string;
    extraitBrut: string | null;
    patternType: "zone_code" | "no_lot";
    scoreConfiance: number | null;
    raison: "no_polygon" | "score_too_low" | "ambiguous" | "no_extract";
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO geo_unresolved
      (node_id, node_type, city_slug, extrait_brut, pattern_type, score_confiance, raison)
    VALUES
      (${params.nodeId}, ${params.nodeType}, ${params.citySlug},
       ${params.extraitBrut ?? null}, ${params.patternType},
       ${params.scoreConfiance ?? null}, ${params.raison})
  `);
}

// ─── Matching zone ─────────────────────────────────────────────────────────────

/**
 * Cherche une zone_version dont code_norm matche le code extrait ET city_slug matche.
 * Retourne le canonical_id de la première zone trouvée, ou null.
 *
 * Note : on cherche les versions actuellement valides (knownTo IS NULL).
 *
 * @deprecated Utiliser l'adaptateur GeoMatchDb via makeGeoMatchDb() + matchZoneMultiLevel().
 */
async function findZoneByCodeNorm(
  db: Database,
  codeNorm: string,
  citySlug: string,
): Promise<string | null> {
  const rows = await db
    .select({ canonicalId: zoneVersions.canonicalId })
    .from(zoneVersions)
    .where(
      and(
        eq(zoneVersions.codeNorm, codeNorm),
        eq(zoneVersions.citySlug, citySlug),
        isNull(zoneVersions.knownTo),
      ),
    )
    .limit(1);

  return rows[0]?.canonicalId ?? null;
}

// ─── Matching lot ──────────────────────────────────────────────────────────────

/**
 * Cherche une lot_version dont no_lot_norm matche le no_lot extrait.
 * Pas de filtre city_slug (cadastre province-entière).
 * Retourne le canonical_id du premier lot trouvé, ou null.
 */
async function findLotByNoLotNorm(
  db: Database,
  noLotNorm: string,
): Promise<string | null> {
  const rows = await db
    .select({ canonicalId: lotVersions.canonicalId })
    .from(lotVersions)
    .where(
      and(
        eq(lotVersions.noLotNorm, noLotNorm),
        isNull(lotVersions.knownTo),
      ),
    )
    .limit(1);

  return rows[0]?.canonicalId ?? null;
}

// ─── Adaptateur GeoMatchDb (Drizzle) ─────────────────────────────────────────

/**
 * Crée un GeoMatchDb branché sur une instance Drizzle.
 * Toutes les requêtes ciblent les versions actives (knownTo IS NULL).
 */
function makeGeoMatchDb(db: Database): GeoMatchDb {
  return {
    async findZoneExact(codeNorm, citySlug) {
      return findZoneByCodeNorm(db, codeNorm, citySlug);
    },

    async findZoneByVariants(codeVariants, citySlug) {
      if (codeVariants.length === 0) return null;
      const rows = await db
        .select({ canonicalId: zoneVersions.canonicalId })
        .from(zoneVersions)
        .where(
          and(
            inArray(zoneVersions.codeNorm, codeVariants),
            eq(zoneVersions.citySlug, citySlug),
            isNull(zoneVersions.knownTo),
          ),
        )
        .limit(1);
      return rows[0]?.canonicalId ?? null;
    },

    async listZoneCodesForCity(citySlug) {
      // limit(2000) = cap raisonnable pour le nombre de zones d'une ville.
      // Permet au mock de test de fonctionner via la queue habituelle.
      const rows = await db
        .select({
          canonicalId: zoneVersions.canonicalId,
          codeNorm: zoneVersions.codeNorm,
        })
        .from(zoneVersions)
        .where(
          and(
            eq(zoneVersions.citySlug, citySlug),
            isNull(zoneVersions.knownTo),
          ),
        )
        .limit(2000);
      return (rows as Array<{ canonicalId: string; codeNorm: string | null }>)
        .filter((r): r is { canonicalId: string; codeNorm: string } =>
          typeof r.codeNorm === "string" && r.codeNorm.length > 0,
        );
    },

    async findZoneAllCities(codeNorm) {
      // limit(50) = cap pour la désambiguïsation — si > 50 villes ont ce code → ambiguïté de toute façon.
      const rows = await db
        .select({
          canonicalId: zoneVersions.canonicalId,
          codeNorm: zoneVersions.codeNorm,
          citySlug: zoneVersions.citySlug,
        })
        .from(zoneVersions)
        .where(
          and(
            eq(zoneVersions.codeNorm, codeNorm),
            isNull(zoneVersions.knownTo),
          ),
        )
        .limit(50);
      return (rows as Array<{ canonicalId: string; codeNorm: string | null; citySlug: string }>).filter(
        (r): r is { canonicalId: string; codeNorm: string; citySlug: string } =>
          typeof r.codeNorm === "string",
      );
    },

    async findLotExact(noLotNorm) {
      return findLotByNoLotNorm(db, noLotNorm);
    },
  };
}

// ─── Résolution principale ────────────────────────────────────────────────────

/**
 * Résout les références géo d'un noeud Signal ou DesignationEvent.
 *
 * Idempotent : peut être appelé plusieurs fois sur le même noeud sans créer
 * de doublons (ON CONFLICT DO NOTHING sur la clé naturelle).
 *
 * @param db     - Handle Drizzle Database.
 * @param input  - Données du noeud à résoudre.
 * @returns Statistiques de résolution (résolus / non-résolus).
 */
export async function resolveGeoRefs(
  db: Database,
  input: GeoResolveInput,
): Promise<GeoResolveResult> {
  const result: GeoResolveResult = {
    nodeId: input.nodeId,
    resolvedZones: 0,
    resolvedLots: 0,
    unresolvedZones: 0,
    unresolvedLots: 0,
  };

  // 1. Extraction multi-source (label + description + zone_ref/no_lot structurés
  //    + citation/excerpts). Les champs structurés sont la référence la plus fiable.
  const { zoneCodes, lotRefs } = extractRefsFromFields({
    label: input.label,
    description: input.description,
    zoneRef: input.zoneRef,
    noLot: input.noLot,
    citation: input.citation,
    excerpts: input.excerpts,
  });

  // Adaptateur DB pour le matching multi-niveau
  const geoDb = makeGeoMatchDb(db);

  // 2. Résolution des codes de zone (matching multi-niveau N1→N4)
  if (zoneCodes.length === 0) {
    // Aucun code extrait — enregistre un non-résolu de type "no_extract"
    await insertUnresolved(db, {
      nodeId: input.nodeId,
      nodeType: input.nodeType,
      citySlug: input.citySlug,
      extraitBrut: null,
      patternType: "zone_code",
      scoreConfiance: null,
      raison: "no_extract",
    });
    result.unresolvedZones++;
  } else {
    for (const zoneCode of zoneCodes) {
      // Score insuffisant -> non-résolu sans appel DB
      if (zoneCode.score < RESOLUTION_THRESHOLD) {
        await insertUnresolved(db, {
          nodeId: input.nodeId,
          nodeType: input.nodeType,
          citySlug: input.citySlug,
          extraitBrut: zoneCode.rawText,
          patternType: "zone_code",
          scoreConfiance: zoneCode.score,
          raison: "score_too_low",
        });
        result.unresolvedZones++;
        continue;
      }

      // Matching multi-niveau N1 (exact) → N2 (variantes) → N3 (edit dist) → N4 (city fallback)
      const codeNorm = normalizeZoneCode(zoneCode.codeNorm);
      const matchResult = await matchZoneMultiLevel(
        geoDb,
        codeNorm,
        zoneCode.rawText,
        input.citySlug,
        zoneCode.score,
      );

      if (isMatchResult(matchResult)) {
        await insertResolution(db, {
          nodeId: input.nodeId,
          nodeType: input.nodeType,
          citySlug: input.citySlug,
          relationType: "concerns_zone",
          targetId: matchResult.canonicalId,
          targetType: "Zone",
          extraitBrut: matchResult.extraitBrut,
          scoreConfiance: matchResult.scoreConfiance,
          provenance: matchResult.provenance,
          asOfDate: input.asOfDate,
        });
        result.resolvedZones++;
      } else {
        await insertUnresolved(db, {
          nodeId: input.nodeId,
          nodeType: input.nodeType,
          citySlug: input.citySlug,
          extraitBrut: matchResult.extraitBrut,
          patternType: "zone_code",
          scoreConfiance: matchResult.scoreConfiance,
          raison: matchResult.raison,
        });
        result.unresolvedZones++;
      }
    }
  }

  // 3. Résolution des numéros de lot (exact no_lot_norm — cadastre province-entière)
  if (lotRefs.length === 0) {
    // Aucun lot extrait — pas de no_extract pour les lots car c'est rare
    // (on n'enregistre un non-résolu lot que si on a tenté d'extraire)
  } else {
    for (const lotRef of lotRefs) {
      if (lotRef.score < RESOLUTION_THRESHOLD) {
        await insertUnresolved(db, {
          nodeId: input.nodeId,
          nodeType: input.nodeType,
          citySlug: input.citySlug,
          extraitBrut: lotRef.rawText,
          patternType: "no_lot",
          scoreConfiance: lotRef.score,
          raison: "score_too_low",
        });
        result.unresolvedLots++;
        continue;
      }

      const noLotNorm = normalizeLotRef(lotRef.noLotNorm);
      const canonicalId = await geoDb.findLotExact(noLotNorm);

      if (!canonicalId) {
        await insertUnresolved(db, {
          nodeId: input.nodeId,
          nodeType: input.nodeType,
          citySlug: input.citySlug,
          extraitBrut: lotRef.rawText,
          patternType: "no_lot",
          scoreConfiance: lotRef.score,
          raison: "no_polygon",
        });
        result.unresolvedLots++;
      } else {
        await insertResolution(db, {
          nodeId: input.nodeId,
          nodeType: input.nodeType,
          citySlug: input.citySlug,
          relationType: "concerns_lot",
          targetId: canonicalId,
          targetType: "Lot",
          extraitBrut: lotRef.rawText,
          scoreConfiance: lotRef.score,
          provenance: lotRef.patternId,
          asOfDate: input.asOfDate,
        });
        result.resolvedLots++;
      }
    }
  }

  return result;
}

/**
 * Résout les références géo d'un lot de noeuds en série.
 * Retourne les statistiques agrégées.
 *
 * @param db     - Handle Drizzle Database.
 * @param inputs - Liste des noeuds à résoudre.
 */
export async function resolveGeoRefsBatch(
  db: Database,
  inputs: GeoResolveInput[],
): Promise<{
  total: number;
  resolvedZones: number;
  resolvedLots: number;
  unresolvedZones: number;
  unresolvedLots: number;
}> {
  let resolvedZones = 0;
  let resolvedLots = 0;
  let unresolvedZones = 0;
  let unresolvedLots = 0;

  for (const input of inputs) {
    const r = await resolveGeoRefs(db, input);
    resolvedZones += r.resolvedZones;
    resolvedLots += r.resolvedLots;
    unresolvedZones += r.unresolvedZones;
    unresolvedLots += r.unresolvedLots;
  }

  return { total: inputs.length, resolvedZones, resolvedLots, unresolvedZones, unresolvedLots };
}
