import { describe, expect, it, vi } from "vitest";
import {
  NORMATIVE_VALUE_KEYS,
  REGLEMENT_KEYS,
  hasRecognizedValue,
  loadGeoFeatureCollection,
  measureNormesCoverage,
  normalizeNormValue,
} from "./normes-keys.js";

describe("normes-keys", () => {
  it("uses the exact regulation allowlist from the wire contract", () => {
    expect(REGLEMENT_KEYS).toEqual([
      "reglement_url",
      "reglement_numero",
      "reglement_millesime",
      "reglement_page_source",
      "Reglement",
      "REGLEMENT",
      "url_reglement",
      "URL_REGLEMENT",
    ]);
    expect(NORMATIVE_VALUE_KEYS).toContain("densite_value");
    expect(NORMATIVE_VALUE_KEYS).toContain("hauteur_min_value");
  });

  it("normalizes scalar and array evidence without inventing values", () => {
    expect(normalizeNormValue(" 35,5 ")).toBe(35.5);
    expect(normalizeNormValue([null, " 12 "])).toBe(12);
    expect(normalizeNormValue("R-901")).toBe("R-901");
    expect(normalizeNormValue(0)).toBe(0);

    for (const value of [null, undefined, " ", false, {}, Number.NaN]) {
      expect(normalizeNormValue(value)).toBeNull();
    }
  });

  it("only accepts non-empty values on allowlisted keys", () => {
    expect(
      hasRecognizedValue(
        { reglement_url: "https://example.test/r-901.pdf" },
        REGLEMENT_KEYS,
      ),
    ).toBe(true);
    expect(
      hasRecognizedValue({ densite_value: [null, "35"] }, NORMATIVE_VALUE_KEYS),
    ).toBe(true);
    expect(
      hasRecognizedValue({ reglement_url: " ", other: "35" }, REGLEMENT_KEYS),
    ).toBe(false);
  });

  it("joins normalized explicit codes and counts duplicate served features", () => {
    const counters = measureNormesCoverage(
      [
        {
          properties: {
            zone_code: "H 2",
            URL_GRILLE: "https://x/grille.pdf",
            usages: ["h1"],
          },
        },
        { properties: { zone_code: "h–2" } },
        { properties: { zone_code: "C-3" } },
      ],
      [
        { properties: { zone_code: "H-2", reglement_url: "https://x/r.pdf" } },
        { properties: { zone_code: "h 2", reglement_numero: "901" } },
        { properties: { zone_code: "C–3", densite_value: 35 } },
        { properties: { zone_code: "X-9", densite_value: 99 } },
      ],
    );

    expect(counters).toEqual({
      zonesWithGrille: 1,
      zonesWithReglement: 2,
      zonesWithLegacyNormes: 1,
      zonesWithNormativeValues: 1,
      covered: 3,
    });
  });

  it("never treats a shared opaque feature id as zone-code evidence", () => {
    expect(
      measureNormesCoverage(
        [{ id: "shared", properties: { zone_code: "H-1" } }],
        [{ id: "shared", properties: { reglement_url: "https://x/r.pdf" } }],
      ),
    ).toMatchObject({ zonesWithReglement: 0, covered: 0 });
  });

  it("merges duplicate auxiliary flags before counting duplicate served features", () => {
    const counters = measureNormesCoverage(
      [
        { properties: { zone_code: "H-1" } },
        { properties: { zone_code: "h–1" } },
      ],
      [
        { properties: { zone_code: "H-1", Reglement: "901" } },
        { properties: { zone_code: "H–1", hauteur_max_value: 12 } },
        { properties: { zone_code: "h-1", URL_GRILLE: "https://x/grid.pdf" } },
      ],
    );

    expect(counters).toEqual({
      zonesWithGrille: 2,
      zonesWithReglement: 2,
      zonesWithLegacyNormes: 0,
      zonesWithNormativeValues: 2,
      covered: 2,
    });
  });

  it("distinguishes incomplete pages, missing collections and invalid payloads", async () => {
    const page = await loadGeoFeatureCollection(
      "https://geo.test",
      "qc-zonage-ville",
      1,
      vi.fn(async () =>
        new Response(JSON.stringify({ features: [{}] }), {
          headers: { "content-type": "application/json" },
        }),
      ) as unknown as typeof fetch,
    );
    expect(page).toMatchObject({ ok: true, complete: false, numberMatched: null });

    const missing = await loadGeoFeatureCollection(
      "https://geo.test",
      "qc-zonage-ville",
      10,
      vi.fn(async () => new Response("{}", { status: 404 })) as unknown as typeof fetch,
    );
    expect(missing).toMatchObject({ ok: true, found: false, complete: true });

    const invalid = await loadGeoFeatureCollection(
      "https://geo.test",
      "qc-zonage-ville",
      10,
      vi.fn(async () => new Response("{}")) as unknown as typeof fetch,
    );
    expect(invalid).toEqual({ ok: false, error: "invalid_response" });
  });
});
