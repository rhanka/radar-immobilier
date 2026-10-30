import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { cutoverProbeRoute } from "./cutover-probe.js";
import { handleAppError } from "../lifecycle/maintenance.js";

const TOKEN = "t".repeat(32);
function app(execute: () => Promise<unknown>, enabled = true): Hono {
  const a = new Hono();
  a.onError(handleAppError);
  a.route("/", cutoverProbeRoute({ enabled, token: TOKEN, db: { execute } as never }));
  return a;
}
const post = (a: Hono, body: unknown, token = TOKEN) => a.request("/api/internal/cutover-probe", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("cutover writer probe", () => {
  it("acknowledges a write with the database that stored it", async () => {
    const res = await post(app(async () => ({ rows: [{ db: "radar_next" }] })), { run: "rehearsal-1", seq: 7 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, db: "radar_next" });
  });

  it("stays closed when disabled, refuses a wrong token and invalid input", async () => {
    const execute = async () => ({ rows: [{ db: "radar" }] });
    expect((await post(app(execute, false), { run: "r", seq: 1 })).status).toBe(404);
    expect((await post(app(execute), { run: "r", seq: 1 }, "x".repeat(32))).status).toBe(401);
    expect((await post(app(execute), { run: "Bad Run", seq: 1 })).status).toBe(400);
    expect((await post(app(execute), { run: "r", seq: -1 })).status).toBe(400);
  });

  it("answers an explicit 503 while the database is frozen", async () => {
    const frozen = app(async () => { throw Object.assign(new Error("read-only"), { code: "25006" }); });
    const res = await post(frozen, { run: "r", seq: 2 });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "maintenance_read_only" });
  });
});
