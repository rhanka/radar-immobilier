/**
 * PW-C controlled application script, served inline in the summary,
 * management and login documents and pinned by CSP (sha256 hash).
 *
 * The server renders every label; the script only posts explicit gestures
 * (confirm with challenge + PW CSRF, revoke by intentId) and reports the
 * typed outcomes. No app secret, grant, or session value enters these bytes
 * beyond the private CSRF/challenge bootstrap of the authenticated document.
 */
import { createHash } from "node:crypto";

export const APP_SUMMARY_SCRIPT = `
(() => {
  "use strict";
  var bootNode = document.getElementById("pw-bootstrap");
  if (!bootNode) return;
  var boot = JSON.parse(bootNode.textContent || "{}");
  function $(id) { return document.getElementById(id); }
  function say(text) { var n = $("pw-note"); if (n) n.textContent = text; }
  function reveal(id) { var n = $(id); if (n) n.hidden = false; }
  async function post(url, body) {
    var controller=typeof AbortController!=="undefined"?new AbortController():null, timer;
    try {
      return await Promise.race([(async function() {
        var res = await fetch(url, { method: "POST", credentials: "same-origin",
          ...(controller?{signal:controller.signal}:{}),
          headers: { "content-type": "application/json", "x-artifact-write-csrf": boot.csrf },
          body: JSON.stringify(body) });
        var data = null;
        try { data = await res.json(); } catch (err) { data = null; }
        return { status: res.status, retryAfter: res.headers.get("retry-after"), data: data };
      })(),new Promise(function(resolve,reject) {
        timer=setTimeout(function(){reject(new Error("Result timed out"));if(controller) controller.abort();},15000);
      })]);
    } finally { clearTimeout(timer); }
  }
  function codeOf(out) {
    return out.data && out.data.error && typeof out.data.error.code === "string"
      ? out.data.error.code : null;
  }
  var confirmBtn = $("pw-confirm");
  if (confirmBtn && boot.confirmUrl && boot.challengeToken) {
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      try {
        var out = await post(boot.confirmUrl, { challengeToken: boot.challengeToken });
        var code = codeOf(out);
        if (out.status === 200 && out.data && out.data.state === "committed" && out.data.receipt) {
          var event = out.data.receipt && out.data.receipt.event ? out.data.receipt.event : {};
          $("pw-receipt").hidden = false;
          $("pw-receipt-command").textContent = String(out.data.commandId || "");
          $("pw-receipt-state").textContent = String(event.state || "");
          $("pw-receipt-basket").textContent = String(event.basket || "");
          say("Recorded. Refresh the target from the page.");
          try { if (typeof window.__pwWriteOnCommitted === "function") window.__pwWriteOnCommitted(out.data); } catch (err) {}
        } else if (out.status === 200 && out.data && out.data.executionState === "committed") {
          say("Recorded. Current rights do not allow viewing the receipt. Consult this intent in the application.");
          reveal("pw-manage-box");
        } else if (code === "challenge_consumed") {
          say("Already confirmed. Read the intent status instead of confirming again.");
        } else if (code === "challenge_expired" || code === "write_intent_revoked") {
          say("This confirmation window is over. Re-read the target, then prepare a new gesture.");
        } else if (code === "csrf_refused") {
          say("The page was renewed. Reload the summary, then confirm again explicitly. The intent is unchanged.");
          reveal("pw-reload-box");
        } else if (out.status === 401) {
          say("The application session ended. Sign in, then reopen the confirmation link from the page.");
          reveal("pw-login-box");
        } else if (code === "confirmation_identity_mismatch" || code === "challenge_invalid") {
          say("This summary belongs to another account. Open it with the same account, without switching.");
        } else if (out.status === 429) {
          say("Too many attempts. Wait " + (out.retryAfter || "a few") + " seconds, then read the intent status.");
        } else {
          say("Result to verify. Keep this page and read the intent status before any new gesture.");
          reveal("pw-manage-box");
        }
      } catch (err) {
        say("Result to verify. The request may still have committed. Read the intent status.");
        reveal("pw-manage-box");
      } finally {
        confirmBtn.disabled = false;
      }
    });
  }
  var revokeBtn = $("pw-revoke");
  if (revokeBtn && boot.revokeUrl) {
    revokeBtn.addEventListener("click", async () => {
      revokeBtn.disabled = true;
      try {
        var out = await post(boot.revokeUrl, {});
        var code = codeOf(out);
        if (out.status === 200 && out.data && out.data.authorizationState === "revoked") {
          $("pw-revoke-result").hidden = false;
          $("pw-revoke-command").textContent = String(out.data.commandState || "");
          say("Revoked. No further confirmation of this intent is possible.");
        } else if (code === "csrf_refused") {
          say("The page was renewed. Reload, then revoke again explicitly.");
          reveal("pw-reload-box");
        } else if (out.status === 401) {
          say("The application session ended. Sign in, then reopen the management link from the page.");
          reveal("pw-login-box");
        } else {
          say("Revocation refused (" + (code || ("http " + out.status)) + "). Read the intent status.");
        }
      } catch (err) {
        say("Result to verify. Read the intent status before any new gesture.");
        reveal("pw-manage-box");
      } finally {
        revokeBtn.disabled = false;
      }
    });
  }
})();
`;

export const APP_SUMMARY_SCRIPT_HASH = createHash("sha256")
  .update(APP_SUMMARY_SCRIPT).digest("base64");

export const APP_SUMMARY_CSP = "default-src 'none'; script-src 'sha256-"
  + APP_SUMMARY_SCRIPT_HASH + "'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'";

export const APP_LOGIN_PATH = "/api/v1/auth/login";
