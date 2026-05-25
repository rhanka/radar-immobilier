import { describe, expect, it } from "vitest";
import { demoOpportunity, demoSignals } from "../demo/radar-demo-data";
import { createDashboardState } from "./dashboard";

describe("createDashboardState", () => {
  it("selects the first signal by default", () => {
    const state = createDashboardState(demoSignals, demoOpportunity);

    expect(state.selectedSignal.id).toBe("sig-ppcmoi-2026-04");
    expect(state.opportunity.score).toBe(82);
  });

  it("selects the requested signal when it exists", () => {
    const state = createDashboardState(
      demoSignals,
      demoOpportunity,
      "sig-cptaq-2026-02",
    );

    expect(state.selectedSignal.title).toBe("Demande CPTAQ adjacente");
  });
});
