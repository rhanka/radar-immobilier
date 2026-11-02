/**
 * Official Sentropic design-kit bytes served to artifact readers.
 *
 * The manifest (version, digests, MIME) lives in @radar/artifacts-host so
 * the MCP authoring guide references exactly what this server serves. The
 * stylesheets themselves are vendored under design-assets/ (verbatim
 * upstream bytes) and copied into the runtime image next to the compiled
 * output (see api/Dockerfile). They never count toward the 256 KiB
 * publication budget.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import {
  findDesignKitAsset,
  type DesignKitAsset,
} from "@radar/artifacts-host";

export const DESIGN_KIT_CSS_MIME = "text/css; charset=utf-8" as const;

const cache = new Map<string, string>();

export function getDesignKitCss(asset: DesignKitAsset): string {
  const hit = cache.get(asset.file);
  if (hit !== undefined) return hit;
  const here = dirname(fileURLToPath(import.meta.url));
  // API root and dedicated content-reader entrypoints are bundled at
  // different depths. Both resolve the same deployment-owned directory.
  const directory = existsSync(join(here, "design-assets")) ? here : join(here, "artifacts");
  const css = readFileSync(join(directory, "design-assets", asset.file), "utf8");
  if (Buffer.byteLength(css) !== asset.sizeBytes ||
    createHash("sha256").update(css).digest("hex") !== asset.sha256Hex) {
    throw new Error("design_asset_integrity_failed");
  }
  cache.set(asset.file, css);
  return css;
}

export function resolveDesignKitAsset(kit: string, digest: string, file: string): DesignKitAsset | null {
  return findDesignKitAsset(kit, digest, file);
}

/**
 * Public kit route: digest-pinned, immutable, no session yet (the reader
 * approval page loads it unauthenticated). Mount once per application
 * origin; the content origins serve the same bytes behind reader auth
 * (see content-serve.ts).
 */
export function createDesignKitApp(): Hono {
  const app = new Hono();
  app.get("/:kit/:digest/:file", (c) => {
    const asset = resolveDesignKitAsset(c.req.param("kit"), c.req.param("digest"), c.req.param("file"));
    if (!asset) return c.json({ error: "not_found" }, 404);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    c.header("Content-Type", DESIGN_KIT_CSS_MIME);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    return c.body(getDesignKitCss(asset));
  });
  return app;
}
