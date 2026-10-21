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

describe("content-deny module isolation", () => {
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

  it("reads only PORT from the environment", () => {
    const names = new Set<string>();
    for (const match of read("content-deny-server.ts").matchAll(/process\.env\[("([^"]+)")\]/g)) {
      const name = match[2];
      if (name !== undefined) names.add(name);
    }
    expect([...names].sort()).toEqual(["PORT"]);
  });
});
