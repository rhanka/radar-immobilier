import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeListCalls, excludedTestDirectories, repositoryTestFiles } from "./artifacts-listkeys-guard.helpers.js";

describe("S3 blob prefix test guard", () => {
  it.each([
    'await rawBlobs().listKeys("")', "await store.listKeys('')", "await store.listKeys(``)",
    'await store.listKeys( /* missing prefix */ )', 'await store["listKeys"]("")',
  ])("should reject an empty or omitted prefix in %s", (source) => {
    expect(analyzeListCalls(source).invalid).toEqual([1]);
  });

  it("should allow scoped calls and ignore comments and string fixtures", () => {
    expect(analyzeListCalls('store.listKeys(`artifacts/${scope}/`); // store.listKeys()\n' +
      'const fixture = \'store.listKeys("")\';').invalid).toEqual([]);
  });

  it("should forbid empty and omitted listKeys prefixes in all API and package tests", () => {
    const tests = repositoryTestFiles(fileURLToPath(new URL("../../", import.meta.url)));
    const violations: string[] = [];
    const nonStatic: string[] = [];
    for (const path of tests) {
      const result = analyzeListCalls(readFileSync(path, "utf8"), path);
      violations.push(...result.invalid.map((line) => `${path}:${line}: listKeys requires a nonempty scoped prefix`));
      nonStatic.push(...result.nonStatic.map(({ line, expression }) => `${path}:${line}: ${expression}`));
    }
    console.info(`listKeys guard: scanned ${tests.length} tests/helpers; excluded directories: ${excludedTestDirectories.join(", ")}`);
    console.info(`listKeys arguments requiring review (${nonStatic.length}):\n${nonStatic.join("\n")}`);
    expect(violations).toEqual([]);
  });
});
