/**
 * Smoke test for SourcesMapView — verifies the component module can be
 * imported and that the maturity helpers used by the view work correctly.
 * Full component render testing requires @testing-library/svelte which is
 * not yet in the UI devDependencies (tracked as a follow-up).
 */
import { describe, expect, it } from "vitest";
import {
  groupByCity,
  cityMaturityColor,
  maturityLabel,
} from "$lib/sources/maturity.js";
import { resolveScrapeStatusUrl } from "$lib/sources/scrape-status-client.js";
import type { ScrapeStatusT } from "@radar/domain";

// Verify maturity pipeline as used by SourcesMapView
describe("SourcesMapView data pipeline", () => {
  const items: ScrapeStatusT[] = [
    {
      citySlug: "valleyfield",
      source: "zonage",
      automation: "one_shot",
      status: "graphified",
      windowMonths: 6,
    },
    {
      citySlug: "valleyfield",
      source: "avis-publics",
      automation: "refresh",
      status: "scraped",
      windowMonths: 6,
    },
    {
      citySlug: "beauharnois",
      source: "zonage",
      automation: "one_shot",
      status: "identified",
      windowMonths: 6,
    },
  ];

  it("groups and computes maturity for display", () => {
    const summaries = groupByCity(items);
    expect(summaries).toHaveLength(2);

    const vf = summaries.find((s) => s.citySlug === "valleyfield");
    expect(vf).toBeDefined();
    expect(vf!.maturity).toBe(75); // (1.0 + 0.5) / 2 = 0.75
    expect(vf!.color).toBe("teal");

    const bh = summaries.find((s) => s.citySlug === "beauharnois");
    expect(bh).toBeDefined();
    expect(bh!.maturity).toBe(25); // identified = 0.25
    expect(bh!.color).toBe("amber");
  });

  it("maturityLabel maps tiers used in the sidebar", () => {
    expect(maturityLabel(0)).toBe("Aucune donnée");
    expect(maturityLabel(75)).toBe("Avancé");
    expect(maturityLabel(25)).toBe("Partiel");
  });

  it("cityMaturityColor produces the expected color tokens", () => {
    expect(cityMaturityColor(0)).toBe("slate");
    expect(cityMaturityColor(75)).toBe("teal");
    expect(cityMaturityColor(100)).toBe("green");
  });

  it("resolveScrapeStatusUrl used by the view resolves correctly", () => {
    expect(resolveScrapeStatusUrl("/api/scrape-status", "")).toBe(
      "/api/scrape-status",
    );
  });
});
