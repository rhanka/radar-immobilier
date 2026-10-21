import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), "utf8");

/** Include side-effect imports, re-exports, dynamic imports and require. */
function importSpecifiers(source: string): string[] {
  return [...new Set(ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName))].sort();
}

/**
 * Every environment key read through any `process.env` spelling, found with
 * the TypeScript AST (not a pattern): dotted access (`process.env.PORT`),
 * indexed access (`process.env["PORT"]`), `process["env"]` variants and
 * destructuring (`const { PORT } = process.env`). A dynamic key or a
 * `node:process` import reports as `<dynamic>` so unknown reads fail closed.
 */
function envKeys(source: string, file: string): string[] {
  const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const keys = new Set<string>();
  const isProcessEnv = (expr: ts.Expression): boolean => {
    if (ts.isPropertyAccessExpression(expr)) {
      return (
        expr.name.text === "env" &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === "process"
      );
    }
    if (ts.isElementAccessExpression(expr)) {
      const arg = expr.argumentExpression;
      return (
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === "process" &&
        arg !== undefined &&
        ts.isStringLiteral(arg) &&
        arg.text === "env"
      );
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "process" && !isProcessEnv(node.parent as ts.Expression)) {
      keys.add("<dynamic>");
    }
    if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
      keys.add(node.name.text);
    } else if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) {
      const arg = node.argumentExpression;
      if (arg !== undefined && ts.isStringLiteral(arg)) keys.add(arg.text);
      else keys.add("<dynamic>");
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      isProcessEnv(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name;
        if (element.dotDotDotToken === undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key))) keys.add(key.text);
        else keys.add("<dynamic>");
      }
    } else if (
      isProcessEnv(node as ts.Expression) &&
      !((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node) &&
      !(ts.isVariableDeclaration(node.parent) && ts.isObjectBindingPattern(node.parent.name))
    ) {
      keys.add("<dynamic>");
    } else if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      (node.moduleSpecifier.text === "node:process" || node.moduleSpecifier.text === "process")
    ) {
      keys.add("<dynamic>");
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return [...keys].sort();
}

describe("content-deny module isolation", () => {
  it.each([
    ["process.env.EXTRA", ["EXTRA"]],
    ["process['env']['EXTRA']", ["EXTRA"]],
    ["const { EXTRA: PORT } = process.env", ["EXTRA"]],
    ["const { ...rest } = process.env", ["<dynamic>"]],
    ["const env = process.env; env.EXTRA", ["<dynamic>"]],
    ["const p = process; p.env.EXTRA", ["<dynamic>"]],
    ["process.env[key]", ["<dynamic>"]],
    ["globalThis.process.env.EXTRA", ["<dynamic>"]],
    ["process.env.PORT", ["PORT"]],
  ])("detects environment access in %s", (source, expected) => {
    expect(envKeys(source as string, "fixture.ts")).toEqual(expected);
  });

  it("loads no application dependency in the denial application", () => {
    expect(importSpecifiers(read("content-deny.ts"))).toEqual(["hono"]);
  });

  it("loads no application dependency in the denial entrypoint", () => {
    expect(importSpecifiers(read("content-deny-server.ts"))).toEqual([
      "./content-deny.js",
      "@hono/node-server",
      "node:http",
    ]);
  });

  it("reads no environment variable in the denial application", () => {
    expect(envKeys(read("content-deny.ts"), "content-deny.ts")).toEqual([]);
  });

  it("reads only PORT from the environment in the denial entrypoint", () => {
    expect(envKeys(read("content-deny-server.ts"), "content-deny-server.ts")).toEqual(["PORT"]);
  });
});
