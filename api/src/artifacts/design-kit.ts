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
  findMapKitAsset,
  type DesignKitAsset,
  type MapKitAsset,
} from "@radar/artifacts-host";

export const DESIGN_KIT_CSS_MIME = "text/css; charset=utf-8" as const;
export const DESIGN_KIT_JS_MIME = "text/javascript; charset=utf-8" as const;

export type DesignKitServedAsset = DesignKitAsset | MapKitAsset;

const cache = new Map<string, string>();

/** Fail closed: served bytes must match the pinned digest and size exactly. */
export function assertAssetIntegrity(asset: Pick<DesignKitServedAsset, "sha256Hex" | "sizeBytes">, bytes: string): void {
  if (Buffer.byteLength(bytes) !== asset.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256Hex) {
    throw new Error("design_asset_integrity_failed");
  }
}

export function getDesignKitBytes(asset: DesignKitServedAsset): string {
  const hit = cache.get(asset.file);
  if (hit !== undefined) {
    assertAssetIntegrity(asset, hit);
    return hit;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  // API root and dedicated content-reader entrypoints are bundled at
  // different depths. Both resolve the same deployment-owned directory.
  const directory = existsSync(join(here, "design-assets")) ? here : join(here, "artifacts");
  const bytes = readFileSync(join(directory, "design-assets", asset.file), "utf8");
  assertAssetIntegrity(asset, bytes);
  cache.set(asset.file, bytes);
  return bytes;
}

export function getDesignKitCss(asset: DesignKitAsset): string {
  return getDesignKitBytes(asset);
}

export function designKitMimeFor(asset: DesignKitServedAsset): string {
  return asset.mediaType === "text/javascript" ? DESIGN_KIT_JS_MIME : DESIGN_KIT_CSS_MIME;
}

export function resolveDesignKitAsset(kit: string, digest: string, file: string): DesignKitServedAsset | null {
  return findDesignKitAsset(kit, digest, file) ?? findMapKitAsset(kit, digest, file);
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
    c.header("Content-Type", designKitMimeFor(asset));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    return c.body(getDesignKitBytes(asset));
  });
  return app;
}
