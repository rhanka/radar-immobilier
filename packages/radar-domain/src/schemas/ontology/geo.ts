import { z } from "zod";

/**
 * Geospatial provenance for a node carrying a PostGIS geometry
 * (SPEC_ONTOLOGY §4, "nullable PostGIS `geom` + `geomSource`").
 *
 * The relational projection holds the actual `geometry(...,4326)` column; in the
 * Zod layer the geometry is represented as an optional WKT/GeoJSON-ish string so
 * the domain stays storage-agnostic. `geom` is ALWAYS nullable: anti-invention
 * (rules cardinales §0.2) forbids fabricating a polygon we did not obtain — a
 * missing geometry is an explicit `null`, never a guessed shape.
 *
 * `geomSource` records HOW the geometry was obtained (open-data, municipal WMS,
 * vectorised PDF, street-name hypothesis…) so the score can audit it; it reuses
 * the same taxonomy as `ZonePolygonSource` (opportunity.ts) plus a `none` value
 * for the null case.
 */
export const GeomSource = z.enum([
  "open-data-ckan",
  "wms-municipal",
  "vectorised-pdf",
  "hypothese-street-name",
  "registry-cadastre",
  "other",
  "none",
]);
export type GeomSourceT = z.infer<typeof GeomSource>;

/**
 * Mixin fields for a geospatially-located node. `geom` is a textual geometry
 * (WKT or GeoJSON string) that the relational layer casts to PostGIS; null when
 * not (yet) available. `geomSource` defaults to `none` when `geom` is null.
 */
export const geoFields = {
  geom: z.string().min(1).nullable().default(null),
  geomSource: GeomSource.default("none"),
};

/** A standalone schema asserting the geo invariant (geomSource=none iff geom is null). */
export const GeoLocated = z
  .object(geoFields)
  .refine((g) => (g.geom === null) === (g.geomSource === "none"), {
    message: "geomSource must be 'none' exactly when geom is null",
  });
export type GeoLocatedT = z.infer<typeof GeoLocated>;
