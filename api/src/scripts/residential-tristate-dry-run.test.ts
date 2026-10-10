import { describe, expect, it } from "vitest";
import {
  auditRow,
  rowsFromCanonicalGraph,
  rowsFromNdjson,
  summarize,
} from "./residential-tristate-dry-run.js";

const window = { dateFrom: "2026-07-05", dateTo: "2026-10-05" };
const refs = [{ page: 4, publishedAt: "2026-07-29" }];

// Canonical latest.json node of production event-26-220 (la-peche).
const draftBylaw = {
  id: "event-26-220",
  type: "DesignationEvent",
  label: "Adoption du premier projet de règlement 113-006-2026",
  refs,
  properties: { etape: "projet_reglement", instrument: "autre", resolution: "26-220",
    reglement_number: "113-006-2026" },
};
const lateUnknown = { ...draftBylaw, id: "event-late", label: "Adoption du règlement 113-007-2026",
  properties: { etape: "adoption", instrument: "autre" } };
const residential = { ...draftBylaw, id: "event-res",
  label: "Avis de motion — règlement de zonage autorisant des habitations multifamiliales",
  properties: { etape: "avis_motion" } };

describe("residential-tristate-dry-run", () => {
  it("projects the canonical graph with the writer's row builder and classifies like the API", () => {
    const rows = rowsFromCanonicalGraph("la-peche", {
      nodes: [draftBylaw, lateUnknown, residential, { id: "zone-h-027", type: "Zone", label: "H-027" }],
    });
    expect(rows.map((row) => row.id)).toEqual(["event-26-220", "event-late", "event-res"]);
    const [draft, late, res] = rows.map((row) => auditRow(row, window));
    expect(draft).toMatchObject({ residentiel: "indetermine", instrument: "autre", before: false, after: true,
      defaultViewBefore: false, defaultViewAfter: true, missingPersistedFields: [] });
    expect(late).toMatchObject({ before: false, after: false, defaultViewAfter: false });
    expect(res).toMatchObject({ residentiel: "oui", before: true, after: true,
      missingPersistedFields: ["instrument"] });
  });

  it("merges a repeated canonical node id like the projection writer", () => {
    const rows = rowsFromCanonicalGraph("la-peche", {
      nodes: [draftBylaw, { ...draftBylaw, refs: [{ page: 5, publishedAt: "2026-07-29" }] }],
    });
    expect(rows).toHaveLength(1);
    expect(summarize(rows.map((row) => auditRow(row, window)))).toMatchObject({
      nodes: 1, eligibilityChanged: { nodes: 1 }, defaultView: { after: 1 },
    });
  });

  it("summarizes nodes, cities and the default view, and never requires a write", () => {
    const rows = rowsFromNdjson([
      JSON.stringify({ id: "event-26-220", type: "DesignationEvent", city_slug: "la-peche",
        label: draftBylaw.label, props: { refs, properties: draftBylaw.properties }, source_ref: null }),
      JSON.stringify({ id: "x", type: "designationevent", city_slug: "la-peche", label: "ignored", props: {} }),
      "",
    ].join("\n"));
    const report = summarize(rows.map((row) => auditRow(row, window)));
    expect(report).toMatchObject({
      nodes: 1,
      cities: 1,
      eligibilityChanged: { nodes: 1, cities: 1, toEligible: 1, toIneligible: 0 },
      defaultView: { before: 0, after: 1, citiesAfter: 1 },
      missingPersistedFields: { nodes: 0, cities: 0 },
      writesRequired: 0,
    });
    expect(report.examples[0]).toMatchObject({ id: "event-26-220", before: "r=filtered", after: "r=eligible" });
  });
});
