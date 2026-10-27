/**
 * Identified graph set and reglement key tests.
 */

import { describe, expect, it } from "vitest";
import { SteveCaptureError } from "../types.js";
import referenceSource from "../../../scripts/purge-avis-bylaws.ts?raw";
import {
  buildGraphSet,
  canonicalGraphSetJson,
  normalizeReglementKey,
  splitReglementTokens,
} from "./graph-set.js";

describe("normalizeReglementKey parity", () => {
  it.each([" R - 901 ", "R\t-\n901", "R\u00a0-901", "E\u0301-901", "É-901"])(
    "matches the existing normalizer for %j", (value) => {
      // Evaluate only the pure reference body; importing the script loads I/O dependencies.
      const body = /export function normalizeReglementKey\(value: string\): string \{([^}]+)\}/
        .exec(referenceSource)?.[1];
      expect(body).toBeDefined();
      const reference = new Function("value", body ?? "") as (text: string) => string;
      expect(normalizeReglementKey(value)).toBe(reference(value));
    },
  );
  it("normalizes triage tokens and graph props the same way", () => {
    expect(normalizeReglementKey("  R-901 ")).toBe("r-901");
    expect(normalizeReglementKey("R-901")).toBe(
      normalizeReglementKey("r-901"),
    );
    const tokens = splitReglementTokens("R-901, r-901");
    expect(tokens.kept).toEqual(["r-901", "r-901"]);
  });

  it("splits on comma, semicolon and newline", () => {
    expect(splitReglementTokens("SYN-1; SYN-2\nSYN-3,SYN-4")).toEqual({
      kept: ["syn-1", "syn-2", "syn-3", "syn-4"],
      ignored: 0,
    });
  });

  it("ignores tokens without a digit and counts them apart", () => {
    expect(splitReglementTokens("SYN-9, sans objet,  ")).toEqual({
      kept: ["syn-9"],
      ignored: 1,
    });
    expect(splitReglementTokens(null)).toEqual({ kept: [], ignored: 0 });
  });
});

describe("buildGraphSet", () => {
  it("identifies a set with snapshot id plus canonical sha256", () => {
    const set = buildGraphSet("synthetic-d3-v1", [
      {
        slug: "ville-synth-b",
        nodes: [
          { id: "gn-2", type: "Signal", props: { reglement_number: "SYN-2" } },
        ],
      },
      {
        slug: "ville-synth-a",
        nodes: [
          { id: "gn-1", type: "Signal", props: { reglement_number: "SYN-1" } },
        ],
      },
    ]);
    expect(set.snapshotId).toBe("synthetic-d3-v1");
    expect(set.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(set.graphs.map((graph) => graph.slug)).toEqual([
      "ville-synth-a",
      "ville-synth-b",
    ]);
    expect(canonicalGraphSetJson(set.snapshotId, set.graphs)).toContain(
      "ville-synth-a",
    );
  });

  it("keeps the canonical JSON stable whatever the input order", () => {
    const makeGraphs = () => [
      {
        slug: "ville-synth-a",
        nodes: [{ id: "gn-1", type: "Signal", props: { b: 2, a: 1 } }],
      },
    ];
    const first = buildGraphSet("synthetic-d3-v1", makeGraphs());
    const second = buildGraphSet("synthetic-d3-v1", makeGraphs().reverse());
    expect(first.sha256).toBe(second.sha256);
  });

  it("rejects a duplicated slug", () => {
    expect(() =>
      buildGraphSet("synthetic-d3-v1", [
        { slug: "ville-synth-a", nodes: [] },
        { slug: "ville-synth-a", nodes: [] },
      ]),
    ).toThrow(SteveCaptureError);
  });
});
