import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function invalidListCalls(source: string): number[] {
  const file = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
          ? callee.argumentExpression.text : undefined;
      const prefix = node.arguments[0];
      if (name === "listKeys" && (prefix === undefined ||
          (ts.isStringLiteralLike(prefix) && prefix.text.length === 0))) {
        lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return lines;
}

function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ["node_modules", "dist", "tmp"].includes(entry.name) ? [] : testFiles(path);
    return /\.(?:spec|test|helpers)\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("S3 blob prefix test guard", () => {
  it.each([
    'await rawBlobs().listKeys("")', "await store.listKeys('')", "await store.listKeys(``)",
    'await store.listKeys( /* missing prefix */ )', 'await store["listKeys"]("")',
  ])("should reject an empty or omitted prefix in %s", (source) => {
    expect(invalidListCalls(source)).toEqual([1]);
  });

  it("should allow scoped calls and ignore comments and string fixtures", () => {
    expect(invalidListCalls('store.listKeys(`artifacts/${scope}/`); // store.listKeys()\n' +
      'const fixture = \'store.listKeys("")\';')).toEqual([]);
  });

  it("should forbid empty and omitted listKeys prefixes in integration tests and package tests", () => {
    const tests = testFiles(fileURLToPath(new URL("./", import.meta.url)));
    const packages = fileURLToPath(new URL("../../packages/", import.meta.url));
    for (const entry of readdirSync(packages, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const src = join(packages, entry.name, "src");
        if (readdirSync(join(packages, entry.name)).includes("src")) tests.push(...testFiles(src));
      }
    }
    const violations = tests.flatMap((path) => invalidListCalls(readFileSync(path, "utf8"))
      .map((line) => `${path}:${line}: listKeys requires a nonempty scoped prefix`));
    expect(violations).toEqual([]);
  });
});
