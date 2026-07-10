/**
 * Tests unitaires load-zone-grid-raw.ts — WP3 LOT2 (E2 zone↔grille, batch OGC).
 *
 * Tout le réseau est mocké — 0 appel OGC live en CI. Couvre :
 *   - recall calc (codes communs Z∩G)
 *   - grille absente (404) -> gridCollectionFound=false
 *   - millésime disjoint (grille présente, 0 code commun)
 *   - staleZoningSource détecté sur la feature zonage (source/confidence)
 *   - retry sur échec réseau transitoire -> succès
 *   - échec persistant après retries -> measured:false (honnête, pas un throw)
 *   - espacement entre requêtes (anti-rafale)
 */
import { describe, expect, it, vi } from "vitest";
import { loadZoneGridRawInputs } from "./load-zone-grid-raw.js";

function itemsResponse(features: Array<{ id?: string; properties: Record<string, unknown> }>): Response {
  return new Response(JSON.stringify({ type: "FeatureCollection", features }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function notFoundResponse(): Response {
  return new Response(JSON.stringify({ code: "NotFound" }), { status: 404 });
}

describe("loadZoneGridRawInputs", () => {
  it("calcule le rappel (codes communs Z∩G) pour une ville avec zonage + grille", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("qc-zonage-norms-mont-tremblant")) {
        return itemsResponse([
          { properties: { zone_code: "ra-100" } },
          { properties: { zone_code: "ca-304" } },
        ]);
      }
      if (url.includes("qc-zonage-mont-tremblant")) {
        return itemsResponse([
          { properties: { zone_code: "RA-100" } },
          { properties: { zone_code: "TO-618-1" } },
        ]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await loadZoneGridRawInputs(["mont-tremblant"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestSpacingMs: 0,
    });

    const input = result.get("mont-tremblant");
    expect(input).toMatchObject({
      measured: true,
      zoneCodeCount: 2,
      gridCollectionFound: true,
      gridCodeCount: 2,
      matchedCodeCount: 1, // RA-100 commun (normalisé majuscules), TO-618-1 non couvert par la grille
    });
  });

  it("grille 404 -> gridCollectionFound=false, zoneCodeCount vient du zonage servi", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("qc-zonage-norms-saint-frederic")) return notFoundResponse();
      if (url.includes("qc-zonage-saint-frederic")) {
        return itemsResponse([{ properties: { zone_code: "A-1" } }]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await loadZoneGridRawInputs(["saint-frederic"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestSpacingMs: 0,
    });

    expect(result.get("saint-frederic")).toMatchObject({
      measured: true,
      zoneCodeCount: 1,
      gridCollectionFound: false,
      gridCodeCount: 0,
      matchedCodeCount: 0,
    });
  });

  it("millésime disjoint : grille présente avec codes mais AUCUN commun avec le zonage", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("qc-zonage-norms-rosemere")) {
        return itemsResponse([{ properties: { zone_code: "OLD-1" } }]);
      }
      if (url.includes("qc-zonage-rosemere")) {
        return itemsResponse([{ properties: { zone_code: "NEW-1" } }]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await loadZoneGridRawInputs(["rosemere"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestSpacingMs: 0,
    });

    expect(result.get("rosemere")).toMatchObject({
      measured: true,
      zoneCodeCount: 1,
      gridCollectionFound: true,
      gridCodeCount: 1,
      matchedCodeCount: 0,
    });
  });

  it("staleZoningSource=true quand une feature zonage porte une source 'Ancien_zonage'", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("qc-zonage-norms-mont-tremblant")) return itemsResponse([]);
      if (url.includes("qc-zonage-mont-tremblant")) {
        return itemsResponse([
          {
            properties: {
              zone_code: "RA-415-1",
              source:
                "https://services6.arcgis.com/x/arcgis/rest/services/Ancien_zonage/FeatureServer/1",
              confidence: "arcgis-zone-vector-ancien",
            },
          },
        ]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await loadZoneGridRawInputs(["mont-tremblant"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestSpacingMs: 0,
    });

    expect(result.get("mont-tremblant")?.staleZoningSource).toBe(true);
  });

  it("staleZoningSource=false sur une source normale (shp-mrc-*, contour-auto)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("qc-zonage-norms-saint-raymond")) return itemsResponse([]);
      if (url.includes("qc-zonage-saint-raymond")) {
        return itemsResponse([
          { properties: { zone_code: "AD-13", source: "shp-mrc-portneuf", confidence: "contour-auto" } },
        ]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await loadZoneGridRawInputs(["saint-raymond"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestSpacingMs: 0,
    });

    expect(result.get("saint-raymond")?.staleZoningSource).toBe(false);
  });

  it("retry : échec réseau transitoire puis succès -> ville mesurée normalement", async () => {
    let zonageCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("qc-zonage-norms-cowansville")) return itemsResponse([{ properties: { zone_code: "Z-1" } }]);
      if (url.includes("qc-zonage-cowansville")) {
        zonageCalls += 1;
        if (zonageCalls < 2) throw new Error("ECONNRESET");
        return itemsResponse([{ properties: { zone_code: "Z-1" } }]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await loadZoneGridRawInputs(["cowansville"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestSpacingMs: 0,
      retryBaseDelayMs: 0,
    });

    expect(zonageCalls).toBe(2);
    expect(result.get("cowansville")).toMatchObject({ measured: true, matchedCodeCount: 1 });
  });

  it("échec persistant après retries -> measured:false (honnête), n'interrompt pas les autres villes", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("levis")) throw new Error("réseau indisponible");
      if (url.includes("qc-zonage-norms-chelsea")) return itemsResponse([{ properties: { zone_code: "A" } }]);
      if (url.includes("qc-zonage-chelsea")) return itemsResponse([{ properties: { zone_code: "A" } }]);
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await loadZoneGridRawInputs(["levis", "chelsea"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestSpacingMs: 0,
      retryBaseDelayMs: 0,
      maxAttempts: 2,
    });

    expect(result.get("levis")).toMatchObject({ measured: false, zoneCodeCount: 0 });
    // La ville en échec n'empêche pas la mesure de la suivante.
    expect(result.get("chelsea")).toMatchObject({ measured: true, matchedCodeCount: 1 });
  });

  it("espace les requêtes (anti-rafale) — respecte requestSpacingMs entre appels", async () => {
    const fetchImpl = vi.fn(async () => itemsResponse([{ properties: { zone_code: "A" } }]));
    const start = Date.now();

    await loadZoneGridRawInputs(["ville-a"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestSpacingMs: 20,
    });

    // 2 requêtes (zonage + normes) -> au moins 2 espacements de 20 ms.
    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });
});
