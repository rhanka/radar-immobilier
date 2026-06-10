import { describe, expect, it } from "vitest";
import {
  cityMaturityColor,
  maturityLabel,
  groupByCity,
} from "./maturity.js";
import type { ScrapeStatusT } from "@radar/domain";

describe("cityMaturityColor", () => {
  it("returns slate for 0%", () => {
    expect(cityMaturityColor(0)).toBe("slate");
  });
  it("returns red for 1-24%", () => {
    expect(cityMaturityColor(10)).toBe("red");
    expect(cityMaturityColor(24)).toBe("red");
  });
  it("returns amber for 25-49%", () => {
    expect(cityMaturityColor(25)).toBe("amber");
    expect(cityMaturityColor(49)).toBe("amber");
  });
  it("returns teal for 50-99%", () => {
    expect(cityMaturityColor(50)).toBe("teal");
    expect(cityMaturityColor(99)).toBe("teal");
  });
  it("returns green for 100%", () => {
    expect(cityMaturityColor(100)).toBe("green");
  });
});

describe("maturityLabel", () => {
  it("labels tiers correctly", () => {
    expect(maturityLabel(0)).toBe("Aucune donnée");
    expect(maturityLabel(15)).toBe("Démarrage");
    expect(maturityLabel(40)).toBe("Partiel");
    expect(maturityLabel(75)).toBe("Avancé");
    expect(maturityLabel(100)).toBe("Complet");
  });
});

describe("groupByCity", () => {
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
      automation: "one_shot",
      status: "scraped",
      windowMonths: 6,
    },
    {
      citySlug: "beauharnois",
      source: "zonage",
      automation: "one_shot",
      status: "todo",
      windowMonths: 6,
    },
  ];

  it("groups items by citySlug", () => {
    const groups = groupByCity(items);
    expect(groups).toHaveLength(2);
    const vf = groups.find((g) => g.citySlug === "valleyfield");
    expect(vf?.items).toHaveLength(2);
    const bh = groups.find((g) => g.citySlug === "beauharnois");
    expect(bh?.items).toHaveLength(1);
  });

  it("computes maturity correctly per city", () => {
    const groups = groupByCity(items);
    const vf = groups.find((g) => g.citySlug === "valleyfield");
    // graphified=1.0, scraped=0.5 → avg = 0.75 → 75
    expect(vf?.maturity).toBe(75);
    const bh = groups.find((g) => g.citySlug === "beauharnois");
    expect(bh?.maturity).toBe(0);
  });
});
