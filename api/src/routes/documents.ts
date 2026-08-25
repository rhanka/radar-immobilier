import { Hono } from "hono";

import type { ObjectReader, ObjectStore } from "../storage/object-store.js";
import {
  mapToGeoKey,
  normalizeRawRef,
  resolveRawContentType,
} from "../services/sources/document-resolver.js";

export interface DocumentsDeps {
  store: ObjectStore;
  /**
   * Dedicated store for raw scraped documents (CAS PV PDFs live here:
   * `radar-immobilier-docs` on SCW). The RECUEIL/scrape pipeline writes the
   * binary bytes under `raw/proces-verbaux-<city>/cas/<sha>.pdf` to THIS bucket,
   * NOT to `store` (which only holds raw-metadata + project state). When absent
   * (tests/local without SCRAPE_S3_*), `store` handles everything.
   */
  scrapeStore?: ObjectStore;
  /**
   * immo→geo document repoint (default OFF). When `geoDocumentsRepoint` is true,
   * a PV whose rawRef maps to a geo CAS key (`mapToGeoKey`) is served STRICTLY
   * from `geoDocumentsReader` (read-only) instead of the immo stores — zero-copy,
   * no fallback to immo on a geo miss (a miss is a genuine 404 for that cutover).
   * A rawRef that does NOT map (non-PV docs, sidecars) still resolves through the
   * legacy immo stores exactly as before, flag on or off.
   */
  geoDocumentsReader?: ObjectReader;
  /** Master switch for the repoint; default false preserves the immo resolver. */
  geoDocumentsRepoint?: boolean;
}

export function documentsRoute(deps: DocumentsDeps): Hono {
  const app = new Hono();

  // Fail fast on an inconsistent wiring rather than silently degrading to immo
  // when the operator intended the geo cutover.
  if (deps.geoDocumentsRepoint && !deps.geoDocumentsReader) {
    throw new Error(
      "geoDocumentsReader is required when geoDocumentsRepoint is enabled",
    );
  }

  // CAS PV PDFs live in the scrape bucket; the metadata store is the fallback
  // (legacy objects + sidecars). Probe the scrape store first so the viewer can
  // actually fetch `raw/proces-verbaux-<city>/cas/<sha>.pdf`.
  const legacyStores: ObjectReader[] = deps.scrapeStore
    ? [deps.scrapeStore, deps.store]
    : [deps.store];

  app.get("/api/documents/raw", async (c) => {
    const rawRef = c.req.query("rawRef");
    const normalizedRawRef = rawRef ? normalizeRawRef(rawRef) : null;
    if (!normalizedRawRef) {
      return c.json({ ok: false, error: "invalid_raw_ref" }, 400);
    }

    // When the repoint is on AND the rawRef is a PV CAS key, serve it ONLY from
    // geo (zero-copy read-only, no immo fallback). Otherwise fall back to the
    // legacy immo stores with the untouched rawRef.
    const geoKey =
      deps.geoDocumentsRepoint && deps.geoDocumentsReader
        ? mapToGeoKey(normalizedRawRef)
        : null;
    const candidates: { reader: ObjectReader; key: string }[] =
      geoKey && deps.geoDocumentsReader
        ? [{ reader: deps.geoDocumentsReader, key: geoKey }]
        : legacyStores.map((reader) => ({ reader, key: normalizedRawRef }));

    let resolved: { reader: ObjectReader; key: string } | null = null;
    for (const candidate of candidates) {
      if (await candidate.reader.head(candidate.key)) {
        resolved = candidate;
        break;
      }
    }
    if (!resolved) {
      return c.json({ ok: false, error: "document_not_found" }, 404);
    }

    const [bytes, contentType] = await Promise.all([
      resolved.reader.get(resolved.key),
      resolveRawContentType(resolved.reader, resolved.key),
    ]);

    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  });

  return app;
}
