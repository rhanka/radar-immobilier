import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, targetFingerprint } from "./target.js";

const node = { type: "Signal", label: "Synthetic signal", sourceRef: null, props: { b: 2, a: { y: 1, x: 0 } } };
describe("observed signal fingerprint", () => {
  it("should hash canonical content without community metadata", () => {
    const expected = '{"label":"Synthetic signal","props":{"a":{"x":0,"y":1},"b":2},"source_ref":null,"type":"Signal"}';
    expect(targetFingerprint(node)).toBe(createHash("sha256").update(expected).digest("hex"));
    expect(targetFingerprint({ ...node, props: { community: 99, a: { x: 0, y: 1 }, b: 2, community_name: "Test" } })).toBe(targetFingerprint(node));
  });
  it("should observe content changes and retain array order", () => {
    for (const changed of [{ ...node, label: "Changed" }, { ...node, type: "DesignationEvent" }, { ...node, sourceRef: "synthetic-ref" }, { ...node, props: { b: 3 } }]) {
      expect(targetFingerprint(changed)).not.toBe(targetFingerprint(node));
    }
    expect(canonicalJson([2, 1])).toBe("[2,1]");
    expect(canonicalJson({ a: null, b: true })).toBe('{"a":null,"b":true}');
  });
});
