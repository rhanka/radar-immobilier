/**
 * No-write guard: the report module stays free of I/O and never mutates
 * its inputs. Synthetic inputs only.
 */

import { describe, expect, it } from "vitest";
import ts from "typescript";
import { cleanChainInput } from "./fixtures.js";
import { buildLotMigrationReport } from "./report.js";

// Discover future module sources too. Only node:crypto is permitted.
const SOURCES = import.meta.glob<string>(["./**/*.ts", "!./**/*.test.ts"], {
  eager: true,
  query: "?raw",
  import: "default",
});
const ALLOWED_NODE_IMPORT = "node:crypto";
const forbiddenImport = (specifier: string): boolean =>
  specifier !== ALLOWED_NODE_IMPORT && !specifier.startsWith("./");
const NETWORK_CALL = /^(?:(?:globalThis|window)\.)?(?:fetch|WebSocket|XMLHttpRequest)$/;

function collectForbidden(text: string): string[] {
  const parsed = ts.createSourceFile("guard.ts", text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (forbiddenImport(specifier)) {
        found.push(specifier);
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(parsed);
      if (NETWORK_CALL.test(callee)) found.push(callee);
      if (
        callee === "require" ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const argument = node.arguments?.[0];
        if (
          argument &&
          ts.isStringLiteral(argument) &&
          forbiddenImport(argument.text)
        ) {
          found.push(argument.text);
        }
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(parsed) === "console"
    ) {
      found.push(`console.${node.name.getText(parsed)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return found;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("lot-migration-report no-write guard", () => {
  it.each(Object.entries(SOURCES))("keeps %s free of I/O and logging", (_name, text) => {
    expect(collectForbidden(text)).toEqual([]);
  });

  it.each([
    'import { readFile } from "fs/promises";',
    'export * from "../db/client.js";',
    'import "node:https";',
    'fetch("https://synthetic.invalid");',
    'console.log("leak");',
  ])("rejects forbidden dependency, network call, or log sink: %s", (source) => {
    expect(collectForbidden(source)).not.toHaveLength(0);
  });

  it("does not mutate deeply frozen inputs", () => {
    const input = deepFreeze(cleanChainInput());
    const before = JSON.stringify(input);
    const first = buildLotMigrationReport(input);
    expect(buildLotMigrationReport(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
  });
});
