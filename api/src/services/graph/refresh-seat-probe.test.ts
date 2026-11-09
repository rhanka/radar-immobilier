import { describe, expect, it } from "vitest";

import type { RefreshModel } from "./refresh-model-policy.js";
import { probeRefreshSeat } from "./refresh-seat-probe.js";

const primary: RefreshModel = { provider: "openai", model: "gpt-6-astra", effort: "medium" };
const fallback: RefreshModel = { provider: "gemini", model: "gemini-3.8-flash", effort: "low" };

const client = (failWith?: unknown) => ({
  async generateJson() {
    if (failWith) throw failWith;
    return { provider: "x", model: "y", status: "completed" as const, text: "{}" };
  },
});

describe("probeRefreshSeat", () => {
  it("is available when the primary answers, and does not probe the fallback", async () => {
    const probed: string[] = [];
    const result = await probeRefreshSeat({ routes: [primary, fallback],
      createClient: (model) => { probed.push(model.model); return client() as never; },
      now: () => 0 });
    expect(result.available).toBe(true);
    expect(probed).toEqual(["gpt-6-astra"]);
  });

  it("falls through to the fallback route on quota", async () => {
    const result = await probeRefreshSeat({ routes: [primary, fallback],
      createClient: (model) => client(model.provider === "openai"
        ? Object.assign(new Error("denied"), { statusCode: 429 }) : undefined) as never,
      now: () => 0 });
    expect(result.available).toBe(true);
    expect(result.routes.map((route) => route.reason)).toEqual(["quota", "ok"]);
  });

  it("reports a structured no-route reason when no seat is eligible", async () => {
    const result = await probeRefreshSeat({ routes: [primary, fallback],
      createClient: () => client(Object.assign(new Error("none"), { code: "no-route" })) as never,
      now: () => 0 });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("no-route");
  });
});
