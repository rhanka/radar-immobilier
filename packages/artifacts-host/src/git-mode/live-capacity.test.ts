import { describe, expect, it } from "vitest";
import { liveCapacityState } from "./live-capacity.js";

describe("live capacity state (never an endless spinner)", () => {
  it("maps a full builder to an explicit queued state with its position", () => {
    expect(liveCapacityState({ publicCode: "builder_unavailable", details: { reason: "queued", position: 2 } }))
      .toEqual({ state: "queued", retryable: true, position: 2, message: expect.stringContaining("queued") });
    expect(liveCapacityState({ publicCode: "builder_unavailable", details: { queued: true } })?.state).toBe("queued");
  });

  it("maps a missing or unqualified worker to builder_unavailable", () => {
    expect(liveCapacityState({ publicCode: "builder_unavailable" })).toMatchObject({ state: "builder_unavailable", retryable: true });
    expect(liveCapacityState({ publicCode: "builder_unavailable", details: { executor: "sandbox", reason: "executor_unavailable" } }))
      .toMatchObject({ state: "builder_unavailable" });
  });

  it("adds nothing for any other refusal", () => {
    expect(liveCapacityState({ publicCode: "access_denied" })).toBeUndefined();
    expect(liveCapacityState(undefined)).toBeUndefined();
  });
});
