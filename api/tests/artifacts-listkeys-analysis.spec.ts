import { describe, expect, it } from "vitest";
import { analyzeListCalls } from "./artifacts-listkeys-guard.helpers.js";

describe("listKeys static prefix analysis", () => {
  it.each([
    'store.listKeys()', 'store.listKeys( /* omitted */ )',
    'store.listKeys("")', "store.listKeys('')", 'store.listKeys(``)',
    'rawBlobs().listKeys((""))', 'store.listKeys((("")))',
    'store.listKeys("" as string)', 'store.listKeys("" as const)',
    'store.listKeys("" satisfies string)', 'store.listKeys(<string>"")',
    'store.listKeys("" + \'\' + ``)', 'store.listKeys(("" + "") as string)',
    'const prefix = ""; store.listKeys(prefix)',
    'const a = ``; const b = (a satisfies string); store.listKeys(b)',
    'store["listKeys"]("")', 'store[`listKeys`]((""))',
    'store?.listKeys?.((""))', 'store.listKeys(`${""}`)',
  ])("should reject a statically empty or omitted prefix: %s", (source) => {
    expect(analyzeListCalls(source).invalid).toEqual([1]);
  });

  it("should report the call line after comments and multiline arguments", () => {
    expect(analyzeListCalls('// store.listKeys()\nstore.listKeys(\n ("")\n)')
      .invalid).toEqual([2]);
  });

  it("should resolve lexical const bindings without confusing shadowed names", () => {
    const source = 'const prefix = "artifacts/outer/";\n' +
      '{ const prefix = ""; store.listKeys(prefix); }\nstore.listKeys(prefix);';
    expect(analyzeListCalls(source).invalid).toEqual([2]);
  });

  it("should allow nonempty strings and ignore comments and string fixtures", () => {
    const source = 'const scope = "test"; store.listKeys(`artifacts/${scope}/`);\n' +
      'store.listKeys("artifacts/" + "scope/"); // store.listKeys()\n' +
      'const fixture = \'store.listKeys("")\';';
    expect(analyzeListCalls(source)).toEqual({ invalid: [], nonStatic: [] });
  });

  it("should list unresolved arguments, mutable bindings and cycles", () => {
    const source = 'store.listKeys(config.prefix);\nlet prefix = ""; store.listKeys(prefix);\n' +
      'const a = b; const b = a; store.listKeys(a);';
    expect(analyzeListCalls(source)).toEqual({ invalid: [], nonStatic: [
      { line: 1, expression: "config.prefix" }, { line: 2, expression: "prefix" },
      { line: 3, expression: "a" },
    ] });
  });
});
