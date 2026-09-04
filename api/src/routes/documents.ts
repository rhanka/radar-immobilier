import { Hono } from "hono";

import type { ObjectReader, ObjectStore } from "../storage/object-store.js";
import { isMissingObjectError } from "../storage/s3-object-store.js";
import {
  geoKeyCandidates,
  normalizeRawRef,
  resolveRawContentType,
  type GeoKeyIndex,
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
   * a PV whose rawRef yields geo CAS candidates is served STRICTLY from
   * `geoDocumentsReader` (read-only) instead of the immo stores — zero-copy, no
   * fallback to immo when every geo candidate misses (a genuine 404 for that
   * cutover). A rawRef with no candidates (non-PV docs, sidecars) still resolves
   * through the legacy immo stores exactly as before, flag on or off.
   */
  geoDocumentsReader?: ObjectReader;
  /** Master switch for the repoint; default false preserves the immo resolver. */
  geoDocumentsRepoint?: boolean;
  /**
   * Frozen geo url→key index (geo-socle #274). When present with the repoint on,
   * a PV whose sha-preserving `mapToGeoKey` MISSES is retried via its source url
   * (`sourceUrl` query param) → this index → geo key. Fixes the ~0.9% re-scrape
   * divergence (and the docx `.bin`/`.html`→`.docx` gap) that the pure rewrite
   * cannot. Absent index = today's sha-only behavior, unchanged.
   */
  geoKeyIndex?: GeoKeyIndex;
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
    const sourceUrl = c.req.query("sourceUrl") ?? null;
    const normalizedRawRef = rawRef ? normalizeRawRef(rawRef) : null;
    if (!normalizedRawRef) {
      return c.json({ ok: false, error: "invalid_raw_ref" }, 400);
    }

    // When the repoint is on AND the rawRef yields PV CAS candidates, probe them
    // in priority order against geo ONLY (zero-copy read-only, no immo fallback).
    // A non-PV key yields no candidate and keeps the untouched legacy path.
    let candidates: { reader: ObjectReader; key: string }[] = legacyStores.map(
      (reader) => ({ reader, key: normalizedRawRef }),
    );
    if (deps.geoDocumentsRepoint && deps.geoDocumentsReader) {
      const geoReader = deps.geoDocumentsReader;
      const geoKeys = geoKeyCandidates(normalizedRawRef, {
        sourceUrl,
        ...(deps.geoKeyIndex ? { index: deps.geoKeyIndex } : {}),
      });
      if (geoKeys.length > 0) {
        candidates = geoKeys.map((key) => ({ reader: geoReader, key }));
      }
    }

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

    // The PAYLOAD object existed at HEAD; if it vanishes before GET (a rare
    // TOCTOU on an otherwise immutable CAS object), that is a genuine 404, not a
    // 500. The catch is scoped to the payload GET ONLY — a miss while resolving
    // the content type (a sidecar TOCTOU) must NOT 404 a document whose bytes
    // were fetched fine. Any non-missing GET fault still propagates — fail loud.
    let bytes: Uint8Array;
    try {
      bytes = await resolved.reader.get(resolved.key);
    } catch (error) {
      if (isMissingObjectError(error)) {
        return c.json({ ok: false, error: "document_not_found" }, 404);
      }
      throw error;
    }
    const contentType = await resolveRawContentType(resolved.reader, resolved.key);

    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  });

  return app;
}
