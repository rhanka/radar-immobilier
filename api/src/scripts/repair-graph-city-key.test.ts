/** GH #812 — CLI contract of repair-graph-city-key (pure parts). */
import { describe, expect, it } from "vitest";

import { parseArgs, summarize } from "./repair-graph-city-key.js";
import type { CityRepairReport } from "../services/graph/city-key-repair.js";

describe("repair-graph-city-key parseArgs", () => {
  it("defaults to preview with explicit cities", () => {
    const args = parseArgs(["gore", "barkmere"]);
    expect(args).toMatchObject({ apply: false, all: false, cities: ["gore", "barkmere"] });
  });
  it("accepts --all for the read-only measurement", () => {
    expect(parseArgs(["--all"])).toMatchObject({ all: true, apply: false, cities: [] });
  });
  it("refuses --apply with --all, an empty target list, and mixed --all + cities", () => {
    expect(parseArgs(["--apply", "--all"])).toEqual({ error: "--apply requires explicit cities (never --all)" });
    expect(parseArgs([])).toEqual({ error: "give city slugs or --all" });
    expect(parseArgs(["--all", "gore"])).toEqual({ error: "--all and explicit cities are exclusive" });
  });
  it("validates slugs and the run id", () => {
    expect(parseArgs(["Gore!"])).toHaveProperty("error");
    expect(parseArgs(["--run-id", "a b", "gore"])).toHaveProperty("error");
    expect(parseArgs(["--run-id", "r-1", "--apply", "gore"])).toMatchObject({ runId: "r-1", apply: true });
  });
});

describe("repair-graph-city-key summarize", () => {
  const base = (city: string, over: Partial<CityRepairReport>): CityRepairReport => ({
    city,
    mode: "preview",
    drift: { s3Nodes: 1, pgNodes: 1, idsMissingInPg: 0, idsNotInS3: 0, edgesMissingInPg: 0, edgesNotInS3: 0, edgesContentDiff: 0 },
    classes: { clean: 1, foreign: 0, unknown: 0 },
    foreignNodes: [],
    unknownNodes: [],
    before: { verdict: "pass" },
    verdict: "pass",
    applied: false,
    noop: true,
    ...over,
  });
  it("lists the cities to repair and the refused ones", () => {
    const summary = summarize(
      [
        base("ok", {}),
        base("gore", { noop: false, classes: { clean: 2, foreign: 1, unknown: 0 }, before: { verdict: "refused", gate: "gate3-source-ref", reason: "x" } }),
        base("mixed", { noop: false, verdict: "refused-unknown", classes: { clean: 0, foreign: 0, unknown: 1 } }),
        base("lossy", { noop: false, verdict: "refused-guard" }),
      ],
      { mode: "preview" },
    );
    expect(summary.needsRepair).toEqual(["gore", "mixed", "lossy"]);
    expect(summary.committed).toEqual([]);
    expect(summary.noop).toBe(1);
    expect(summary.refusedUnknown).toEqual(["mixed"]);
    expect(summary.refusedGuard).toEqual(["lossy"]);
    expect(summary.beforeRefused).toEqual(["gore"]);
    expect(summary.foreignNodes).toBe(1);
    expect(summary.citiesWithForeign).toBe(1);
  });
});
