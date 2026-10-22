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
    ["globalThis[\"process\"].env.EXTRA", ["<dynamic>"]],
    ["global.process.env.EXTRA", ["<dynamic>"]],
    ["global[\"process\"].env.EXTRA", ["<dynamic>"]],
    ["self.process.env.EXTRA", ["<dynamic>"]],
    ["globalThis[\"proc\" + \"ess\"].env.EXTRA", ["<dynamic>"]],
    ["process[\"en\" + \"v\"].EXTRA", ["<dynamic>"]],
    ["globalThis.process.env[key]", ["<dynamic>"]],
    ["const { EXTRA } = globalThis.process.env", ["<dynamic>"]],
    ["const { process } = globalThis", ["<dynamic>"]],
    ["const p = globalThis.process", ["<dynamic>"]],
    ["process.env.PORT", ["PORT"]],
  ])("detects environment access in %s", (source, expected) => {
    expect(envKeys(source as string, "fixture.ts")).toEqual(expected);
  });

  /** Global-object probes: each must be refused in both denial modules. */
  const GLOBAL_PROCESS_PROBES = [
    'void globalThis["process"].env.EXTRA;',
    "void globalThis.process.env.EXTRA;",
    "void global.process.env.EXTRA;",
    "void self.process.env.EXTRA;",
    'void globalThis["proc" + "ess"].env.EXTRA;',
    "const { process: probe } = globalThis; void probe.env.EXTRA;",
  ];

  it.each(GLOBAL_PROCESS_PROBES)("refuses global process access in the denial application (%s)", (probe: string) => {
    expect(envKeys(`${read("content-deny.ts")}\n${probe}`, "content-deny.ts")).toContain("<dynamic>");
  });

  it.each(GLOBAL_PROCESS_PROBES)("refuses global process access in the denial entrypoint (%s)", (probe: string) => {
    expect(envKeys(`${read("content-deny-server.ts")}\n${probe}`, "content-deny-server.ts")).toContain("<dynamic>");
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
