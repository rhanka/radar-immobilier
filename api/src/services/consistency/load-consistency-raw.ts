/**
 * WP3 LOT1 — Chargement PG des comptes bruts E0/E1 (batch, jamais 1104
 * requêtes live). Quatre agrégats GROUP BY city_slug, sans filtre ville en
 * SQL (même convention que `run-geo-mapper.ts` : on lit tout, puis on
 * restreint aux villes ciblées en TS) — les tables source (graph_nodes,
 * geo_resolutions, geo_unresolved) restent bornées à l'échelle du batch.
 *
 * E0 : reprend EXACTEMENT la définition `signals.withCitation` de
 * `source-coverage.ts` (même fragment SQL de détection de citation/extrait).
 *
 * E1 : lit la sortie du mapper #74 (`geo_resolutions` relation
 * `concerns_zone` ∪ `geo_unresolved` pattern `zone_code`) — AUCUNE
 * ré-extraction ici, uniquement des agrégats sur ce qui a déjà été résolu.
 *   - dénominateur (`zoneDesignations`) = désignations résolues + non-résolues
 *     « comptables » (raison `no_polygon`/`ambiguous` — un vrai code de zone a
 *     été extrait, la résolution a juste échoué). Exclut `no_extract`/
 *     `score_too_low` (rien d'extractible ou sous le seuil de publication —
 *     ce ne sont pas des désignations-zone).
 *   - numérateur (`matchedZoneDesignations`) = désignations résolues dont la
 *     cible joint une `zone_versions` COURANTE (`known_to IS NULL`) avec
 *     géométrie non nulle, DE LA MÊME VILLE (exclut les résolutions
 *     `city_fallback` cross-ville du calcul de "servi").
 *   - `zoneChainMapped` = le mapper a-t-il seulement TRAITÉ cette ville
 *     (≥ 1 ligne, résolue ou non, y compris `no_extract`) ? Sert à distinguer
 *     `non_mesure` (mapper jamais lancé sur cette ville) de `non_applicable`
 *     (mapper lancé, aucune désignation-zone trouvée).
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes, geoResolutions, geoUnresolved, zoneVersions } from "../../db/schema.js";
import { RELIABLE_ZONE_MATCH_THRESHOLD, type CityConsistencyRawInput } from "./consistency-calc.js";

interface SignalAgg {
  published: number;
  grounded: number;
}

interface ZoneResolvedAgg {
  totalResolved: number;
  matchedServed: number;
  reliableMatched: number;
}

interface ZoneUnresolvedAgg {
  countable: number;
  excluded: number;
}

/** E0 — signaux publiés + part groundée (même définition que `signals.withCitation`). */
async function loadSignalAggregates(db: Database): Promise<Map<string, SignalAgg>> {
  const rows = await db
    .select({
      citySlug: graphNodes.citySlug,
      published: sql<number>`count(*)::int`,
      grounded: sql<number>`(count(*) filter (where
        coalesce(
          ${graphNodes.props} ->> 'citation',
          ${graphNodes.props} -> 'properties' ->> 'citation',
          ${graphNodes.props} ->> 'excerpt',
          ${graphNodes.props} -> 'properties' ->> 'excerpt'
        ) is not null
        or (
          jsonb_typeof(${graphNodes.props} -> 'refs') = 'array'
          and exists (
            select 1
            from jsonb_array_elements(${graphNodes.props} -> 'refs') as ref
            where jsonb_typeof(ref.value) = 'object'
              and coalesce(ref.value ->> 'citation', ref.value ->> 'excerpt')
                is not null
          )
        )
      ))::int`,
    })
    .from(graphNodes)
    .where(
      and(
        inArray(graphNodes.type, ["Signal", "DesignationEvent"]),
        isNotNull(graphNodes.citySlug),
      ),
    )
    .groupBy(graphNodes.citySlug);

  const map = new Map<string, SignalAgg>();
  for (const row of rows) {
    if (!row.citySlug) continue;
    map.set(row.citySlug, {
      published: Number(row.published ?? 0),
      grounded: Number(row.grounded ?? 0),
    });
  }
  return map;
}

/** E1 (numérateur) — geo_resolutions concerns_zone, jointe aux zones SERVIES/courantes. */
async function loadZoneResolvedAggregates(db: Database): Promise<Map<string, ZoneResolvedAgg>> {
  const rows = await db
    .select({
      citySlug: geoResolutions.citySlug,
      totalResolved: sql<number>`count(*)::int`,
      matchedServed: sql<number>`(count(*) filter (where ${zoneVersions.id} is not null))::int`,
      reliableMatched: sql<number>`(count(*) filter (where ${zoneVersions.id} is not null and ${geoResolutions.scoreConfiance} >= ${RELIABLE_ZONE_MATCH_THRESHOLD}))::int`,
    })
    .from(geoResolutions)
    .leftJoin(
      zoneVersions,
      and(
        eq(zoneVersions.canonicalId, geoResolutions.targetId),
        eq(zoneVersions.citySlug, geoResolutions.citySlug),
        isNull(zoneVersions.knownTo),
        isNotNull(zoneVersions.geom),
      ),
    )
    .where(eq(geoResolutions.relationType, "concerns_zone"))
    .groupBy(geoResolutions.citySlug);

  const map = new Map<string, ZoneResolvedAgg>();
  for (const row of rows) {
    map.set(row.citySlug, {
      totalResolved: Number(row.totalResolved ?? 0),
      matchedServed: Number(row.matchedServed ?? 0),
      reliableMatched: Number(row.reliableMatched ?? 0),
    });
  }
  return map;
}

/** E1 (dénominateur, part non résolue) — geo_unresolved pattern zone_code, par raison. */
async function loadZoneUnresolvedAggregates(db: Database): Promise<Map<string, ZoneUnresolvedAgg>> {
  const rows = await db
    .select({
      citySlug: geoUnresolved.citySlug,
      countable: sql<number>`(count(*) filter (where ${geoUnresolved.raison} in ('no_polygon', 'ambiguous')))::int`,
      excluded: sql<number>`(count(*) filter (where ${geoUnresolved.raison} in ('no_extract', 'score_too_low')))::int`,
    })
    .from(geoUnresolved)
    .where(eq(geoUnresolved.patternType, "zone_code"))
    .groupBy(geoUnresolved.citySlug);

  const map = new Map<string, ZoneUnresolvedAgg>();
  for (const row of rows) {
    map.set(row.citySlug, {
      countable: Number(row.countable ?? 0),
      excluded: Number(row.excluded ?? 0),
    });
  }
  return map;
}

/** Signaux DISTINCTS portant ≥ 1 désignation-zone comptable (résolue ou non_polygon/ambiguous). */
async function loadZoneDesignatingSignalCounts(db: Database): Promise<Map<string, number>> {
  const result = await db.execute<{ city_slug: string; count: number }>(sql`
    SELECT city_slug, count(distinct node_id)::int AS count
    FROM (
      SELECT city_slug, node_id FROM geo_resolutions WHERE relation_type = 'concerns_zone'
      UNION
      SELECT city_slug, node_id FROM geo_unresolved
        WHERE pattern_type = 'zone_code' AND raison IN ('no_polygon', 'ambiguous')
    ) atoms
    GROUP BY city_slug
  `);
  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(row.city_slug, Number(row.count ?? 0));
  }
  return map;
}

/**
 * Charge les comptes bruts E0+E1 pour les villes demandées. Batch PG — QUATRE
 * requêtes agrégées au total (pas une par ville), puis un merge en TS.
 */
export async function loadCityConsistencyRawInputs(
  db: Database,
  citySlugs: readonly string[],
): Promise<CityConsistencyRawInput[]> {
  const [signals, zoneResolved, zoneUnresolved, zoneDesignating] = await Promise.all([
    loadSignalAggregates(db),
    loadZoneResolvedAggregates(db),
    loadZoneUnresolvedAggregates(db),
    loadZoneDesignatingSignalCounts(db),
  ]);

  return citySlugs.map((citySlug) => {
    const signal = signals.get(citySlug) ?? { published: 0, grounded: 0 };
    const resolved =
      zoneResolved.get(citySlug) ?? { totalResolved: 0, matchedServed: 0, reliableMatched: 0 };
    const unresolved = zoneUnresolved.get(citySlug) ?? { countable: 0, excluded: 0 };
    const designating = zoneDesignating.get(citySlug) ?? 0;
    const zoneChainMapped =
      resolved.totalResolved + unresolved.countable + unresolved.excluded > 0;

    return {
      citySlug,
      publishedSignals: signal.published,
      groundedSignals: signal.grounded,
      zoneChainMapped,
      matchedZoneDesignations: resolved.matchedServed,
      reliableMatchedZoneDesignations: resolved.reliableMatched,
      zoneDesignations: resolved.totalResolved + unresolved.countable,
      zoneDesignatingSignals: designating,
    };
  });
}
