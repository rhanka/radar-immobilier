import type { Database } from "../db/client.js";
import { readFacetContext } from "../services/facets/classification-context.js";
import { WorkspaceId } from "../services/facets/classification-query.js";
import { FacetError } from "../services/facets/target.js";
import { verifyGrant, type GrantIssuer } from "./preview-grant.js";
import type { createPublishedWritePage } from "./published-write-page.js";
import { PW_BOOTSTRAP_PATH } from "./published-write-page.js";
import { PW_PAGE_SCRIPT } from "./write-intent-page.js";

/** The release chooses a workspace; only the current reader can authorize it. */
export async function publishedWriteBootstrap(request: Request, options: {
  db: Database; page: ReturnType<typeof createPublishedWritePage>;
  readIssuer: GrantIssuer; readGrantSecret: string; appOrigin: string;
}) {
  const reader = await options.page.authenticate(request);
  if (!reader) throw new FacetError(401, "write_grant_required");
  const selected = WorkspaceId.safeParse(new URL(request.url).searchParams.get("workspaceId"));
  if (!selected.success) throw new FacetError(400, "invalid_facet_command");
  const readGrant = request.headers.get("x-preview-grant") ?? "";
  const claims = await verifyGrant(readGrant, { ...options.readIssuer, host: reader.resource.host },
    options.readGrantSecret, Date.now());
  if (!claims || claims.sessionId !== reader.session.sid || claims.readerSub !== reader.session.readerSub ||
    claims.artifactId !== reader.resource.artifactId || claims.releaseId !== reader.resource.releaseId ||
    claims.profileName !== reader.resource.profileName || claims.profileFingerprint !== reader.resource.profileFingerprint ||
    claims.policyRevision !== reader.resource.policyRevision) throw new FacetError(401, "write_grant_required");
  await readFacetContext(options.db, reader.session.readerSub, selected.data);
  return { workspaceId: selected.data, readerSub: reader.session.readerSub, appOrigin: options.appOrigin,
    pageInstanceId: reader.instance, csrf: reader.csrf, readGrant };
}

/** Served as same-origin JavaScript under the release CSP, without eval. */
export const PUBLISHED_WRITE_SCRIPT = `
(() => {
  "use strict";
  // Capture before the published page removes its read grant from the URL.
  var readGrant = new URLSearchParams(location.search).get("grant");
  var workspaceId = document.documentElement.dataset.pwWorkspace;
  window.__pwWriteReady = (async function () {
    if (!readGrant || !workspaceId) throw new Error("Select an authorized workspace");
    var controller=typeof AbortController!=="undefined"?new AbortController():null, timer, body;
    try {
      body=await Promise.race([(async function() {
        var response = await fetch(${JSON.stringify(PW_BOOTSTRAP_PATH)}+"?"+new URLSearchParams({workspaceId:workspaceId}),
          {credentials:"same-origin",headers:{"x-preview-grant":readGrant},signal:controller?.signal});
        if (!response.ok) throw new Error("Write bootstrap unavailable");
        return await response.json();
      })(),new Promise(function(resolve,reject) {
        timer=setTimeout(function(){reject(new Error("Write bootstrap timed out"));if(controller) controller.abort();},15000);
      })]);
    } finally { clearTimeout(timer); }
    var node = document.createElement("script");
    node.id = "pw-page-bootstrap"; node.type = "application/json"; node.textContent = JSON.stringify(body);
    document.documentElement.appendChild(node);
    ${PW_PAGE_SCRIPT}
    document.dispatchEvent(new Event("pw-write-ready"));
  })();
  window.__pwWriteReady.catch(function () {
    document.querySelectorAll("[data-pw-gesture]").forEach(function(button){button.disabled=true;});
  });
})();
`;
