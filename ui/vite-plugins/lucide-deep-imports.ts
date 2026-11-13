// Rewrite `import { A, B as C } from "@lucide/svelte"` into one default import
// per icon (`import A from "@lucide/svelte/icons/a"`), in the app sources AND in
// the design-system packages under node_modules. The barrel re-exports ~7 000
// icon modules (plus three alias barrels) that Rollup must parse before tree
// shaking drops them; deep imports keep only the icons actually used.
//
// Safe by construction:
// - only `ImportDeclaration`s whose source is exactly `@lucide/svelte` and whose
//   specifiers are ALL named are rewritten; default, namespace, mixed and
//   re-export forms are left as written (and reported with a warning, since
//   they keep the whole barrel in the module graph);
// - the name -> file table is read from the barrel files of the very package
//   the importer resolves to, so aliases (`AlertCircle`, `LucideX`, `XIcon`)
//   map to the same component the barrel exports;
// - a name with no deep module (`Icon`, `defaultAttributes`, a typo, an icon
//   removed upstream) fails the build with the importer and the name.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Plugin } from "vite";

export const LUCIDE_SVELTE = "@lucide/svelte";

/** Export name -> icon file stem (`dist/icons/<stem>.js`). */
export type LucideIconIndex = ReadonlyMap<string, string>;

const REEXPORT = /default\s+as\s+(\w+)\s*\}\s*from\s*['"]([^'"]+)['"]/g;
const STAR = /export\s*\*\s*from\s*['"]\.\/([^'"]+)['"]/g;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/**
 * Read the icon index of an installed `@lucide/svelte` from its `dist` directory:
 * `icons/index.js` plus every alias barrel listed by `aliases/index.js`. Only
 * names whose `icons/<stem>.js` deep module exists are kept.
 */
export function readLucideIconIndex(distDir: string): LucideIconIndex {
  const barrels = [join(distDir, "icons/index.js")];
  const aliasIndex = join(distDir, "aliases/index.js");
  if (existsSync(aliasIndex)) {
    for (const m of stripComments(readFileSync(aliasIndex, "utf8")).matchAll(STAR)) {
      barrels.push(join(distDir, "aliases", m[1]));
    }
  }
  const index = new Map<string, string>();
  for (const barrel of barrels) {
    if (!existsSync(barrel)) continue;
    for (const m of stripComments(readFileSync(barrel, "utf8")).matchAll(REEXPORT)) {
      const target = resolve(dirname(barrel), m[2]);
      const stem = target.replace(/^.*[\\/]/, "").replace(/\.(svelte|js)$/, "");
      if (existsSync(join(distDir, "icons", `${stem}.js`))) index.set(m[1], stem);
    }
  }
  if (index.size === 0) {
    throw new Error(`[lucide-deep-imports] no icon found under ${distDir}; the @lucide/svelte layout changed`);
  }
  return index;
}

// Minimal ESTree shapes used here (Rollup's parser returns ESTree with offsets).
interface Ranged { start: number; end: number }
interface Name { type: "Identifier"; name: string }
interface Str { type: "Literal"; value: string }
interface Specifier {
  type: "ImportSpecifier" | "ImportDefaultSpecifier" | "ImportNamespaceSpecifier";
  imported?: Name | Str;
  local: Name;
}
interface TopLevel extends Ranged {
  type: string;
  source?: { value: unknown } | null;
  specifiers?: Specifier[];
}

const SCRIPT = /\.(?:[cm]?[jt]sx?|svelte)$/;

export function lucideDeepImports(): Plugin {
  const indexByDist = new Map<string, LucideIconIndex>();
  return {
    name: "lucide-deep-imports",
    apply: "build",
    transform(code, id) {
      if (!code.includes(LUCIDE_SVELTE) || id.includes("?") || !SCRIPT.test(id)) return null;
      const body = (this.parse(code) as unknown as { body: TopLevel[] }).body;
      const imports = body.filter((n) => n.source?.value === LUCIDE_SVELTE);
      if (imports.length === 0) return null;

      const named = imports.filter(
        (n) => n.type === "ImportDeclaration" && n.specifiers!.length > 0
          && n.specifiers!.every((s) => s.type === "ImportSpecifier"),
      );
      for (const n of imports) {
        if (!named.includes(n)) {
          this.warn(`${LUCIDE_SVELTE} barrel kept in ${id}: only named imports are rewritten`, n.start);
        }
      }
      if (named.length === 0) return null;

      // Node resolution from the importer, NOT this.resolve(): a Rollup-context
      // resolve of the barrel loads it (and ~2 000 alias modules) back into the
      // module graph, which is what this plugin removes.
      let distDir: string;
      try {
        const from = isAbsolute(id) ? id : join(process.cwd(), "importer.js");
        distDir = dirname(createRequire(from).resolve(LUCIDE_SVELTE));
      } catch {
        return this.error(`cannot resolve ${LUCIDE_SVELTE} from ${id}`);
      }
      let index = indexByDist.get(distDir);
      if (!index) indexByDist.set(distDir, (index = readLucideIconIndex(distDir)));

      let out = code;
      for (const n of [...named].sort((a, b) => b.start - a.start)) {
        const deep = n.specifiers!.map((s) => {
          const name = s.imported!.type === "Identifier" ? s.imported!.name : s.imported!.value;
          const stem = index!.get(name);
          if (!stem) {
            this.error(`"${name}" imported from ${LUCIDE_SVELTE} in ${id} has no deep module `
              + `${LUCIDE_SVELTE}/icons/<name> (not an icon of the installed version)`, n.start);
          }
          return `import ${s.local.name} from ${JSON.stringify(`${LUCIDE_SVELTE}/icons/${stem}`)};`;
        });
        out = out.slice(0, n.start) + deep.join(" ") + out.slice(n.end);
      }
      return { code: out, map: null };
    },
  };
}
