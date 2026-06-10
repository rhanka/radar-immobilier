/**
 * Tests for scrape-status derivation service.
 *
 * Vérifie que :
 *   1. deriveStaticScrapeStatuses() retourne les statuts réels dérivés de
 *      ALL_PV_CITIES et des villes MAMH (anti-invention §0.2).
 *   2. mergeWithDerived() donne la priorité aux enregistrements stockés.
 *   3. GET /api/scrape-status/maturity retourne un score cohérent.
 */

import { describe, expect, it } from "vitest";
import type { ScrapeStatusT } from "@radar/domain";
import { ALL_PV_CITIES } from "@radar/sources";
import { deriveStaticScrapeStatuses, mergeWithDerived } from "./derive.js";
import { scrapeStatusRoute } from "../../routes/scrape-status.js";
import type { ObjectStore } from "../../storage/object-store.js";

function makeMemStore(): ObjectStore {
  const data = new Map<string, Uint8Array>();
  return {
    async put(key, body) {
      const buf =
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : Buffer.isBuffer(body)
            ? new Uint8Array(body)
            : body;
      data.set(key, buf);
      return { key };
    },
    async get(key) {
      const val = data.get(key);
      if (!val) throw new Error(`not found: ${key}`);
      return val;
    },
    async head(key) {
      return data.has(key) ? { key } : null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveStaticScrapeStatuses
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveStaticScrapeStatuses()", () => {
  it("retourne au moins ALL_PV_CITIES.length enregistrements conseils-municipaux", () => {
    const records = deriveStaticScrapeStatuses();
    const pvRecords = records.filter((r) => r.source === "conseils-municipaux");
    expect(pvRecords.length).toBe(ALL_PV_CITIES.length);
  });

  it("chaque ville PV a status=scraped et dataQuality=pdf", () => {
    const records = deriveStaticScrapeStatuses();
    for (const city of ALL_PV_CITIES) {
      const rec = records.find(
        (r) =>
          r.citySlug === city.config.citySlug &&
          r.source === "conseils-municipaux",
      );
      expect(rec).toBeDefined();
      expect(rec!.status).toBe("scraped");
      expect(rec!.dataQuality).toBe("pdf");
      expect(rec!.automation).toBe("one_shot");
      expect(rec!.windowMonths).toBe(6);
    }
  });

  it("salaberry-de-valleyfield a avis-publics=graphified et role-evaluation=graphified", () => {
    const records = deriveStaticScrapeStatuses();
    const avis = records.find(
      (r) =>
        r.citySlug === "salaberry-de-valleyfield" && r.source === "avis-publics",
    );
    expect(avis).toBeDefined();
    expect(avis!.status).toBe("graphified");

    const role = records.find(
      (r) =>
        r.citySlug === "salaberry-de-valleyfield" &&
        r.source === "role-evaluation",
    );
    expect(role).toBeDefined();
    expect(role!.status).toBe("graphified");
  });

  it("beauharnois a avis-publics=graphified", () => {
    const records = deriveStaticScrapeStatuses();
    const avis = records.find(
      (r) => r.citySlug === "beauharnois" && r.source === "avis-publics",
    );
    expect(avis).toBeDefined();
    expect(avis!.status).toBe("graphified");
  });

  it("salaberry-de-valleyfield a zonage avec siteUrl (GeoSourceInventory)", () => {
    const records = deriveStaticScrapeStatuses();
    const zonage = records.find(
      (r) =>
        r.citySlug === "salaberry-de-valleyfield" && r.source === "zonage",
    );
    expect(zonage).toBeDefined();
    // Valleyfield has a pdf URL in GeoSourceInventory → identified
    expect(zonage!.status).toBe("identified");
    expect(zonage!.siteUrl).toBeDefined();
  });

  it("pas de doublon (citySlug × source unique)", () => {
    const records = deriveStaticScrapeStatuses();
    const keys = records.map((r) => `${r.citySlug}::${r.source}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("aucun statut ne dépasse la réalité (anti-invention)", () => {
    const records = deriveStaticScrapeStatuses();
    // PV cities must not be graphified in static derivation
    for (const city of ALL_PV_CITIES) {
      const rec = records.find(
        (r) =>
          r.citySlug === city.config.citySlug &&
          r.source === "conseils-municipaux",
      );
      if (rec) {
        expect(["scraped", "identified", "todo", "error"]).toContain(rec.status);
        expect(rec.status).not.toBe("graphified");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeWithDerived
// ─────────────────────────────────────────────────────────────────────────────

describe("mergeWithDerived()", () => {
  it("priorité aux enregistrements stored pour la même clé (citySlug × source)", () => {
    const stored: ScrapeStatusT[] = [
      {
        citySlug: "saint-constant",
        source: "conseils-municipaux",
        automation: "one_shot",
        windowMonths: 6,
        status: "graphified", // upgrade par un agent
        dataQuality: "pdf",
      },
    ];
    const merged = mergeWithDerived(stored);
    const rec = merged.find(
      (r) =>
        r.citySlug === "saint-constant" && r.source === "conseils-municipaux",
    );
    expect(rec).toBeDefined();
    // Le stored (graphified) doit primer sur le dérivé (scraped)
    expect(rec!.status).toBe("graphified");
  });

  it("inclut les enregistrements dérivés pour les villes non dans stored", () => {
    const stored: ScrapeStatusT[] = [];
    const merged = mergeWithDerived(stored);
    // All PV cities should appear
    for (const city of ALL_PV_CITIES) {
      const rec = merged.find(
        (r) =>
          r.citySlug === city.config.citySlug &&
          r.source === "conseils-municipaux",
      );
      expect(rec).toBeDefined();
    }
  });

  it("inclut les enregistrements stored supplémentaires (sources non dérivées)", () => {
    // youtube-seances is not in the static derivation
    const stored: ScrapeStatusT[] = [
      {
        citySlug: "saint-constant",
        source: "youtube-seances",
        automation: "refresh",
        windowMonths: 6,
        status: "identified",
      },
    ];
    const merged = mergeWithDerived(stored);
    const rec = merged.find(
      (r) =>
        r.citySlug === "saint-constant" && r.source === "youtube-seances",
    );
    expect(rec).toBeDefined();
    expect(rec!.status).toBe("identified");
  });

  it("pas de doublon après merge", () => {
    const stored: ScrapeStatusT[] = [
      {
        citySlug: "saint-constant",
        source: "conseils-municipaux",
        automation: "one_shot",
        windowMonths: 6,
        status: "graphified",
      },
    ];
    const merged = mergeWithDerived(stored);
    const pvRecords = merged.filter(
      (r) =>
        r.citySlug === "saint-constant" &&
        r.source === "conseils-municipaux",
    );
    expect(pvRecords).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scrape-status/maturity
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/scrape-status/maturity", () => {
  it("retourne une liste d'entrées avec citySlug, maturity, sourceCount", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/maturity");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { citySlug: string; maturity: number; sourceCount: number }[];
    };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(typeof item.citySlug).toBe("string");
      expect(item.maturity).toBeGreaterThanOrEqual(0);
      expect(item.maturity).toBeLessThanOrEqual(100);
      expect(item.sourceCount).toBeGreaterThan(0);
    }
  });

  it("salaberry-de-valleyfield a une maturité > 0 (multi-sources graphifiées)", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/maturity");
    const body = (await res.json()) as {
      items: { citySlug: string; maturity: number; sourceCount: number }[];
    };
    const valleyfield = body.items.find(
      (i) => i.citySlug === "salaberry-de-valleyfield",
    );
    expect(valleyfield).toBeDefined();
    // avis-publics + role-evaluation sont graphified → maturity > 0
    expect(valleyfield!.maturity).toBeGreaterThan(0);
  });

  it("les villes PV-only ont maturity > 0 (conseils-municipaux scraped = 50)", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/maturity");
    const body = (await res.json()) as {
      items: { citySlug: string; maturity: number; sourceCount: number }[];
    };
    // saint-constant is in ALL_PV_CITIES with scraped PV → maturity = 50
    const stConstant = body.items.find((i) => i.citySlug === "saint-constant");
    expect(stConstant).toBeDefined();
    expect(stConstant!.maturity).toBe(50);
    expect(stConstant!.sourceCount).toBe(1);
  });

  it("liste triée par citySlug", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/maturity");
    const body = (await res.json()) as {
      items: { citySlug: string; maturity: number; sourceCount: number }[];
    };
    const slugs = body.items.map((i) => i.citySlug);
    const sorted = [...slugs].sort((a, b) => a.localeCompare(b));
    expect(slugs).toEqual(sorted);
  });

  it("un agent peut upgrader un statut PV vers graphified (maturité monte)", async () => {
    const store = makeMemStore();
    const app = scrapeStatusRoute(store);

    // Agent upgrades saint-constant to graphified
    await app.request("/api/scrape-status/saint-constant/conseils-municipaux", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "saint-constant",
        source: "conseils-municipaux",
        automation: "one_shot",
        windowMonths: 6,
        status: "graphified",
        dataQuality: "pdf",
      }),
    });

    const res = await app.request("/api/scrape-status/maturity");
    const body = (await res.json()) as {
      items: { citySlug: string; maturity: number; sourceCount: number }[];
    };
    const stConstant = body.items.find((i) => i.citySlug === "saint-constant");
    expect(stConstant).toBeDefined();
    // graphified → maturity = 100 (100% of 1 source)
    expect(stConstant!.maturity).toBe(100);
  });
});
