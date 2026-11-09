import { describe, expect, it } from "vitest";
import { toSignalCardView } from "../src/services/facets/scoped-signal-cards.js";
import type { GraphSignalCard } from "../src/routes/graph-signals.js";

function card(props: Record<string, unknown>): GraphSignalCard {
  return {
    id: "sig-1", type: "Signal", label: "Avis", citySlug: "valleyfield", sourceRef: null,
    facetFingerprint: "fp", createdAt: null, description: "d", publishedAt: null,
    docRefs: [], evidence: {} as GraphSignalCard["evidence"],
    classification: {} as GraphSignalCard["classification"],
    legacySubset: {} as GraphSignalCard["legacySubset"],
    bPrime: {} as GraphSignalCard["bPrime"], etape: "avis_motion",
    regulatoryStatus: "anticipation", props,
  };
}

describe("toSignalCardView", () => {
  it("keeps allowlisted card fields and drops unknown props keys", () => {
    const view = toSignalCardView(card({
      properties: { category: "rezonage", etape: "avis_motion", adresse: "1 rue X", demandeur: "Y" },
      secretKey: "drop", properties2: {},
    }));
    expect(view.etape).toBe("avis_motion");
    expect(view.props).toEqual({ properties: { category: "rezonage", etape: "avis_motion" } });
  });
  it("keeps projected ref dates needed by the date lens", () => {
    const view = toSignalCardView(card({ refs: [{ publishedAt: "2026-01-05", rawRef: "s3://x", excerpt: "e" }] }));
    expect(view.props).toEqual({ refs: [{ publishedAt: "2026-01-05", excerpt: "e" }] });
  });
});
