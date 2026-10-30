import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { handleAppError, isMaintenanceError } from "./maintenance.js";

function appThrowing(error: unknown): Hono {
  const app = new Hono();
  app.onError(handleAppError);
  app.post("/write", () => { throw error; });
  return app;
}

describe("cutover freeze errors", () => {
  it("maps read-only (25006) and terminated (57P01) sessions to an explicit 503, through a cause chain", async () => {
    for (const code of ["25006", "57P01"]) {
      const wrapped = new Error("Failed query", { cause: Object.assign(new Error("db"), { code }) });
      expect(isMaintenanceError(wrapped)).toBe(true);
      const res = await appThrowing(wrapped).request("/write", { method: "POST" });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      expect(await res.json()).toEqual({ error: "maintenance_read_only" });
    }
  });

  it("keeps other errors as 500 and HTTP exceptions as their own response", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const other = await appThrowing(Object.assign(new Error("unique"), { code: "23505" })).request("/write", { method: "POST" });
    expect(other.status).toBe(500);
    quiet.mockRestore();
    const http = await appThrowing(new HTTPException(409, { message: "conflict" })).request("/write", { method: "POST" });
    expect(http.status).toBe(409);
  });
});
