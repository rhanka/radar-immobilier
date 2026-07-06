import { describe, expect, it } from "vitest";
import {
  BLOCKER_LABEL,
  computeBlockers,
  computeConsistencyState,
  computeEdgeMetric,
  deriveCityConsistency,
  unmeasuredCityConsistency,
  type CityConsistencyRawInput,
} from "./consistency-calc.js";

const GENERATED_AT = "2026-07-06T00:00:00.000Z";

function baseInput(patch: Partial<CityConsistencyRawInput> = {}): CityConsistencyRawInput {
  return {
    citySlug: "mont-tremblant",
    publishedSignals: 10,
    groundedSignals: 10,
    zoneChainMapped: true,
    matchedZoneDesignations: 5,
    reliableMatchedZoneDesignations: 5,
    zoneDesignations: 5,
    zoneDesignatingSignals: 5,
    ...patch,
  };
}

describe("computeEdgeMetric", () => {
  it("calcule un rate quand le dénominateur est positif", () => {
    expect(computeEdgeMetric(7, 10)).toEqual({
      num: 7,
      denom: 10,
      rate: 0.7,
      status: "measured",
    });
  });

  it("dénominateur vide -> non_applicable, JAMAIS un rate=1 (100 %)", () => {
    const metric = computeEdgeMetric(0, 0);
    expect(metric.status).toBe("non_applicable");
    expect(metric.rate).toBeNull();
    // Anti-survente : même si num était non nul par erreur, denom<=0 gagne.
    expect(computeEdgeMetric(3, 0).rate).toBeNull();
  });

  it("dénominateur vide avec statut explicite non_mesure", () => {
    const metric = computeEdgeMetric(0, 0, "non_mesure");
    expect(metric.status).toBe("non_mesure");
    expect(metric.rate).toBeNull();
  });
});

describe("deriveCityConsistency — E0 pvSignal", () => {
  it("aucun signal publié -> pvSignal non_applicable, état global unmeasured", () => {
    const result = deriveCityConsistency(
      baseInput({ publishedSignals: 0, groundedSignals: 0, zoneChainMapped: false }),
      GENERATED_AT,
    );
    expect(result.edges.pvSignal.status).toBe("non_applicable");
    expect(result.edges.pvSignal.rate).toBeNull();
    expect(result.state).toBe("unmeasured");
    expect(result.blockers).toEqual([BLOCKER_LABEL.NO_PUBLISHED_SIGNAL]);
  });

  it("signaux publiés tous groundés -> pvSignal mesuré à 1.0", () => {
    const result = deriveCityConsistency(
      baseInput({ publishedSignals: 20, groundedSignals: 20 }),
      GENERATED_AT,
    );
    expect(result.edges.pvSignal).toMatchObject({ num: 20, denom: 20, rate: 1, status: "measured" });
  });

  it("grounding sous le seuil (0.95) -> bloqueur Signal sans citation", () => {
    const result = deriveCityConsistency(
      baseInput({ publishedSignals: 10, groundedSignals: 8 }), // 0.8 < 0.95
      GENERATED_AT,
    );
    expect(result.edges.pvSignal.rate).toBeCloseTo(0.8);
    expect(result.blockers).toContain(BLOCKER_LABEL.SIGNAL_NO_CITATION);
  });
});

describe("deriveCityConsistency — E1 signalZone", () => {
  it("mapper jamais tourné pour la ville -> non_mesure, PAS non_applicable", () => {
    const result = deriveCityConsistency(
      baseInput({
        zoneChainMapped: false,
        matchedZoneDesignations: 0,
        reliableMatchedZoneDesignations: 0,
        zoneDesignations: 0,
        zoneDesignatingSignals: 0,
      }),
      GENERATED_AT,
    );
    expect(result.edges.signalZone.status).toBe("non_mesure");
    expect(result.edges.signalZone.rate).toBeNull();
    expect(result.blockers).toContain(BLOCKER_LABEL.PG_NOT_PULLED);
    // E0 a une vraie mesure -> état "partial" (bloqué à l'arête zone), pas "unmeasured".
    expect(result.state).toBe("partial");
  });

  it("mapper tourné mais aucune désignation-zone -> non_applicable, PAS 100 %", () => {
    const result = deriveCityConsistency(
      baseInput({
        zoneChainMapped: true,
        matchedZoneDesignations: 0,
        reliableMatchedZoneDesignations: 0,
        zoneDesignations: 0,
        zoneDesignatingSignals: 0,
      }),
      GENERATED_AT,
    );
    expect(result.edges.signalZone.status).toBe("non_applicable");
    expect(result.edges.signalZone.rate).toBeNull();
    expect(result.blockers).toContain(BLOCKER_LABEL.NO_ZONE_DESIGNATION);
    // pvSignal coherent + signalZone non_applicable (hors périmètre, pas un échec) -> coherent.
    expect(result.state).toBe("coherent");
  });

  it("rappel mesuré sous le seuil (0.85) -> bloqueur Zone désignée non servie, état partial", () => {
    const result = deriveCityConsistency(
      baseInput({
        zoneChainMapped: true,
        zoneDesignations: 10,
        matchedZoneDesignations: 6, // 0.6 < 0.85
        reliableMatchedZoneDesignations: 6,
        zoneDesignatingSignals: 8,
      }),
      GENERATED_AT,
    );
    expect(result.edges.signalZone.rate).toBeCloseTo(0.6);
    expect(result.blockers).toContain(BLOCKER_LABEL.ZONE_NOT_SERVED);
    expect(result.state).toBe("partial");
  });

  it("rappel >= seuil + pvSignal >= seuil -> état coherent", () => {
    const result = deriveCityConsistency(
      baseInput({
        publishedSignals: 20,
        groundedSignals: 20,
        zoneChainMapped: true,
        zoneDesignations: 10,
        matchedZoneDesignations: 9, // 0.9 >= 0.85
        reliableMatchedZoneDesignations: 9,
        zoneDesignatingSignals: 8,
      }),
      GENERATED_AT,
    );
    expect(result.state).toBe("coherent");
    expect(result.blockers).toEqual([]);
  });

  it("fraction fiable = matches à score >= 0.9 / matches totaux", () => {
    const result = deriveCityConsistency(
      baseInput({
        zoneChainMapped: true,
        zoneDesignations: 10,
        matchedZoneDesignations: 8,
        reliableMatchedZoneDesignations: 3, // 3/8 = 0.375
        zoneDesignatingSignals: 8,
      }),
      GENERATED_AT,
    );
    expect(result.edges.signalZone.reliableNum).toBe(3);
    expect(result.edges.signalZone.reliableRate).toBeCloseTo(0.375);
  });

  it("aucun match -> reliableRate null (jamais une division par zéro déguisée)", () => {
    const result = deriveCityConsistency(
      baseInput({
        zoneChainMapped: true,
        zoneDesignations: 10,
        matchedZoneDesignations: 0,
        reliableMatchedZoneDesignations: 0,
        zoneDesignatingSignals: 6,
      }),
      GENERATED_AT,
    );
    expect(result.edges.signalZone.reliableRate).toBeNull();
    // recall mesuré à 0/10 = 0 (measured, PAS non_applicable : le mapper a bien
    // trouvé 10 désignations, aucune ne matche une zone servie).
    expect(result.edges.signalZone.status).toBe("measured");
    expect(result.edges.signalZone.rate).toBe(0);
  });

  it("applicabilité = signaux désignant une zone / signaux publiés (anti-100%-trompeur)", () => {
    const result = deriveCityConsistency(
      baseInput({
        publishedSignals: 40,
        groundedSignals: 40,
        zoneChainMapped: true,
        zoneDesignations: 12,
        matchedZoneDesignations: 12,
        reliableMatchedZoneDesignations: 12,
        zoneDesignatingSignals: 9,
      }),
      GENERATED_AT,
    );
    expect(result.edges.signalZone.applicability).toEqual({
      num: 9,
      denom: 40,
      rate: 0.225,
      status: "measured",
    });
  });

  it("ville sans aucun signal désignant une zone (mais publiée) -> applicability non_applicable", () => {
    const result = deriveCityConsistency(
      baseInput({
        publishedSignals: 40,
        groundedSignals: 40,
        zoneChainMapped: true,
        zoneDesignations: 0,
        matchedZoneDesignations: 0,
        reliableMatchedZoneDesignations: 0,
        zoneDesignatingSignals: 0,
      }),
      GENERATED_AT,
    );
    // publishedSignals=40>0 donc computeEdgeMetric(0,40) est bien "measured" à 0,
    // PAS non_applicable : on a un dénominateur valide, un vrai 0 mesuré.
    expect(result.edges.signalZone.applicability).toEqual({
      num: 0,
      denom: 40,
      rate: 0,
      status: "measured",
    });
  });
});

describe("computeConsistencyState — tri-état maillon faible", () => {
  it("jamais 'Non couvert' : les seuls états possibles sont coherent/partial/unmeasured", () => {
    const states = new Set<string>();
    const scenarios: Array<[import("./consistency-calc.js").EdgeMetric, import("./consistency-calc.js").EdgeMetric]> = [
      [computeEdgeMetric(0, 0), computeEdgeMetric(0, 0)],
      [computeEdgeMetric(10, 10), computeEdgeMetric(0, 0, "non_mesure")],
      [computeEdgeMetric(10, 10), computeEdgeMetric(0, 0)],
      [computeEdgeMetric(10, 10), computeEdgeMetric(9, 10)],
      [computeEdgeMetric(5, 10), computeEdgeMetric(9, 10)],
    ];
    for (const [pv, sz] of scenarios) states.add(computeConsistencyState(pv, sz));
    expect(states).toEqual(new Set(["coherent", "partial", "unmeasured"]));
  });

  it("maillon faible : un seul seuil manqué suffit à dégrader coherent -> partial", () => {
    const strongPv = computeEdgeMetric(100, 100); // 1.0 >= 0.95
    const weakZone = computeEdgeMetric(1, 10); // 0.1 < 0.85
    expect(computeConsistencyState(strongPv, weakZone)).toBe("partial");
  });
});

describe("computeBlockers", () => {
  it("aucun bloqueur quand tout est coherent", () => {
    const pv = computeEdgeMetric(100, 100);
    const zone = computeEdgeMetric(90, 100);
    expect(computeBlockers(pv, zone)).toEqual([]);
  });

  it("court-circuite les bloqueurs de zone quand aucun signal n'est publié", () => {
    const pv = computeEdgeMetric(0, 0);
    const zone = { num: 0, denom: 0, rate: null, status: "non_mesure" as const };
    expect(computeBlockers(pv, zone)).toEqual([BLOCKER_LABEL.NO_PUBLISHED_SIGNAL]);
  });
});

describe("unmeasuredCityConsistency", () => {
  it("ville hors snapshot -> Non mesuré honnête, jamais un faux zéro/vert", () => {
    const result = unmeasuredCityConsistency("ville-hors-focus30");
    expect(result.state).toBe("unmeasured");
    expect(result.mode).toBe("unmeasured");
    expect(result.generatedAt).toBeNull();
    expect(result.edges.pvSignal.rate).toBeNull();
    expect(result.edges.signalZone.rate).toBeNull();
    expect(result.edges.signalZone.applicability.rate).toBeNull();
  });
});
