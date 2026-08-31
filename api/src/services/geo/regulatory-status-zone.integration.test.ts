/**
 * INTÉGRATION pg (LOT 1 serving, A.5c / D5 REVERSE) — prouve l'agrégat zone
 * bout-en-bout à travers Postgres : `upsertGraphAtomic` → `buildNodeRow` PERSISTE
 * `regulatoryStatus` (A.2) → `buildZoneResolutionMap` LIT + AGRÈGE (A.3c).
 *
 * Invariant REVERSE (i-arch) : une zone touchée par un règlement ADOPTÉ dont un
 * nœud n'a PAS de stade direct (→ anticipation isolé) s'affiche quand même FIRM
 * (hérité du nœud-adoption frère via `aggregateRegulatoryStatus`, PAS le nœud isolé).
 * C'est le bug qui marche dans les 2 sens : on exerce le nœud sans-stade.
 *
 * DB-gaté (`skipIf`) comme graphify-34 : ne tourne qu'avec un Postgres de test
 * (`make test-api` / NODE_ENV=test / GRAPH_DB_TESTS=1).
 */
import { describe, expect, it } from "vitest";
import { upsertGraphAtomic } from "../graph/graph-store.js";
import { buildZoneResolutionMap } from "./geo-features.js";

const DB_AVAILABLE = process.env.NODE_ENV === "test" || process.env.GRAPH_DB_TESTS === "1";

describe.skipIf(!DB_AVAILABLE)("A.5c — agrégat zone regulatoryStatus (reverse-invariant, pg)", () => {
  async function getDb() {
    const { createDb } = await import("../../db/client.js");
    const { loadConfig } = await import("../../config.js");
    return createDb(loadConfig({
      POSTGRES_HOST: process.env.POSTGRES_HOST ?? "postgres",
      POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
      POSTGRES_USER: process.env.POSTGRES_USER ?? "radar",
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "changeme-dev-only",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "radar",
    })).db;
  }

  const CITY = "__test_regstatus_reverse__";
  const ZONE = "zone::__test_regstatus_reverse__::H-1";

  async function seedResolutions(
    db: Awaited<ReturnType<typeof getDb>>,
    nodeIds: string[],
  ): Promise<void> {
    const { geoResolutions } = await import("../../db/schema.js");
    await db.insert(geoResolutions).values(
      nodeIds.map((nodeId) => ({
        nodeId,
        nodeType: "DesignationEvent",
        citySlug: CITY,
        relationType: "concerns_zone",
        targetId: ZONE,
        targetType: "Zone",
        scoreConfiance: "1",
        provenance: "zone_explicit",
      })),
    );
  }

  async function clean(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
    const { graphNodes, graphEdges, geoResolutions } = await import("../../db/schema.js");
    const { eq, inArray, or } = await import("drizzle-orm");
    await db.delete(geoResolutions).where(eq(geoResolutions.citySlug, CITY));
    const ids = (await db.select({ id: graphNodes.id }).from(graphNodes).where(eq(graphNodes.citySlug, CITY)))
      .map((row) => row.id);
    if (ids.length > 0) {
      await db.delete(graphEdges).where(or(inArray(graphEdges.srcId, ids), inArray(graphEdges.dstId, ids)));
    }
    await db.delete(graphNodes).where(eq(graphNodes.citySlug, CITY));
  }

  it("REVERSE : nœud sans-stade (anticipation isolé) + nœud-adoption firm → zone FIRM", async () => {
    const db = await getDb();
    await clean(db);
    try {
      // node1 = SANS stade (bare) → buildNodeRow ne persiste PAS regulatoryStatus
      //         → lecture = anticipation fail-safe (le nœud isolé).
      // node2 = adoption → buildNodeRow persiste regulatoryStatus="firm" (A.2).
      const bare = `${CITY}:evt:bare`;
      const adoption = `${CITY}:evt:adoption`;
      const seeded = await upsertGraphAtomic(db, CITY, {
        nodes: [
          { id: bare, type: "DesignationEvent", label: "Règlement (nœud sans stade)", properties: { reglement_number: "R-1" } },
          { id: adoption, type: "DesignationEvent", label: "Adoption du règlement", properties: { etape: "adoption", reglement_number: "R-1" } },
        ],
      });
      expect(seeded.aborted).toBe(false);
      await seedResolutions(db, [bare, adoption]);

      const zoneMap = await buildZoneResolutionMap(db, CITY);
      const zone = zoneMap.get(ZONE);
      expect(zone).toBeDefined();
      expect(zone!.signalCount).toBe(2);
      // L'AGRÉGAT est firm (hérité de l'adoption) — PAS anticipation du nœud isolé.
      expect(zone!.regulatoryStatus).toBe("firm");
    } finally {
      await clean(db);
    }
  });

  it("avis-only : tous nœuds au stade avis/projet → zone ANTICIPATION (jamais firm)", async () => {
    const db = await getDb();
    await clean(db);
    try {
      const avis = `${CITY}:evt:avis`;
      const projet = `${CITY}:evt:projet`;
      const seeded = await upsertGraphAtomic(db, CITY, {
        nodes: [
          { id: avis, type: "DesignationEvent", label: "Avis de motion", properties: { etape: "avis_motion", reglement_number: "R-2" } },
          { id: projet, type: "DesignationEvent", label: "Projet de règlement", properties: { etape: "projet_reglement", reglement_number: "R-2" } },
        ],
      });
      expect(seeded.aborted).toBe(false);
      await seedResolutions(db, [avis, projet]);

      const zone = (await buildZoneResolutionMap(db, CITY)).get(ZONE);
      expect(zone).toBeDefined();
      expect(zone!.regulatoryStatus).toBe("anticipation");
    } finally {
      await clean(db);
    }
  });
});
