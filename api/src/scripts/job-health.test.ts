/**
 * job-health.test.ts — the worker-live two-axis exit/warn verdict. Regression
 * cover for the nightly CronJob failing every run: per-city source errors
 * (unreachable / 4xx — ~87 of ~528 cities) are TOLERABLE data-quality events and
 * must exit 0; only a SYSTEMIC failure exits 1 — the RECUEIL axis (fetch-error
 * rate at/above maxErrorRate) or the EXPLOITATION axis (pdftotext missing, or a
 * PG feed expected yet 0 upserts despite cities fetched). A separate WARN tier
 * (normal / elevated) surfaces degradation without failing the Job.
 */
import { describe, expect, it } from "vitest";

import { assessJobHealth } from "./job-health.js";

// A clean baseline; each test overrides only the axis it exercises.
const base = {
  errorCount: 0,
  cityCount: 528,
  maxErrorRate: 0.9,
  elevatedWarnRate: 0.5,
  exploitRequested: false,
  feedExpected: false,
  upserted: 0,
  pdftotextAvailable: true,
} as const;

describe("assessJobHealth", () => {
  it("cityCount 0 → 0 / none (no cities processed, not a failure)", () => {
    expect(assessJobHealth({ ...base, cityCount: 0 })).toEqual({
      code: 0,
      warn: "none",
      reason: "no cities processed",
    });
  });

  it("clean run (0 errors) → 0 / none", () => {
    const h = assessJobHealth({ ...base, errorCount: 0 });
    expect(h.code).toBe(0);
    expect(h.warn).toBe("none");
    expect(h.reason).toBe("clean run");
  });

  it("observed 87/528 (maxRate .9, warnRate .5) → 0 / normal (tolerated)", () => {
    const h = assessJobHealth({ ...base, errorCount: 87, cityCount: 528 });
    expect(h.code).toBe(0);
    expect(h.warn).toBe("normal");
    expect(h.reason).toMatch(/tolerated/);
  });

  it("300/528 (~57%) → 0 / elevated (alertable degradation, not fatal)", () => {
    const h = assessJobHealth({ ...base, errorCount: 300, cityCount: 528 });
    expect(h.code).toBe(0);
    expect(h.warn).toBe("elevated");
    expect(h.reason).toMatch(/elevated fetch-error rate/);
  });

  it("500/528 (~95%) → 1 (systemic RECUEIL fetch failure)", () => {
    const h = assessJobHealth({ ...base, errorCount: 500, cityCount: 528 });
    expect(h.code).toBe(1);
    expect(h.reason).toMatch(/systemic fetch failure/);
  });

  it("boundary: fetch rate exactly == maxErrorRate → 1 (>= is inclusive)", () => {
    const h = assessJobHealth({ ...base, errorCount: 9, cityCount: 10, maxErrorRate: 0.9 });
    expect(h.code).toBe(1);
    expect(h.reason).toMatch(/systemic fetch failure/);
  });

  it("EXPLOITATION axis: exploit requested but pdftotext missing → 1 (misconfigured image)", () => {
    const h = assessJobHealth({
      ...base,
      errorCount: 0,
      cityCount: 10,
      exploitRequested: true,
      pdftotextAvailable: false,
    });
    expect(h.code).toBe(1);
    // Fetch axis is clean, so warn is 'none' — the two axes are independent.
    expect(h.warn).toBe("none");
    expect(h.reason).toMatch(/pdftotext/);
  });

  it("EXPLOITATION axis: feed expected, cities fetched, 0 upserted → 1 (broken write path)", () => {
    const h = assessJobHealth({
      ...base,
      errorCount: 0,
      cityCount: 10,
      exploitRequested: true,
      feedExpected: true,
      upserted: 0,
      pdftotextAvailable: true,
    });
    expect(h.code).toBe(1);
    expect(h.reason).toMatch(/produced nothing/);
  });

  it("feed expected WITH upserts > 0 → NOT the 0-upsert systemic (falls through to tier)", () => {
    const h = assessJobHealth({
      ...base,
      errorCount: 87,
      cityCount: 528,
      exploitRequested: true,
      feedExpected: true,
      upserted: 400,
      pdftotextAvailable: true,
    });
    expect(h.code).toBe(0);
    expect(h.warn).toBe("normal");
    expect(h.reason).toMatch(/tolerated/);
  });

  it("exploitRequested false → EXPLOITATION axis skipped (pdftotext absence is irrelevant)", () => {
    const h = assessJobHealth({
      ...base,
      errorCount: 0,
      cityCount: 10,
      exploitRequested: false,
      pdftotextAvailable: false,
    });
    expect(h.code).toBe(0);
    expect(h.reason).toBe("clean run");
  });

  it("feedExpected false → 0 upserts is NOT fatal (S3-only scrape job)", () => {
    const h = assessJobHealth({
      ...base,
      errorCount: 0,
      cityCount: 10,
      exploitRequested: true,
      feedExpected: false,
      upserted: 0,
      pdftotextAvailable: true,
    });
    expect(h.code).toBe(0);
    expect(h.reason).toBe("clean run");
  });
});
