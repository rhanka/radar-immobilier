/** Build the same API and MCP composition from locked, already installed bytes. */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
const external = { name: "workspace-only", setup(b) {
  b.onResolve({ filter: /^[^./]/ }, (a) => a.path.startsWith("@radar/") ? null : { path: a.path, external: true });
} };
await build({ entryPoints: ["api/src/app.ts", "api/src/index.ts"], bundle: true,
  platform: "node", format: "esm", target: "node24", outdir: "api/dist",
  outbase: "api/src", metafile: true, plugins: [external] }).then((result) => {
  writeFileSync("/evidence/api-image-metafile.json", JSON.stringify(result.metafile));
});
await build({ entryPoints: ["packages/immo-mcp/src/server-http.ts", "packages/immo-mcp/src/data-source.ts"],
  bundle: true, splitting: true, platform: "node", format: "esm", target: "node24",
  outdir: "packages/immo-mcp/dist", outbase: "packages/immo-mcp/src", metafile: true,
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
}).then((result) => {
  writeFileSync("/evidence/mcp-image-metafile.json", JSON.stringify(result.metafile));
});
// Exercise compiled entrypoints in the image; database fixtures remain synthetic.
const fixture = "api/tests/integration/mcp-signal-search-network-fixture.ts";
const original = readFileSync(fixture, "utf8");
const changed = original.replace('"../../src/app.js"', '"../../dist/app.js"')
  .replace('"../../../packages/immo-mcp/src/server-http.js"', '"../../../packages/immo-mcp/dist/server-http.js"')
  .replace('"../../../packages/immo-mcp/src/data-source.js"', '"../../../packages/immo-mcp/dist/data-source.js"');
if (changed === original || changed.includes('/src/app.js"') || changed.includes('/src/server-http.js"')
  || changed.includes('/src/data-source.js"')) throw new Error("Image entrypoint substitution failed");
writeFileSync(fixture, changed);
writeFileSync("/evidence/image-fixture-imports.txt", changed.split("\n").filter((s) => s.includes("/dist/")).join("\n") + "\n");
