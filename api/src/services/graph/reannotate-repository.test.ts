import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/client.js";
import {
  DEFAULT_REANNOTATION_STATEMENT_TIMEOUT_MS,
  REANNOTATION_LIST_STATEMENT_TIMEOUT_MS,
  withReannotationDb,
} from "./reannotate-db.js";
import { createReannotationRepository } from "./reannotate-repository.js";

function createFakeDb(
  handler: (text: string, values: unknown[] | undefined, rowMode?: string) => { rows: unknown[] },
) {
  const executed: Array<{ text: string; values: unknown[] | undefined }> = [];
  const connect = vi.fn(async () => ({
    on: vi.fn(),
    release: vi.fn(),
    query: vi.fn(async (
      sqlOrConfig: string | { text: string; values?: unknown[]; rowMode?: string },
      values?: unknown[],
    ) => {
      const text = typeof sqlOrConfig === "string" ? sqlOrConfig : sqlOrConfig.text;
      const params = values ?? (typeof sqlOrConfig === "string" ? undefined : sqlOrConfig.values);
      const rowMode = typeof sqlOrConfig === "string" ? undefined : sqlOrConfig.rowMode;
      executed.push({ text, values: params });
      if (text.startsWith("SET ")) return { rows: [] };
      return handler(text, params, rowMode);
    }),
  }));
  return { db: { $client: { connect } } as unknown as Database, executed, connect };
}

describe("withReannotationDb statement_timeout bounds", () => {
  it("uses 5s by default and honors an explicit list timeout", async () => {
    const fake = createFakeDb(() => ({ rows: [] }));
    await withReannotationDb(fake.db, undefined, async () => "ok");
    await withReannotationDb(fake.db, undefined, async () => "ok", {
      statementTimeoutMs: REANNOTATION_LIST_STATEMENT_TIMEOUT_MS,
    });
    const sets = fake.executed.filter((q) => q.text.startsWith("SET ")).map((q) => q.text);
    expect(sets).toEqual([
      `SET statement_timeout = '${DEFAULT_REANNOTATION_STATEMENT_TIMEOUT_MS}ms'`,
      "SET lock_timeout = '1s'",
      `SET statement_timeout = '${REANNOTATION_LIST_STATEMENT_TIMEOUT_MS}ms'`,
      "SET lock_timeout = '1s'",
    ]);
  });

  it("rejects out-of-range statementTimeoutMs before acquiring a connection", async () => {
    const fake = createFakeDb(() => ({ rows: [] }));
    await expect(withReannotationDb(fake.db, undefined, async () => "ok", { statementTimeoutMs: 0 }))
      .rejects.toThrow("statementTimeoutMs");
    await expect(withReannotationDb(fake.db, undefined, async () => "ok", { statementTimeoutMs: 120_001 }))
      .rejects.toThrow("statementTimeoutMs");
    expect(fake.connect).not.toHaveBeenCalled();
  });
});

describe("createReannotationRepository batched city listing", () => {
  it("enumerates distinct cities via loose index scan and fetches bounded batches in order", async () => {
    const batchCalls: string[][] = [];
    const fake = createFakeDb((text, values, rowMode) => {
      if (text.includes("WITH RECURSIVE cities")) {
        return { rows: [{ city_slug: "alma" }, { city_slug: "bromont" }, { city_slug: "drummondville" }] };
      }
      const cities = (values ?? []).filter((v): v is string =>
        v === "alma" || v === "bromont" || v === "drummondville");
      batchCalls.push(cities);
      return {
        rows: cities.map((city) => rowMode === "array"
          ? [city, `sig-${city}`, "Signal", `Label ${city}`, {}, null]
          : { city_slug: city, id: `sig-${city}`, type: "Signal", label: `Label ${city}`, props: {}, source_ref: null }),
      };
    });
    const repo = createReannotationRepository(fake.db, undefined, { cityBatchSize: 2 });
    const rows = await repo.list(new Date("2026-10-20T00:00:00.000Z"));

    expect(batchCalls).toEqual([["alma", "bromont"], ["drummondville"]]);
    expect(rows.map((r) => `${r.citySlug}:${r.id}`)).toEqual([
      "alma:sig-alma",
      "bromont:sig-bromont",
      "drummondville:sig-drummondville",
    ]);
    const timeouts = fake.executed
      .filter((q) => q.text.startsWith("SET statement_timeout"))
      .map((q) => q.text);
    expect(timeouts).toEqual([
      `SET statement_timeout = '${REANNOTATION_LIST_STATEMENT_TIMEOUT_MS}ms'`,
      `SET statement_timeout = '${REANNOTATION_LIST_STATEMENT_TIMEOUT_MS}ms'`,
      `SET statement_timeout = '${REANNOTATION_LIST_STATEMENT_TIMEOUT_MS}ms'`,
    ]);
  });

  it("short-circuits when no cities exist or when scoped nodeIds is empty", async () => {
    const emptyFake = createFakeDb(() => ({ rows: [] }));
    const repo = createReannotationRepository(emptyFake.db);
    expect(await repo.list(new Date("2026-10-20T00:00:00.000Z"))).toEqual([]);
    expect(emptyFake.connect).toHaveBeenCalledTimes(1);

    const scopedFake = createFakeDb(() => ({ rows: [] }));
    const scopedRepo = createReannotationRepository(scopedFake.db, { citySlug: "alma", nodeIds: [] });
    expect(await scopedRepo.list(new Date("2026-10-20T00:00:00.000Z"))).toEqual([]);
    expect(scopedFake.connect).not.toHaveBeenCalled();
  });

  it("stops between city batches when the abort signal fires", async () => {
    const controller = new AbortController();
    let batches = 0;
    const fake = createFakeDb((text) => {
      if (text.includes("WITH RECURSIVE cities")) {
        return { rows: [{ city_slug: "alma" }, { city_slug: "bromont" }, { city_slug: "drummondville" }] };
      }
      batches++;
      controller.abort(new Error("cancelled"));
      return { rows: [] };
    });
    const repo = createReannotationRepository(fake.db, undefined, { cityBatchSize: 1 });
    await expect(repo.list(new Date("2026-10-20T00:00:00.000Z"), controller.signal)).rejects.toThrow("cancelled");
    expect(batches).toBe(1);
  });

  it("rejects invalid cityBatchSize values", () => {
    const fake = createFakeDb(() => ({ rows: [] }));
    expect(() => createReannotationRepository(fake.db, undefined, { cityBatchSize: 0 })).toThrow("cityBatchSize");
    expect(() => createReannotationRepository(fake.db, undefined, { cityBatchSize: 501 })).toThrow("cityBatchSize");
  });
});
