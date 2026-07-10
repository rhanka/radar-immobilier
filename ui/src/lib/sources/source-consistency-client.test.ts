/**
 * Tests d'HONNÊTETÉ (WP3 LOT1+LOT2) — client cohérence E2E.
 *
 * Verrouille : ville absente du snapshot -> `Non mesuré` (jamais un faux
 * 0/100 %) ; formatage num/dénom neutre ; fraction fiable null si aucun match ;
 * arête zoneGrid (E2) — libellés honnêtes + normalisation d'un payload legacy
 * sans `zoneGrid` (snapshot écrit avant LOT2).
 */
import { describe, expect, it } from "vitest";
import {
  getCityConsistency,
  unmeasuredCityConsistency,
  formatEdgeCount,
  formatReliablePct,
  formatConsistencyFreshness,
  formatZoneGridState,
  CONSISTENCY_STATE_LABEL,
  UNMEASURED_ZONE_GRID,
  type CityConsistency,
  type ConsistencyResponse,
  type SignalZoneEdge,
  type ZoneGridEdge,
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
      zoneGrid: {
        num: 95,
        denom: 104,
        rate: 0.9135,
        status: "measured",
        state: "ok",
        staleZoningSource: false,
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

  it("payload SANS zoneGrid (snapshot écrit avant LOT2) -> normalisé en non_mesure, pas de crash", () => {
    // Simule un payload API/legacy antérieur à l'arête E2 (edges.zoneGrid absent).
    const legacyConsistency = {
      citySlug: "rimouski",
      mode: "batch-pg",
      generatedAt: "2026-06-01T00:00:00.000Z",
      state: "coherent",
      edges: {
        pvSignal: { num: 10, denom: 10, rate: 1, status: "measured" },
        signalZone: {
          num: 5,
          denom: 5,
          rate: 1,
          status: "measured",
          reliableNum: 5,
          reliableRate: 1,
          applicability: { num: 5, denom: 10, rate: 0.5, status: "measured" },
        },
        // zoneGrid volontairement absent.
      },
      blockers: [],
    } as unknown as CityConsistency;
    const response: ConsistencyResponse = {
      generatedAt: legacyConsistency.generatedAt,
      cities: [{ citySlug: "rimouski", consistency: legacyConsistency }],
    };
    const result = getCityConsistency("rimouski", response);
    expect(result.edges.zoneGrid).toEqual(UNMEASURED_ZONE_GRID);
    // E0/E1 restent inchangés — la normalisation ne touche QUE zoneGrid.
    expect(result.edges.pvSignal).toEqual(legacyConsistency.edges.pvSignal);
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

// ─────────────────────────────────────────────────────────────────────────────
// WP3 LOT2 — E2 zone↔grille : libellés honnêtes. `millesime-disjoint` se
// raffine en « Ancien zonage servi » uniquement quand la cause est confirmée
// (staleZoningSource), sinon reste un constat neutre « Millésime disjoint ».
// ─────────────────────────────────────────────────────────────────────────────
describe("formatZoneGridState", () => {
  function zoneGridEdge(overrides: Partial<ZoneGridEdge> = {}): ZoneGridEdge {
    return {
      num: 0,
      denom: 0,
      rate: null,
      status: "non_mesure",
      state: "non_mesure",
      staleZoningSource: false,
      ...overrides,
    };
  }

  it("ok -> « OK »", () => {
    expect(formatZoneGridState(zoneGridEdge({ state: "ok", status: "measured" }))).toBe("OK");
  });

  it("partiel -> « À qualifier » (copy partagée avec le tri-état global)", () => {
    expect(formatZoneGridState(zoneGridEdge({ state: "partiel", status: "measured" }))).toBe(
      "À qualifier",
    );
  });

  it("absente (grille 404) -> « Grille absente »", () => {
    expect(formatZoneGridState(zoneGridEdge({ state: "absente", status: "measured" }))).toBe(
      "Grille absente",
    );
  });

  it("zonage-absent -> « Zonage absent »", () => {
    expect(
      formatZoneGridState(zoneGridEdge({ state: "zonage-absent", status: "non_applicable" })),
    ).toBe("Zonage absent");
  });

  it("non_mesure -> « Non mesuré »", () => {
    expect(formatZoneGridState(zoneGridEdge())).toBe("Non mesuré");
  });

  it("millesime-disjoint SANS source confirmée -> « Millésime disjoint » (constat neutre)", () => {
    const edge = zoneGridEdge({
      state: "millesime-disjoint",
      status: "measured",
      staleZoningSource: false,
    });
    expect(formatZoneGridState(edge)).toBe("Millésime disjoint");
  });

  it("millesime-disjoint AVEC source ArcGIS 'Ancien_zonage' confirmée -> « Ancien zonage servi »", () => {
    const edge = zoneGridEdge({
      state: "millesime-disjoint",
      status: "measured",
      staleZoningSource: true,
    });
    expect(formatZoneGridState(edge)).toBe("Ancien zonage servi");
  });

  it("jamais « Non couvert » — copy réservée à la couverture", () => {
    const allLabels = [
      formatZoneGridState(zoneGridEdge({ state: "ok" })),
      formatZoneGridState(zoneGridEdge({ state: "partiel" })),
      formatZoneGridState(zoneGridEdge({ state: "absente" })),
      formatZoneGridState(zoneGridEdge({ state: "zonage-absent" })),
      formatZoneGridState(zoneGridEdge({ state: "non_mesure" })),
      formatZoneGridState(zoneGridEdge({ state: "millesime-disjoint" })),
      formatZoneGridState(zoneGridEdge({ state: "millesime-disjoint", staleZoningSource: true })),
    ];
    expect(allLabels).not.toContain("Non couvert");
  });
});
