import { describe, expect, it } from "vitest";
import ts from "typescript";
import { captureWorkbookInventory } from "../inventory.js";
import { buildTestGraphSet, buildTriageWorkbook, syntheticMunicipalities } from "./fixtures.js";
import { buildD3Report } from "./report.js";

// Discover future sources and tests too. Only the local workbook check may read files.
const SOURCES = import.meta.glob<string>(["./**/*.ts", "!./d3-report.local.test.ts"], {
  eager: true, query: "?raw", import: "default",
});
const FORBIDDEN_IMPORT = /(?:^|\/)(?:db|storage|stockage)(?:\/|$)|@aws-sdk|^(?:node:)?(?:fs|https?|http2|net|tls|dns|dgram|child_process)(?:\/|$)|^(?:axios|undici|ws)(?:\/|$)/;
const NETWORK_CALL = /^(?:(?:globalThis|window)\.)?(?:fetch|WebSocket|XMLHttpRequest)$/;

function forbiddenReferences(text: string): string[] {
  const source = ts.createSourceFile("guard.ts", text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
        FORBIDDEN_IMPORT.test(node.moduleSpecifier.text)) {
      found.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(source);
      if (NETWORK_CALL.test(callee)) found.push(callee);
      if (callee === "require" || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments?.[0];
        if (argument && ts.isStringLiteral(argument) && FORBIDDEN_IMPORT.test(argument.text)) {
          found.push(argument.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("d3-report no-write guard", () => {
  it.each(Object.entries(SOURCES))("keeps %s free of I/O", (_name, text) => {
    expect(forbiddenReferences(text)).toEqual([]);
  });

  it.each([
    'import { readFile } from "fs/promises";',
    'export * from "../db/client.js";',
    'const store = import("../storage/s3.js");',
    'const aws = require("@aws-sdk/client-s3");',
    'import "node:https";',
    'fetch ("https://synthetic.invalid");',
    'globalThis.fetch("https://synthetic.invalid");',
    'new WebSocket("wss://synthetic.invalid");',
  ])("rejects forbidden dependency or network call: %s", (source) => {
    expect(forbiddenReferences(source)).not.toHaveLength(0);
  });

  it("does not mutate deeply frozen inventory, graphs or municipalities", () => {
    const inventory = deepFreeze(captureWorkbookInventory(buildTriageWorkbook([
      { city: "Ville Synth A", reglement: "SYN-101", classement: "Synthetic" },
    ])));
    const graphSet = deepFreeze(buildTestGraphSet([{
      slug: "ville-synth-a", nodes: [
        { id: "gn-1", type: "Signal", props: { reglement_number: "SYN-101" } },
      ],
    }]));
    const municipalities = deepFreeze(syntheticMunicipalities());
    const before = JSON.stringify({ inventory, graphSet, municipalities });
    const first = buildD3Report(inventory, graphSet, municipalities);
    expect(first.resolvedTriplets).toBe(1);
    expect(buildD3Report(inventory, graphSet, municipalities)).toEqual(first);
    expect(JSON.stringify({ inventory, graphSet, municipalities })).toBe(before);
  });
});
