import { describe, expect, it } from "vitest";
import { sourceConsistencyRoute } from "./source-consistency.js";
import type { Database } from "../db/client.js";
import { deriveCityConsistency, type CityConsistencyRawInput } from "../services/consistency/consistency-calc.js";

function rawInput(patch: Partial<CityConsistencyRawInput> = {}): CityConsistencyRawInput {
  return {
    citySlug: "mont-tremblant",
    publishedSignals: 10,
    groundedSignals: 10,
    zoneChainMapped: true,
    matchedZoneDesignations: 9,
    reliableMatchedZoneDesignations: 9,
    zoneDesignations: 10,
    zoneDesignatingSignals: 8,
    ...patch,
  };
}

/** Mock DB minimal : `db.select().from(table)` résout une liste de payloads. */
function makeDb(payloadRows: Array<{ payload: unknown }>): Database {
  const chain = {
    from: () => Promise.resolve(payloadRows),
  };
  return { select: () => chain } as unknown as Database;
}

describe("GET /api/source/consistency", () => {
  it("sans DB -> réponse vide honnête (jamais une erreur 5xx)", async () => {
    const app = sourceConsistencyRoute({});
    const res = await app.request("/api/source/consistency");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ generatedAt: null, cities: [] });
  });

  it("expose les snapshots présents avec le generatedAt le plus récent", async () => {
    const older = deriveCityConsistency(rawInput(), "2026-07-01T00:00:00.000Z");
    const newer = deriveCityConsistency(
      rawInput({ citySlug: "rimouski" }),
      "2026-07-05T00:00:00.000Z",
    );
    const app = sourceConsistencyRoute({
      db: makeDb([{ payload: older }, { payload: newer }]),
    });
    const res = await app.request("/api/source/consistency");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generatedAt: string | null;
      cities: Array<{ citySlug: string }>;
    };
    expect(body.generatedAt).toBe("2026-07-05T00:00:00.000Z");
    expect(body.cities.map((c) => c.citySlug).sort()).toEqual(["mont-tremblant", "rimouski"]);
  });

  it("aucun snapshot -> liste vide, generatedAt null (pas un faux 100 %)", async () => {
    const app = sourceConsistencyRoute({ db: makeDb([]) });
    const res = await app.request("/api/source/consistency");
    const body = await res.json();
    expect(body).toEqual({ generatedAt: null, cities: [] });
  });
});
