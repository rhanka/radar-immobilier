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

  it("has no forbidden reference in the denial application", () => {
    expect(collectViolations(read("content-deny.ts"), "content-deny.ts")).toEqual([]);
    expect(countAllowedPortReads(read("content-deny.ts"), "content-deny.ts")).toBe(0);
  });

  it("allows only the single process.env.PORT read in the denial entrypoint", () => {
    expect(collectViolations(read("content-deny-server.ts"), "content-deny-server.ts")).toEqual([]);
    expect(countAllowedPortReads(read("content-deny-server.ts"), "content-deny-server.ts")).toBe(1);
  });
});
