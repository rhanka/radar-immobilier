/**
 * PW-C page script: the exact bytes served to pages, hash-pinned by CSP.
 *
 * Two concatenated IIFEs with no shared scope. The prepare part turns an
 * explicit gesture into an idempotent prepare call, opens the application
 * top-level link, and replays the exact key after a lost response. The poll
 * part follows the intent within the fixed budget and hands the receipt to
 * the host page hook. The page can never confirm; confirmation lives in the
 * application surface under the normal session plus the PW CSRF token.
 */
import { createHash } from "node:crypto";
import { PW_PAGE_POLL_BOUNDS, PW_PAGE_PREPARE_PATH, PW_PAGE_STATUS_PATH } from "./write-intent-page-gesture.js";

const PW_PAGE_SCRIPT_PREPARE = `
(() => {
  "use strict";
  var PREPARE = ${JSON.stringify(PW_PAGE_PREPARE_PATH)};
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HEX64 = /^[a-f0-9]{64}$/;
  var CITY = /^[a-z0-9-]{1,128}$/;
  var BASKETS = { pertinent: 1, a_surveiller: 1 };
  function $(sel) { return document.querySelector(sel); }
  function say(text) { var n = $("#pw-write-note"); if (n) n.textContent = text; }
  function reveal(id) { var n = $(id); if (n) n.hidden = false; }
  function gestureFrom(el) {
    var d = el.dataset || {};
    var gesture = { operation: d.pwOperation, workspaceId: d.pwWorkspace,
      target: { citySlug: d.pwCity, type: d.pwType, id: d.pwId },
      displayedFingerprint: d.pwFingerprint, expectedProjectionToken: d.pwToken };
    if (d.pwBasket) gesture.basket = d.pwBasket;
    if (d.pwReason) gesture.reasonCode = d.pwReason;
    if (d.pwDeselect) gesture.deselect = d.pwDeselect.split(",");
    gesture.expectedHeadId = d.pwExpectedHead ? d.pwExpectedHead : null;
    if (d.pwExpectedHeads) {
      try { gesture.expectedSelectionHeads = JSON.parse(d.pwExpectedHeads); }
      catch (err) { gesture.expectedSelectionHeads = "invalid"; }
    }
    return gesture;
  }
  function validGesture(g) {
    if (!g || BASKETS[g.basket] === undefined && g.basket !== undefined) return "basket";
    if (["facets.signals.personal.select.v1", "facets.signals.personal.deselect.v1",
      "facets.signals.personal.discard.v1", "facets.signals.personal.restore.v1",
      "facets.signals.workspace.discard.v1", "facets.signals.workspace.restore.v1"]
      .indexOf(g.operation) === -1) return "operation";
    if (typeof g.workspaceId !== "string" || !UUID.test(g.workspaceId)) return "workspaceId";
    if (!g.target || typeof g.target.citySlug !== "string" || !CITY.test(g.target.citySlug)) return "citySlug";
    if (g.target.type !== "Signal" && g.target.type !== "DesignationEvent") return "type";
    if (typeof g.target.id !== "string" || g.target.id.length < 1 || g.target.id.length > 512) return "id";
    if (g.reasonCode !== undefined && (typeof g.reasonCode !== "string" || g.reasonCode.length < 1
      || g.reasonCode.length > 128)) return "reasonCode";
    if (g.deselect !== undefined) {
      if (!Array.isArray(g.deselect) || g.deselect.length > 2) return "deselect";
      for (var i = 0; i < g.deselect.length; i += 1) if (!BASKETS[g.deselect[i]]) return "deselect";
    }
    if (g.expectedSelectionHeads !== undefined && g.expectedSelectionHeads !== null
      && (typeof g.expectedSelectionHeads !== "object" || Array.isArray(g.expectedSelectionHeads))) {
      return "expectedSelectionHeads";
    }
    if (g.expectedHeadId !== null && g.expectedHeadId !== undefined && !UUID.test(g.expectedHeadId)) return "expectedHeadId";
    if (typeof g.displayedFingerprint !== "string" || !HEX64.test(g.displayedFingerprint)) return "displayedFingerprint";
    if (typeof g.expectedProjectionToken !== "string" || !HEX64.test(g.expectedProjectionToken)) return "expectedProjectionToken";
    return null;
  }
  function prepareBody(g) {
    var body = { operation: g.operation, workspaceId: g.workspaceId,
      target: { citySlug: g.target.citySlug, type: g.target.type, id: g.target.id },
      expectedHeadId: g.expectedHeadId === undefined ? null : g.expectedHeadId,
      displayedFingerprint: g.displayedFingerprint,
      expectedProjectionToken: g.expectedProjectionToken };
    if (g.basket !== undefined) body.basket = g.basket;
    if (g.reasonCode !== undefined) body.reasonCode = g.reasonCode;
    if (g.deselect !== undefined) body.deselect = g.deselect.slice().sort();
    if (g.expectedSelectionHeads !== undefined) body.expectedSelectionHeads = g.expectedSelectionHeads;
    return body;
  }
  function withTimeout(ms) {
    if (typeof AbortController === "undefined") return {};
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return { signal: ctrl.signal, done: function () { clearTimeout(timer); } };
  }
  function openApp(url, manageUrl) {
    var box = $("#pw-write-open");
    if (box) {
      while (box.firstChild) box.removeChild(box.firstChild);
      var link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open in the application";
      box.appendChild(link);
      var manage = document.createElement("a");
      manage.href = manageUrl;
      manage.target = "_blank";
      manage.rel = "noopener noreferrer";
      manage.textContent = "Manage this intent";
      box.appendChild(document.createTextNode(" "));
      box.appendChild(manage);
      box.hidden = false;
    }
    var opened = null;
    try { opened = window.open(url, "_blank", "noopener,noreferrer"); } catch (err) { opened = null; }
    if (!opened) say("The popup was blocked. Use the application link above.");
    return opened;
  }
})();
`;
const PW_PAGE_SCRIPT_POLL = "";
export const PW_PAGE_SCRIPT = `${PW_PAGE_SCRIPT_PREPARE}\n${PW_PAGE_SCRIPT_POLL}`;

export const PW_PAGE_SCRIPT_HASH = createHash("sha256")
  .update(PW_PAGE_SCRIPT).digest("base64");
