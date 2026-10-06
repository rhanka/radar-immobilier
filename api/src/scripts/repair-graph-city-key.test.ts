/** GH #812 — CLI contract of repair-graph-city-key (pure parts). */
import { describe, expect, it } from "vitest";

import { parseArgs, runRepair, summarize, terminationSummary, type Args, type RepairDeps } from "./repair-graph-city-key.js";
import type { Database } from "../db/client.js";
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
    drift: { s3Nodes: 1, pgNodes: 1, idsMissingInPg: 0, idsNotInS3: 0, nodesContentDiff: 0, edgesMissingInPg: 0, edgesNotInS3: 0, edgesContentDiff: 0 },
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

// Review A825-03 / SOL-825-01 / SOL-825-02: every requested city gets an outcome, and a run whose
// report cannot be uploaded is not green. No database work happens for unavailable cities, so a
// fake handle answering the PK precondition is enough.
describe("repair-graph-city-key runRepair outcomes", () => {
  const db = { execute: async () => ({ rows: [{ cols: ["city_slug", "id"] }] }) } as unknown as Database;
  const logger = { info: () => undefined, error: () => undefined };
  function deps(store: Partial<RepairDeps["store"]>, out: { termination?: string; puts: string[] }): RepairDeps {
    return {
      db,
      logger,
      store: {
        list: async () => ["graph/gore/latest.json"],
        get: async () => { throw new Error("unexpected get"); },
        put: async (key: string) => { out.puts.push(key); return { key } as never; },
        ...store,
      } as RepairDeps["store"],
      writeTermination: async (body) => { out.termination = body; },
    };
  }
  const args = (over: Partial<Args>): Args => ({ apply: true, all: false, cities: ["gore"], runId: "t", ...over });

  it("an explicitly requested city without latest.json fails the run (not-found)", async () => {
    const out = { puts: [] as string[] } as { termination?: string; puts: string[] };
    const missing = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    const code = await runRepair(args({}), deps({ get: async () => { throw missing; } }, out));
    expect(code).toBe(1);
    expect(JSON.parse(out.termination!).unavailable).toEqual(["gore:not-found"]);
    expect(out.puts).toEqual(["reports/graph-city-key/t/repair.json"]);
  });

  it("a storage read failure is reported as read-failed, distinct from not-found", async () => {
    const out = { puts: [] as string[] } as { termination?: string; puts: string[] };
    const denied = Object.assign(new Error("AccessDenied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    const code = await runRepair(args({}), deps({ get: async () => { throw denied; } }, out));
    expect(code).toBe(1);
    expect(JSON.parse(out.termination!).unavailable).toEqual(["gore:read-failed"]);
  });

  it("a latest.json that is not a graph is unavailable (unreadable)", async () => {
    const out = { puts: [] as string[] } as { termination?: string; puts: string[] };
    const code = await runRepair(args({}), deps({ get: async () => new TextEncoder().encode("{ not json") }, out));
    expect(code).toBe(1);
    expect(JSON.parse(out.termination!).unavailable).toEqual(["gore:unreadable"]);
  });

  it("a failed report upload fails the run and says so in the termination summary", async () => {
    const out = { puts: [] as string[] } as { termination?: string; puts: string[] };
    const code = await runRepair(args({ apply: false, all: true, cities: [] }),
      deps({ list: async () => [], put: async () => { throw new Error("AccessDenied"); } }, out));
    expect(code).toBe(1);
    const term = JSON.parse(out.termination!);
    expect(term.reportUploaded).toBe(false);
    expect(term.reportError).toContain("AccessDenied");
  });

  it("refuses to run before migration 0013 (exit 2)", async () => {
    const out = { puts: [] as string[] } as { termination?: string; puts: string[] };
    const old = { execute: async () => ({ rows: [{ cols: ["id"] }] }) } as unknown as Database;
    expect(await runRepair(args({}), { ...deps({}, out), db: old })).toBe(2);
    expect(out.puts).toEqual([]);
  });

  it("keeps the termination summary under 4 KiB with long city lists", () => {
    const many = Array.from({ length: 400 }, (_, i) => `city-with-a-long-slug-${i}`);
    const summary = summarize([], { mode: "apply", runId: "t" });
    const body = terminationSummary({ ...summary, committed: many, needsRepair: many }, { mode: "apply", runId: "t", reportKey: "k", reportUploaded: true });
    expect(body.length).toBeLessThanOrEqual(4000);
    expect(JSON.parse(body).committed.at(-1)).toMatch(/^…\+/);
  });
});
