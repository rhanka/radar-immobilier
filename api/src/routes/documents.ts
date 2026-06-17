import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import { isSafeRawRef, resolveRawContentType } from "../services/sources/document-resolver.js";

export interface DocumentsDeps {
  store: ObjectStore;
}

export function documentsRoute(deps: DocumentsDeps): Hono {
  const app = new Hono();

  app.get("/api/documents/raw", async (c) => {
    const rawRef = c.req.query("rawRef");
    if (!rawRef || !isSafeRawRef(rawRef)) {
      return c.json({ ok: false, error: "invalid_raw_ref" }, 400);
    }

    const head = await deps.store.head(rawRef);
    if (!head) {
      return c.json({ ok: false, error: "document_not_found" }, 404);
    }

    const [bytes, contentType] = await Promise.all([
      deps.store.get(rawRef),
      resolveRawContentType(deps.store, rawRef),
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

