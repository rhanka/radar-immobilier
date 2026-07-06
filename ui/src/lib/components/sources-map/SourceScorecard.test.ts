/**
 * QA léger — SourceScorecard : lignes « Champs lot » (superficie / adresse /
 * code postal / normes foldées) mesurées LAZY sur l'endpoint lot-fields.
 *
 * Vérifie l'HONNÊTETÉ du rendu :
 *   1. Ville enrichie (Delson-like) : chaque champ affiche son % réel
 *      (« 100 % des lots », badge « Servi » ; normes partielles → « 70 % des
 *      lots », badge « Partiel ») + la note de méthode (échantillon déclaré).
 *   2. Ville non enrichie (Mont-Tremblant-like) : « 0 % — non enrichi »,
 *      badge « Non couvert » — jamais un vert fabriqué.
 *   3. Lots non servis : « aucune donnée », AUCUN appel réseau lot-fields.
 *
 * Environnement jsdom — fetch global stubé (aucun réseau réel).
 */
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, cleanup, within } from "@testing-library/svelte";
import SourceScorecard from "./SourceScorecard.svelte";
import type {
  CityCoverage,
  CityLotFields,
} from "$lib/sources/source-coverage-client.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Ville avec lots SERVIS par geo (zonage non servi → pas d'appel grilles). */
function makeCity(slug: string, name: string, lotsServed: boolean): CityCoverage {
  return {
    citySlug: slug,
    cityName: name,
    mrc: null,
    priorityRank: null,
    l1Raw: { state: "absent", count: 0, freshness: "unknown" },
    l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
    signals: {
      state: "absent",
      count: 0,
      withCitation: 0,
      priority: 0,
      freshness: "unknown",
    },
    l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: {
      state: lotsServed ? "verified" : "absent",
      served: lotsServed,
      servedBy: lotsServed ? "geo" : null,
      freshness: lotsServed ? "fresh" : "unknown",
    },
    lotFields: { state: "absent", freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus: lotsServed ? "declared" : "absent",
    nextMarginalGain: null,
  };
}

/** Réponse cohérence PAR DÉFAUT des tests hors-sujet : aucun snapshot (honnête). */
const EMPTY_CONSISTENCY = { generatedAt: null, cities: [] };

/**
 * Stub fetch : sert le payload lot-fields donné, compte les appels. Sert
 * aussi `/api/source/consistency` (fetch systématique de SourceScorecard,
 * WP3 LOT1) avec un snapshot vide par défaut — ces tests portent sur les
 * champs lot, pas sur la cohérence.
 */
function stubLotFieldsFetch(payload: CityLotFields) {
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/lot-fields")) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/source/consistency")) {
      return new Response(JSON.stringify(EMPTY_CONSISTENCY), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`appel réseau inattendu : ${url}`);
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

/** Attend la résolution du fetch lazy (microtâches + re-render Svelte). */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("SourceScorecard — champs lot enrichis (tri-état + % honnête)", () => {
  it("ville enrichie : 100 % affichés par champ, normes partielles honnêtes, méthode déclarée", async () => {
    stubLotFieldsFetch({
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
    });

    const { getByTestId } = render(SourceScorecard, {
      props: { city: makeCity("delson", "Delson", true) },
    });
    await flush();

    const block = getByTestId("scorecard-lot-fields");
    const superficie = within(block).getByTestId("lot-field-superficie");
    expect(superficie.textContent).toContain("Superficie");
    expect(superficie.textContent).toContain("100 % des lots");
    expect(superficie.textContent).toContain("Servi");

    expect(
      within(block).getByTestId("lot-field-adresse").textContent,
    ).toContain("100 % des lots");
    expect(
      within(block).getByTestId("lot-field-code-postal").textContent,
    ).toContain("100 % des lots");

    // Normes partielles : % réel + « Partiel » — jamais « Servi » fabriqué.
    const normes = within(block).getByTestId("lot-field-normes");
    expect(normes.textContent).toContain("70 % des lots");
    expect(normes.textContent).toContain("Partiel");
    expect(normes.textContent).not.toContain("Servi");

    // Méthode DÉCLARÉE : échantillon, jamais présenté comme exhaustif.
    expect(block.textContent).toContain("échantillon de 450 lots");
  });

  it("ville non enrichie (Mont-Tremblant-like) : « 0 % — non enrichi » sur les 4 champs", async () => {
    stubLotFieldsFetch({
      citySlug: "mont-tremblant",
      available: true,
      totalLots: 9000,
      sampleSize: 450,
      sampled: true,
      fields: {
        superficie: { count: 0, pct: 0, state: "absent" },
        adresse: { count: 0, pct: 0, state: "absent" },
        codePostal: { count: 0, pct: 0, state: "absent" },
        normes: { count: 0, pct: 0, state: "absent" },
      },
      state: "absent",
    });

    const { getByTestId } = render(SourceScorecard, {
      props: { city: makeCity("mont-tremblant", "Mont-Tremblant", true) },
    });
    await flush();

    const block = getByTestId("scorecard-lot-fields");
    for (const key of ["superficie", "adresse", "code-postal", "normes"]) {
      const row = within(block).getByTestId(`lot-field-${key}`);
      expect(row.textContent).toContain("0 % — non enrichi");
      expect(row.textContent).toContain("Non couvert");
    }
  });

  it("lots non servis : « aucune donnée », aucun appel réseau lot-fields", async () => {
    // La cohérence E2E (WP3 LOT1) fait TOUJOURS un fetch batch au montage
    // (indépendant de l'état lots) — seul l'appel /lot-fields doit être absent.
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/source/consistency")) {
        return new Response(JSON.stringify(EMPTY_CONSISTENCY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`appel réseau inattendu : ${url}`);
    });
    vi.stubGlobal("fetch", fetchStub);

    const { getByTestId } = render(SourceScorecard, {
      props: { city: makeCity("ville-sans-lots", "Ville Sans Lots", false) },
    });
    await flush();

    expect(getByTestId("scorecard-lot-fields").textContent).toContain(
      "aucune donnée",
    );
    expect(
      fetchStub.mock.calls.some((call) => String(call[0]).includes("/lot-fields")),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP3 LOT1 — section « Cohérence E2E » (lane SÉPARÉE de la couverture, 2e
// badge). Verrouille : ville mesurée (focus-30) affiche les 2 arêtes E0/E1 +
// fraîcheur batch ; ville SANS snapshot -> « Non mesuré » honnête (jamais un
// faux 0/100 %), jamais « Non couvert » (réservé à la couverture).
// ─────────────────────────────────────────────────────────────────────────────
describe("SourceScorecard — Cohérence E2E (WP3 LOT1)", () => {
  /** Stub fetch dédié à la section cohérence (aucun appel lot-fields/grilles attendu ici). */
  function stubConsistencyFetch(
    body: { generatedAt: string | null; cities: Array<{ citySlug: string; consistency: unknown }> },
  ) {
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/source/consistency")) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`appel réseau inattendu : ${url}`);
    });
    vi.stubGlobal("fetch", fetchStub);
    return fetchStub;
  }

  it("ville focus-30 mesurée (coherent) : 2 arêtes + fraction fiable + fraîcheur batch PG", async () => {
    stubConsistencyFetch({
      generatedAt: "2026-07-05T00:00:00.000Z",
      cities: [
        {
          citySlug: "mont-tremblant",
          consistency: {
            citySlug: "mont-tremblant",
            mode: "batch-pg",
            generatedAt: "2026-07-05T00:00:00.000Z",
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
          },
        },
      ],
    });

    const { getByTestId } = render(SourceScorecard, {
      props: { city: makeCity("mont-tremblant", "Mont-Tremblant", true) },
    });
    await flush();

    const block = getByTestId("scorecard-consistency");
    expect(block.textContent).toContain("Cohérence E2E");
    expect(getByTestId("consistency-state-badge").textContent).toContain("Cohérent");
    expect(getByTestId("consistency-pv-signal").textContent).toContain("20/20");
    expect(getByTestId("consistency-signal-zone").textContent).toContain("9/10");
    expect(getByTestId("consistency-signal-zone").textContent).toContain("67 %");
    expect(getByTestId("consistency-freshness").textContent).toContain("batch PG");
    expect(block.textContent).not.toContain("Non couvert");
  });

  it("ville SANS snapshot : « Non mesuré » honnête, jamais un faux 0/100 %", async () => {
    stubConsistencyFetch({ generatedAt: null, cities: [] });

    const { getByTestId } = render(SourceScorecard, {
      props: { city: makeCity("ville-hors-focus30", "Ville Hors Focus 30", false) },
    });
    await flush();

    const block = getByTestId("scorecard-consistency");
    expect(getByTestId("consistency-state-badge").textContent).toContain("Non mesuré");
    expect(getByTestId("consistency-pv-signal").textContent).toContain("non mesuré");
    expect(getByTestId("consistency-signal-zone").textContent).toContain("non mesuré");
    expect(getByTestId("consistency-freshness").textContent).toContain(
      "aucun snapshot pour cette ville",
    );
    expect(block.textContent).not.toContain("Non couvert");
    expect(block.textContent).not.toContain("100 %");
  });

  it("bloqueur : ligne dédiée affichée quand la ville en a au moins un", async () => {
    stubConsistencyFetch({
      generatedAt: "2026-07-05T00:00:00.000Z",
      cities: [
        {
          citySlug: "sutton",
          consistency: {
            citySlug: "sutton",
            mode: "batch-pg",
            generatedAt: "2026-07-05T00:00:00.000Z",
            state: "partial",
            edges: {
              pvSignal: { num: 8, denom: 10, rate: 0.8, status: "measured" },
              signalZone: {
                num: 0,
                denom: 0,
                rate: null,
                status: "non_mesure",
                reliableNum: 0,
                reliableRate: null,
                applicability: { num: 0, denom: 10, rate: 0, status: "measured" },
              },
            },
            blockers: ["Signal sans citation", "PG non pullé"],
          },
        },
      ],
    });

    const { getByTestId } = render(SourceScorecard, {
      props: { city: makeCity("sutton", "Sutton", false) },
    });
    await flush();

    expect(getByTestId("consistency-state-badge").textContent).toContain("À qualifier");
    expect(getByTestId("consistency-blocker").textContent).toContain("Signal sans citation");
    expect(getByTestId("consistency-blocker").textContent).toContain("PG non pullé");
  });
});
