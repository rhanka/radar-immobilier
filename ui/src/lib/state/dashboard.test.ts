import { describe, expect, it } from "vitest";
import { demoOpportunity, demoSignals } from "../demo/radar-demo-data";
import { createDashboardState } from "./dashboard";

describe("createDashboardState", () => {
  it("selects the first signal by default", () => {
    const state = createDashboardState(demoSignals, demoOpportunity);

    expect(state.selectedSignal.id).toBe("sig-zoning-150-49");
    expect(state.opportunity.score).toBe(90);
  });

  it("selects the requested signal when it exists", () => {
    const state = createDashboardState(
      demoSignals,
      demoOpportunity,
      "sig-cptaq-a118",
    );

    expect(state.selectedSignal.title).toBe("Proximité zone agricole A-118 (CPTAQ)");
  });
});
