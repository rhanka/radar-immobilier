/**
 * Basemap tile template shared by the Signaux views (J1.1, B1).
 *
 * The normal app build resolves the public OSM raster template below. The
 * artifact build overrides it at build time with VITE_BASEMAP_TILE_URL
 * pointing at the same-origin tile relay
 * (/__artifacts/tiles/v1/osm/{z}/{x}/{y}), so the published SPA emits zero
 * cross-origin tile requests. The OSM attribution string stays in the views
 * and must remain visible in the page (OSM tile usage policy).
 */
export const DEFAULT_BASEMAP_TILE_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function basemapTileTemplate(env: { VITE_BASEMAP_TILE_URL?: string }): string {
  const override = env.VITE_BASEMAP_TILE_URL?.trim();
  return override ? override : DEFAULT_BASEMAP_TILE_URL;
}
