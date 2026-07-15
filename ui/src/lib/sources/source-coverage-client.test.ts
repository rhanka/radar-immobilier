/**
 * Tests d'HONNÊTETÉ (L-honnêteté, anti-survente) de la vue Source.
 *
 * Le sujet de cette vue EST l'honnêteté de la donnée : ces tests verrouillent
 * qu'on ne fabrique jamais de « vert » et que les trois états restent distincts.
 *   - JAMAIS la couleur `verified` si `worstStatus ≠ verified`.
 *   - Ville absente de la couverture → `absent` (gris neutre), pas vert.
 *   - `declared` ≠ `verified` ≠ `absent` (trois couleurs distinctes).
 *   - headline = totals EXACTS de l'endpoint (jamais recalculé/arrondi).
 */
import { describe, expect, it, vi } from "vitest";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import {
  STATE_COLOR,
  colorForState,
  colorForCity,
  buildFillColorExpression,
  buildFocusOpacityExpression,
  isFocusCity,
  computeFocusScope,
  buildProvinceHeadline,
  formatProvinceHeadline,
  countCheapZonageCompletions,
  countCheapLotsCompletions,
  sortCitiesForConsole,
  fetchCityGrilles,
  fetchCityLotFields,
  lotFieldEvidence,
  lotFieldsMethodNote,
  type CityCoverage,
  type CityLotFields,
  type CoverageState,
  type CoverageTotals,
} from "./source-coverage-client.js";

// ── Fabrique de ville de test ────────────────────────────────────────────────

function makeCity(overrides: Partial<CityCoverage> = {}): CityCoverage {
  return {
    citySlug: "ville-test",
    cityName: "Ville Test",
    mrc: "MRC Test",
    priorityRank: null,
    l1Raw: { state: "absent", count: 0, freshness: "unknown" },
    l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
    signals: { state: "absent", count: 0, withCitation: 0, priority: 0, freshness: "unknown" },
    l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus: "absent",
    nextMarginalGain: null,
    ...overrides,
  };
}

/** Couleur qu'une ville donnée recevrait via l'expression match (par slug). */
function colorFromExpression(
  expr: unknown[],
  citySlug: string,
): string {
  // expr = ["match", ["get","citySlug"], slug, color, ..., fallback]
  const fallback = expr[expr.length - 1] as string;
  for (let i = 2; i < expr.length - 1; i += 2) {
    if (expr[i] === citySlug) return expr[i + 1] as string;
  }
  return fallback;
}

// ── 1. Trois états distincts (D2) ─────────────────────────────────────────────

describe("tri-état : trois couleurs DISTINCTES", () => {
  it("declared ≠ verified ≠ absent", () => {
    const states: CoverageState[] = ["verified", "declared", "absent"];
    const colors = states.map(colorForState);
    expect(new Set(colors).size).toBe(3);
    expect(STATE_COLOR.verified).not.toBe(STATE_COLOR.declared);
    expect(STATE_COLOR.declared).not.toBe(STATE_COLOR.absent);
    expect(STATE_COLOR.verified).not.toBe(STATE_COLOR.absent);
  });

  it("colorForCity colorie par le PIRE statut, jamais par une couche isolée", () => {
    // Toutes les couches sauf une sont vérifiées, mais worstStatus = declared :
    // la couleur DOIT être declared (ambre), JAMAIS verified (vert).
    const city = makeCity({
      l1Raw: { state: "verified", count: 3, freshness: "fresh" },
      l2Graph: { state: "verified", ontologyVersion: "2.3", freshness: "fresh" },
      signals: { state: "verified", count: 12, withCitation: 9, priority: 1, freshness: "fresh" },
      l4Zonage: { state: "verified", served: true, servedBy: "geo", freshness: "fresh" },
      l5Lots: { state: "declared", served: false, servedBy: null, freshness: "unknown" },
      worstStatus: "declared",
    });
    expect(colorForCity(city)).toBe(STATE_COLOR.declared);
    expect(colorForCity(city)).not.toBe(STATE_COLOR.verified);
  });
});

// ── 2. Expression choroplèthe : jamais de vert fabriqué ───────────────────────

describe("buildFillColorExpression — anti-survente", () => {
  it("colorie chaque ville par worstStatus (jamais verified si worstStatus≠verified)", () => {
    const cities = [
      makeCity({ citySlug: "verte", worstStatus: "verified" }),
      makeCity({ citySlug: "ambre", worstStatus: "declared" }),
      makeCity({ citySlug: "grise", worstStatus: "absent" }),
    ];
    const expr = buildFillColorExpression(cities) as unknown[];
    expect(colorFromExpression(expr, "verte")).toBe(STATE_COLOR.verified);
    expect(colorFromExpression(expr, "ambre")).toBe(STATE_COLOR.declared);
    expect(colorFromExpression(expr, "grise")).toBe(STATE_COLOR.absent);
    // La ville `declared` n'est SURTOUT pas peinte en vert.
    expect(colorFromExpression(expr, "ambre")).not.toBe(STATE_COLOR.verified);
  });

  it("ville ABSENTE de la couverture → absent (gris), jamais vert", () => {
    const cities = [makeCity({ citySlug: "connue", worstStatus: "verified" })];
    const expr = buildFillColorExpression(cities) as unknown[];
    // Ville inconnue du jeu de couverture : retombe sur le fallback = absent.
    const unknownColor = colorFromExpression(expr, "ville-jamais-vue");
    expect(unknownColor).toBe(STATE_COLOR.absent);
    expect(unknownColor).not.toBe(STATE_COLOR.verified);
  });

  it("le fallback de l'expression (non vide) est la couleur absent (dernier élément)", () => {
    const expr = buildFillColorExpression([
      makeCity({ citySlug: "connue", worstStatus: "verified" }),
    ]) as unknown[];
    expect(expr[expr.length - 1]).toBe(STATE_COLOR.absent);
  });

  // ── Régression BUG carte vide : jamais de `match` sans paire (invalide) ──────
  it("sans couverture (liste vide) : couleur CONSTANTE absent, pas un match cassé", () => {
    // Un `["match", input, fallback]` sans paire est REJETÉ par MapLibre et fait
    // échouer la couche `cities-fill` → aucun aplat. On peint donc tout en
    // « Non couvert » (gris) via une couleur constante, honnête et VALIDE.
    const expr = buildFillColorExpression([]);
    expect(expr).toBe(STATE_COLOR.absent);
  });

  it("l'expression fill-color est TOUJOURS un paint MapLibre valide (vide ET peuplée)", () => {
    const cases: Record<string, ReturnType<typeof buildFillColorExpression>> = {
      empty: buildFillColorExpression([]),
      populated: buildFillColorExpression([
        makeCity({ citySlug: "a", worstStatus: "verified" }),
        makeCity({ citySlug: "b", worstStatus: "declared" }),
        makeCity({ citySlug: "c", worstStatus: "absent" }),
      ]),
    };
    for (const [name, expr] of Object.entries(cases)) {
      // `createExpression` valide l'arité du `match` : un `["match", input,
      // fallback]` sans paire (l'ancien bug) est rejeté (result === "error").
      const parsed = createExpression(expr);
      expect(parsed.result, `${name}: ${JSON.stringify(parsed)}`).toBe("success");
    }
  });
});

// ── 3. Focus : les villes portant les signaux PRIORITAIRES z∩m∩p ─────────────
// Axe de reporting « 30 villes / 33 signaux précoces » : le focus = l'ensemble
// des villes DISTINCTES avec ≥ 1 signal prioritaire (zonage ∩ multifamilial 4+
// ∩ précoce, `signals.priority`). Ni priorityRank ≤ 30 (1er bug, proximité),
// ni top 30 par NOMBRE de signaux (2e bug, volume brut).

describe("focus = villes à signaux PRIORITAIRES z∩m∩p (computeFocusScope)", () => {
  /** Ville avec `count` signaux projetés dont `priority` prioritaires z∩m∩p. */
  function makeSignalCity(
    slug: string,
    count: number,
    priorityRank: number | null = null,
    priority = 0,
  ): CityCoverage {
    return makeCity({
      citySlug: slug,
      cityName: slug,
      priorityRank,
      signals: {
        state: count > 0 ? "verified" : "absent",
        count,
        withCitation: 0,
        priority,
        freshness: count > 0 ? "fresh" : "unknown",
      },
    });
  }

  it("bug Steve : ville proche SANS signal JAMAIS focus, ville à signal prioritaire LOIN focus", () => {
    // Ancien critère (priorityRank ≤ 30) : Kirkland (rang 30, 0 signal) était
    // focus et Mont-Tremblant (rang 351, 2 signaux prioritaires z∩m∩p mesurés
    // le 2026-07-03) ne l'était pas. Corrigé : le focus se base sur les
    // signaux PRIORITAIRES portés.
    const kirkland = makeSignalCity("kirkland", 0, 30, 0);
    const tremblant = makeSignalCity("mont-tremblant", 13, 351, 2);
    const scope = computeFocusScope([kirkland, tremblant]);
    expect(isFocusCity(kirkland, scope)).toBe(false);
    expect(isFocusCity(tremblant, scope)).toBe(true);
  });

  it("le VOLUME de signaux ne suffit pas : 400 signaux sans prioritaire → PAS focus", () => {
    // 2e bug (corrigé ici) : le focus n'est PAS un top-N par nombre de
    // signaux. Lyster (400 signaux, 0 prioritaire — chiffres réels S3
    // 2026-07-03) n'est pas focus ; Sutton (5 signaux dont 1 prioritaire) l'est.
    const lyster = makeSignalCity("lyster", 400, 550, 0);
    const sutton = makeSignalCity("sutton", 5, 288, 1);
    const scope = computeFocusScope([lyster, sutton]);
    expect(isFocusCity(lyster, scope)).toBe(false);
    expect(isFocusCity(sutton, scope)).toBe(true);
  });

  it("priorityRank 1 sans signal prioritaire : pas focus (la proximité ne compte plus)", () => {
    const scope = computeFocusScope([
      makeSignalCity("proche-sans-signal", 0, 1, 0),
      makeSignalCity("loin-avec-prioritaire", 2, 900, 1),
    ]);
    expect(scope.slugs.has("proche-sans-signal")).toBe(false);
    expect(scope.slugs.has("loin-avec-prioritaire")).toBe(true);
  });

  it("AUCUNE troncature : l'ensemble suit la donnée (35 villes prioritaires → 35 focus)", () => {
    // Le focus n'est PAS forcé à 30 : c'est l'ensemble des villes portant les
    // signaux prioritaires (~30 mesurées sur données réelles, jamais tronqué).
    const cities = Array.from({ length: 35 }, (_, i) =>
      makeSignalCity(`v${String(i + 1).padStart(2, "0")}`, i + 2, null, 1),
    );
    const scope = computeFocusScope(cities);
    expect(scope.slugs.size).toBe(35);
  });

  it("rang = nb de signaux PRIORITAIRES décroissant (tie-break : total, rang, nom)", () => {
    const scope = computeFocusScope([
      makeSignalCity("un-prioritaire", 22, 100, 1),
      makeSignalCity("deux-prioritaires", 4, 400, 2),
      makeSignalCity("un-prioritaire-moins-fourni", 5, 100, 1),
    ]);
    expect(scope.rankBySlug.get("deux-prioritaires")).toBe(1);
    expect(scope.rankBySlug.get("un-prioritaire")).toBe(2);
    expect(scope.rankBySlug.get("un-prioritaire-moins-fourni")).toBe(3);
  });

  it("payload ancien (sans champ priority) → focus vide, rien d'inventé", () => {
    const legacy = makeSignalCity("legacy", 12, 10, 0);
    // Simule une réponse d'API antérieure au champ `priority`.
    delete (legacy.signals as Partial<CityCoverage["signals"]>).priority;
    const scope = computeFocusScope([legacy]);
    expect(scope.slugs.size).toBe(0);
    expect(isFocusCity(legacy, scope)).toBe(false);
  });

  it("mode Province : opacité uniforme (number), pas d'expression par ville", () => {
    const cities = [makeSignalCity("a", 4, 1, 1)];
    const op = buildFocusOpacityExpression(cities, false);
    expect(typeof op).toBe("number");
  });

  it("mode focus : ville à signal prioritaire opaque, les autres atténuées, fallback atténué", () => {
    const cities = [
      makeSignalCity("focus", 13, 351, 2), // prioritaire, loin → focus
      makeSignalCity("volume-sans-prioritaire", 400, 5, 0), // volume brut → atténuée
      makeSignalCity("horsfocus", 0, 5, 0), // proche, 0 signal → atténuée
    ];
    const expr = buildFocusOpacityExpression(cities, true) as unknown[];
    const focusOp = colorFromExpression(expr, "focus") as unknown as number;
    const volumeOp = colorFromExpression(expr, "volume-sans-prioritaire") as unknown as number;
    const dimOp = colorFromExpression(expr, "horsfocus") as unknown as number;
    const fallbackOp = expr[expr.length - 1] as number;
    expect(focusOp).toBeGreaterThan(dimOp);
    expect(volumeOp).toBe(dimOp);
    expect(fallbackOp).toBe(dimOp);
  });
});

// ── 4. Headline province = totals EXACTS (D7) ─────────────────────────────────

describe("headline province", () => {
  const totals: CoverageTotals = {
    cities: 1106,
    l1Raw: 274,
    l2Graph: 197,
    signals: 31,
    l4Zonage: 561,
    l5Lots: 1102,
  };

  it("formatProvinceHeadline reprend les totals EXACTS sans recalcul", () => {
    // Les chiffres zonage/lots viennent du LISTING LIVE geo (BUG « 70/1106
    // zonage servi » alors que geo sert 500+ zonages / ~1102 lots) : le
    // headline reflète les totals de l'endpoint, JAMAIS un recalcul local.
    expect(formatProvinceHeadline(totals)).toBe(
      "197/1106 graphés · 561/1106 zonage servi · 1102/1106 lots servis",
    );
  });

  it("buildProvinceHeadline expose les totals + complétions cheap (zonage)", () => {
    const cities = [
      makeCity({ citySlug: "a", nextMarginalGain: "zonage" }),
      makeCity({ citySlug: "b", nextMarginalGain: "zonage" }),
      makeCity({ citySlug: "c", nextMarginalGain: "lots" }),
      makeCity({ citySlug: "d", nextMarginalGain: null }),
    ];
    const headline = buildProvinceHeadline({ totals, cities });
    expect(headline.cities).toBe(1106);
    expect(headline.l2Graph).toBe(197);
    expect(headline.l4Zonage).toBe(561);
    expect(headline.l5Lots).toBe(1102);
    expect(headline.cheapZonage).toBe(2);
  });

  it("countCheapZonage/Lots comptent le prochain gain marginal", () => {
    const cities = [
      makeCity({ nextMarginalGain: "zonage" }),
      makeCity({ nextMarginalGain: "lots" }),
      makeCity({ nextMarginalGain: "lots" }),
      makeCity({ nextMarginalGain: null }),
    ];
    expect(countCheapZonageCompletions(cities)).toBe(1);
    expect(countCheapLotsCompletions(cities)).toBe(2);
  });
});

// ── 5. Tri Console : pires statuts d'abord (action en tête) ───────────────────

describe("sortCitiesForConsole", () => {
  it("trie absent < declared < verified, puis focus-30, puis alpha", () => {
    const cities = [
      makeCity({ citySlug: "v", cityName: "Verte", worstStatus: "verified", priorityRank: 2 }),
      makeCity({ citySlug: "a2", cityName: "Absente Beta", worstStatus: "absent", priorityRank: null }),
      makeCity({ citySlug: "a1", cityName: "Absente Alpha", worstStatus: "absent", priorityRank: 5 }),
      makeCity({ citySlug: "d", cityName: "Declaree", worstStatus: "declared", priorityRank: null }),
    ];
    const sorted = sortCitiesForConsole(cities);
    expect(sorted.map((c) => c.citySlug)).toEqual(["a1", "a2", "d", "v"]);
  });

  it("ne mute pas le tableau d'entrée", () => {
    const cities = [
      makeCity({ citySlug: "x", worstStatus: "verified" }),
      makeCity({ citySlug: "y", worstStatus: "absent" }),
    ];
    const before = cities.map((c) => c.citySlug);
    sortCitiesForConsole(cities);
    expect(cities.map((c) => c.citySlug)).toEqual(before);
  });
});

// ── 6. Détail grilles de zonage (lazy, live) ─────────────────────────────────

describe("fetchCityGrilles", () => {
  it("appelle l'endpoint par ville et retourne le contrat tel quel", async () => {
    const payload = {
      citySlug: "saint-hippolyte",
      available: true,
      zoneCount: 3,
      numberMatched: 3,
      complete: true,
      zonesWithGrille: 1,
      zonesWithReglement: 1,
      zonesWithLegacyNormes: 1,
      zonesWithNormativeValues: 1,
      covered: 2,
      state: "declared" as const,
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const result = await fetchCityGrilles("saint-hippolyte", fetchImpl);
    expect(result).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/source/coverage/saint-hippolyte/grilles",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("lève en cas d'échec HTTP (état « donnée indisponible » honnête côté vue)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{}", { status: 502 }),
    ) as unknown as typeof fetch;
    await expect(fetchCityGrilles("ville-x", fetchImpl)).rejects.toThrow(
      "source-coverage grilles HTTP 502",
    );
  });
});

// ── Champs lot enrichis (superficie/adresse/CP/normes) ───────────────────────

describe("fetchCityLotFields", () => {
  it("appelle l'endpoint par ville et retourne le contrat tel quel", async () => {
    const payload: CityLotFields = {
      citySlug: "delson",
      available: true,
      totalLots: 3330,
      sampleSize: 450,
      sampled: true,
      fields: {
        superficie: { count: 450, pct: 100, state: "verified" },
        adresse: { count: 450, pct: 100, state: "verified" },
        codePostal: { count: 450, pct: 100, state: "verified" },
        normes: { count: 315, pct: 70, state: "declared" },
      },
      state: "declared",
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const result = await fetchCityLotFields("delson", fetchImpl);
    expect(result).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/source/coverage/delson/lot-fields",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("lève en cas d'échec HTTP (état « donnée indisponible » honnête côté vue)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{}", { status: 502 }),
    ) as unknown as typeof fetch;
    await expect(fetchCityLotFields("ville-x", fetchImpl)).rejects.toThrow(
      "source-coverage lot-fields HTTP 502",
    );
  });
});

describe("lotFieldEvidence (copy client, % honnête)", () => {
  it("100 % → « 100 % des lots », partiel → « N % des lots », 0 → « non enrichi »", () => {
    expect(
      lotFieldEvidence({ count: 450, pct: 100, state: "verified" }),
    ).toBe("100 % des lots");
    expect(lotFieldEvidence({ count: 315, pct: 70, state: "declared" })).toBe(
      "70 % des lots",
    );
    expect(lotFieldEvidence({ count: 13, pct: 3, state: "declared" })).toBe(
      "3 % des lots",
    );
    expect(lotFieldEvidence({ count: 0, pct: 0, state: "absent" })).toBe(
      "0 % — non enrichi",
    );
  });
});

describe("lotFieldsMethodNote (méthode déclarée, jamais masquée)", () => {
  it("mesure exhaustive → « mesuré sur les N lots servis »", () => {
    expect(
      lotFieldsMethodNote({
        citySlug: "delson",
        available: true,
        totalLots: 330,
        sampleSize: 330,
        sampled: false,
      }),
    ).toBe("mesuré sur les 330 lots servis");
  });

  it("échantillon → « échantillon de N lots sur M »", () => {
    const note = lotFieldsMethodNote({
      citySlug: "longueuil",
      available: true,
      totalLots: 90000,
      sampleSize: 450,
      sampled: true,
    });
    // toLocaleString fr-CA : séparateur de milliers (espace insécable).
    expect(note).toMatch(/^échantillon de 450 lots sur 90.000$/);
  });

  it("mesure indisponible ou vide → null (pas de note fabriquée)", () => {
    expect(
      lotFieldsMethodNote({ citySlug: "ville-x", available: false }),
    ).toBeNull();
    expect(
      lotFieldsMethodNote({
        citySlug: "ville-y",
        available: true,
        totalLots: 0,
        sampleSize: 0,
        sampled: false,
      }),
    ).toBeNull();
  });
});
