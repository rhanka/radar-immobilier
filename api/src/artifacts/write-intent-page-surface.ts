import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { ApiReaderContext } from "./reader-context.js";
import { PW_PAGE_SCRIPT, PW_PAGE_SCRIPT_HASH } from "./write-intent-page.js";
import { assertWritePrepareBody, type WritePrepareBody } from "./write-intent-schemas.js";
import { readFacetContext } from "../services/facets/classification-context.js";
import { readSignalClassification } from "../services/facets/classification-state.js";
import { searchSignalClassifications, type ClassificationOptions } from "../services/facets/classification-search.js";
import { decodeQuery, StateQuery, SignalQuery, WorkspaceId } from "../services/facets/classification-query.js";

export interface WritePageBootstrap {
  workspaceId: string;
  appOrigin: string;
  pageInstanceId: string;
  csrf: string;
  readGrant: string;
  /** Explicit user choices, resolved by the host under this reader. */
  gestures: readonly WritePrepareBody[];
}
export interface WritePageSurface {
  document(request: Request, reader: ApiReaderContext): Promise<Response>;
  read(operation: "state" | "search", params: URLSearchParams, reader: ApiReaderContext): Promise<unknown>;
}

/** Optional composition port: no default workspace or publisher credentials. */
export function createWritePageSurface(options: { db: Database; store: ObjectStore;
  classification?: ClassificationOptions; bootstrap: (request: Request, reader: ApiReaderContext) => Promise<WritePageBootstrap | null>;
}): WritePageSurface {
  const escape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const json = (value: unknown) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const labels: Record<string, string> = { "personal.select": "Select personal basket", "personal.deselect": "Remove personal basket",
    "personal.discard": "Discard for me", "personal.restore": "Restore for me",
    "workspace.discard": "Discard for workspace", "workspace.restore": "Restore for workspace" };
  return {
    async document(request, reader) {
      const bootstrap = await options.bootstrap(request, reader);
      if (!bootstrap || !bootstrap.pageInstanceId || bootstrap.csrf.length < 32 || !bootstrap.readGrant ||
        new URL(bootstrap.appOrigin).origin !== bootstrap.appOrigin || !bootstrap.appOrigin.startsWith("https://")) {
        return Response.json({ error: "write_transport_closed" }, { status: 503 });
      }
      await readFacetContext(options.db, reader.readerSub, WorkspaceId.parse(bootstrap.workspaceId));
      const buttons = bootstrap.gestures.map((body) => {
        assertWritePrepareBody(body);
        if (body.workspaceId !== bootstrap.workspaceId) throw new Error("Write page workspace mismatch");
        const fields = { operation: body.operation, workspace: body.workspaceId, city: body.target.citySlug,
          type: body.target.type, id: body.target.id, basket: body.basket, reason: body.reasonCode,
          deselect: body.deselect?.join(","), "expected-head": body.expectedHeadId ?? "",
          "expected-heads": body.expectedSelectionHeads === undefined ? undefined : JSON.stringify(body.expectedSelectionHeads),
          fingerprint: body.displayedFingerprint, token: body.expectedProjectionToken };
        const attrs = Object.entries(fields).filter(([, value]) => value !== undefined)
          .map(([name, value]) => `data-pw-${name}="${escape(String(value))}"`).join(" ");
        return `<button type="button" data-pw-gesture ${attrs}>${escape(labels[body.operation.replace(/^facets.signals\./, "").replace(/\.v1$/, "")] ?? "Prepare action")}</button>`;
      }).join("\n");
      const { gestures: _gestures, ...privateBootstrap } = bootstrap;
      const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Basket actions</title>
        <h1>Prepare basket actions</h1><p>Each action requires your explicit confirmation in the application.</p>${buttons}
        <p id="pw-write-note" role="status"></p><div id="pw-write-open" hidden></div>
        <button id="pw-write-retry" hidden>Retry the same preparation</button><button id="pw-write-manual" hidden>Check once</button>
        <pre id="pw-page-receipt"></pre><pre id="pw-live-state"></pre><pre id="pw-live-cards"></pre><pre id="pw-live-counts"></pre>
        <script id="pw-page-bootstrap" type="application/json">${json({ ...privateBootstrap, readerSub: reader.readerSub })}</script>
        <script>${PW_PAGE_SCRIPT}</script></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store",
        "Content-Security-Policy": `default-src 'self'; script-src 'sha256-${PW_PAGE_SCRIPT_HASH}'; connect-src 'self'; worker-src 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'` } });
    },
    async read(operation, params, reader) {
      const deps = { db: options.db, store: options.store, ...(options.classification ? { classification: options.classification } : {}) };
      if (operation === "state") {
        const { workspaceId, ...query } = decodeQuery(params, StateQuery.extend({ workspaceId: WorkspaceId }));
        return readSignalClassification(deps, reader.readerSub, workspaceId, query);
      }
      const { workspaceId, ...query } = decodeQuery(params, SignalQuery.extend({ workspaceId: WorkspaceId }));
      return searchSignalClassifications(deps, reader.readerSub, workspaceId, query);
    },
  };
}
