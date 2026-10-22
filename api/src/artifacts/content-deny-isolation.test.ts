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
 * Strict ban for the denial modules: no identifier, property name or
 * computed-access string may reference a global or environment handle.
 * The ban makes aliases impossible: any alias source already fails.
 */
const FORBIDDEN_IDENTIFIERS = new Set([
  "globalThis",
  "global",
  "self",
  "window",
  "process",
  "eval",
  "Function",
  "Reflect",
  "require",
]);

const FORBIDDEN_STRINGS = new Set([
  "globalThis",
  "global",
  "self",
  "window",
  "process",
  "eval",
  "Function",
  "Reflect",
  "require",
]);

const FORBIDDEN_IMPORTS = new Set(["node:process", "process"]);

/**
 * The single allowed `process` occurrence: the root object of an exact
 * `process.env.PORT` property chain over dots. Bracket spellings,
 * assertions between the links and destructured copies are not allowed.
 * It must initialize `raw` directly inside the entrypoint's `resolvePort`.
 */
function isAllowedProcessIdentifier(node: ts.Identifier): boolean {
  if (node.text !== "process") return false;
  const parent = node.parent;
  if (!ts.isPropertyAccessExpression(parent)) return false;
  if (parent.expression !== node) return false;
  if (parent.name.text !== "env") return false;
  const grandparent = parent.parent;
  if (!ts.isPropertyAccessExpression(grandparent)) return false;
  if (grandparent.expression !== parent) return false;
  if (grandparent.name.text !== "PORT") return false;
  const declaration = grandparent.parent;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== grandparent) return false;
  if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "raw") return false;
  const statement = declaration.parent.parent;
  if (!ts.isVariableStatement(statement)) return false;
  const body = statement.parent;
  if (!ts.isBlock(body) || !ts.isFunctionDeclaration(body.parent)) return false;
  return body.parent.name?.text === "resolvePort" &&
    ts.isSourceFile(body.parent.parent) &&
    node.getSourceFile().fileName === "content-deny-server.ts";
}

function countAllowedPortReads(source: string, file: string): number {
  const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "PORT" &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "env" &&
      ts.isIdentifier(node.expression.expression) &&
      isAllowedProcessIdentifier(node.expression.expression)
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

/** Every forbidden reference found in one source, with line numbers. */
function collectViolations(source: string, file: string): string[] {
  const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations = new Set<string>();
  const lineOf = (node: ts.Node): number =>
    root.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      if (!(node.text === "process" && isAllowedProcessIdentifier(node))) {
        violations.add(`${file}:${lineOf(node)} forbidden identifier ${node.text}`);
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if (arg !== undefined && ts.isStringLiteral(arg) && FORBIDDEN_STRINGS.has(arg.text)) {
        violations.add(`${file}:${lineOf(node)} forbidden computed string ${arg.text}`);
      }
    }
    if (
      ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.ImportKeyword &&
      node.name.text === "meta"
    ) {
      violations.add(`${file}:${lineOf(node)} forbidden import.meta`);
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      FORBIDDEN_IMPORTS.has(node.moduleSpecifier.text)
    ) {
      violations.add(`${file}:${lineOf(node)} forbidden import ${node.moduleSpecifier.text}`);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      FORBIDDEN_IMPORTS.has(node.moduleSpecifier.text)
    ) {
      violations.add(`${file}:${lineOf(node)} forbidden export ${node.moduleSpecifier.text}`);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      FORBIDDEN_IMPORTS.has(node.arguments[0].text)
    ) {
      violations.add(`${file}:${lineOf(node)} forbidden dynamic import ${node.arguments[0].text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return [...violations].sort();
}

/**
 * Every environment key read through any `process.env` spelling, found with
 * the TypeScript AST (not a pattern): dotted access (`process.env.PORT`),
 * indexed access (`process.env["PORT"]`), `process["env"]` variants and
 * destructuring (`const { PORT } = process.env`). `process` reached through
 * a global object (`globalThis`, `global`, `self`, including computed keys),
 * a computed `env` key, a `process`/global alias, or a `node:process`
 * import reports as `<dynamic>` so unknown reads fail closed. Only `env` on
 * the bare `process` identifier resolves to a precise key.
 */
const GLOBAL_OBJECTS = new Set(["globalThis", "global", "self"]);

function envKeys(source: string, file: string): string[] {
  const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const keys = new Set<string>();
  const isGlobalChain = (expr: ts.Expression): boolean => {
    if (
      ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) ||
      ts.isTypeAssertionExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr)
    ) return isGlobalChain(expr.expression);
    if (ts.isIdentifier(expr)) return GLOBAL_OBJECTS.has(expr.text);
    if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
      return isGlobalChain(expr.expression);
    }
    return false;
  };
  const isProcessRef = (expr: ts.Expression): boolean => {
    if (ts.isIdentifier(expr)) return expr.text === "process";
    if (ts.isPropertyAccessExpression(expr)) {
      return expr.name.text === "process" && isGlobalChain(expr.expression);
    }
    if (ts.isElementAccessExpression(expr)) {
      if (!isGlobalChain(expr.expression)) return false;
      const arg = expr.argumentExpression;
      if (arg !== undefined && ts.isStringLiteral(arg)) return arg.text === "process";
      return true;
    }
    return false;
  };
  const isProcessEnv = (expr: ts.Expression): boolean => {
    if (ts.isPropertyAccessExpression(expr)) {
      return expr.name.text === "env" && isProcessRef(expr.expression);
    }
    if (ts.isElementAccessExpression(expr)) {
      if (!isProcessRef(expr.expression)) return false;
      const arg = expr.argumentExpression;
      if (arg !== undefined && ts.isStringLiteral(arg)) return arg.text === "env";
      return true;
    }
    return false;
  };
  const isBareProcessEnv = (expr: ts.Expression): boolean => {
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
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isProcessRef(node)) {
      keys.add("<dynamic>");
    }
    if (ts.isIdentifier(node) && node.text === "process" && !isProcessEnv(node.parent as ts.Expression)) {
      keys.add("<dynamic>");
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      (isProcessRef(node.initializer) || isGlobalChain(node.initializer))
    ) {
      keys.add("<dynamic>");
    }
    if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
      if (isBareProcessEnv(node.expression)) keys.add(node.name.text);
      else keys.add("<dynamic>");
    } else if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) {
      const arg = node.argumentExpression;
      if (isBareProcessEnv(node.expression) && arg !== undefined && ts.isStringLiteral(arg)) keys.add(arg.text);
      else keys.add("<dynamic>");
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      isProcessEnv(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      if (!isBareProcessEnv(node.initializer)) {
        keys.add("<dynamic>");
      } else {
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name;
          if (element.dotDotDotToken === undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key))) keys.add(key.text);
          else keys.add("<dynamic>");
        }
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

/**
 * Probes from the three reviews. Each must fail the strict ban, alone and
 * appended to each denial module: indexed global access, type assertions,
 * separate-assignment alias, destructuring and computed string access, plus
 * one probe per remaining forbidden handle.
 */
const FORBIDDEN_PROBES = [
  'void globalThis["process"].env.EXTRA;',
  'void (globalThis["process"] as NodeJS.Process).env.EXTRA;',
  'void (globalThis as typeof globalThis)["process"].env.EXTRA;',
  "void globalThis.process.env.EXTRA;",
  "void global.process.env.EXTRA;",
  'void global["process"].env.EXTRA;',
  "void self.process.env.EXTRA;",
  'void self["process"].env.EXTRA;',
  "void window.process.env.EXTRA;",
  'let runtime: typeof globalThis;\nruntime = globalThis;\nvoid runtime["process"].env["EXTRA"];',
  "const { process } = globalThis; void process;",
  "const { process: probe } = globalThis; void probe;",
  "const p = process; void p;",
  "const env = process.env; void env;",
  "const { PORT } = process.env; void PORT;",
  'void process["env"].EXTRA;',
  'void process.env["EXTRA"];',
  'void process.env["PORT"];',
  'void process["env"]["PORT"];',
  'void globalThis["proc" + "ess"].env.EXTRA;',
  'void process["en" + "v"].EXTRA;',
  "void (process as unknown as { env: { EXTRA: string } }).env.EXTRA;",
  "void (process.env as unknown as Record<string, string>).EXTRA;",
  'void eval("process.env.EXTRA");',
  'void Function("return process.env.EXTRA")();',
  'void Function("return process")().env.EXTRA;',
  'void Reflect.get(globalThis, "process").env.EXTRA;',
  'void Reflect.get(process.env, "EXTRA");',
  'void require("node:process");',
  "void import.meta.env;",
  'import process from "node:process"; void process;',
  'import { env } from "node:process"; void env;',
];

describe("content-deny module isolation", () => {
  it.each(FORBIDDEN_PROBES)("rejects forbidden pattern %s", (probe) => {
    expect(collectViolations(probe as string, "fixture.ts")).not.toEqual([]);
  });

  it.each(FORBIDDEN_PROBES)("refuses forbidden pattern in the denial application (%s)", (probe: string) => {
    expect(collectViolations(`${read("content-deny.ts")}\n${probe}`, "content-deny.ts")).not.toEqual([]);
  });

  it.each(FORBIDDEN_PROBES)("refuses forbidden pattern in the denial entrypoint (%s)", (probe: string) => {
    expect(
      collectViolations(`${read("content-deny-server.ts")}\n${probe}`, "content-deny-server.ts"),
    ).not.toEqual([]);
  });

  it("accepts the single process.env.PORT read as precise", () => {
    const source = "function resolvePort() { const raw = process.env.PORT; }";
    expect(collectViolations(source, "content-deny-server.ts")).toEqual([]);
    expect(countAllowedPortReads(source, "content-deny-server.ts")).toBe(1);
    expect(collectViolations(source, "content-deny.ts")).not.toEqual([]);
    expect(collectViolations("void process.env.PORT;", "content-deny-server.ts")).not.toEqual([]);
  });

  it("refuses the bracket spelling of the PORT read", () => {
    expect(collectViolations('void process.env["PORT"];', "fixture.ts")).not.toEqual([]);
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
