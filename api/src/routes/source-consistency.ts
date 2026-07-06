import { Hono } from "hono";
import type { Database } from "../db/client.js";
import { readAllConsistencySnapshots } from "../services/consistency/consistency-snapshot-store.js";
import type { CityConsistency } from "../services/consistency/consistency-calc.js";

/**
 * GET /api/source/consistency — cohérence E2E par ville (WP3 LOT1), lecture
 * BATCH du snapshot matérialisé par `run-consistency-snapshot.ts`.
 *
 * SÉPARÉ de `/api/source/coverage` (D-lane séparée : une ville peut être
 * « Servi » en couverture ET « À qualifier »/« Non mesuré » en cohérence —
 * ne modifie pas `worstStatus`). Ne renvoie QUE les villes ayant un snapshot ;
 * une ville absente de la réponse est honnêtement « Non mesuré » côté client
 * (cf. `unmeasuredCityConsistency` dans `source-consistency-client.ts`) — cet
 * endpoint ne fabrique jamais d'entrée pour les ~1104 villes non ciblées.
 *
 * Batch PG daté : une seule lecture de la table snapshot (bornée au périmètre
 * du dernier run — focus-30 par défaut), JAMAIS de recalcul live.
 */
export interface SourceConsistencyDeps {
  db?: Database;
}

export interface ConsistencyResponse {
  /** Horodatage du snapshot le plus récent parmi les villes retournées (null si aucun). */
  generatedAt: string | null;
  cities: Array<{ citySlug: string; consistency: CityConsistency }>;
}

export function sourceConsistencyRoute(deps: SourceConsistencyDeps): Hono {
  const app = new Hono();

  app.get("/api/source/consistency", async (c) => {
    if (!deps.db) {
      const body: ConsistencyResponse = { generatedAt: null, cities: [] };
      return c.json(body);
    }

    const consistencies = await readAllConsistencySnapshots(deps.db);
    let generatedAt: string | null = null;
    for (const item of consistencies) {
      if (item.generatedAt && (!generatedAt || item.generatedAt > generatedAt)) {
        generatedAt = item.generatedAt;
      }
    }

    const body: ConsistencyResponse = {
      generatedAt,
      cities: consistencies.map((consistency) => ({
        citySlug: consistency.citySlug,
        consistency,
      })),
    };
    return c.json(body);
  });

  return app;
}
