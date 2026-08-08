import { describe, expect, it } from "vitest";
import {
  buildPalierMatrixLive,
  cityBCount,
  cityIsB,
  cityResolvedPct,
  geoCellFor,
  kpiResolvedPct,
  palierCellStatusLabel,
  proxyImmoPlaceholderMatrix,
  PALIER_KPIS_20,
  type PalierMatrix,
} from "./palier-matrix-client.js";
import type {
  GraphSignalCityItem,
  GraphSignalsByCityResponse,
} from "$lib/signals/graph-signals-by-city-client.js";
import type {
  CityCoverage,
  CoverageResponse,
} from "$lib/sources/source-coverage-client.js";

// Couverture minimale injectable (17 dims geo). Défaut : tout « absent ».
function mkCoverageCity(slug: string, over: Partial<CityCoverage> = {}): CityCoverage {
  const geo = { state: "absent" as const, served: false, servedBy: null, freshness: "unknown" as const };
  return {
    citySlug: slug,
    cityName: slug,
    mrc: null,
    priorityRank: null,
    l1Raw: { state: "absent", count: 0, freshness: "unknown" },
    l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
    signals: { state: "absent", count: 0, withCitation: 0, priority: 0, freshness: "unknown" },
    l4Zonage: { ...geo },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: { ...geo },
    tod: { ...geo },
    worstStatus: "absent",
    nextMarginalGain: null,
    ...over,
  };
}
function mkCoverage(cities: CityCoverage[]): CoverageResponse {
  return {
    generatedAt: "2026-08-08T00:00:00.000Z",
    totals: { cities: cities.length, l1Raw: 0, l2Graph: 0, signals: 0, l4Zonage: 0, l5Lots: 0 },
    cities,
  };
}
const emptyCoverageFetcher = async (): Promise<CoverageResponse> => mkCoverage([]);

describe("palier-matrix/v1 — couche données", () => {
  it("libellés de statut NEUTRES (aucun jargon interne)", () => {
    expect(palierCellStatusLabel("complete")).toBe("Complet");
    expect(palierCellStatusLabel("incomplete")).toBe("Partiel");
    expect(palierCellStatusLabel("unknown")).toBe("À qualifier");
    expect(palierCellStatusLabel("na")).toBe("N-A");
    for (const s of ["complete", "incomplete", "unknown", "na"] as const) {
      expect(palierCellStatusLabel(s).toLowerCase()).not.toContain("unknown");
      expect(palierCellStatusLabel(s).toLowerCase()).not.toContain("honn");
    }
  });

  it("cityResolvedPct : % de cellules complètes, N-A EXCLU du dénominateur", () => {
    const row = {
      citySlug: "x",
      cityName: "X",
      cells: [
        { kpiId: "a", status: "complete" as const },
        { kpiId: "b", status: "incomplete" as const },
        { kpiId: "c", status: "na" as const },
        { kpiId: "d", status: "na" as const },
      ],
    };
    expect(cityResolvedPct(row)).toBe(50);
  });

  it("cityResolvedPct : ville 100 % N-A → 0 (pas de division par zéro)", () => {
    expect(
      cityResolvedPct({ citySlug: "x", cityName: "X", cells: [{ kpiId: "a", status: "na" }] }),
    ).toBe(0);
  });

  it("kpiResolvedPct : % de villes complètes pour un KPI (barre par-KPI)", () => {
    const m: PalierMatrix = {
      contract: "palier-matrix/v1",
      subset: "B",
      label: "t",
      kpis: [{ id: "k", label: "K" }],
      cities: [
        { citySlug: "a", cityName: "A", cells: [{ kpiId: "k", status: "complete" }] },
        { citySlug: "b", cityName: "B", cells: [{ kpiId: "k", status: "incomplete" }] },
        { citySlug: "c", cityName: "C", cells: [{ kpiId: "k", status: "na" }] },
      ],
    };
    expect(kpiResolvedPct(m, "k")).toBe(50);
  });

  it("placeholder proxy-immo : étiqueté honnêtement + 7 villes × 4 KPI", () => {
    const m = proxyImmoPlaceholderMatrix("B");
    expect(m.contract).toBe("palier-matrix/v1");
    expect(m.label).toBe("proxy immo geo-lot pending");
    expect(m.cities).toHaveLength(7);
    expect(m.kpis).toHaveLength(4);
    for (const row of m.cities) expect(row.cells).toHaveLength(4);
  });
});

// ── Builder LIVE : scope B + dénominateur + récence depuis le fetch by-city ──
function emptyStages() {
  return {
    avis_motion: 0,
    projet_reglement: 0,
    consultation_publique: 0,
    second_projet: 0,
    adoption: 0,
    entree_vigueur: 0,
    inconnu: 0,
  };
}

// Ville B au sens de la vue Signaux : `stageCountsResEligible` (zonage ∩
// résidentiel-éligible) porte le compte précoce — c'est ce que lit le prédicat
// B par défaut « vivier-v2 » (countForVivierCity).
function mkCity(slug: string, bCount: number): GraphSignalCityItem {
  const item: GraphSignalCityItem = {
    citySlug: slug,
    signalCount: bCount,
    subsetCounts: {},
  };
  if (bCount > 0) {
    item.vivierV2Counts = {
      qualified: bCount,
      residentialUnknown: 0,
      stageCounts: { ...emptyStages(), avis_motion: bCount },
      stageCountsHorsZonage: emptyStages(),
      stageCountsResEligible: { ...emptyStages(), avis_motion: bCount },
      stageCountsResEligibleHorsZonage: emptyStages(),
    } as unknown as GraphSignalCityItem["vivierV2Counts"];
  }
  return item;
}

function resp(cities: GraphSignalCityItem[]): GraphSignalsByCityResponse {
  return { ok: true, totalCount: cities.length, cities };
}

describe("cityIsB / cityBCount — prédicat B = celui de la vue Signaux", () => {
  it("B = compte bulk B (countForVivierCity, clé vivier-v2) > 0 ; non-B sinon", () => {
    expect(cityBCount(mkCity("a", 3))).toBe(3);
    expect(cityIsB(mkCity("a", 3))).toBe(true);
    expect(cityBCount(mkCity("z", 0))).toBe(0);
    expect(cityIsB(mkCity("z", 0))).toBe(false);
  });
});

describe("buildPalierMatrixLive — scope/dénominateur/récence LIVE", () => {
  const now = new Date("2026-08-07T00:00:00.000Z");

  // Mock du serveur date-aware : la fenêtre restreint les villes B.
  function fetcher(opts: { dateFrom?: string | null; dateTo?: string | null }) {
    const all = resp([
      mkCity("westmount", 2), // B, priorité (réf. fallback)
      mkCity("ville-recente-6mo", 1), // B
      mkCity("ville-ancienne", 1), // B
      mkCity("ville-non-b", 0), // non-B → exclue
    ]);
    if (!opts.dateFrom) return Promise.resolve(all);
    // dateFrom = −91j (≈ 2026-05-08) : seule westmount est B récente.
    if (opts.dateFrom >= "2026-05-01") {
      return Promise.resolve(resp([mkCity("westmount", 2)]));
    }
    // dateFrom = −182j (≈ 2026-02-06) : westmount + ville-recente-6mo.
    return Promise.resolve(
      resp([mkCity("westmount", 2), mkCity("ville-recente-6mo", 1)]),
    );
  }

  it("exclut les villes non-B ; dénominateur = nb villes B live", async () => {
    const m = await buildPalierMatrixLive({ fetcher, now, coverageFetcher: emptyCoverageFetcher });
    expect(m.denominator).toBe(3);
    expect(m.cities.map((c) => c.citySlug)).not.toContain("ville-non-b");
    expect(m.cities).toHaveLength(3);
    expect(m.kpis).toHaveLength(20);
  });

  it("récence LIVE par ville + comptes de cohorte (lt3mo/lt6mo/all)", async () => {
    const m = await buildPalierMatrixLive({ fetcher, now, coverageFetcher: emptyCoverageFetcher });
    expect(m.recencyCounts).toEqual({ lt3mo: 1, lt6mo: 2, all: 3 });
    const byslug = new Map(m.cities.map((c) => [c.citySlug, c.recency]));
    expect(byslug.get("westmount")).toBe("lt3mo");
    expect(byslug.get("ville-recente-6mo")).toBe("lt6mo");
    expect(byslug.get("ville-ancienne")).toBe("older");
  });

  it("priorité (réf. hors-ligne) en tête + cellule immo bindée depuis l'artefact", async () => {
    const m = await buildPalierMatrixLive({ fetcher, now, coverageFetcher: emptyCoverageFetcher });
    // westmount est priorité (fallback) → première ligne.
    expect(m.cities[0]?.citySlug).toBe("westmount");
    expect(m.cities[0]?.isPriority).toBe(true);
    expect(m.priorityCount).toBeGreaterThanOrEqual(1);
    // kpi04 (PV) = LIVE : westmount a des signaux servis (signalCount>0) →
    // complet, provenance « live » (plus la réf. hors-ligne).
    const kpi4 = m.cities[0]?.cells.find((c) => c.kpiId === "kpi04");
    expect(kpi4?.status).toBe("complete");
    expect(kpi4?.source).toBe("live");
    // Une cellule geo (kpi01) = « À qualifier » : coverage vide (ville hors
    // couverture) → à qualifier honnête, provenance « couverture absente ».
    const kpi1 = m.cities[0]?.cells.find((c) => c.kpiId === "kpi01");
    expect(kpi1?.status).toBe("unknown");
    expect(kpi1?.source).toBe("couverture absente");
    // kpi20 (Recall) NON servi live → reste réf. hors-ligne (honnête).
    const kpi20 = m.cities[0]?.cells.find((c) => c.kpiId === "kpi20");
    expect(kpi20?.source).toBe("réf. hors-ligne");
  });

  it("kpi04 LIVE corrige le stale : ville B absente du fallback → complet (live)", async () => {
    const m = await buildPalierMatrixLive({ fetcher, now, coverageFetcher: emptyCoverageFetcher });
    // ville-ancienne est B live (signalCount>0) mais hors artefact réf. →
    // le live la marque « complet » (PV présent), pas « à qualifier » stale.
    const row = m.cities.find((c) => c.citySlug === "ville-ancienne");
    const kpi4 = row?.cells.find((c) => c.kpiId === "kpi04");
    expect(kpi4?.status).toBe("complete");
    expect(kpi4?.source).toBe("live");
  });

  it("chaque ligne a exactement 20 cellules (une par KPI)", async () => {
    const m = await buildPalierMatrixLive({ fetcher, now, coverageFetcher: emptyCoverageFetcher });
    for (const row of m.cities) expect(row.cells).toHaveLength(20);
    expect(PALIER_KPIS_20).toHaveLength(20);
  });

  it("17 dims geo dérivées du LIVE coverage (mapping verrouillé) par ville", async () => {
    const covFetcher = async () =>
      mkCoverage([
        mkCoverageCity("westmount", {
          l4Zonage: { state: "verified", served: true, servedBy: "geo", freshness: "fresh" },
          l5Lots: { state: "declared", served: true, servedBy: "local", freshness: "partial" },
          normes: { state: "declared", freshness: "partial", zoneCount: 4, zonesWithGrille: 4, zonesWithReglement: 2, zonesWithNormativeValues: 0 },
          signals: { state: "verified", count: 10, withCitation: 10, priority: 3, freshness: "fresh" },
          l2Graph: { state: "verified", ontologyVersion: "2.3", freshness: "fresh" },
          lotFields: { state: "declared", freshness: "partial" },
          tod: { state: "verified", served: true, servedBy: "geo", freshness: "fresh" },
        }),
      ]);
    const m = await buildPalierMatrixLive({ fetcher, now, coverageFetcher: covFetcher });
    const row = m.cities.find((c) => c.citySlug === "westmount");
    const cell = (id: string) => row?.cells.find((c) => c.kpiId === id);
    // Direct coverage : zonage verified → complet ; lots declared → partiel.
    expect(cell("kpi01")?.status).toBe("complete");
    expect(cell("kpi01")?.source).toBe("coverage");
    expect(cell("kpi02")?.status).toBe("incomplete");
    // Sous-comptes normes : grille 4/4 → complet ; règlement 2/4 → partiel ;
    // valeurs 0/4 → à qualifier.
    expect(cell("kpi03")?.status).toBe("complete");
    expect(cell("kpi05")?.status).toBe("incomplete");
    expect(cell("kpi06")?.status).toBe("unknown");
    // 11 URL-source : 10/10 signaux cités → complet, « dérivé à valider ».
    expect(cell("kpi11")?.status).toBe("complete");
    expect(cell("kpi11")?.source).toBe("dérivé à valider");
    // 08 provenance geo → complet ; 09 fraîcheur fresh → complet (dérivés).
    expect(cell("kpi08")?.status).toBe("complete");
    expect(cell("kpi09")?.status).toBe("complete");
    // TOD groupé 18/19 verified → complet.
    expect(cell("kpi18")?.status).toBe("complete");
    expect(cell("kpi19")?.status).toBe("complete");
    // Structurels jamais complete : 07 = N-A ; 10 = en cours ; 14 = unknown.
    expect(cell("kpi07")?.status).toBe("na");
    expect(cell("kpi07")?.source).toBe("structurel");
    expect(cell("kpi10")?.status).toBe("unknown");
    expect(cell("kpi10")?.source).toBe("en cours");
    expect(cell("kpi14")?.status).toBe("unknown");
  });

  it("échec du fetch coverage n'invalide PAS la matrice (geo → à qualifier)", async () => {
    const failing = async (): Promise<CoverageResponse> => {
      throw new Error("401");
    };
    const m = await buildPalierMatrixLive({ fetcher, now, coverageFetcher: failing });
    expect(m.denominator).toBe(3); // scope B intact
    const kpi1 = m.cities[0]?.cells.find((c) => c.kpiId === "kpi01");
    expect(kpi1?.status).toBe("unknown");
    expect(kpi1?.source).toBe("couverture absente");
  });
});

describe("geoCellFor — mapping kpi_id → couche coverage (lock conducteur)", () => {
  it("ville hors couverture → à qualifier honnête (couverture absente)", () => {
    const c = geoCellFor("kpi01", undefined);
    expect(c.status).toBe("unknown");
    expect(c.source).toBe("couverture absente");
  });

  it("structurels 07/10/14 : jamais complete même sans couverture", () => {
    expect(geoCellFor("kpi07", undefined)).toMatchObject({ status: "na", source: "structurel" });
    expect(geoCellFor("kpi10", undefined)).toMatchObject({ status: "unknown", source: "en cours" });
    expect(geoCellFor("kpi14", undefined)).toMatchObject({ status: "unknown", source: "structurel" });
  });

  it("normes : repli sur l'état bulk quand les sous-comptes sont absents", () => {
    const city = mkCoverageCity("x", { normes: { state: "verified", freshness: "fresh" } });
    expect(geoCellFor("kpi03", city).status).toBe("complete"); // pas de zonesWithGrille → normes.state
  });
});
