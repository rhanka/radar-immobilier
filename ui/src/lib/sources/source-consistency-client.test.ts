/**
 * Tests d'HONNÊTETÉ (WP3 LOT1) — client cohérence E2E.
 *
 * Verrouille : ville absente du snapshot -> `Non mesuré` (jamais un faux
 * 0/100 %) ; formatage num/dénom neutre ; fraction fiable null si aucun match.
 */
import { describe, expect, it } from "vitest";
import {
  getCityConsistency,
  unmeasuredCityConsistency,
  formatEdgeCount,
  formatReliablePct,
  formatConsistencyFreshness,
  CONSISTENCY_STATE_LABEL,
  type CityConsistency,
  type ConsistencyResponse,
  type SignalZoneEdge,
} from "./source-consistency-client.js";

function makeConsistency(overrides: Partial<CityConsistency> = {}): CityConsistency {
  return {
    citySlug: "mont-tremblant",
    mode: "batch-pg",
    generatedAt: "2026-07-05T12:00:00.000Z",
    state: "coherent",
    edges: {
      pvSignal: { num: 20, denom: 20, rate: 1, status: "measured" },
      signalZone: {
        num: 9,
        denom: 10,
        rate: 0.9,
        status: "measured",
        reliableNum: 6,
        reliableRate: 0.6667,
        applicability: { num: 8, denom: 20, rate: 0.4, status: "measured" },
      },
    },
    blockers: [],
    ...overrides,
  };
}

describe("getCityConsistency", () => {
  it("ville présente dans le snapshot -> renvoie sa cohérence réelle", () => {
    const consistency = makeConsistency();
    const response: ConsistencyResponse = {
      generatedAt: consistency.generatedAt,
      cities: [{ citySlug: consistency.citySlug, consistency }],
    };
    expect(getCityConsistency("mont-tremblant", response)).toEqual(consistency);
  });

  it("ville ABSENTE du snapshot -> Non mesuré honnête, jamais un faux 0/100 %", () => {
    const response: ConsistencyResponse = { generatedAt: null, cities: [] };
    const result = getCityConsistency("ville-hors-focus30", response);
    expect(result.state).toBe("unmeasured");
    expect(result.mode).toBe("unmeasured");
    expect(result.edges.pvSignal.rate).toBeNull();
    expect(result.edges.signalZone.rate).toBeNull();
  });

  it("réponse null (fetch pas encore résolu) -> Non mesuré, pas une exception", () => {
    const result = getCityConsistency("mont-tremblant", null);
    expect(result).toEqual(unmeasuredCityConsistency("mont-tremblant"));
  });
});

describe("formatEdgeCount", () => {
  it("mesuré -> « num/denom »", () => {
    expect(formatEdgeCount({ num: 9, denom: 10, rate: 0.9, status: "measured" })).toBe("9/10");
  });

  it("non_applicable -> copy neutre, PAS de fraction fabriquée", () => {
    expect(formatEdgeCount({ num: 0, denom: 0, rate: null, status: "non_applicable" })).toBe(
      "non applicable",
    );
  });

  it("non_mesure -> copy neutre distincte de non_applicable", () => {
    expect(formatEdgeCount({ num: 0, denom: 0, rate: null, status: "non_mesure" })).toBe(
      "non mesuré",
    );
  });
});

describe("formatReliablePct", () => {
  it("calcule un pourcentage arrondi quand reliableRate est défini", () => {
    const edge: SignalZoneEdge = makeConsistency().edges.signalZone;
    expect(formatReliablePct(edge)).toBe("67 %");
  });

  it("aucun match -> null (jamais un 0 % fabriqué)", () => {
    const edge: SignalZoneEdge = {
      num: 0,
      denom: 10,
      rate: 0,
      status: "measured",
      reliableNum: 0,
      reliableRate: null,
      applicability: { num: 0, denom: 20, rate: 0, status: "measured" },
    };
    expect(formatReliablePct(edge)).toBeNull();
  });
});

describe("formatConsistencyFreshness", () => {
  it("mode batch-pg -> « batch PG · <date> »", () => {
    const text = formatConsistencyFreshness(makeConsistency());
    expect(text).toContain("batch PG");
  });

  it("mode unmeasured -> repli honnête, pas de date fabriquée", () => {
    const text = formatConsistencyFreshness(unmeasuredCityConsistency("ville-x"));
    expect(text).toBe("aucun snapshot pour cette ville");
  });
});

describe("CONSISTENCY_STATE_LABEL", () => {
  it("jamais « Non couvert » — réservé à la couverture", () => {
    expect(Object.values(CONSISTENCY_STATE_LABEL)).not.toContain("Non couvert");
    expect(CONSISTENCY_STATE_LABEL.unmeasured).toBe("Non mesuré");
  });
});
