import { describe, expect, it } from "vitest";
import { analyzeListCalls, repositoryTestFiles } from "./artifacts-listkeys-guard.helpers.js";

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
    'store.listKeys(("")!)', '(store.listKeys)("")',
    '(store.listKeys as Function)("")', 'store["list" + "Keys"]("")',
    'const method = "listKeys"; store[method]("")',
    'const [prefix] = [""] as const; store.listKeys(prefix)',
    'store.listKeys(...([""] as const))', 'store.listKeys(...([] as const))',
    'const flag = false; store.listKeys(flag ? "artifacts/test/" : "")',
    'const flag = true; store.listKeys(flag ? "" : "artifacts/test/")',
    'store.listKeys("artifacts/../")',
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

  it("should keep complex expressions unresolved and rely on the runtime contract", () => {
    const source = 'const { prefix } = config; store.listKeys(prefix);\n' +
      'store.listKeys(...args);\nstore.listKeys(flag ? config.a : config.b);';
    expect(analyzeListCalls(source)).toEqual({ invalid: [], nonStatic: [
      { line: 1, expression: "prefix" }, { line: 2, expression: "...args" },
      { line: 3, expression: "flag ? config.a : config.b" },
    ] });
  });

  it("should preserve valid tuple spreads, destructuring and constant branches", () => {
    const source = 'const [prefix] = ["artifacts/tuple/"] as const; store.listKeys(prefix);\n' +
      'store.listKeys(...([] as const), "artifacts/spread/");\n' +
      'const flag = false; store.listKeys(flag ? "" : "artifacts/branch/");';
    expect(analyzeListCalls(source)).toEqual({ invalid: [], nonStatic: [] });
  });

  it("should scan every API and package test location using in-memory directories", () => {
    const directories: Record<string, string[]> = {
      "repo/api": ["tests/", "src/", "custom/", "dist/", "tmp/", "node_modules/", ".git/"],
      "repo/api/tests": ["a.spec.ts", "a.test.ts", "a.helpers.ts", "ignored.ts"],
      "repo/api/src": ["nested/"], "repo/api/src/nested": ["b.test.ts", "b.spec.ts"],
      "repo/api/custom": ["c.test.ts"], "repo/api/dist": ["d.spec.ts"],
      "repo/api/tmp": ["e.test.ts"], "repo/packages": ["one/", "two/", "README.md", "node_modules/", ".git/"],
      "repo/packages/one": ["src/", "tests/", "root.test.ts"],
      "repo/packages/one/src": ["f.spec.ts"], "repo/packages/one/tests": ["g.test.ts"],
      "repo/packages/two": ["__tests__/"], "repo/packages/two/__tests__": ["h.spec.ts"],
    };
    const readDirectory = (path: string) => {
      expect(directories[path], `unexpected directory: ${path}`).toBeDefined();
      return directories[path]!.map((name) => ({
        name: name.replace(/\/$/, ""), isDirectory: () => name.endsWith("/"),
      }));
    };
    expect(repositoryTestFiles("repo", readDirectory)).toEqual([
      "repo/api/custom/c.test.ts", "repo/api/dist/d.spec.ts", "repo/api/src/nested/b.spec.ts",
      "repo/api/src/nested/b.test.ts", "repo/api/tests/a.helpers.ts", "repo/api/tests/a.spec.ts",
      "repo/api/tests/a.test.ts", "repo/api/tmp/e.test.ts", "repo/packages/one/root.test.ts",
      "repo/packages/one/src/f.spec.ts", "repo/packages/one/tests/g.test.ts",
      "repo/packages/two/__tests__/h.spec.ts",
    ]);
  });
});
