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

function documentShell(title: string, body: string, status: 200 | 401): Response {
  return new Response(`<!doctype html>
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
`, { status, headers: { "content-type": "text/html; charset=utf-8",
    "content-security-policy": APP_SUMMARY_CSP } });
}

