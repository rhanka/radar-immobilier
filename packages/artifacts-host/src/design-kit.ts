/**
 * Official Sentropic design-kit manifest shared by the immo MCP authoring
 * guide and the API content servers.
 *
 * A single versioned definition feeds the guide asset URLs, the reserved
 * content-host path and the reader approval page: the bytes served
 * under `/__artifacts/design/<kit>/<digest>/<file>` are the real upstream
 * stylesheets, pinned by version AND sha256. No floating CDN, no per-page
 * bundle copy. The kit lives outside the 256 KiB publication budget.
 *
 * Provenance:
 * - sent-tech.css: `@sentropic/design-system-themes` 0.11.0 token build
 *   (`tokens/sent-tech.css` of the ds-bundle snapshot).
 * - components.css: `@sentropic/design-system-react` 0.36.46 component
 *   stylesheet (`_ds_bundle.css` of the ds-bundle snapshot, verbatim).
 * - npm now ships design-system-react 0.38.0 ESM-only (no UMD); the
 *   snapshot stays pinned at 0.36.46 until a newer browser bundle is
 *   qualified under the release CSP. Recorded lag, not a silent upgrade.
 */

export const DESIGN_KIT_VERSION = "ds-0.36.46-r1" as const;

export const DESIGN_KIT_REACT_SNAPSHOT = "0.36.46" as const;
export const DESIGN_KIT_THEMES_VERSION = "0.11.0" as const;
export const DESIGN_KIT_THEME = "sent-tech" as const;

export interface DesignKitAsset {
  readonly file: string;
  readonly sha256Hex: string;
  readonly sizeBytes: number;
  readonly mediaType: "text/css";
}

export const DESIGN_KIT_ASSETS: readonly DesignKitAsset[] = Object.freeze([
  {
    file: "sent-tech.css",
    sha256Hex: "925139c5dad7d3f5deba7483ed5bfd5a9394671cd00bbd4bf6c02660065f892e",
    sizeBytes: 112476,
    mediaType: "text/css",
  },
  {
    file: "components.css",
    sha256Hex: "16db33abc8e0655c7c010b7546f97e26e32cad4fafa8718aa6b9cf84d0e3c4ea",
    sizeBytes: 536362,
    mediaType: "text/css",
  },
]);

export function designKitAssetUrl(asset: DesignKitAsset): string {
  return `/__artifacts/design/${DESIGN_KIT_VERSION}/${asset.sha256Hex}/${asset.file}`;
}

export function findDesignKitAsset(
  kit: string,
  digest: string,
  file: string,
): DesignKitAsset | null {
  if (kit !== DESIGN_KIT_VERSION) return null;
  if (!/^[0-9a-f]{64}$/.test(digest)) return null;
  const asset = DESIGN_KIT_ASSETS.find((entry) => entry.file === file);
  if (!asset || asset.sha256Hex !== digest.toLowerCase()) return null;
  return asset;
}
