/**
 * Backward compatibility for basket pages published with the pre-I2 reader
 * bridge (starter before the deferred basket consent).
 *
 * Those pages ship a `reader.js` whose `kindOf` maps the typed
 * `basket_consent_required` 403 to `denied`: the first H5 call shows
 * « inaccessible » and the « Réouvrir » link restarts a document-only
 * opening, looping forever until the artifact is republished. The host
 * upgrades the served bytes instead: the patched bridge navigates top-level
 * to `/__reader/consent` exactly once per page load, then the page reloads
 * with a basket-scoped grant and replays its reads on init (true for every
 * starter-based page, old and new `app.js` alike).
 *
 * Only exact legacy bridges are touched: the body must carry the
 * `window.ImmoReader` marker and the old `delegated_scope_refused` entry
 * while lacking any `basket_consent_required` handling, and every surgical
 * replacement must apply exactly once. Anything else (already-current
 * bridges, custom clients, ambiguous bodies) is served unchanged, so the
 * upgrade never breaks a page it does not recognize. The patched bytes keep
 * the same public `window.ImmoReader` surface (workspaces/context/search,
 * grant cycle, renew), so the old token flow — grant in the URL, POST
 * `/__reader/renew`, `x-preview-grant` header — keeps working unchanged.
 */

const CONSENT_CODE = "basket_consent_required";

/** True only for the pre-I2 starter bridge, never for current or custom code. */
export function isLegacyReaderBridge(body: string): boolean {
  return body.includes("window.ImmoReader") &&
    body.includes("delegated_scope_refused") &&
    !body.includes(CONSENT_CODE);
}

function countMatches(haystack: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return haystack.match(new RegExp(pattern.source, flags))?.length ?? 0;
}

/**
 * Patch a legacy bridge to the deferred-consent flow. Returns the upgraded
 * source, or null when the body is not an exact legacy bridge (serve it
 * unchanged). Idempotent: upgraded output is no longer legacy.
 */
export function upgradeLegacyReaderBridge(body: string): string | null {
  if (!isLegacyReaderBridge(body)) return null;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const kindPattern = /capability_required: "denied",\r?\n([ \t]*)delegated_scope_refused: "denied",/;
  const statePattern = /var REFRESH_BEFORE_MS = 30000;\r?\n/;
  const readPattern = /var code = failureCode\(body, response\.status\);\r?\n([ \t]*)throw ReadError\(kindOf\(code, response\.status\), code, response\.status, requestIdOf\(body\)\);/;
  if (countMatches(body, kindPattern) !== 1 ||
    countMatches(body, statePattern) !== 1 ||
    countMatches(body, readPattern) !== 1) return null;
  const withKind = body.replace(kindPattern,
    (_match, indent: string) =>
      `capability_required: "denied",${eol}${indent}${CONSENT_CODE}: "consent",${eol}${indent}delegated_scope_refused: "denied",`);
  const withState = withKind.replace(statePattern,
    () => `var REFRESH_BEFORE_MS = 30000;${eol}` +
      `// Deferred basket consent: the first business call without basket scope${eol}` +
      `// answers basket_consent_required; navigate top-level to /__reader/consent${eol}` +
      `// exactly once per page load (host-patched legacy bridge).${eol}` +
      `var consentRedirected = false;${eol}`);
  return withState.replace(readPattern,
    (_match, indent: string) =>
      `var code = failureCode(body, response.status);${eol}` +
      `${indent}var kind = kindOf(code, response.status);${eol}` +
      `${indent}if (kind === "consent" && !consentRedirected) {${eol}` +
      `${indent}  consentRedirected = true;${eol}` +
      `${indent}  location.assign("/__reader/consent");${eol}` +
      `${indent}}${eol}` +
      `${indent}throw ReadError(kind, code, response.status, requestIdOf(body));`);
}
