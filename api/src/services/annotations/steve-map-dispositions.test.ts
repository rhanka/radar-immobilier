import { describe, expect, it } from "vitest";
import { planSteveMapCategory } from "./steve-map-dispositions.js";

describe("Steve map category preparation", () => {
  it("should propose the ratified mark correspondences without importing or inventing an author", () => {
    expect(planSteveMapCategory("mark", "lettre").proposal).toEqual({ dimension: "pipeline", statut: "lettre_envoyee" });
    expect(planSteveMapCategory("mark", "envente").proposal).toEqual({ dimension: "marche", statut: "en_vente" });
    expect(planSteveMapCategory("mark", "favori").requires).toContain("documentary-attribution");
    expect(planSteveMapCategory("mark", "sollicite").proposal).toEqual({ dimension: "pipeline", statut: "sollicite" });
    expect(planSteveMapCategory("mark", "verifie").proposal).toBeNull();
  });
  it("should keep pins, zones, listings, notes and unknown categories in distinct source dispositions", () => {
    expect(planSteveMapCategory("manual-pin").requires).toContain("coordinates-crs-units-precision");
    expect(planSteveMapCategory("zone").requires).toContain("authoritative-zone-match");
    expect(planSteveMapCategory("listing").requires).toContain("qualified-listing-domain-mapping");
    expect(planSteveMapCategory("lot-note").representation).toBe("canonical-discussion");
    expect(planSteveMapCategory("unknown").representation).toBe("unresolved-source-category");
  });
});
