// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postcss, { type ChildNode, type Node, type Root } from "postcss";
import tailwind from "@tailwindcss/postcss";
import { beforeAll, describe, expect, it } from "vitest";

describe("global UI styles", () => {
  let root: Root;

  beforeAll(async () => {
    const from = fileURLToPath(new URL("./app.css", import.meta.url));
    const css = await readFile(from, "utf8");
    root = (await postcss([tailwind({ optimize: false })]).process(css, { from })).root;
  });

  function declarations(selector: string): Record<string, string> {
    const values: Record<string, string> = {};
    root.walkRules((rule) => {
      const selectors = [selector, `${selector}:focus`, `:where(${selector} > :not(:last-child))`];
      if (!selectors.includes(rule.selector)) return;
      rule.walkDecls((decl) => { values[decl.prop] = decl.value; });
    });
    return values;
  }

  function layerOf(node: ChildNode): string | undefined {
    let parent: Node | undefined = node.parent;
    while (parent && parent.type !== "root") {
      if (parent instanceof postcss.AtRule && parent.name === "layer") return parent.params;
      parent = parent.parent;
    }
    return undefined;
  }

  it("should let layered typography utilities override native control resets", () => {
    const resetLayers: (string | undefined)[] = [];
    root.walkRules((rule) => {
      if (!rule.selector.split(",").some((part) => part.trim() === "input")) return;
      rule.walkDecls((decl) => {
        if (["font", "font-size", "font-weight", "line-height"].includes(decl.prop)) {
          resetLayers.push(layerOf(decl));
        }
      });
    });
    expect(resetLayers.length).toBeGreaterThan(0);
    expect(resetLayers.every((layer) => layer === "base")).toBe(true);
    for (const selector of [".text-sm", ".font-semibold", ".leading-5"]) {
      const layers: (string | undefined)[] = [];
      root.walkRules((rule) => {
        if (rule.selector === selector) layers.push(layerOf(rule));
      });
      expect(layers).toEqual(["utilities"]);
    }
  });

  it("should space zero-margin map notices independently of their margins", async () => {
    for (const path of [
      "./lib/components/maps/SignauxMapView.svelte",
      "./lib/components/sources-map/SourceCoverageMap.svelte",
    ]) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      const noticeClass = source.match(/<div class="([^"]+)"[^>]*>\s*<!--[^<]*-->\s*\{#if zonesLoading\}\s*<p class="m-0 font-semibold text-slate-500">Chargement des zones/);
      expect(noticeClass).not.toBeNull();
      const classes = noticeClass![1]!.split(" ");
      expect(classes).toEqual(expect.arrayContaining(["flex", "flex-col", "gap-1"]));
      expect(classes).not.toContain("space-y-1");
    }
    expect(declarations(".gap-1").gap).toBe("var(--spacing)");
    expect(declarations(":root, :host")["--spacing"]).toBe("0.25rem");
  });

  it("should retain card and legend radii and shadows", () => {
    expect(declarations(".rounded-xs")["border-radius"]).toBe("var(--radius-xs)");
    expect(declarations(".rounded-sm")["border-radius"]).toBe("var(--radius-sm)");
    expect(declarations(".shadow-xs")["--tw-shadow"]).toContain("0 1px 2px 0");
    const theme = declarations(":root, :host");
    expect(theme["--radius-xs"]).toBe("0.125rem");
    expect(theme["--radius-sm"]).toBe("0.25rem");
  });

  it("should retain the palette and resolve semantic colors on the themed element", () => {
    expect(declarations(":root, :host")["--color-teal-600"]).toBe("#0d9488");
    expect(declarations(":root, :host")["--color-slate-200"]).toBe("#e2e8f0");
    expect(declarations(".text-radar-teal").color)
      .toBe("var(--st-semantic-action-primary)");
    expect(declarations(".text-radar-ink").color).toBe("var(--st-semantic-text-primary)");
  });

  it("should generate accessible focus outlines and explicit focus rings", () => {
    expect(declarations(".focus\\:outline-hidden").outline).toBe("2px solid transparent");
    expect(declarations(".focus\\:ring-1")["--tw-ring-shadow"]).toContain("1px");
    expect(declarations(".focus\\:ring-teal-300")["--tw-ring-color"])
      .toBe("var(--color-teal-300)");
  });

  it("should generate spacing and dividers for lists and responsive panels", () => {
    expect(declarations(".space-y-2")["margin-block-end"]).toBeDefined();
    expect(declarations(".divide-y")["border-bottom-width"]).toBeDefined();
    expect(declarations(".lg\\:divide-x")["border-inline-end-width"]).toBeDefined();
  });
});
