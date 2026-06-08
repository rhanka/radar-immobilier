import { describe, expect, it } from "vitest";
import {
  TemporalSpan,
  isValidAt,
  isKnownAt,
  resolveAsOf,
  projectAsOf,
  type TemporalSpanT,
  type TemporallySpanned,
} from "./temporal.js";

/**
 * Tests for the bitemporal span and as-of resolution helpers
 * (SPEC_ONTOLOGY §4.4 D5, SPEC_DESIGN_DATA_MODEL §3). Validity-time = when the
 * regulatory fact is true; knowledge-time = when radar knew it.
 */

const span = (
  validFrom: string,
  validTo: string | null,
  knownFrom: string,
  knownTo: string | null = null,
): TemporalSpanT => ({ validFrom, validTo, knownFrom, knownTo });

interface Ver extends TemporallySpanned {
  label: string;
}
const ver = (
  label: string,
  validFrom: string,
  validTo: string | null,
  knownFrom: string,
  knownTo: string | null = null,
): Ver => ({ label, temporal: span(validFrom, validTo, knownFrom, knownTo) });

describe("TemporalSpan schema", () => {
  it("parses an open span (validTo/knownTo default to null)", () => {
    const parsed = TemporalSpan.parse({
      validFrom: "2024-01-01",
      knownFrom: "2024-02-01T10:00:00.000Z",
    });
    expect(parsed.validTo).toBeNull();
    expect(parsed.knownTo).toBeNull();
  });

  it("rejects a malformed validFrom date", () => {
    expect(() =>
      TemporalSpan.parse({ validFrom: "2024/01/01", knownFrom: "2024-02-01T10:00:00.000Z" }),
    ).toThrow();
  });

  it("rejects a knownFrom that is a bare date (must be a datetime)", () => {
    expect(() =>
      TemporalSpan.parse({ validFrom: "2024-01-01", knownFrom: "2024-02-01" }),
    ).toThrow();
  });
});

describe("isValidAt", () => {
  it("includes the start instant and excludes the end instant [validFrom, validTo)", () => {
    const s = span("2024-01-01", "2024-06-01", "2024-01-01T00:00:00.000Z");
    expect(isValidAt(s, "2024-01-01")).toBe(true);
    expect(isValidAt(s, "2024-03-15")).toBe(true);
    expect(isValidAt(s, "2024-06-01")).toBe(false); // exclusive end
    expect(isValidAt(s, "2023-12-31")).toBe(false);
  });

  it("treats null validTo as still-valid", () => {
    const s = span("2024-01-01", null, "2024-01-01T00:00:00.000Z");
    expect(isValidAt(s, "2999-01-01")).toBe(true);
  });
});

describe("isKnownAt", () => {
  it("uses the knowledge window [knownFrom, knownTo)", () => {
    const s = span("2024-01-01", null, "2024-02-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z");
    expect(isKnownAt(s, "2024-01-15T00:00:00.000Z")).toBe(false); // before known
    expect(isKnownAt(s, "2024-02-01T00:00:00.000Z")).toBe(true); // inclusive start
    expect(isKnownAt(s, "2024-05-01T00:00:00.000Z")).toBe(false); // exclusive end
  });
});

describe("resolveAsOf — validity-time only", () => {
  // A zone rezoned at 2024-06-01; later corrected. Two valid-time versions, both currently believed.
  const versions: Ver[] = [
    ver("v1-before", "2020-01-01", "2024-06-01", "2024-06-02T00:00:00.000Z"),
    ver("v2-after", "2024-06-01", null, "2024-06-02T00:00:00.000Z"),
  ];

  it("resolves the version applicable at the queried validity instant", () => {
    expect(resolveAsOf(versions, "2022-01-01")?.label).toBe("v1-before");
    expect(resolveAsOf(versions, "2024-06-01")?.label).toBe("v2-after");
    expect(resolveAsOf(versions, "2999-01-01")?.label).toBe("v2-after");
  });

  it("returns null when no version is valid at the instant", () => {
    expect(resolveAsOf(versions, "2010-01-01")).toBeNull();
  });

  it("ignores knowledge-closed versions when knownAt is omitted", () => {
    // a superseded (knownTo closed) belief that was valid in the same window must NOT win
    const withCorrection: Ver[] = [
      ver("wrong", "2024-06-01", null, "2024-06-02T00:00:00.000Z", "2024-07-01T00:00:00.000Z"),
      ver("right", "2024-06-01", null, "2024-07-01T00:00:00.000Z"),
    ];
    expect(resolveAsOf(withCorrection, "2024-08-01")?.label).toBe("right");
  });
});

describe("resolveAsOf — bitemporal (knownAt provided)", () => {
  // Radar first believed the wrong fact, then corrected it via a compensating patch.
  const versions: Ver[] = [
    ver("wrong", "2024-06-01", null, "2024-06-02T00:00:00.000Z", "2024-07-01T00:00:00.000Z"),
    ver("right", "2024-06-01", null, "2024-07-01T00:00:00.000Z"),
  ];

  it("returns what radar believed at the given knowledge instant", () => {
    // as known on 2024-06-15: radar believed "wrong"
    expect(resolveAsOf(versions, "2024-08-01", "2024-06-15T00:00:00.000Z")?.label).toBe("wrong");
    // as known on 2024-08-01: radar believes "right"
    expect(resolveAsOf(versions, "2024-08-01", "2024-08-01T00:00:00.000Z")?.label).toBe("right");
  });

  it("returns null when nothing was known yet at knownAt", () => {
    expect(resolveAsOf(versions, "2024-08-01", "2024-01-01T00:00:00.000Z")).toBeNull();
  });
});

describe("projectAsOf — knowledge cut", () => {
  const versions: Ver[] = [
    ver("a", "2024-01-01", null, "2024-02-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z"),
    ver("b", "2024-01-01", null, "2024-05-01T00:00:00.000Z"),
  ];

  it("keeps only versions known at the cut instant", () => {
    expect(projectAsOf(versions, "2024-03-01T00:00:00.000Z").map((v) => v.label)).toEqual(["a"]);
    expect(projectAsOf(versions, "2024-06-01T00:00:00.000Z").map((v) => v.label)).toEqual(["b"]);
  });

  it("returns an empty set before any knowledge", () => {
    expect(projectAsOf(versions, "2024-01-01T00:00:00.000Z")).toEqual([]);
  });
});
