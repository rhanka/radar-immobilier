/**
 * Pure unit tests for the canonical JSON + hashing primitive. No I/O.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  canonicalBytes,
  canonicalHash,
  sha256Of,
  CanonicalJsonError,
} from "./canonical-json.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively and deterministically", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
    expect(canonicalJson({ z: { d: 1, c: 2 }, y: 3 })).toBe('{"y":3,"z":{"c":2,"d":1}}');
  });

  it("preserves array element order verbatim (schema-declared ordering)", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson({ list: ["b", "a"] })).toBe('{"list":["b","a"]}');
  });

  it("drops undefined properties but keeps explicit null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("rejects non-finite numbers instead of coercing them to null", () => {
    expect(() => canonicalJson({ x: NaN })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ x: Infinity })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson([1, -Infinity])).toThrow(/\[1\]/);
  });

  it("rejects bigint (not representable in canonical JSON)", () => {
    expect(() => canonicalJson({ x: 1n })).toThrow(CanonicalJsonError);
  });

  it("canonicalBytes are UTF-8 of the canonical string", () => {
    const value = { greeting: "héllo", n: 1 };
    expect(canonicalBytes(value).toString("utf8")).toBe(canonicalJson(value));
  });
});

describe("sha256Of / canonicalHash", () => {
  it("emits sha256:<64 hex>", () => {
    expect(sha256Of("abc")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(canonicalHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is a known-answer hash for the empty object", () => {
    // sha256("{}") — pins the algorithm and encoding.
    expect(sha256Of("{}")).toBe(
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
    expect(canonicalHash({})).toBe(sha256Of("{}"));
  });

  it("is independent of source object key order", () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it("changes when any business value changes", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
    expect(canonicalHash({ list: [1, 2] })).not.toBe(canonicalHash({ list: [2, 1] }));
  });
});
