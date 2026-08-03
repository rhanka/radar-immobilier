import { describe, it, expect, afterEach } from "vitest";
import { healthRoute } from "./health.js";

const ok = async () => ({ ok: true });
const fail = async () => ({ ok: false, detail: "down" });

describe("healthRoute", () => {
  afterEach(() => {
    delete process.env["GIT_SHA"];
  });

  it("GET /livez returns 200 WITHOUT probing dependencies (liveness must not be coupled to DB/S3)", async () => {
    // Even with both dependencies down, liveness stays green: a dependency
    // blip must never get the pod killed (crash-loop cause C2).
    const app = healthRoute({ checkDb: fail, checkObjectStore: fail });
    const res = await app.request("/livez");
    expect(res.status).toBe(200);
    // status stays "ok"; /livez now also carries the deployed build sha so the
    // CD deploy job can prove the rolled-out sha is actually SERVED.
    expect(await res.json()).toEqual({ status: "ok", sha: "unknown" });
  });

  it("GET /livez surfaces the injected GIT_SHA (served-build proof for CD)", async () => {
    process.env["GIT_SHA"] = "abc1234";
    const app = healthRoute({ checkDb: fail, checkObjectStore: fail });
    const res = await app.request("/livez");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", sha: "abc1234" });
  });

  it("GET /health returns 200 when both dependencies are healthy", async () => {
    const app = healthRoute({ checkDb: ok, checkObjectStore: ok });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("GET /health carries the deployed sha (public served-build proof — /health is the only API route nginx proxies)", async () => {
    process.env["GIT_SHA"] = "def5678";
    const app = healthRoute({ checkDb: ok, checkObjectStore: ok });
    const res = await app.request("/health");
    expect((await res.json()).sha).toBe("def5678");
  });

  it("GET /health returns 503 when a dependency is down (readiness signal)", async () => {
    const app = healthRoute({ checkDb: fail, checkObjectStore: ok });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe("degraded");
  });
});
