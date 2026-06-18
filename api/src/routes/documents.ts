import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import { normalizeRawRef, resolveRawContentType } from "../services/sources/document-resolver.js";

export interface DocumentsDeps {
  store: ObjectStore;
}

export function documentsRoute(deps: DocumentsDeps): Hono {
  const app = new Hono();

  app.get("/api/documents/raw", async (c) => {
    const rawRef = c.req.query("rawRef");
    const normalizedRawRef = rawRef ? normalizeRawRef(rawRef) : null;
    if (!normalizedRawRef) {
      return c.json({ ok: false, error: "invalid_raw_ref" }, 400);
    }

    const head = await deps.store.head(normalizedRawRef);
    if (!head) {
      return c.json({ ok: false, error: "document_not_found" }, 404);
    }

    const [bytes, contentType] = await Promise.all([
      deps.store.get(normalizedRawRef),
      resolveRawContentType(deps.store, normalizedRawRef),
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
