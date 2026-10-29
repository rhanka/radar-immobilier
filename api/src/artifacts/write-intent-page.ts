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
import { PW_PAGE_BUILD_BODY_SOURCE, PW_PAGE_OPERATIONS, PW_PAGE_POLL_BOUNDS, PW_PAGE_PREPARE_PATH, PW_PAGE_STATUS_PATH } from "./write-intent-page-gesture.js";
import { PW_PAGE_BUDGET_SCRIPT } from "./write-intent-page-budget.js";
import { validPwPageEnvelope } from "./write-intent-page-envelope.js";
import { WRITE_REFUSAL_CODES } from "./write-intent-refusal.js";
import { PW_PAGE_READ_SCRIPT } from "./write-intent-page-read.js";

const PW_PAGE_SCRIPT_PREPARE = `
(() => {
  "use strict";
  var PREPARE = ${JSON.stringify(PW_PAGE_PREPARE_PATH)};
  var buildBody = ${PW_PAGE_BUILD_BODY_SOURCE};
  var operations = ${JSON.stringify(PW_PAGE_OPERATIONS)};
  var validateEnvelope = ${validPwPageEnvelope.toString()};
  var boot = {};
  try { boot = JSON.parse(document.querySelector("#pw-page-bootstrap").textContent); } catch (err) {}
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
    try { buildBody(g, operations); return null; } catch (err) { return err.message; }
  }
  function prepareBody(g) { return buildBody(g, operations); }
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
  var pendingAttempt = null;
  var preparing = false;
  async function prepare(gesture, key) {
    var problem = validGesture(gesture);
    if (problem) { say("This gesture is incomplete (" + problem + ")."); return; }
    preparing = true;
    var dispatched = false;
    var gate = {};
    try {
      if (!boot.pageInstanceId || !boot.csrf || typeof window.__pwReadGesture !== "function") throw new Error("Page bootstrap unavailable");
      // Only a new intention rereads its target. An uncertain retry keeps its exact body/key.
      if (!pendingAttempt) gesture = await window.__pwReadGesture(gesture);
      var freshProblem = validGesture(gesture);
      if (freshProblem) throw new Error("Target state unavailable");
      gate = withTimeout(15000);
      dispatched = true;
      var res = await fetch(PREPARE, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": key,
          "x-reader-instance": boot.pageInstanceId, "x-reader-csrf": boot.csrf },
        body: JSON.stringify(prepareBody(gesture)), signal: gate.signal });
      var data = null;
      try { data = await res.json(); } catch (err) { data = null; }
      var code = data && data.error && typeof data.error.code === "string" ? data.error.code : null;
      if ((res.status === 200 || res.status === 201) && validateEnvelope(data,
        {verb:"prepare",readerSub:boot.readerSub,appOrigin:boot.appOrigin})) {
        pendingAttempt = null;
        say(data.data.state === "committed" || data.data.state === "rejected"
          || data.data.state === "expired" || data.data.state === "revoked"
          ? "Already " + data.data.state + ". Follow the status once for the receipt."
          : "Prepared. Open the application to confirm.");
        openApp(data.data.confirmationUrl, data.data.managementUrl);
        if (typeof window.__pwWritePrepared === "function") window.__pwWritePrepared(data.data.intentId, gesture);
        try {
          if (typeof window.__pwWriteFollowUp === "function") window.__pwWriteFollowUp(data.data.intentId);
        } catch (err) {}
        return;
      }
      if (res.status >= 500 || res.status === 200 || res.status === 201) {
        pendingAttempt = { gesture: gesture, key: key };
        say("Result to verify. Retry the exact gesture below before preparing another.");
        reveal("#pw-write-retry");
      } else if (code === "idempotency_key_conflict") {
        say("This gesture conflicts with another prepared intent. Re-read the target first.");
      } else if (res.status === 401) {
        say("The page session ended. Sign in again on the page, then prepare a new gesture.");
      } else if (res.status === 403) {
        say("The page is not allowed to prepare this gesture.");
      } else if (res.status === 429) {
        say("Too many preparations. Wait, then try again explicitly.");
      } else {
        say("Preparation refused (" + (code || ("http " + res.status)) + "). Correct the gesture and try again.");
      }
    } catch (err) {
      if (dispatched) {
        pendingAttempt = { gesture: gesture, key: key };
        say("The request may still have reached the server. Retry the exact gesture below.");
        reveal("#pw-write-retry");
      } else say("Target refresh failed. Re-read the page before preparing another gesture.");
    } finally {
      preparing = false;
      if (pendingAttempt) reveal("#pw-write-retry");
      if (gate.done) gate.done();
    }
  }
  document.addEventListener("click", function (event) {
    var el = event.target && event.target.closest
      ? event.target.closest("[data-pw-gesture]") : null;
    if (!el || el.disabled) return;
    if (preparing || pendingAttempt) return;
    var key = null;
    try { key = crypto.randomUUID(); } catch (err) { say("This browser cannot mint gesture keys."); return; }
    prepare(gestureFrom(el), key);
  });
  var retryBtn = $("#pw-write-retry");
  if (retryBtn) retryBtn.addEventListener("click", function () {
    if (!pendingAttempt || preparing) return;
    var attempt = pendingAttempt;
    var box = $("#pw-write-retry");
    if (box) box.hidden = true;
    prepare(attempt.gesture, attempt.key);
  });
})();
`;

const PW_PAGE_SCRIPT_POLL = `
(() => {
  "use strict";
  var STATUS = ${JSON.stringify(PW_PAGE_STATUS_PATH)};
  var INTERVAL_MS = ${PW_PAGE_POLL_BOUNDS.intervalMs};
  var WINDOW_MS = ${PW_PAGE_POLL_BOUNDS.windowMs};
  var MAX_POLLS = ${PW_PAGE_POLL_BOUNDS.maxPolls};
  var MANUAL_SPACING_MS = ${PW_PAGE_POLL_BOUNDS.manualSpacingMs};
  var REQUEST_TIMEOUT_MS = ${PW_PAGE_POLL_BOUNDS.requestTimeoutMs};
  var TERMINAL = { committed: 1, rejected: 1, expired: 1, revoked: 1 };
  var validateEnvelope = ${validPwPageEnvelope.toString()};
  var refusalCodes = ${JSON.stringify(WRITE_REFUSAL_CODES)};
  var boot = {};
  try { boot = JSON.parse(document.querySelector("#pw-page-bootstrap").textContent); } catch (err) {}
  function $(sel) { return document.querySelector(sel); }
  function say(text) { var n = $("#pw-write-note"); if (n) n.textContent = text; }
  function reveal(id) { var n = $(id); if (n) n.hidden = false; }
  function withTimeout(ms) {
    if (typeof AbortController === "undefined") return {};
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return { signal: ctrl.signal, done: function () { clearTimeout(timer); } };
  }
  var poll = { timer: null, inFlight: false, intentId: null, startedAt: 0, count: 0,
    stopped: true, manualAt: 0, nextAt: 0, cacheOK: false, restoredLease: false };
  var pollVersion = 0;
${PW_PAGE_BUDGET_SCRIPT}
  function stopPoll() {
    poll.stopped = true;
    if (poll.timer !== null) { clearTimeout(poll.timer); poll.timer = null; }
    checkpointBudget();
  }
  function schedule(ms) {
    if (poll.timer !== null) clearTimeout(poll.timer);
    poll.timer = setTimeout(tick, ms);
  }
  async function checkOnce(intentId, version) {
    var gate = withTimeout(REQUEST_TIMEOUT_MS);
    try {
      var res = await fetch(STATUS + "?intentId=" + encodeURIComponent(intentId),
        { credentials: "same-origin", headers: { accept: "application/json" }, signal: gate.signal });
      var data = null;
      try { data = await res.json(); } catch (err) { data = null; }
      if (res.status === 200 && !validateEnvelope(data,
        {verb:"status",readerSub:boot.readerSub,appOrigin:boot.appOrigin,intentId:intentId},refusalCodes)) {
        return {status:502,data:{error:{code:"upstream_bad_payload"}}};
      }
      if (intentId === poll.intentId && version === pollVersion) poll.nextAt = 0;
      return { status: res.status, retryAfter: res.headers.get("retry-after"), data: data };
    } finally {
      if (gate.done) gate.done();
    }
  }
  function codeOf(data) {
    return data && data.error && typeof data.error.code === "string" ? data.error.code : null;
  }
  async function handleStatus(out, manual, current) {
    var code = codeOf(out.data);
    var state = out.data && out.data.data ? out.data.data.state : null;
    if (out.status === 200 && state && TERMINAL[state]) {
      // Status is complete. Rereading the projection must not lease the next intent's follow-up.
      stopPoll();
      poll.inFlight = false;
      if (state === "committed") {
        var receipt = out.data.data.receipt && out.data.data.receipt.event
          ? out.data.data.receipt.event : {};
        say("Confirmed " + (receipt.basket || "") + " (" + (receipt.state || "") + "). Refresh the target from the page.");
        try {
          if (typeof window.__pwWriteOnCommitted !== "function") throw new Error("Display needs refresh");
          await window.__pwWriteOnCommitted(out.data.data, current);
        } catch (err) { if (current()) say("Classification recorded; display needs refresh. Keep the receipt and use the application link."); }
      } else if (state === "expired") {
        say("Expired. Re-read the target, then prepare a new gesture.");
      } else if (state === "revoked") {
        say("Revoked. No confirmation of this intent is possible.");
      } else {
        say("Refused (" + (out.data.data.error ? out.data.data.error.code : state) + "). Re-read the target, then prepare a new gesture.");
      }
      return;
    }
    if (out.status === 200) return;
    if (out.status === 401) {
      say(code === "write_grant_expired"
        ? "The write grant expired. Re-read the target, then prepare a new gesture."
        : "The page session ended. Sign in again on the page, then prepare a new gesture.");
      stopPoll();
      return;
    }
    if (out.status === 403) {
      say("This page can no longer follow the intent. Open the management link in the application.");
      stopPoll();
      return;
    }
    if (out.status === 429) {
      var wait = Math.min(60, Math.max(INTERVAL_MS / 1000, parseInt(out.retryAfter || "2", 10) || 2));
      poll.nextAt = Math.max(poll.nextAt, Date.now() + wait * 1000);
      poll.restoredLease = true;
      if (!manual) schedule(wait * 1000);
      say("The follow-up is limited. Waiting " + wait + " seconds.");
      return;
    }
    say("Result to verify. Use the manual check below.");
    stopPoll();
    reveal("#pw-write-manual");
  }
  async function tick() {
    poll.timer = null;
    if (poll.stopped) return;
    if (poll.inFlight) { schedule(INTERVAL_MS); return; }
    if (document.hidden) { schedule(INTERVAL_MS); return; }
    var now = Date.now();
    if ((now - poll.startedAt) >= WINDOW_MS || poll.count >= MAX_POLLS) {
      stopPoll();
      say("Result to verify. Use the manual check below.");
      reveal("#pw-write-manual");
      return;
    }
    var flight = {};
    poll.inFlight = flight;
    poll.count += 1;
    poll.nextAt = now + REQUEST_TIMEOUT_MS;
    if (!checkpointBudget()) { poll.inFlight = false; return; }
    var intentId = poll.intentId;
    var version = pollVersion;
    try {
      var out = await checkOnce(intentId, version);
      if (intentId !== poll.intentId || version !== pollVersion) return;
      await handleStatus(out, false, function () { return intentId === poll.intentId && version === pollVersion; });
      if (intentId !== poll.intentId || version !== pollVersion) return;
      var state = out.data && out.data.data ? out.data.data.state : "";
      if (!poll.stopped && !TERMINAL[state] && poll.timer === null) schedule(INTERVAL_MS);
    } catch (err) {
      if (intentId !== poll.intentId || version !== pollVersion) return;
      say("Result to verify. Use the manual check below.");
      stopPoll();
      reveal("#pw-write-manual");
    } finally {
      if (poll.inFlight === flight) poll.inFlight = false;
      if (intentId === poll.intentId && version === pollVersion) {
        poll.nextAt = Math.max(poll.nextAt, Date.now() + INTERVAL_MS);
        checkpointBudget();
      }
    }
  }
  function startPoll(intentId) {
    if (poll.intentId === intentId) return;
    pollVersion += 1;
    stopPoll();
    if (!restoreBudget(intentId)) return;
    var now = Date.now();
    if (poll.stopped || now >= poll.startedAt + WINDOW_MS || MAX_POLLS <= poll.count) {
      stopPoll();
      say("Result to verify. Use the manual check below.");
      reveal("#pw-write-manual");
      return;
    }
    schedule(Math.max(INTERVAL_MS, poll.nextAt - now));
  }
  window.__pwWriteFollowUp = startPoll;
  var manualBtn = $("#pw-write-manual");
  if (manualBtn) manualBtn.addEventListener("click", async function () {
    if (!poll.cacheOK) return;
    if (poll.intentId === null || poll.inFlight) return;
    var now = Date.now();
    if ((poll.restoredLease && now < poll.nextAt) || now - poll.manualAt < MANUAL_SPACING_MS) {
      say("Wait before checking again.");
      return;
    }
    manualBtn.dataset.pwLast = now;
    poll.manualAt = now;
    stopPoll();
    var intentId = poll.intentId;
    var version = pollVersion;
    var flight = {};
    poll.inFlight = flight;
    poll.nextAt = now + REQUEST_TIMEOUT_MS;
    if (!checkpointBudget()) { poll.inFlight = false; return; }
    try {
      var out = await checkOnce(intentId, version);
      if (intentId !== poll.intentId || version !== pollVersion) return;
      await handleStatus(out, true, function () { return intentId === poll.intentId && version === pollVersion; });
    } catch (err) {
      if (intentId !== poll.intentId || version !== pollVersion) return;
      say("Result to verify. Try the manual check again later.");
    } finally {
      if (poll.inFlight === flight) poll.inFlight = false;
      if (intentId === poll.intentId && version === pollVersion) {
        poll.nextAt = Math.max(poll.nextAt, poll.manualAt + MANUAL_SPACING_MS);
        checkpointBudget();
      }
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !poll.stopped && poll.timer === null && !poll.inFlight) schedule(INTERVAL_MS);
  });
})();
`;

export const PW_PAGE_SCRIPT = `${PW_PAGE_READ_SCRIPT}\n${PW_PAGE_SCRIPT_PREPARE}\n${PW_PAGE_SCRIPT_POLL}`;

export const PW_PAGE_SCRIPT_HASH = createHash("sha256")
  .update(PW_PAGE_SCRIPT).digest("base64");
