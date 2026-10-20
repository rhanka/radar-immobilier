import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseXml } from "./xml.js";
describe("XML nesting bounds", () => {
  it("rejects XML nesting beyond 64 levels", () => {
    const nested = (depth: number): string => "<a>".repeat(depth) + "<b/>" + "</a>".repeat(depth);
    expect(() => parseXml(nested(63))).not.toThrow();
    expect(() => parseXml("<a>".repeat(64) + "</a>".repeat(64))).not.toThrow();
    expect(() => parseXml(nested(64))).toThrow(/nesting exceeds/);
    expect(() => parseXml(nested(65))).toThrow(/nesting exceeds/);
  });
});

describe("XML attribute work bounds", () => {
  it("reads separated attributes and rejects missing separators or duplicates", () => {
    expect(() => parseXml(`<a first = '1'\n second="2"  />`)).not.toThrow();
    expect(() => parseXml(`<a first="1"second="2"/>`)).toThrow(/invalid XML attributes/);
    expect(() => parseXml(`<a first="1" first="2"/>`)).toThrow(/duplicate XML attribute/);
  });

  it("rejects a 1 MiB malformed attribute within two seconds", () => {
    // A subprocess deadline also bounds a synchronous parser regression.
    const parserUrl = new URL("./xml.ts", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { strict as assert } from "node:assert";
      import { parseXml } from ${JSON.stringify(parserUrl)};
      assert.throws(() => parseXml('<a ' + 'x'.repeat(1024 * 1024) + '/>'),
        { name: 'SteveCaptureError', message: 'invalid XML attributes' });
    `], { timeout: 2000, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
