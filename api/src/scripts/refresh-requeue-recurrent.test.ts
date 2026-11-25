import { describe, expect, it } from "vitest";

import { REFRESH_AVAILABILITY_REASONS } from "../services/graph/refresh-coverage.js";
import { recurrentConfigFromEnv, recurrentRoutesFromEnv, seatSkipLine } from "./refresh-requeue-recurrent.js";

describe("recurrentConfigFromEnv", () => {
  it("defaults to the documented ceilings", () => {
    expect(recurrentConfigFromEnv({})).toEqual(
      { maxAgeDays: 90, maxPerRun: 50, maxPerCity: 5, maxRequeues: 2, dryRun: false });
  });

  it("rejects a non-positive ceiling", () => {
    expect(() => recurrentConfigFromEnv({ REQUEUE_MAX_PER_RUN: "0" })).toThrow("REQUEUE_MAX_PER_RUN");
  });

  it("parses optional REQUEUE_REASONS including the availability alias", () => {
    expect(recurrentConfigFromEnv({ REQUEUE_REASONS: "availability" }).reasons)
      .toEqual([...REFRESH_AVAILABILITY_REASONS].sort());
    expect(recurrentConfigFromEnv({ REQUEUE_REASONS: "quota,transport" }).reasons)
      .toEqual(["quota", "transport"]);
  });
});

describe("recurrentRoutesFromEnv", () => {
  it("accepts openai primary with muse fallback (prod CronJob cascade)", () => {
    expect(recurrentRoutesFromEnv({
      REFRESH_PROVIDER: "openai",
      REFRESH_MODEL: "gpt-6.2-astra",
      REFRESH_REASONING_EFFORT: "low",
      REFRESH_FALLBACK_PROVIDER: "muse",
      REFRESH_FALLBACK_MODEL: "muse-wonder-1.0",
      REFRESH_FALLBACK_REASONING_EFFORT: "low",
    })).toEqual([
      { provider: "openai", model: "gpt-6.2-astra", effort: "low" },
      { provider: "muse", model: "muse-wonder-1.0", effort: "low" },
    ]);
  });

  it("rejects an unknown provider", () => {
    expect(() => recurrentRoutesFromEnv({
      REFRESH_PROVIDER: "openai",
      REFRESH_MODEL: "gpt-6.2-astra",
      REFRESH_REASONING_EFFORT: "low",
      REFRESH_FALLBACK_PROVIDER: "unknown",
      REFRESH_FALLBACK_MODEL: "x",
      REFRESH_FALLBACK_REASONING_EFFORT: "low",
    })).toThrow("REFRESH_FALLBACK_PROVIDER");
  });
});

describe("seatSkipLine", () => {
  it("is one structured JSON line naming the classified reason", () => {
    const line = seatSkipLine({ available: false, reason: "quota", routes: [], latencyMs: 3 });
    expect(JSON.parse(line)).toMatchObject({ decision: "skip", reason: "quota" });
    expect(line).not.toContain("\n");
  });
});
