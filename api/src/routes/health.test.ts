import { describe, it, expect } from "vitest";
import { healthRoute } from "./health.js";

const ok = async () => ({ ok: true });
const fail = async () => ({ ok: false, detail: "down" });

describe("healthRoute", () => {
  it("GET /livez returns 200 WITHOUT probing dependencies (liveness must not be coupled to DB/S3)", async () => {
    // Even with both dependencies down, liveness stays green: a dependency
    // blip must never get the pod killed (crash-loop cause C2).
    const app = healthRoute({ checkDb: fail, checkObjectStore: fail });
    const res = await app.request("/livez");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /health returns 200 when both dependencies are healthy", async () => {
    const app = healthRoute({ checkDb: ok, checkObjectStore: ok });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("GET /health returns 503 when a dependency is down (readiness signal)", async () => {
    const app = healthRoute({ checkDb: fail, checkObjectStore: ok });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe("degraded");
  });
});
