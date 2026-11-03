import { describe, expect, it } from "vitest";
import {
  SIGNAL_QUERY_APP_ROUTE_PATH,
  SIGNAL_QUERY_CONTRACT_VERSION,
  SIGNAL_QUERY_MCP_TOOL,
  SIGNAL_QUERY_PRODUCT_DEFAULT,
  SIGNAL_QUERY_READER_OPERATION,
  SignalFilterV1,
  SignalQueryCountsV1,
  SignalQueryFacetsV1,
  SignalQueryItemV1,
  SignalQueryResponseV1,
} from "./signal-filter-v1.js";

describe("SignalFilterV1 frozen contract", () => {
  it("should accept the named product default", () => {
    const parsed = SignalFilterV1.parse({ ...SIGNAL_QUERY_PRODUCT_DEFAULT });
    expect(parsed.requireZonage).toBe(true);
    expect(parsed.dateBasis).toBe("document");
    expect(parsed.sort).toBe("vivier_rank");
  });

  it("should accept an all-cities opening without citySlug", () => {
    const parsed = SignalFilterV1.parse({});
    expect(parsed.citySlug).toBeUndefined();
    expect(parsed.limit).toBe(50);
    expect(parsed.include).toEqual(["facets"]);
  });

  it("should refuse zoneCode without citySlug", () => {
    const parsed = SignalFilterV1.safeParse({ zoneCode: "H-101" });
    expect(parsed.success).toBe(false);
  });

  it("should refuse an unknown key, a bad civil date, and an out-of-range limit", () => {
    expect(SignalFilterV1.safeParse({ citySlug: "valleyfield", unknown: true }).success).toBe(false);
    expect(SignalFilterV1.safeParse({ dateFrom: "2026-02-31", dateTo: "2026-03-01" }).success).toBe(false);
    expect(SignalFilterV1.safeParse({ dateFrom: "2026-03-02", dateTo: "2026-03-01" }).success).toBe(false);
    expect(SignalFilterV1.safeParse({ limit: 101 }).success).toBe(false);
    expect(SignalFilterV1.safeParse({ q: "x".repeat(129) }).success).toBe(false);
  });

  it("should freeze the single route, operation, and tool spelling", () => {
    expect(SIGNAL_QUERY_APP_ROUTE_PATH).toBe(
      "/api/v1/workspaces/:workspaceId/signal-facets/query",
    );
    expect(SIGNAL_QUERY_READER_OPERATION).toBe("signals.query.v1");
    expect(SIGNAL_QUERY_MCP_TOOL).toBe("query_signals");
    expect(SIGNAL_QUERY_CONTRACT_VERSION).toBe("signal-query-v1");
  });

  it("should require byCity in every response", () => {
    const ok = makeResponse();
    expect(SignalQueryResponseV1.parse(ok).facets.byCity).toHaveLength(1);
    expect(
      SignalQueryResponseV1.safeParse({ ...ok, facets: { basis: "x", byCity: [] }, items: [{}] }).success,
    ).toBe(false);
  });

  it("should reject any extra key on snapshot, counts, item, card, and facets", () => {
    const ok = makeResponse();
    const item = firstItem();
    expect(
      SignalQueryResponseV1.safeParse({ ...ok, snapshot: { ...ok.snapshot, baseToken: "t", queryDigest: "d", extra: 1 } }).success,
    ).toBe(false);
    expect(
      SignalQueryResponseV1.safeParse({ ...ok, counts: { ...ok.counts, extra: 1 } }).success,
    ).toBe(false);
    expect(
      SignalQueryItemV1.safeParse({ ...item, props: { raw: true } }).success,
    ).toBe(false);
    expect(
      SignalQueryItemV1.safeParse({ ...item, card: { ...item.card, unknownField: 1 } }).success,
    ).toBe(false);
    expect(
      SignalQueryFacetsV1.safeParse({ ...makeFacets(), unknownDimension: {} }).success,
    ).toBe(false);
  });

  it("should require the full strict card, classification, facets, and attachments on every item", () => {
    const item = firstItem();
    const { card: _card, ...withoutCard } = item;
    expect(SignalQueryItemV1.safeParse(withoutCard).success).toBe(false);
    const { classification: _classification, ...withoutClassification } = item;
    expect(SignalQueryItemV1.safeParse(withoutClassification).success).toBe(false);
    const { facets: _facets, ...withoutFacets } = item;
    expect(SignalQueryItemV1.safeParse(withoutFacets).success).toBe(false);
    const parsed = SignalQueryItemV1.parse(item);
    expect(parsed.zoneCodes).toEqual(["H-101"]);
    expect(parsed.card.regulatoryStatus).toBe("firm");
    expect(parsed.card.freshness).toEqual({ day: "2026-10-02", basis: "document" });
  });

  it("should require closed enum keys and the vivier block on facets", () => {
    expect(
      SignalQueryFacetsV1.safeParse({ ...makeFacets(), byStage: { not_a_stage: 1 } }).success,
    ).toBe(false);
    expect(
      SignalQueryFacetsV1.safeParse({
        ...makeFacets(),
        byInstrument: { ...makeFacets().byInstrument, unknown_instrument: 1 },
      }).success,
    ).toBe(false);
    expect(
      SignalQueryFacetsV1.safeParse({ ...makeFacets(), byRegulatoryStatus: { draft: 2 } }).success,
    ).toBe(false);
    const { vivier: _vivier, ...withoutVivier } = makeFacets();
    expect(SignalQueryFacetsV1.safeParse(withoutVivier).success).toBe(false);
  });

  it("should freeze the single-pass navigation basis and enforce count invariants", () => {
    const counts = makeResponse().counts;
    expect(counts.navigation.basis).toBe("single_pass_signal_query_v1");
    expect(SignalQueryCountsV1.parse(counts).matched).toBe(1);
    expect(
      SignalQueryCountsV1.safeParse({ ...counts, eligible: counts.visible + counts.discarded + 1 }).success,
    ).toBe(false);
    expect(
      SignalQueryCountsV1.safeParse({
        ...counts,
        navigation: { ...counts.navigation, basis: "after_content_personal_history_and_archive_before_basket" },
      }).success,
    ).toBe(false);
  });
});

function firstItem() {
  const [item] = makeResponse().items;
  if (!item) throw new Error("expected one fixture item");
  return item;
}

function makeFacets() {
  return {
    basis: "matched-minus-city",
    byCity: [{ citySlug: "valleyfield", matched: 1 }],
    byStage: {
      avis_motion: 1,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    byInstrument: {
      rezonage: 1,
      ppcmoi: 0,
      piia: 0,
      derogation: 0,
      refonte: 0,
      plan_urbanisme: 0,
      autre: 0,
    },
    byRegulatoryStatus: { firm: 1, anticipation: 0 },
    vivier: {
      qualified: 1,
      residentialUnknown: 0,
      excludedByReason: {
        non_residentiel_franc: 0,
        piia_non_pertinent: 0,
        hors_zonage: 0,
        derogation_hors_sujet: 0,
      },
    },
  };
}

function makeResponse() {
  return {
    contractVersion: "signal-query-v1" as const,
    snapshot: { kind: "signal-query-v1" as const, baseToken: "base-token", queryDigest: "query-digest" },
    counts: {
      unit: "distinct_targets" as const,
      eligible: 1,
      visible: 1,
      discarded: 0,
      discardedByScope: { personalOnly: 0, workspaceOnly: 0, both: 0 },
      navigation: {
        basis: "single_pass_signal_query_v1" as const,
        population: 1,
        pertinent: 0,
        a_surveiller: 0,
        selectedDistinct: 0,
        selectionMemberships: 0,
        unselected: 1,
      },
      matched: 1,
    },
    facets: makeFacets(),
    items: [
      {
        citySlug: "valleyfield",
        target: { citySlug: "valleyfield", type: "Signal" as const, id: "sig-vf-01" },
        card: {
          label: "Rezonage residentiel — 12 logements zone H-101",
          description: "Rezonage pour 12 logements",
          stage: "avis_motion" as const,
          sourceStage: "avis_motion",
          regulatoryStatus: "firm" as const,
          freshness: { day: "2026-10-02", basis: "document" as const },
          automaticExclusionReason: null,
          docRefs: [],
          missingEvidence: [],
          truncatedFields: [],
        },
        classification: {
          zonage: { valeur: "oui" as const, source: "s", confiance: 0.9 },
          residentiel: { valeur: "oui" as const, source: "s", confiance: 0.9 },
          effet_densifiant: "densifie" as const,
          instrument: "rezonage" as const,
          etape: "avis_motion" as const,
          etapes_historique: [],
          exclusion_reason: null,
          provenance: { extrait: "projet de 12 logements" },
          confiance: 0.9,
        },
        facets: {
          selection: { pertinent: null, a_surveiller: null },
          archive: { personal: false, workspace: false },
          personalHistoryState: "untouched" as const,
          personalHidden: false,
          workspaceHidden: false,
          effectiveHidden: false,
        },
        zoneCodes: ["H-101"],
        lotNos: [],
      },
    ],
    page: { limit: 50, nextCursor: null, truncated: false },
  };
}
