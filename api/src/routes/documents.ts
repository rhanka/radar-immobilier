import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import {
  normalizeRawRef,
  resolveDocShaToRawRef,
  resolveRawContentType,
} from "../services/sources/document-resolver.js";

export interface DocumentsDeps {
  store: ObjectStore;
  /**
   * Store holding the scraped raw documents (PV PDFs). In production this is
   * the SCW `…-docs` bucket (`getScrapeObjectStore`). Falls back to `store`
   * when not provided so local/test setups with a single store keep working.
   */
  scrapeStore?: ObjectStore;
}

async function streamRaw(store: ObjectStore, rawRef: string): Promise<Response> {
  const head = await store.head(rawRef);
  if (!head) {
    return Response.json({ ok: false, error: "document_not_found" }, { status: 404 });
  }
  const [bytes, contentType] = await Promise.all([
    store.get(rawRef),
    resolveRawContentType(store, rawRef),
  ]);
  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}

export function documentsRoute(deps: DocumentsDeps): Hono {
  const app = new Hono();
  const docStore = deps.scrapeStore ?? deps.store;

  app.get("/api/documents/raw", async (c) => {
    const rawRef = c.req.query("rawRef");
    const normalizedRawRef = rawRef ? normalizeRawRef(rawRef) : null;
    if (!normalizedRawRef) {
      return c.json({ ok: false, error: "invalid_raw_ref" }, 400);
    }
    return streamRaw(docStore, normalizedRawRef);
  });

  // Stream a raw document (PV PDF) by its content hash. Resolves the docSha to
  // a CAS rawRef — via `.meta.json` siblings when present, else by scanning the
  // CAS layout `raw/<source>/cas/<docSha>.<ext>`. This is the URL behind the
  // UI "PDF" button, which only knows a signal's `docSha`.
  app.get("/api/documents/pdf/:docSha", async (c) => {
    const docSha = c.req.param("docSha");
    const rawRef = docSha ? await resolveDocShaToRawRef(docStore, docSha) : null;
    if (!rawRef) {
      return c.json({ ok: false, error: "document_not_found" }, 404);
    }
    return streamRaw(docStore, rawRef);
  });

  return app;
}
