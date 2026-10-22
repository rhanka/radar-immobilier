/**
 * 6K synthetic manifests: conflict-free and conflicted shapes.
 * Pure report construction; no database, no operational data.
 */
import { describe, expect, it } from "vitest";
import { cutoverTargetKey } from "./lot-project.js";
import {
  cleanCutoverReport,
  conflictedCutoverReport,
} from "./cutover-fixture.js";
import { cutoverImportKeyFor } from "./lot-cutover.js";

describe("6K synthetic cutover manifests", () => {
  it("should build a conflict-free manifest that needs no approval", () => {
    const { report, targetKeys } = cleanCutoverReport();
    expect(report.destinationsQualified).toBe(true);
    expect(report.counts.conflicts).toBe(0);
    expect(report.rows.length).toBeGreaterThan(0);
    expect(report.rows.every((row) => row.disposition === "mapped")).toBe(true);
    expect(targetKeys.length).toBeGreaterThan(0);
  });

  it("should build a conflicted manifest with one converged target", () => {
    const { report, conflictTargetKey, winnerSourceId, loserSourceId, mappedTargetKeys } =
      conflictedCutoverReport();
    expect(report.destinationsQualified).toBe(true);
    expect(report.counts.conflicts).toBeGreaterThan(0);
    const conflictRows = report.rows.filter((row) => row.disposition === "conflict");
    expect(conflictRows.length).toBe(2);
    expect(new Set(conflictRows.map((row) => cutoverTargetKey(row))).size).toBe(1);
    expect(cutoverTargetKey(conflictRows[0]!)).toBe(conflictTargetKey);
    const terminal = conflictRows.filter((row) =>
      (row.observed.supersededBy ?? null) === null && row.destination !== null);
    expect(terminal.map((row) => row.sourceId).sort())
      .toEqual([winnerSourceId, loserSourceId].sort());
    expect(conflictRows[0]!.diagnostics).toContain("heads-converged");
    expect(mappedTargetKeys.length).toBeGreaterThan(0);
    expect(mappedTargetKeys).not.toContain(conflictTargetKey);
  });

  it("should key destinations canonically and native fallbacks distinctly", () => {
    const { report } = conflictedCutoverReport();
    const mapped = report.rows.find((row) => row.disposition === "mapped")!;
    expect(cutoverTargetKey(mapped)).toMatch(/^dest:synthetic-6j-city::/);
  });

  it("should derive a deterministic, well-formed cutover import key", () => {
    const workspaceId = "6c000000-0000-4000-8000-000000000001";
    const first = cutoverImportKeyFor(workspaceId);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(cutoverImportKeyFor(workspaceId)).toBe(first);
    expect(cutoverImportKeyFor("6c000000-0000-4000-8000-000000000002")).not.toBe(first);
  });
});
