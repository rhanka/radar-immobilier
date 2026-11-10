import { describe, expect, it } from "vitest";
import {
  StdoutOpsFailureSink,
  buildOpsJobFailureEvent,
  decideOpsEmission,
  readOpsTarget,
} from "./ops-failure.js";

const AT = new Date("2026-11-09T12:00:00.000Z");

describe("decideOpsEmission", () => {
  it("emits systemic-city-failures with attempted counts", () => {
    expect(
      decideOpsEmission({
        health: { exitCode: 1, reason: "systemic-city-failures" },
        counts: { published: 1, failed: 9 },
        target: "immo-preprod",
        cycleId: "cycle-1",
        at: AT,
      }),
    ).toEqual({
      v: 1,
      event: "ops.job_failure",
      job: "radar-refresh-pv",
      kind: "systemic-city-failures",
      target: "immo-preprod",
      cycleId: "cycle-1",
      at: "2026-11-09T12:00:00.000Z",
      failed: 9,
      attempted: 10,
      reason: "systemic-city-failures",
    });
  });

  it("emits succeeded on a healthy sweep (recovery)", () => {
    const event = decideOpsEmission({
      health: { exitCode: 0 },
      counts: { published: 3, failed: 0 },
      target: "immo-prod",
      cycleId: "cycle-2",
      at: AT,
    });
    expect(event?.kind).toBe("succeeded");
    expect(event?.target).toBe("immo-prod");
  });

  it("stays silent for non-systemic failures until L1 names them", () => {
    expect(
      decideOpsEmission({
        health: { exitCode: 1, reason: "fallback-quota-exhausted" },
        counts: { published: 0, failed: 2 },
        target: "unknown",
        cycleId: "cycle-3",
        at: AT,
      }),
    ).toBeNull();
  });
});

describe("ops failure sink and target", () => {
  it("writes exactly one stdout JSON line per event", async () => {
    const lines: string[] = [];
    const sink = new StdoutOpsFailureSink((line) => lines.push(line));
    await sink.emit(
      buildOpsJobFailureEvent({
        kind: "succeeded",
        target: "unknown",
        cycleId: "cycle-4",
        at: AT,
        failed: 0,
        attempted: 0,
      }),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event: "ops.job_failure",
      kind: "succeeded",
      target: "unknown",
    });
  });

  it("never guesses the target from the environment", () => {
    expect(readOpsTarget({ OPS_TARGET: "immo-prod" } as NodeJS.ProcessEnv)).toBe(
      "immo-prod",
    );
    expect(readOpsTarget({} as NodeJS.ProcessEnv)).toBe("unknown");
    expect(
      readOpsTarget({ OPS_TARGET: "staging" } as NodeJS.ProcessEnv),
    ).toBe("unknown");
  });
});
