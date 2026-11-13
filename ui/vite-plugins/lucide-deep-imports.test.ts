// @vitest-environment node
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, parseAst, type Plugin } from "vite";
import { describe, expect, it, vi } from "vitest";
import { lucideDeepImports, readLucideIconIndex } from "./lucide-deep-imports";

const req = createRequire(import.meta.url);
const distDir = dirname(req.resolve("@lucide/svelte"));
const APP = fileURLToPath(new URL("../src/Widget.svelte", import.meta.url));
const DS = join(dirname(req.resolve("@sentropic/design-system-svelte")), "Select.svelte");

type Transform = (this: unknown, code: string, id: string) => { code: string } | null;

async function run(code: string, id = APP) {
  const plugin = lucideDeepImports();
  const warn = vi.fn();
  const ctx = {
    parse: (src: string) => parseAst(src),
    warn,
    error: (msg: string) => {
      throw new Error(msg);
    },
  };
  const out = await (plugin.transform as Transform).call(ctx, code, id);
  return { out: out?.code ?? null, warn };
}

describe("readLucideIconIndex", () => {
  const index = readLucideIconIndex(distDir);

  it("maps icon names and every alias family to the deep module stem", () => {
    expect(index.get("Check")).toBe("check");
    expect(index.get("AlertCircle")).toBe("alert-circle"); // deprecated alias, own shim to circle-alert.svelte
    expect(index.get("LucideCheck")).toBe("check");
    expect(index.get("CheckIcon")).toBe("check");
    expect(index.get("Map")).toBe("map");
  });

  it("excludes barrel exports that are not icons", () => {
    expect(index.has("Icon")).toBe(false);
    expect(index.has("defaultAttributes")).toBe(false);
    expect(index.has("icons")).toBe(false);
  });

  it("fails clearly on a directory that holds no icon", () => {
    expect(() => readLucideIconIndex(dirname(fileURLToPath(import.meta.url)))).toThrow(/no icon found/);
  });
});

describe("lucideDeepImports transform", () => {
  it("is a build-only plugin", () => {
    expect(lucideDeepImports().apply).toBe("build");
  });

  it("rewrites named imports, aliases and multi-line lists into one import per icon", async () => {
    const { out } = await run(
      'import { Check, Map as MapIcon,\n  AlertCircle } from "@lucide/svelte";\nimport { X } from \'@lucide/svelte\';\nconst a = [Check, MapIcon, AlertCircle, X];\n',
    );
    expect(out).toBe(
      'import Check from "@lucide/svelte/icons/check"; import MapIcon from "@lucide/svelte/icons/map"; '
        + 'import AlertCircle from "@lucide/svelte/icons/alert-circle";\n'
        + 'import X from "@lucide/svelte/icons/x";\nconst a = [Check, MapIcon, AlertCircle, X];\n',
    );
  });

  it("covers design-system modules under node_modules", async () => {
    expect(DS).toMatch(/node_modules\/@sentropic\/design-system-svelte\//);
    const { out } = await run('import { ChevronDown } from "@lucide/svelte";\nexport { ChevronDown };\n', DS);
    expect(out).toBe('import ChevronDown from "@lucide/svelte/icons/chevron-down";\nexport { ChevronDown };\n');
  });

  it("leaves non-named forms untouched and warns that the barrel stays", async () => {
    const code = [
      'import * as L from "@lucide/svelte";',
      'import Lucide, { Check } from "@lucide/svelte";',
      'export { X } from "@lucide/svelte";',
      'import "@lucide/svelte";',
      'import Check2 from "@lucide/svelte/icons/check";',
      "",
    ].join("\n");
    const { out, warn } = await run(code);
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("ignores modules that do not import @lucide/svelte and non-script ids", async () => {
    expect((await run('import { Check } from "other";')).out).toBeNull();
    expect((await run('// mentions @lucide/svelte only\nexport const a = 1;\n')).out).toBeNull();
    const css = 'import { Check } from "@lucide/svelte";';
    expect((await run(css, "/app/src/Widget.svelte?svelte&type=style&lang.css")).out).toBeNull();
    expect((await run(css, "/app/docs/report.md")).out).toBeNull();
  });

  it("fails the build on a name that has no deep module", async () => {
    await expect(run('import { Check, NotAnIcon } from "@lucide/svelte";')).rejects.toThrow(
      /"NotAnIcon" imported from @lucide\/svelte in .*\/src\/Widget\.svelte has no deep module/,
    );
    await expect(run('import { Icon } from "@lucide/svelte";')).rejects.toThrow(/"Icon"/);
  });

  it("fails clearly when the importer cannot resolve @lucide/svelte", async () => {
    await expect(run('import { Check } from "@lucide/svelte";', "/nowhere/src/A.svelte")).rejects.toThrow(
      /cannot resolve @lucide\/svelte from \/nowhere\/src\/A\.svelte/,
    );
  });
});

describe("lucideDeepImports in a real vite build", () => {
  it("keeps the barrel out of the module graph and bundles only the used icons", async () => {
    const root = fileURLToPath(new URL("./fixtures", import.meta.url));
    // Every module Rollup loaded, tree-shaken or not: the cost is in loading them.
    let graph: string[] = [];
    const census: Plugin = {
      name: "census",
      generateBundle() {
        graph = [...this.getModuleIds()].filter((id) => id.includes("@lucide/svelte"));
      },
    };
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [svelte() as Plugin[], lucideDeepImports(), census],
      resolve: { conditions: ["browser", "svelte", "module", "import", "default"] },
      build: { write: false, rollupOptions: { input: `${root}/entry.js` } },
    });
    expect(graph.some((id) => id.endsWith("lucide-svelte.js"))).toBe(false);
    expect(graph.some((id) => /\/icons\/index\.js$/.test(id))).toBe(false);
    expect(graph.filter((id) => /\/icons\/[^/]+\.svelte$/.test(id)).map((id) => id.replace(/^.*\//, "")).sort())
      .toEqual(["check.svelte", "circle-alert.svelte"]);
  }, 60_000);
});
