import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { runInNewContext } from "node:vm";
import type { Server } from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), "utf8");

/** Include side-effect imports, re-exports, dynamic imports and require. */
function importSpecifiers(source: string): string[] {
  return [...new Set(ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName))].sort();
}

/**
 * Strict ban for the denial modules: no identifier, property name or
 * computed-access string may reference a global or environment handle, and
 * no `constructor`, `getPrototypeOf` or `__proto__` access may appear in any
 * spelling (identifier, property or computed string). The ban makes aliases
 * impossible: any alias source already fails. This static guard is defense
 * in depth only: it cannot be exhaustive in JavaScript, so the execution
 * guarantee comes from the child process with a reduced environment and the
 * deployment gate (see below).
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
  "constructor",
  "getPrototypeOf",
  "__proto__",
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
  "constructor",
  "getPrototypeOf",
  "__proto__",
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
      (node.arguments[0] === undefined || !ts.isStringLiteral(node.arguments[0]) ||
        FORBIDDEN_IMPORTS.has(node.arguments[0].text))
    ) {
      violations.add(`${file}:${lineOf(node)} forbidden dynamic import ${node.arguments[0]?.getText()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return [...violations].sort();
}

/**
 * Probes from the four reviews. Each must fail the strict ban, alone and
 * appended to each denial module: indexed global access, type assertions,
 * separate-assignment alias, destructuring and computed string access, one
 * probe per remaining forbidden handle, and the prototype-chain constructor
 * bypass (identifier, property and computed spellings).
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
  'const runtime = Object.getPrototypeOf(Response).constructor("return process")();\nvoid runtime.env.EXTRA;',
  "void Object.getPrototypeOf(Response);",
  "void Response.constructor;",
  'void probe.constructor("return process")();',
  'void obj["constructor"];',
  "void ({}).__proto__;",
  'void obj["__proto__"];',
  'void Object["getPrototypeOf"](Response);',
  "void constructor;",
  'void console.log.constructor.call(null, "return process.env.EXTRA")();',
  'void import(["node", "process"].join(":")).then(({ env }) => { void env.EXTRA; });',
];

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer | string) => {
        data += chunk.toString();
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.once("error", reject);
    req.end();
  });
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close((error?: Error) => {
        if (error !== undefined) reject(error);
        else resolve(port);
      });
    });
  });
}

/** Execute the actual modules without instrumenting the test runner's env. */
function executeDenialModules(env: NodeJS.ProcessEnv, servers: Server[]): void {
  const require = createRequire(import.meta.url);
  const application: Record<string, unknown> = {};
  const http = {
    ...require("node:http"),
    createServer: (...args: Parameters<typeof createHttpServer>): Server => {
      const server = createHttpServer(...args);
      servers.push(server);
      return server;
    },
  };
  for (const file of ["content-deny.ts", "content-deny-server.ts"]) {
    const { outputText } = ts.transpileModule(read(file), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, {
      exports: file === "content-deny.ts" ? application : {},
      require: (name: string): unknown => {
        if (name === "./content-deny.js") return application;
        if (name === "node:http") return http;
        return require(name);
      },
      process: { env },
      console,
      Response,
    }, { filename: file });
  }
}

/**
 * Transpile the denial sources into an isolated directory as CommonJS with
 * absolute targets for the three allowed imports. No runtime resolver from
 * the test runner is exposed to the child.
 */
function writeChildBundle(dir: string, appSuffix: string, serverSuffix: string): string {
  const resolve = (specifier: string): string =>
    createRequire(import.meta.url).resolve(specifier);
  const hono = resolve("hono");
  const nodeServer = resolve("@hono/node-server");
  const compile = (name: string, suffix: string): string =>
    ts.transpileModule(read(name) + suffix, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  writeFileSync(
    join(dir, "content-deny.cjs"),
    compile("content-deny.ts", appSuffix).replace(
      /require\(["']hono["']\)/,
      `require(${JSON.stringify(hono)})`,
    ),
  );
  writeFileSync(
    join(dir, "content-deny-server.cjs"),
    compile("content-deny-server.ts", serverSuffix)
      .replace(/require\(["']\.\/content-deny\.js["']\)/, 'require("./content-deny.cjs")')
      .replace(
        /require\(["']@hono\/node-server["']\)/,
        `require(${JSON.stringify(nodeServer)})`,
      ),
  );
  return join(dir, "content-deny-server.cjs");
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if ((child.exitCode !== null || child.signalCode !== null) &&
      child.stdout?.destroyed && child.stderr?.destroyed) resolve(undefined);
    else child.once("close", () => resolve(undefined));
  });
}

/**
 * Start the denial service in a child Node process whose environment holds
 * only PORT. Whatever the code reads, there is nothing else to find: the
 * guarantee is structural, not syntactic.
 */
async function startDenialChild(
  entry: string,
  port: number,
): Promise<{ child: ChildProcess; output: () => string }> {
  const child = spawn(process.execPath, [entry], {
    env: { PORT: ` ${port} ` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  const deadline = Date.now() + 5000;
  try {
    for (;;) {
      try {
        const live = await httpGet(port, "/livez");
        if (live.status === 200) break;
      } catch {
        // Retry until the listener accepts connections.
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`denial child exited early on ${port}: ${output}`);
      }
      if (Date.now() > deadline) throw new Error(`denial child did not start on ${port}: ${output}`);
      await new Promise<void>((resolve) => setTimeout(() => resolve(undefined), 50));
    }
  } catch (error) {
    child.kill("SIGTERM");
    await waitForChildExit(child);
    throw error;
  }
  return { child, output: () => output };
}

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

describe("content-deny runtime environment isolation", () => {
  it.each(["", "  invalid  ", "0", "65536", "1.5"])("preserves invalid PORT diagnostics (%j)", (port) => {
    expect(() => executeDenialModules({ PORT: port }, [])).toThrow(
      `invalid PORT ${JSON.stringify(port)}: expected an integer in 1-65535`,
    );
  });

  it(
    "reads only PORT at runtime",
    async () => {
      const freePort = await findFreePort();
      expect(freePort).toBeGreaterThan(0);
      const readKeys = new Set<string>();
      const target = { ...process.env, PORT: ` ${freePort} ` };
      const trackedEnv = new Proxy(target, {
        get(t, p, r) {
          if (typeof p === "string") readKeys.add(p);
          return Reflect.get(t, p, r);
        },
        has(t, p) {
          if (typeof p === "string") readKeys.add(p);
          return Reflect.has(t, p);
        },
        ownKeys(t) {
          const keys = Reflect.ownKeys(t);
          for (const key of keys) {
            if (typeof key === "string") readKeys.add(key);
          }
          return keys;
        },
        getOwnPropertyDescriptor(t, p) {
          if (typeof p === "string") readKeys.add(p);
          return Reflect.getOwnPropertyDescriptor(t, p);
        },
        set(t, p, value, r) {
          if (typeof p === "string") readKeys.add(p);
          return Reflect.set(t, p, value, r);
        },
      });
      const servers: Server[] = [];
      try {
        executeDenialModules(trackedEnv, servers);
        const deadline = Date.now() + 5000;
        for (;;) {
          try {
            const live = await httpGet(freePort, "/livez");
            if (live.status === 200) break;
          } catch {
            // Retry until the listener accepts connections.
          }
          if (Date.now() > deadline) throw new Error(`denial server did not start on ${freePort}`);
          await new Promise<void>((resolve) => setTimeout(() => resolve(undefined), 50));
        }
        const root = await httpGet(freePort, "/");
        expect(root.status).toBe(404);
        expect(JSON.parse(root.body)).toEqual({ error: "not_found" });
        expect(readKeys).toEqual(new Set(["PORT"]));
      } finally {
        for (const server of servers) {
          await new Promise<void>((resolve) => server.close(() => resolve(undefined)));
        }
      }
    },
    15000,
  );
});
