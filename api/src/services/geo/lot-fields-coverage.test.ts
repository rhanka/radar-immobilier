import { describe, expect, it, vi } from "vitest";
import {
  LOT_FIELDS_CHUNK,
  LOT_FIELDS_MAX_SAMPLE,
  buildLotFieldsResponse,
  buildSamplePlan,
  countLotFields,
  honestPct,
  lotFieldState,
  measureCityLotFields,
} from "./lot-fields-coverage.js";

/** Feature geo minimaliste : uniquement des properties. */
function feat(properties: Record<string, unknown>): unknown {
  return { type: "Feature", properties, geometry: null };
}

/** Lot COMPLET façon Delson (surface + adresse + FSA + normes foldées). */
function fullLot(): unknown {
  return feat({
    surface_m2: 6116.71,
    adresse: "225 chemin Saint-Francois-Xavier",
    code_postal: "J5B",
    hauteur_max_value: 1,
    densite_value: 45,
    marge_avant_min_value: 7.6,
  });
}

/** Lot NON ENRICHI façon Mont-Tremblant (aucun champ servi). */
function bareLot(): unknown {
  return feat({ NO_LOT: "1 234 567", zone_code: "R-1" });
}

describe("countLotFields (verbatim-or-null)", () => {
  it("compte les 4 champs sur un lot complet, rien sur un lot nu", () => {
    expect(countLotFields([fullLot()])).toEqual({
      superficie: 1,
      adresse: 1,
      codePostal: 1,
      normes: 1,
    });
    expect(countLotFields([bareLot()])).toEqual({
      superficie: 0,
      adresse: 0,
      codePostal: 0,
      normes: 0,
    });
  });

  it("ne compte JAMAIS une valeur vide/nulle/invalide comme présente", () => {
    const counts = countLotFields([
      feat({
        surface_m2: null,
        adresse: "   ",
        code_postal: "",
        hauteur_max_value: null,
        densite_value: null,
      }),
      feat({ surface_m2: 0 }), // aire nulle = pas une aire réelle
      feat({ surface_m2: Number.NaN }),
      "pas-une-feature",
    ]);
    expect(counts).toEqual({
      superficie: 0,
      adresse: 0,
      codePostal: 0,
      normes: 0,
    });
  });

  it("une SEULE norme foldée suffit à marquer le lot « normé »", () => {
    const counts = countLotFields([
      feat({ superficie_min_value: 300 }),
      feat({ marge_laterale_min_value: 3 }),
      feat({ hauteur_min_value: 4 }), // hauteur_MIN n'est PAS un champ compté
    ]);
    expect(counts.normes).toBe(2);
  });
});

describe("honestPct (jamais de 100 % fabriqué, jamais de 0 % masquant)", () => {
  it("0 seulement à zéro, 100 seulement à complet", () => {
    expect(honestPct(0, 450)).toBe(0);
    expect(honestPct(450, 450)).toBe(100);
    expect(honestPct(0, 0)).toBe(0);
  });

  it("borne la couverture partielle à [1, 99] malgré l'arrondi", () => {
    expect(honestPct(449, 450)).toBe(99); // 99.8 % n'affiche JAMAIS 100
    expect(honestPct(1, 450)).toBe(1); // 0.2 % n'affiche JAMAIS 0
    expect(honestPct(315, 450)).toBe(70);
    expect(honestPct(13, 450)).toBe(3); // Longueuil-like : normes ~3 %
  });
});

describe("lotFieldState (tri-état par champ)", () => {
  it("verified = complet, declared = partiel, absent = zéro", () => {
    expect(lotFieldState(450, 450)).toBe("verified");
    expect(lotFieldState(315, 450)).toBe("declared");
    expect(lotFieldState(0, 450)).toBe("absent");
    expect(lotFieldState(0, 0)).toBe("absent");
  });
});

describe("buildSamplePlan (stratifié, exact sous la borne)", () => {
  it("total ≤ borne → toutes les tranches (mesure exacte)", () => {
    expect(buildSamplePlan(400)).toEqual([
      { offset: 0, limit: 150 },
      { offset: 150, limit: 150 },
      { offset: 300, limit: 100 },
    ]);
    expect(buildSamplePlan(100)).toEqual([{ offset: 0, limit: 100 }]);
    expect(buildSamplePlan(0)).toEqual([]);
  });

  it("total > borne → 3 tranches début / milieu / fin DISJOINTES", () => {
    const plan = buildSamplePlan(3330);
    expect(plan).toEqual([
      { offset: 0, limit: 150 },
      { offset: 1590, limit: 150 },
      { offset: 3180, limit: 150 },
    ]);
    // Disjointes : chaque tranche finit avant le début de la suivante.
    expect(plan[0]!.offset + plan[0]!.limit).toBeLessThanOrEqual(
      plan[1]!.offset,
    );
    expect(plan[1]!.offset + plan[1]!.limit).toBeLessThanOrEqual(
      plan[2]!.offset,
    );
    expect(plan[2]!.offset + plan[2]!.limit).toBe(3330);
  });

  it("reste disjoint au seuil exact (total = borne + 1)", () => {
    const plan = buildSamplePlan(LOT_FIELDS_MAX_SAMPLE + 1);
    expect(plan[0]!.offset + plan[0]!.limit).toBeLessThanOrEqual(
      plan[1]!.offset,
    );
    expect(plan[1]!.offset + plan[1]!.limit).toBeLessThanOrEqual(
      plan[2]!.offset,
    );
  });
});

describe("buildLotFieldsResponse (agrégat tri-état)", () => {
  it("ville 100 % partout → verified, 100 % par champ", () => {
    const res = buildLotFieldsResponse("delson", 450, 450, {
      superficie: 450,
      adresse: 450,
      codePostal: 450,
      normes: 450,
    });
    expect(res.state).toBe("verified");
    expect(res.sampled).toBe(false);
    expect(res.fields?.superficie).toEqual({
      count: 450,
      pct: 100,
      state: "verified",
    });
  });

  it("ville 0 % partout (Mont-Tremblant) → absent, 0 % par champ", () => {
    const res = buildLotFieldsResponse("mont-tremblant", 9000, 450, {
      superficie: 0,
      adresse: 0,
      codePostal: 0,
      normes: 0,
    });
    expect(res.state).toBe("absent");
    expect(res.sampled).toBe(true);
    expect(res.fields?.adresse).toEqual({ count: 0, pct: 0, state: "absent" });
  });

  it("ville partielle (Longueuil : superficie 100 %, normes 3 %) → declared", () => {
    const res = buildLotFieldsResponse("longueuil", 90000, 450, {
      superficie: 450,
      adresse: 448,
      codePostal: 450,
      normes: 13,
    });
    expect(res.state).toBe("declared");
    expect(res.fields?.superficie.pct).toBe(100);
    expect(res.fields?.adresse.pct).toBe(99); // 99.6 % ≠ « 100 % »
    expect(res.fields?.normes).toEqual({ count: 13, pct: 3, state: "declared" });
  });
});

describe("measureCityLotFields (mesure live, fetch mocké)", () => {
  function itemsResponse(features: unknown[], numberMatched: number): Response {
    return new Response(
      JSON.stringify({ type: "FeatureCollection", features, numberMatched }),
      { status: 200, headers: { "content-type": "application/geo+json" } },
    );
  }

  it("petite ville : mesure EXACTE en tranches de 150 (sampled: false)", async () => {
    const total = 200;
    const lots = Array.from({ length: total }, () => fullLot());
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://geo.test");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "0");
      return itemsResponse(lots.slice(offset, offset + limit), total);
    }) as unknown as typeof fetch;

    const res = await measureCityLotFields("delson", "http://geo.test", fetchImpl);
    expect(res).not.toBeNull();
    expect(res?.totalLots).toBe(total);
    expect(res?.sampleSize).toBe(total);
    expect(res?.sampled).toBe(false);
    expect(res?.state).toBe("verified");
    expect(res?.fields?.codePostal.pct).toBe(100);
  });

  it("grande ville : échantillon stratifié de 450 (sampled: true), offsets début/milieu/fin", async () => {
    const total = 3330;
    const requested: number[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://geo.test");
      requested.push(Number(url.searchParams.get("offset") ?? "0"));
      const limit = Number(url.searchParams.get("limit") ?? "0");
      return itemsResponse(
        Array.from({ length: limit }, () => bareLot()),
        total,
      );
    }) as unknown as typeof fetch;

    const res = await measureCityLotFields(
      "mont-tremblant",
      "http://geo.test",
      fetchImpl,
    );
    expect(requested.sort((a, b) => a - b)).toEqual([0, 1590, 3180]);
    expect(res?.sampleSize).toBe(LOT_FIELDS_MAX_SAMPLE);
    expect(res?.sampled).toBe(true);
    expect(res?.state).toBe("absent");
    expect(res?.fields?.superficie.pct).toBe(0);
    expect(LOT_FIELDS_CHUNK * 3).toBe(LOT_FIELDS_MAX_SAMPLE);
  });

  it("collection 404 → available avec zéros (aucun lot servi), geo down → null", async () => {
    const notFound = vi.fn(async () => new Response("nf", { status: 404 }));
    const res404 = await measureCityLotFields(
      "ville-sans-lots",
      "http://geo.test",
      notFound as unknown as typeof fetch,
    );
    expect(res404?.available).toBe(true);
    expect(res404?.totalLots).toBe(0);
    expect(res404?.state).toBe("absent");

    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const resDown = await measureCityLotFields(
      "ville-x",
      "http://geo.test",
      down as unknown as typeof fetch,
    );
    expect(resDown).toBeNull();
  });

  it("tranche en échec → mesure sur les lots RÉELLEMENT lus (jamais extrapolé)", async () => {
    const total = 3330;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://geo.test");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (offset > 0) return new Response("boom", { status: 500 });
      return itemsResponse(
        Array.from({ length: 150 }, () => fullLot()),
        total,
      );
    }) as unknown as typeof fetch;

    const res = await measureCityLotFields("ville-y", "http://geo.test", fetchImpl);
    expect(res?.sampleSize).toBe(150);
    expect(res?.sampled).toBe(true);
    expect(res?.fields?.superficie.count).toBe(150);
  });
});
