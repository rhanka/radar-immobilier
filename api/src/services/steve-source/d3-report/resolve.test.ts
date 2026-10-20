/**
 * Resolver tests: every status, every priority, synthetic data only.
 */

import { describe, expect, it } from "vitest";
import { buildTestGraphSet, syntheticMunicipalities } from "./fixtures.js";
import { D3_RULE_VERSION, resolveTriageRow } from "./resolve.js";
import type { TriageRow } from "./triage-rows.js";

function makeRow(overrides: {
  city?: string | null;
  mrc?: string | null;
  reglement?: string | null;
}): TriageRow {
  const cell = (text: string | null | undefined) =>
    text === undefined || text === null
      ? { raw: null, value: null }
      : { raw: text, value: text };
  return {
    locator: { sheet: "Triage", sheetId: 1, row: 2 },
    order: 0,
    number: cell("1"),
    city: cell(overrides.city ?? null),
    mrc: cell(overrides.mrc ?? null),
    reglement: cell(overrides.reglement ?? null),
    classement: { raw: "Pertinent", value: "Pertinent" },
  };
}

const municipalities = syntheticMunicipalities();

function singleGraph() {
  return buildTestGraphSet([
    {
      slug: "ville-synth-a",
      nodes: [
        { id: "gn-1", type: "Signal", props: { reglement_number: "SYN-101" } },
        { id: "gn-2", type: "Signal", props: { reglement_number: "SYN-102" } },
      ],
    },
  ]);
}

describe("resolveTriageRow", () => {
  it("exposes rule version d3-report-v1", () => {
    expect(D3_RULE_VERSION).toBe("d3-report-v1");
  });

  it("returns unavailable for a unique city whose graph is missing", () => {
    const graphSet = buildTestGraphSet([]);
    const resolution = resolveTriageRow(
      makeRow({ city: "Ville Synth A", reglement: "SYN-101" }),
      graphSet,
      municipalities,
    );
    expect(resolution.status).toBe("unavailable");
  });

  it("returns ambiguous for a homonym without MRC", () => {
    const resolution = resolveTriageRow(
      makeRow({ city: "Bourg Homonyme", reglement: "SYN-101" }),
      singleGraph(),
      municipalities,
    );
    expect(resolution.status).toBe("ambiguous");
  });

  it("returns ambiguous when two nodes share one reglement", () => {
    const graphSet = buildTestGraphSet([
      {
        slug: "ville-synth-a",
        nodes: [
          { id: "gn-1", type: "Signal", props: { reglement_number: "SYN-101" } },
          { id: "gn-2", type: "DesignationEvent", props: { cible_reglement_numero: "SYN-101" } },
        ],
      },
    ]);
    const resolution = resolveTriageRow(
      makeRow({ city: "Ville Synth A", reglement: "SYN-101" }),
      graphSet,
      municipalities,
    );
    expect(resolution.status).toBe("ambiguous");
  });

  it("returns fully_resolved when every target resolves", () => {
    const resolution = resolveTriageRow(
      makeRow({ city: "Ville Synth A", reglement: "SYN-101, SYN-102" }),
      singleGraph(),
      municipalities,
    );
    expect(resolution.status).toBe("fully_resolved");
    expect(resolution.resolved).toHaveLength(2);
  });

  it("returns partially_resolved when a single target resolves", () => {
    const resolution = resolveTriageRow(
      makeRow({ city: "Ville Synth A", reglement: "SYN-101, SYN-999" }),
      singleGraph(),
      municipalities,
    );
    expect(resolution.status).toBe("partially_resolved");
    expect(resolution.resolved).toHaveLength(1);
  });

  it("returns unresolved for an unknown city", () => {
    const resolution = resolveTriageRow(
      makeRow({ city: "Ville Inexistante Synth", reglement: "SYN-101" }),
      singleGraph(),
      municipalities,
    );
    expect(resolution.status).toBe("unresolved");
  });

  it("returns unresolved for a row without a reglement number", () => {
    const resolution = resolveTriageRow(
      makeRow({ city: "Ville Synth A", reglement: null }),
      singleGraph(),
      municipalities,
    );
    expect(resolution.status).toBe("unresolved");
    expect(resolution.keptTokens).toBe(0);
  });

  it("prefers unavailable over a target conflict", () => {
    const graphSet = buildTestGraphSet([]);
    const resolution = resolveTriageRow(
      makeRow({ city: "Ville Synth A", reglement: "SYN-101, SYN-102" }),
      graphSet,
      municipalities,
    );
    expect(resolution.status).toBe("unavailable");
  });

  it("is deterministic on the same inputs", () => {
    const graphSet = singleGraph();
    const row = makeRow({ city: "Ville Synth A", reglement: "SYN-101" });
    const first = resolveTriageRow(row, graphSet, municipalities);
    const second = resolveTriageRow(structuredClone(row), graphSet, municipalities);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
