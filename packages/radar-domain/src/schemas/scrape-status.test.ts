import { describe, expect, it } from "vitest";
import {
  ScrapeStatus,
  ScrapeStatusSource,
  cityMaturity,
  type ScrapeStatusT,
} from "./scrape-status.js";

describe("ScrapeStatus schema", () => {
  const minimal: ScrapeStatusT = {
    citySlug: "valleyfield",
    source: "conseils-municipaux",
    automation: "one_shot",
    status: "todo",
    windowMonths: 6,
  };

  it("accepts a minimal valid record", () => {
    expect(ScrapeStatus.safeParse(minimal).success).toBe(true);
  });

  it("accepts a full record", () => {
    const full: ScrapeStatusT = {
      citySlug: "valleyfield",
      source: "zonage",
      automation: "refresh",
      windowMonths: 6,
      status: "scraped",
      coveragePct: 80,
      lastRunAt: "2026-06-01T00:00:00Z",
      siteUrl: "https://example.com",
      dataQuality: "geojson",
      notes: "test",
    };
    expect(ScrapeStatus.safeParse(full).success).toBe(true);
  });

  it("rejects unknown source", () => {
    expect(
      ScrapeStatus.safeParse({ ...minimal, source: "unknown-src" }).success,
    ).toBe(false);
  });

  it("rejects coveragePct outside 0-100", () => {
    expect(
      ScrapeStatus.safeParse({ ...minimal, coveragePct: 150 }).success,
    ).toBe(false);
    expect(
      ScrapeStatus.safeParse({ ...minimal, coveragePct: -1 }).success,
    ).toBe(false);
  });

  it("defaults windowMonths to 6 for conseils-municipaux", () => {
    const input = {
      citySlug: "valleyfield",
      source: "conseils-municipaux",
      automation: "one_shot",
      status: "todo",
    };
    const parsed = ScrapeStatus.parse(input);
    expect(parsed.windowMonths).toBe(6);
  });

  it("ScrapeStatusSource enum has all 5 sources", () => {
    const sources = ScrapeStatusSource.options;
    expect(sources).toContain("conseils-municipaux");
    expect(sources).toContain("avis-publics");
    expect(sources).toContain("youtube-seances");
    expect(sources).toContain("zonage");
    expect(sources).toContain("role-evaluation");
    expect(sources).toHaveLength(5);
  });
});

describe("cityMaturity", () => {
  it("returns 0 for empty list", () => {
    expect(cityMaturity([])).toBe(0);
  });

  it("returns 0 for all-todo list", () => {
    const items: ScrapeStatusT[] = [
      {
        citySlug: "x",
        source: "zonage",
        automation: "one_shot",
        status: "todo",
        windowMonths: 6,
      },
    ];
    expect(cityMaturity(items)).toBe(0);
  });

  it("returns 100 for all-graphified list", () => {
    const items: ScrapeStatusT[] = [
      {
        citySlug: "x",
        source: "zonage",
        automation: "one_shot",
        status: "graphified",
        windowMonths: 6,
      },
      {
        citySlug: "x",
        source: "avis-publics",
        automation: "one_shot",
        status: "graphified",
        windowMonths: 6,
      },
    ];
    expect(cityMaturity(items)).toBe(100);
  });

  it("computes proportional maturity correctly", () => {
    // scraped = 0.5 weight, graphified = 1.0 weight
    // (0.5 + 1.0) / 2 = 0.75 → 75
    const items: ScrapeStatusT[] = [
      {
        citySlug: "x",
        source: "zonage",
        automation: "one_shot",
        status: "scraped",
        windowMonths: 6,
      },
      {
        citySlug: "x",
        source: "avis-publics",
        automation: "one_shot",
        status: "graphified",
        windowMonths: 6,
      },
    ];
    expect(cityMaturity(items)).toBe(75);
  });

  it("error status contributes 0", () => {
    const items: ScrapeStatusT[] = [
      {
        citySlug: "x",
        source: "zonage",
        automation: "one_shot",
        status: "error",
        windowMonths: 6,
      },
    ];
    expect(cityMaturity(items)).toBe(0);
  });

  it("identified status contributes 0.25", () => {
    const items: ScrapeStatusT[] = [
      {
        citySlug: "x",
        source: "zonage",
        automation: "one_shot",
        status: "identified",
        windowMonths: 6,
      },
    ];
    expect(cityMaturity(items)).toBe(25);
  });
});
