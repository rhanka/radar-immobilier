/**
 * PW-C application documents (summary, management, login) embedding the
 * controlled script. The server renders every label; only the private
 * CSRF/challenge bootstrap carries capability data.
 */
import type { Context } from "hono";
import { PwWriteError } from "../services/facets/pw-write-errors.js";
import { assertSignalWriteInput, type SignalWriteInput } from "../services/facets/signal-write-operations.js";
import type { PwIntentRow } from "../services/facets/pw-write-store.js";
import { APP_LOGIN_PATH, APP_SUMMARY_CSP, APP_SUMMARY_SCRIPT } from "./write-intent-app-script.js";

const OPERATION_COPY: Record<SignalWriteInput["operation"],
  { title: string; scope: string; effect: string }> = {
  "facets.signals.personal.select.v1": { title: "Select a personal basket", scope: "Personal gesture. Only you can see it.", effect: "Adds the chosen basket. The other basket and both archives stay unchanged." },
  "facets.signals.personal.deselect.v1": { title: "Remove a personal basket", scope: "Personal gesture. Only you can see it.", effect: "Removes only the chosen basket. The other basket and both archives stay unchanged." },
  "facets.signals.personal.discard.v1": { title: "Discard for me", scope: "Personal gesture. Only you can see it.", effect: "Archives the target for you. Baskets are removed only when explicitly checked. The workspace archive stays unchanged." },
  "facets.signals.personal.restore.v1": { title: "Restore for me", scope: "Personal gesture. Only you can see it.", effect: "Lifts your personal archive. It never reactivates a basket and never touches the workspace archive." },
  "facets.signals.workspace.discard.v1": { title: "Discard for the workspace", scope: "Workspace gesture. Every authorized member is affected.", effect: "Archives the target for the workspace. Personal baskets and archives stay unchanged." },
  "facets.signals.workspace.restore.v1": { title: "Restore for the workspace", scope: "Workspace gesture. Every authorized member is affected.", effect: "Lifts the workspace archive. It never reactivates a basket and never touches personal archives." },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === "\"") return "&quot;";
    return "&#39;";
  });
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

function validatedCommand(row: PwIntentRow): SignalWriteInput {
  try {
    const command = row.command as SignalWriteInput;
    if (command === null || typeof command !== "object" || Array.isArray(command)) {
      throw new PwWriteError(503, "write_authority_unavailable");
    }
    assertSignalWriteInput(command);
    return command;
  } catch {
    throw new PwWriteError(503, "write_authority_unavailable");
  }
}

function describeCommand(command: SignalWriteInput): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (command.basket !== undefined) rows.push(["Basket", command.basket]);
  if (command.reasonCode !== undefined) rows.push(["Reason", command.reasonCode]);
  if (command.deselect !== undefined) {
    rows.push(["Remove baskets", command.deselect.length === 0 ? "none" : [...command.deselect].sort().join(", ")]);
  }
  if (command.expectedSelectionHeads !== undefined) {
    const heads = Object.entries(command.expectedSelectionHeads)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([basket, head]) => `${basket}: ${head === null ? "absent" : head}`);
    rows.push(["Expected selection heads", heads.join("; ")]);
  }
  rows.push(["Expected head", command.expectedHeadId === null ? "absent" : command.expectedHeadId]);
  rows.push(["Displayed fingerprint", command.displayedFingerprint]);
  rows.push(["Projection token", command.expectedProjectionToken]);
  return rows;
}

function definitionList(rows: Array<[string, string]>): string {
  return "<dl>" + rows.map(([term, value]) =>
    `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>`).join("") + "</dl>";
}

function documentShell(c: Context, title: string, body: string, status: 200 | 401): Response {
  return c.newResponse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
</head>
<body>
<main>${body}</main>
<script>${APP_SUMMARY_SCRIPT}</script>
</body>
</html>
`, status, { "content-type": "text/html; charset=utf-8",
    "content-security-policy": APP_SUMMARY_CSP });
}

/** Business summary for the current rights holder, with confirm + revoke. */
export function renderWriteIntentSummary(c: Context, row: PwIntentRow,
  bootstrap: { csrf: string; challengeToken: string }): Response {
  const input = validatedCommand(row);
  const copy = OPERATION_COPY[input.operation];
  const target = input.target;
  const boot = { csrf: bootstrap.csrf, challengeToken: bootstrap.challengeToken,
    intentId: row.intentId, confirmUrl: `/api/v1/artifacts/write-intents/${row.intentId}/confirm`,
    revokeUrl: `/api/v1/artifacts/write-intents/${row.intentId}/revoke`,
    managementUrl: `/api/v1/artifacts/write-intents/${row.intentId}`,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : "" };
  const body = `<h1>${escapeHtml(copy.title)}</h1>
<p>${escapeHtml(copy.scope)}</p>
<p>${escapeHtml(copy.effect)}</p>
${definitionList([["Intent", row.intentId], ["Workspace", row.workspaceId],
  ["City", input.target.citySlug], ["Target", `${target.type} ${target.id}`],
  ["Operation", input.operation], ["Expires", boot.expiresAt],
  ...describeCommand(input)])}
<p>Confirm only what this page shows. The server rechecks everything on confirm.</p>
<button id="pw-confirm" type="button">Confirm</button>
<button id="pw-revoke" type="button">Revoke</button>
<p id="pw-note" role="status"></p>
<section id="pw-receipt" hidden>
<h2>Receipt</h2>
<dl><dt>Command</dt><dd id="pw-receipt-command"></dd>
<dt>State</dt><dd id="pw-receipt-state"></dd>
<dt>Basket</dt><dd id="pw-receipt-basket"></dd></dl>
</section>
<p id="pw-revoke-result" hidden>Revocation command state: <span id="pw-revoke-command"></span></p>
<p id="pw-reload-box" hidden><a id="pw-reload" href="${escapeHtml(c.req.path)}">Reload the summary</a>, then act again explicitly.</p>
<p id="pw-login-box" hidden><a href="${APP_LOGIN_PATH}">Sign in</a>, then reopen the confirmation link from the page.</p>
<p id="pw-manage-box" hidden>Open the <a href="${escapeHtml(boot.managementUrl)}">management view</a> to check this intent.</p>
<script id="pw-bootstrap" type="application/json">${escapeJsonForScript(boot)}</script>`;
  return documentShell(c, copy.title, body, 200);
}

/** Technical management for the owner after rights loss: revoke only. */
export function renderWriteIntentManagement(c: Context, row: PwIntentRow,
  bootstrap: { csrf: string; result?: Record<string, unknown> }): Response {
  const boot = { csrf: bootstrap.csrf, intentId: row.intentId,
    revokeUrl: `/api/v1/artifacts/write-intents/${row.intentId}/revoke`,
    managementUrl: `/api/v1/artifacts/write-intents/${row.intentId}` };
  const result = bootstrap.result ?? {};
  const body = `<h1>Manage a write intent</h1>
<p>${result.receipt ? "Recorded result. Review execution and revocation separately." : "Management only. No confirmation is available from this document."}</p>
${definitionList([["Intent", row.intentId], ["State", String(result.state ?? "unknown")],
    ["Execution", String(result.executionState ?? "unknown")], ["Revocation", String(result.revocationState ?? "unknown")]])}
${result.receipt ? `<section id="pw-recovered-receipt"><h2>Recorded receipt</h2><pre>${escapeHtml(JSON.stringify(result.receipt))}</pre>` +
    `<p>Command: ${escapeHtml(String(result.commandId))}</p></section>` : ""}
<button id="pw-revoke" type="button">Revoke</button>
<p id="pw-note" role="status"></p>
<p id="pw-revoke-result" hidden>Revocation command state: <span id="pw-revoke-command"></span></p>
<p id="pw-reload-box" hidden><a id="pw-reload" href="${escapeHtml(c.req.path)}">Reload</a>, then revoke again explicitly.</p>
<p id="pw-login-box" hidden><a href="${APP_LOGIN_PATH}">Sign in</a>, then reopen the management link from the page.</p>
<script id="pw-bootstrap" type="application/json">${escapeJsonForScript(boot)}</script>`;
  return documentShell(c, "Manage a write intent", body, 200);
}

/** Login document: fixed login link, then manual reopen of the page link. */
export function renderWriteIntentLogin(c: Context): Response {
  const body = `<h1>Sign in required</h1>
<p>This confirmation page needs the normal application session.</p>
<p><a href="${APP_LOGIN_PATH}">Sign in</a>, then reopen the confirmation link from the page. No confirmation happens automatically.</p>`;
  return documentShell(c, "Sign in required", body, 401);
}
