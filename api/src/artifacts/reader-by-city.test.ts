import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBasketReadOperation } from "./reader-baskets.js";
import { validateReaderResponse } from "./reader-responses.js";
import type { ApiReaderContext } from "./reader-context.js";

vi.mock("../services/facets/scoped-by-city.js", () => ({ readScopedByCity: vi.fn() }));
import { readScopedByCity } from "../services/facets/scoped-by-city.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const stages = { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0,
  adoption: 0, entree_vigueur: 0, inconnu: 0 };
const subsets = Object.fromEntries(["", "z", "m", "p", "r", "z|m", "z|p", "z|r", "m|p", "m|r", "p|r",
  "z|m|p", "z|m|r", "z|p|r", "m|p|r", "z|m|p|r"].map((key) => [key, 0]));
const city = { citySlug: "valleyfield", signalCount: 0, subsetCounts: subsets,
  vivierV2Counts: { qualified: 0, residentialUnknown: 0, excludedByReason: { non_residentiel_franc: 0,
    piia_non_pertinent: 0, hors_zonage: 0, derogation_hors_sujet: 0 }, stageCounts: stages,
  stageCountsHorsZonage: stages, stageCountsResEligible: stages, stageCountsResEligibleHorsZonage: stages, total: 0 } };

beforeEach(() => { vi.resetAllMocks(); });

describe("signals.by-city.v1 service wiring", () => {
  it("should wrap the scoped service result in the app envelope and never show discarded", async () => {
    vi.mocked(readScopedByCity).mockResolvedValue({ totalCount: 0, cities: [city] } as never);
    const read = createBasketReadOperation({ db: {} as never, store: {} as never });
    const body = await read("signals.by-city.v1", { workspaceId: WORKSPACE, excludePiia: "1" },
      { readerSub: "reader-alice" } as ApiReaderContext);
    expect(validateReaderResponse("signals.by-city.v1", body, "reader-alice"))
      .toEqual({ ok: true, totalCount: 0, cities: [city] });
    expect(vi.mocked(readScopedByCity).mock.calls[0]!.slice(1)).toEqual(["reader-alice", WORKSPACE,
      { dateRange: { excludePiia: true }, showDiscarded: false }]);
  });
});

describe("signals.by-city.v1 Filtre cube", () => {
  it("should carry the Filtre cube counters to the artifact reader", async () => {
    const withCube = { ...city, filtreCube: { "11100": 2, "11010": 1 } };
    vi.mocked(readScopedByCity).mockResolvedValue({ totalCount: 0, cities: [withCube] } as never);
    const read = createBasketReadOperation({ db: {} as never, store: {} as never });
    const body = await read("signals.by-city.v1", { workspaceId: WORKSPACE },
      { readerSub: "reader-alice" } as ApiReaderContext);
    expect(validateReaderResponse("signals.by-city.v1", body, "reader-alice"))
      .toEqual({ ok: true, totalCount: 0, cities: [withCube] });
  });

  it("should refuse a cube cell that is not a five-flag key", async () => {
    vi.mocked(readScopedByCity).mockResolvedValue(
      { totalCount: 0, cities: [{ ...city, filtreCube: { "sig-1": 1 } }] } as never);
    const read = createBasketReadOperation({ db: {} as never, store: {} as never });
    const body = await read("signals.by-city.v1", { workspaceId: WORKSPACE },
      { readerSub: "reader-alice" } as ApiReaderContext);
    expect(() => validateReaderResponse("signals.by-city.v1", body, "reader-alice")).toThrow();
  });
});
