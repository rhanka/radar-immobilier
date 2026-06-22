import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import { normalizeRawRef, resolveRawContentType } from "../services/sources/document-resolver.js";

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
}

export function documentsRoute(deps: DocumentsDeps): Hono {
  const app = new Hono();

  // CAS PV PDFs live in the scrape bucket; the metadata store is the fallback
  // (legacy objects + sidecars). Probe the scrape store first so the viewer can
  // actually fetch `raw/proces-verbaux-<city>/cas/<sha>.pdf`.
  const stores: ObjectStore[] = deps.scrapeStore
    ? [deps.scrapeStore, deps.store]
    : [deps.store];

  app.get("/api/documents/raw", async (c) => {
    const rawRef = c.req.query("rawRef");
    const normalizedRawRef = rawRef ? normalizeRawRef(rawRef) : null;
    if (!normalizedRawRef) {
      return c.json({ ok: false, error: "invalid_raw_ref" }, 400);
    }

    let resolved: ObjectStore | null = null;
    for (const store of stores) {
      if (await store.head(normalizedRawRef)) {
        resolved = store;
        break;
      }
    }
    if (!resolved) {
      return c.json({ ok: false, error: "document_not_found" }, 404);
    }

    const [bytes, contentType] = await Promise.all([
      resolved.get(normalizedRawRef),
      resolveRawContentType(resolved, normalizedRawRef),
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
