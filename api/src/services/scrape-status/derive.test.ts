/**
 * Tests for scrape-status derivation service.
 *
 * Vérifie que :
 *   1. deriveStaticScrapeStatuses() retourne les statuts réels dérivés de
 *      ALL_PV_CITIES et des villes MAMH (anti-invention §0.2).
 *   2. deriveStaticScrapeStatuses() couvre les 1106 villes du Québec.
 *   3. mergeWithDerived() donne la priorité aux enregistrements stockés.
 *   4. GET /api/scrape-status/maturity retourne un score cohérent.
 *   5. GET /api/scrape-status/coverage retourne l'agrégat provincial (total=1106).
 */

import { describe, expect, it } from "vitest";
import type { ScrapeStatusT } from "@radar/domain";
import { ALL_PV_CITIES, QC_MUNICIPALITIES } from "@radar/sources";
import { deriveStaticScrapeStatuses, mergeWithDerived, deriveProvincialCoverage } from "./derive.js";
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
    async list(prefix) {
      return [...data.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveStaticScrapeStatuses
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveStaticScrapeStatuses()", () => {
  it("retourne QC_MUNICIPALITIES.length enregistrements conseils-municipaux (inventaire provincial)", () => {
    const records = deriveStaticScrapeStatuses();
    const pvRecords = records.filter((r) => r.source === "conseils-municipaux");
    // Inventaire provincial : 1 enregistrement CM par ville QC (1106)
    // + les villes ALL_PV_CITIES dont le slug ne correspond pas à QC_MUNICIPALITIES
    // (saint-damase, hemmingford) s'ajoutent aux 1106 QC → total > 1106
    // mais le test de cohérence principal est l'inventaire QC = 1106 CM records.
    expect(pvRecords.length).toBeGreaterThanOrEqual(ALL_PV_CITIES.length);
    expect(pvRecords.length).toBeGreaterThanOrEqual(QC_MUNICIPALITIES.length);
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

  it("inventaire provincial : couvre au moins QC_MUNICIPALITIES.length villes pour conseils-municipaux", () => {
    const records = deriveStaticScrapeStatuses();
    const cmRecords = records.filter((r) => r.source === "conseils-municipaux");
    // Le total CM = ALL_PV_CITIES (32) + villes QC non câblées + exclues.
    // Les villes PV dont le slug ne figure pas dans QC_MUNICIPALITIES s'ajoutent.
    // La somme finale doit couvrir les 1106 villes QC au minimum.
    expect(cmRecords.length).toBeGreaterThanOrEqual(QC_MUNICIPALITIES.length);
    expect(cmRecords.length).toBeGreaterThanOrEqual(1106);
  });

  it("villes câblées (ALL_PV_CITIES) ont status=scraped dans l'inventaire provincial", () => {
    const records = deriveStaticScrapeStatuses();
    for (const city of ALL_PV_CITIES) {
      const rec = records.find(
        (r) =>
          r.citySlug === city.config.citySlug &&
          r.source === "conseils-municipaux",
      );
      expect(rec).toBeDefined();
      expect(rec!.status).toBe("scraped");
    }
  });

  it("villes non câblées ont status=todo dans l'inventaire provincial", () => {
    const records = deriveStaticScrapeStatuses();
    const wiredSlugs = new Set(ALL_PV_CITIES.map((c) => c.config.citySlug));
    const nonWired = records.filter(
      (r) =>
        r.source === "conseils-municipaux" && !wiredSlugs.has(r.citySlug),
    );
    expect(nonWired.length).toBeGreaterThan(0);
    for (const rec of nonWired) {
      expect(rec.status).toBe("todo");
    }
  });

  it("villes exclues (Montréal, Laval) sont présentes avec status=todo et dataQuality=none", () => {
    const records = deriveStaticScrapeStatuses();
    const montreal = records.find(
      (r) => r.citySlug === "montreal" && r.source === "conseils-municipaux",
    );
    const laval = records.find(
      (r) => r.citySlug === "laval" && r.source === "conseils-municipaux",
    );
    // Les deux villes exclues doivent être présentes dans l'inventaire
    expect(montreal).toBeDefined();
    expect(montreal!.status).toBe("todo");
    expect(montreal!.dataQuality).toBe("none");
    expect(laval).toBeDefined();
    expect(laval!.status).toBe("todo");
    expect(laval!.dataQuality).toBe("none");
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

// ─────────────────────────────────────────────────────────────────────────────
// deriveProvincialCoverage
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveProvincialCoverage()", () => {
  it("total = 1106 (QC_MUNICIPALITIES.length)", () => {
    const records = deriveStaticScrapeStatuses();
    const coverage = deriveProvincialCoverage(records);
    expect(coverage.total).toBe(1106);
    expect(coverage.total).toBe(QC_MUNICIPALITIES.length);
  });

  it("byStatus.todo + byStatus.scraped + byStatus.graphified + byStatus.identified + byStatus.error = total", () => {
    const records = deriveStaticScrapeStatuses();
    const coverage = deriveProvincialCoverage(records);
    const sum =
      coverage.byStatus.todo +
      coverage.byStatus.identified +
      coverage.byStatus.scraped +
      coverage.byStatus.graphified +
      coverage.byStatus.error;
    expect(sum).toBe(coverage.total);
  });

  it("byStatus.scraped = nombre de villes PV dont le slug figure dans QC_MUNICIPALITIES", () => {
    const records = deriveStaticScrapeStatuses();
    const coverage = deriveProvincialCoverage(records);
    // Certaines villes ALL_PV_CITIES (ex : saint-damase, hemmingford) ont des slugs
    // qui ne correspondent pas exactement à QC_MUNICIPALITIES (ambiguïté de nom).
    // La couverture ne compte donc que les villes QC trouvées → ≤ ALL_PV_CITIES.length.
    const qcSlugs = new Set(QC_MUNICIPALITIES.map((m) => m.slug));
    const pvInQc = ALL_PV_CITIES.filter((c) => qcSlugs.has(c.config.citySlug)).length;
    expect(coverage.byStatus.scraped).toBe(pvInQc);
    expect(coverage.byStatus.scraped).toBeGreaterThan(0);
  });

  it("byStatus.todo décroît légitimement à mesure que les villes sont câblées", () => {
    const records = deriveStaticScrapeStatuses();
    const coverage = deriveProvincialCoverage(records);
    // Invariant structurel : todo + scraped + graphified + identified + error = total.
    // L'assertion "todo > 50%" n'est plus pertinente une fois la barre franchie
    // (jalon atteint ~2026-06 avec 500+ villes câblées sur 1106).
    // On vérifie à la place que todo est cohérent et positif (villes non câblées existent encore).
    const wiredInQc = coverage.byStatus.scraped + coverage.byStatus.graphified;
    const ratio = wiredInQc / coverage.total;
    if (ratio < 0.5) {
      // Moins de 50% câblées : la majorité reste todo.
      expect(coverage.byStatus.todo).toBeGreaterThan(coverage.total / 2);
    } else {
      // Plus de 50% câblées (jalon franchi) : todo recule mais reste > 0.
      expect(coverage.byStatus.todo).toBeGreaterThan(0);
      // Cohérence : todo ne peut pas dépasser le nombre de villes non câblées.
      expect(coverage.byStatus.todo).toBeLessThanOrEqual(coverage.total - wiredInQc);
    }
  });

  it("byMrc contient des clés MRC avec total, scraped, todo", () => {
    const records = deriveStaticScrapeStatuses();
    const coverage = deriveProvincialCoverage(records);
    const mrcKeys = Object.keys(coverage.byMrc);
    expect(mrcKeys.length).toBeGreaterThan(0);
    for (const key of mrcKeys) {
      const mrc = coverage.byMrc[key]!;
      expect(mrc.total).toBeGreaterThan(0);
      expect(mrc.scraped + mrc.todo).toBeLessThanOrEqual(mrc.total);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scrape-status/coverage
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/scrape-status/coverage", () => {
  it("retourne total=1106 et byStatus avec tous les compteurs", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/coverage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      byStatus: {
        todo: number;
        identified: number;
        scraped: number;
        graphified: number;
        error: number;
      };
      byMrc: Record<string, { total: number; scraped: number; todo: number }>;
    };
    expect(body.total).toBe(1106);
    expect(body.byStatus).toBeDefined();
    expect(typeof body.byStatus.todo).toBe("number");
    expect(typeof body.byStatus.scraped).toBe("number");
    expect(typeof body.byStatus.graphified).toBe("number");
    // scraped = villes PV dont le slug correspond à QC_MUNICIPALITIES (≤ ALL_PV_CITIES.length)
    expect(body.byStatus.scraped).toBeGreaterThan(0);
    expect(body.byStatus.scraped).toBeLessThanOrEqual(ALL_PV_CITIES.length);
    expect(body.byMrc).toBeDefined();
    expect(Object.keys(body.byMrc).length).toBeGreaterThan(0);
  });

  it("somme byStatus = total (cohérence comptage)", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/coverage");
    const body = (await res.json()) as {
      total: number;
      byStatus: {
        todo: number;
        identified: number;
        scraped: number;
        graphified: number;
        error: number;
      };
    };
    const sum =
      body.byStatus.todo +
      body.byStatus.identified +
      body.byStatus.scraped +
      body.byStatus.graphified +
      body.byStatus.error;
    expect(sum).toBe(body.total);
  });
});
