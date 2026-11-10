import { describe, expect, it } from "vitest";

import { recurrentConfigFromEnv, seatSkipLine } from "./refresh-requeue-recurrent.js";

describe("recurrentConfigFromEnv", () => {
  it("defaults to the documented ceilings", () => {
    expect(recurrentConfigFromEnv({})).toEqual(
      { maxAgeDays: 90, maxPerRun: 50, maxPerCity: 5, maxRequeues: 2, dryRun: false });
  });

  it("rejects a non-positive ceiling", () => {
    expect(() => recurrentConfigFromEnv({ REQUEUE_MAX_PER_RUN: "0" })).toThrow("REQUEUE_MAX_PER_RUN");
  });
});

describe("seatSkipLine", () => {
  it("is one structured JSON line naming the classified reason", () => {
    const line = seatSkipLine({ available: false, reason: "quota", routes: [], latencyMs: 3 });
    expect(JSON.parse(line)).toMatchObject({ decision: "skip", reason: "quota" });
    expect(line).not.toContain("\n");
  });
});
