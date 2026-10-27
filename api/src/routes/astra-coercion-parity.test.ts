import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z as bundledV3 } from "zod/v3";
import { scopedLotReadsRoute } from "./scoped-lot-reads.js";
import { readLotHistory, readLotSourceHistory } from "../services/facets/lots/lot-history.js";

vi.mock("../services/facets/lots/lot-history.js", () => ({
  readLotHistory: vi.fn(async () => ({ items: [] })),
  readLotSourceHistory: vi.fn(async () => ({ items: [] })),
}));
const z3: typeof bundledV3 = process.env.ZOD3_REFERENCE
  ? (await import(/* @vite-ignore */ process.env.ZOD3_REFERENCE)).z : bundledV3;
const previous = z3.object({ offset: z3.coerce.number().int().min(0).default(0),
  limit: z3.coerce.number().int().min(1).max(100).default(20) });
describe("Astra historical HTTP pagination coercion", () => {
  for (const endpoint of ["history", "source-history"]) {
    for (const field of ["offset", "limit"]) {
      for (const value of ["", "-1.5", "0.5", "0", "20", "100", "100.5", "1e20"]) {
        it("preserves " + endpoint + " " + field + "=" + value, async () => {
          vi.clearAllMocks();
          const app = new Hono();
          app.use("*", async (c, next) => { c.set("session" as never, { sub: "user" } as never); await next(); });
          app.route("/", scopedLotReadsRoute({ db: {} } as Parameters<typeof scopedLotReadsRoute>[0]));
          const params = new URLSearchParams({ citySlug: "valleyfield", canonicalId: "lot",
            mode: "real", chainId: "chain", [field]: value });
          const expected = previous.safeParse({ [field]: value });
          const response = await app.request("/api/v1/workspaces/11111111-1111-1111-1111-111111111111/lot-facets/"
            + endpoint + "?" + params);
          expect(response.status).toBe(expected.success ? 200 : 400);
          expect(await response.json()).toEqual(expected.success
            ? { ok: true, items: [] } : { error: "invalid_facet_command" });
          const reader = endpoint === "history" ? readLotHistory : readLotSourceHistory;
          if (expected.success) {
            expect(reader).toHaveBeenCalledOnce();
            expect(vi.mocked(reader).mock.calls[0]!.slice(-2)).toEqual([expected.data.offset, expected.data.limit]);
          } else expect(reader).not.toHaveBeenCalled();
        });
      }
    }
  }
});
