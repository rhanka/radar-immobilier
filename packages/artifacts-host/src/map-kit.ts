/**
 * Artifact map base kit manifest (I-4) shared by the immo MCP authoring
 * guide and the API content servers.
 *
 * Same regime as the design kit: a single versioned definition feeds the
 * guide asset URLs and the reserved content-host path. The bytes served
 * under `/__artifacts/design/<kit>/<digest>/<file>` are worker-free ESM
 * plus its layout stylesheet, pinned by version AND sha256. No floating
 * CDN, no per-page bundle copy. The kit lives outside the 256 KiB
 * publication budget.
 *
 * Provenance: authored in `api/src/artifacts/design-assets/` (I-4,
 * `feat/artifact-map-socle`), Canvas 2D / SVG only, no worker, no inline
 * styles, no external tile/glyph/font fetch by default.
 */

export const MAP_KIT_VERSION = "map-v1" as const;

export interface MapKitAsset {
  readonly file: string;
  readonly sha256Hex: string;
  readonly sizeBytes: number;
  readonly mediaType: "text/javascript" | "text/css";
}

export const MAP_KIT_ASSETS: readonly MapKitAsset[] = Object.freeze([
  {
    file: "map-base.mjs",
    sha256Hex: "6c29b89a902e1292a965e2970df62e2f30a4f66458b1b98ab17190be976e000e",
    sizeBytes: 30895,
    mediaType: "text/javascript",
  },
  {
    file: "map-base.css",
    sha256Hex: "f1f83ec35652f897b4cee2b06248df17326e2b8e1515c6a9c12bb0dff7316c7f",
    sizeBytes: 1031,
    mediaType: "text/css",
  },
]);

export function mapKitAssetUrl(asset: MapKitAsset): string {
  return `/__artifacts/design/${MAP_KIT_VERSION}/${asset.sha256Hex}/${asset.file}`;
}

export function findMapKitAsset(
  kit: string,
  digest: string,
  file: string,
): MapKitAsset | null {
  if (kit !== MAP_KIT_VERSION) return null;
  if (!/^[0-9a-f]{64}$/.test(digest)) return null;
  const asset = MAP_KIT_ASSETS.find((entry) => entry.file === file);
  if (!asset || asset.sha256Hex !== digest.toLowerCase()) return null;
  return asset;
}
