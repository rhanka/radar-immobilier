import { describe, expect, it } from "vitest";
import {
  computeLotFacetCounters,
  facetCounterFor,
  lotMatchesFacetFilter,
  type LotFacetState,
} from "./lot-facet-counters.js";

function state(overrides: Partial<LotFacetState> & { key: string }): LotFacetState {
  return {
    selectionActive: false,
    pipelineStatus: null,
    marketActive: false,
    archivedActive: false,
    ...overrides,
  };
}

describe("independent lot facet counters", () => {
  it("should count one lot in every active facet without summing to a population", () => {
    const counters = computeLotFacetCounters([
      state({ key: "a", selectionActive: true, pipelineStatus: "sollicite", marketActive: true }),
      state({ key: "b", pipelineStatus: "lettre_envoyee", archivedActive: true }),
      state({ key: "c" }),
    ]);
    expect(counters).toEqual({
      total: 3,
      selected: 1,
      sollicite: 1,
      lettreEnvoyee: 1,
      enVente: 1,
      archived: 1,
      unmarked: 1,
    });
    expect(counters.selected + counters.sollicite + counters.enVente + counters.archived)
      .not.toBe(counters.total);
  });

  it("should map legacy statuses onto their replacement facets", () => {
    const counters = computeLotFacetCounters([
      state({ key: "a", selectionActive: true, archivedActive: true }),
    ]);
    expect(facetCounterFor(counters, "all")).toBe(1);
    expect(facetCounterFor(counters, "favori")).toBe(1);
    expect(facetCounterFor(counters, "selected")).toBe(1);
    expect(facetCounterFor(counters, "ecarte")).toBe(1);
    expect(facetCounterFor(counters, "archived")).toBe(1);
    expect(facetCounterFor(counters, "sollicite")).toBe(0);
    expect(facetCounterFor(counters, "lettre_envoyee")).toBe(0);
    expect(facetCounterFor(counters, "en_vente")).toBe(0);
    expect(facetCounterFor(counters, "unmarked")).toBe(0);
  });

  it("should match one facet at a time and exclude missing state from unmarked", () => {
    const active = state({ key: "a", selectionActive: true, pipelineStatus: "sollicite" });
    expect(lotMatchesFacetFilter(active, "all")).toBe(true);
    expect(lotMatchesFacetFilter(active, "favori")).toBe(true);
    expect(lotMatchesFacetFilter(active, "selected")).toBe(true);
    expect(lotMatchesFacetFilter(active, "sollicite")).toBe(true);
    expect(lotMatchesFacetFilter(active, "lettre_envoyee")).toBe(false);
    expect(lotMatchesFacetFilter(active, "en_vente")).toBe(false);
    expect(lotMatchesFacetFilter(active, "ecarte")).toBe(false);
    expect(lotMatchesFacetFilter(active, "unmarked")).toBe(false);
    expect(lotMatchesFacetFilter(null, "unmarked")).toBe(false);
    expect(lotMatchesFacetFilter(null, "sollicite")).toBe(false);
    expect(lotMatchesFacetFilter(undefined, "all")).toBe(true);
  });
});
