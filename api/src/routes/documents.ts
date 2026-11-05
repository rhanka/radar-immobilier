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
   * `radar-immobilier-docs` on OVH). The RECUEIL/scrape pipeline writes the
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

/** 50 MiB ceiling shared by the public route and the reader op (DoS / memory). */
export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024;

export type RawDocumentRead =
  | { kind: "ok"; bytes: Uint8Array; contentType: string }
  | { kind: "not_found" }
  | { kind: "too_large" };

/**
 * Shared raw-document resolution (legacy immo stores, or the geo repoint for
 * PV CAS keys), used by the public `/api/documents/raw` route and by the
 * J1.2d/e reader op `documents.pv.v1`. The caller supplies an already
 * normalized rawRef; nothing here decides authorization.
 */
export function createRawDocumentReader(deps: DocumentsDeps): (
  normalizedRawRef: string, sourceUrl: string | null,
) => Promise<RawDocumentRead> {
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

  return async (normalizedRawRef, sourceUrl) => {
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
    let resolvedSize: number | undefined = undefined;
    for (const candidate of candidates) {
      const info = await candidate.reader.head(candidate.key);
      if (info) {
        resolved = candidate;
        resolvedSize = info.size;
        break;
      }
    }
    if (!resolved) return { kind: "not_found" };
    if (resolvedSize !== undefined && resolvedSize > MAX_DOCUMENT_SIZE_BYTES) {
      return { kind: "too_large" };
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
      if (isMissingObjectError(error)) return { kind: "not_found" };
      throw error;
    }
    if (bytes.byteLength > MAX_DOCUMENT_SIZE_BYTES) return { kind: "too_large" };
    const contentType = await resolveRawContentType(resolved.reader, resolved.key);
    return { kind: "ok", bytes, contentType };
  };
}

export function documentsRoute(deps: DocumentsDeps): Hono {
  const app = new Hono();
  const readRaw = createRawDocumentReader(deps);

  app.get("/api/documents/raw", async (c) => {
    const rawRef = c.req.query("rawRef");
    const sourceUrl = c.req.query("sourceUrl") ?? null;
    const normalizedRawRef = rawRef ? normalizeRawRef(rawRef) : null;
    if (!normalizedRawRef) {
      return c.json({ ok: false, error: "invalid_raw_ref" }, 400);
    }

    const read = await readRaw(normalizedRawRef, sourceUrl);
    if (read.kind === "not_found") {
      return c.json({ ok: false, error: "document_not_found" }, 404);
    }
    if (read.kind === "too_large") {
      return c.json(
        { ok: false, error: "payload_too_large", message: "Document exceeds maximum size limit (50 MB)" },
        413,
      );
    }
    const { bytes, contentType } = read;

    const isPdf = contentType.toLowerCase().startsWith("application/pdf");
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    };
    if (!isPdf) {
      headers["Content-Disposition"] = "attachment";
    }

    return new Response(new Uint8Array(bytes), { headers });
  });

  return app;
}
