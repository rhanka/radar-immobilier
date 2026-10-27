import { describe, expect, it, vi } from "vitest";
import { z as bundledV3 } from "zod/v3";
import { scrapeStatusRoute } from "./scrape-status.js";
import { backlogRoute, createBacklogStore } from "./backlog.js";
import { readAll } from "../services/scrape-status/store.js";
import type { ObjectStore } from "../storage/object-store.js";

const z3: typeof bundledV3 = process.env.ZOD3_REFERENCE
  ? (await import(/* @vite-ignore */ process.env.ZOD3_REFERENCE)).z : bundledV3;
const base = { citySlug: "valleyfield", source: "conseils-municipaux",
  automation: "refresh", status: "todo", windowMonths: 6 };
function memoryStore() {
  const values = new Map<string, Uint8Array>();
  const store: ObjectStore = {
    get: async (key) => { const value = values.get(key); if (!value) throw Error("missing"); return value; },
    head: async (key) => values.has(key) ? { key } : null,
    list: async (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)),
    put: vi.fn(async (key, body) => {
      values.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
      return { key };
    }),
  };
  return store;
}
const endpoint = "/api/scrape-status/valleyfield/conseils-municipaux";
describe("Astra actual HTTP parity against Zod 3", () => {
  for (const lastRunAt of ["2026-10-27T12:30Z", "2024-02-29T00:00Z",
    "2026-02-29T12:30Z", "2026-10-27T24:00Z", "2026-10-27T12:30"]) {
    it("preserves stored timestamps and PUT response " + lastRunAt, async () => {
      const store = memoryStore();
      const item = { ...base, lastRunAt };
      const previous = z3.object({ lastRunAt: z3.string().datetime() }).safeParse({ lastRunAt });
      await store.put("state/valleyfield/conseils-municipaux.json", JSON.stringify(item));
      expect(await readAll(store)).toEqual(previous.success ? [item] : []);
      const response = await scrapeStatusRoute(store).request(endpoint, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(item),
      });
      expect(response.status).toBe(previous.success ? 200 : 400);
      expect(await response.json()).toEqual(previous.success ? { item, items: [item] }
        : { ok: false, error: "validation-failed", detail: previous.error.format() });
    });
  }
  for (const windowMonths of [-1.5, 0.5, 0, 1, 2 ** 53, 1e20]) {
    it("preserves complete integer HTTP response " + windowMonths, async () => {
      const store = memoryStore();
      const item = { ...base, windowMonths };
      const previous = z3.object({ windowMonths: z3.number().int().positive() }).safeParse({ windowMonths });
      const response = await scrapeStatusRoute(store).request(endpoint, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(item),
      });
      expect(response.status).toBe(previous.success ? 200 : 400);
      expect(await response.json()).toEqual(previous.success ? { item, items: [item] }
        : { ok: false, error: "validation-failed", detail: previous.error.format() });
      if (!previous.success) expect(store.put).not.toHaveBeenCalled();
    });
  }
  for (const lexeme of ["1e400", "-1e400"]) it("retains text type errors for raw exponent " + lexeme, async () => {
    const store = createBacklogStore();
    const add = vi.spyOn(store, "add");
    const app = backlogRoute(store, () => ({ available: true, items: [] }));
    const body = '{"titre":' + lexeme + '}';
    const previous = z3.object({ titre: z3.string().min(1) }).safeParse(JSON.parse(body));
    expect(previous.success).toBe(false);
    if (previous.success) throw Error("reference accepted a numeric title");
    const response = await app.request("/api/backlog/items", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request", details: previous.error.issues });
    expect(add).not.toHaveBeenCalled();
  });
});
