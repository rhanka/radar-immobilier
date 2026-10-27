import { describe, expect, it } from "vitest";
import { graphifyGraphSchema } from "./graph-store.js";
import { LotFeature } from "../geo/lots.js";
import { readLotCutoverServerConfig } from "../facets/lots/lot-cutover-config.js";

describe("actual persisted-data presence contracts from Zod 3", () => {
  it("defaults an absent graph label and preserves explicit empty labels", () => {
    const absent = graphifyGraphSchema.parse({ nodes: [{ id: "n1" }], links: [] });
    expect(absent.nodes[0]?.label).toBe("");
    const explicit = graphifyGraphSchema.parse({ nodes: [{ id: "n1", label: "" }], links: [] });
    expect(explicit.nodes[0]?.label).toBe("");
    expect(graphifyGraphSchema.safeParse({ nodes: [{ id: "n1", label: null }] }).success).toBe(false);
  });
  it("keeps unknown GeoJSON coordinates optional at input", () => {
    const input = { type: "Feature", properties: { noLot: "1" }, geometry: { type: "Point" } };
    expect(LotFeature.parse(input)).toEqual(input);
  });
  it("keeps missing cutover evidence distinct from null and explicit evidence", () => {
    const input = {
      workspaceId: "aaaaaaaa-aaaa-0000-0000-aaaaaaaaaaaa",
      mapping: { mappingVersion: "v1", importerVersion: "v1", destinationsQualified: true },
      maintenance: { maintenanceAttemptId: "bbbbbbbb-bbbb-0000-0000-bbbbbbbbbbbb", releaseId: "v1", instanceIds: ["synthetic"] },
    };
    const absent = readLotCutoverServerConfig(JSON.stringify(input));
    expect(absent?.maintenance).not.toHaveProperty("evidence");
    expect(readLotCutoverServerConfig(JSON.stringify({ ...input, maintenance: { ...input.maintenance, evidence: null } }))?.maintenance.evidence).toBeNull();
  });
});
