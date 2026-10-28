import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { l5Publication } from "./l5-fixture.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { PUBLISHED_WRITE_DECLARATION } from "../../src/artifacts/published-write-authority.js";

/** PG/S3 fixture setup only. The browser never calls a source Hono app. */
export async function imagePublication(contentBase: string) {
  const h = await l5Publication();
  for (const [person, basket] of [[h.f.contributor, "pertinent"], [h.f.moderator, "a_surveiller"]] as const) {
    await writeScopedPersonalFacet(h.f.db, person.sub, h.f.workspaceId, {
      action: "select", basket, target: h.signal.target, expectedHeadId: null,
      displayedFingerprint: h.signal.fingerprint, commandKey: randomUUID(),
    });
  }
  const params = new URLSearchParams({ workspaceId: h.f.workspaceId, citySlug: h.signal.target.citySlug,
    type: h.signal.target.type, id: h.signal.target.id });
  const script = `
    const grant = new URLSearchParams(location.search).get("grant");
    history.replaceState(null,"",location.pathname);
    async function refresh() {
      await window.__pwWriteReady;
      const response = await fetch("/__reader/api/baskets.state.v1?" + ${JSON.stringify(params.toString())},
        {headers:{"x-preview-grant":grant}});
      const data = await response.json();
      if (!response.ok) throw new Error("read_failed_"+response.status);
      const item = data.item, selection = item.facets.selection;
      document.body.dataset.selection = JSON.stringify(selection);
      const basket = selection.pertinent?.state === "active" ? "a_surveiller" : "pertinent";
      const button = document.querySelector("#prepare");
      Object.assign(button.dataset, {pwGesture:"1",pwOperation:"facets.signals.personal.select.v1",
        pwWorkspace:data.workspaceId,pwCity:item.target.citySlug,pwType:item.target.type,pwId:item.target.id,
        pwBasket:basket,pwExpectedHead:selection[basket]?.id??"",pwFingerprint:item.displayedFingerprint,
        pwToken:data.snapshot.baseToken});
      button.disabled=false; document.body.dataset.readReady="1";
    }
    refresh().catch(error=>{document.body.dataset.failure=error.message;});
  `;
  const html = `<!doctype html><html lang="en" data-pw-workspace="${h.f.workspaceId}"><meta charset="utf-8"><title>Published basket actions</title>` +
    '<h1>Published basket actions</h1><button id="prepare" disabled data-pw-gesture>Prepare selection</button>' +
    '<p id="pw-write-note"></p><div id="pw-write-open" hidden></div>' +
    '<button id="pw-write-retry" hidden>Retry</button><button id="pw-write-manual" hidden>Check status</button>' +
    '<pre id="pw-page-receipt"></pre><pre id="pw-live-state"></pre><pre id="pw-live-cards"></pre><pre id="pw-live-counts"></pre>' +
    '<script src="/__reader/write.js"></script><script src="/actions.js"></script></html>';
  const published = await h.control.handle("publish", h.author, { artifactId: h.artifactId, idempotencyKey: randomUUID(), files: [
    { path: "index.html", mimeType: "text/html", text: html },
    { path: "actions.js", mimeType: "text/javascript", text: script },
    { path: "radar-write.json", mimeType: "application/json", text: PUBLISHED_WRITE_DECLARATION },
  ] });
  expect(published.status).toBe(201);
  const releaseId = (published.body as { releaseId: string }).releaseId;
  return { ...h, releaseId, pageHost: `${releaseId}.pinned.${contentBase}`,
    origin: `https://${releaseId}.pinned.${contentBase}` };
}
