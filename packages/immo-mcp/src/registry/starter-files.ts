/**
 * Publishable starter files for Radar artifact pages (starter v1.0.0).
 *
 * Single HTML page + author stylesheet + presentation script + the
 * framework-agnostic H5 reader client. The four files are directly
 * publishable with artifacts_publish (about 20 KiB total, far below the
 * 256 KiB budget) and satisfy the release CSP without any inline
 * script/style hash: every script and stylesheet loads same-origin.
 *
 * Author code uses Sentropic DS tokens (`--st-*`) and markup only and
 * never defines its own palette. The official kit stylesheets load first,
 * from the reserved same-origin design path (see @radar/artifacts-host
 * design-kit manifest for the pinned version and digests).
 */
import { DESIGN_KIT_ASSETS, designKitAssetUrl } from "@radar/artifacts-host";

export const STARTER_INDEX_HTML = `<!doctype html>
<html lang="fr" data-st-theme="sent-tech">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signaux — Radar immobilier</title>
${DESIGN_KIT_ASSETS.map((asset) => `<link rel="stylesheet" href="${designKitAssetUrl(asset)}">`).join("\n")}
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main class="radar-page">
<header class="radar-head">
<p class="radar-eyebrow">Radar immobilier</p>
<h1>Signaux de votre panier</h1>
<p class="radar-lede">Lecture seule, avec vos droits de lecteur. Renseignez l'espace de travail et la ville, puis lisez les signaux.</p>
</header>
<form id="filters" class="radar-filters" novalidate>
<div class="st-field radar-grow">
<span class="st-field__label"><label for="workspace">Espace de travail</label></span>
<span class="st-field__control"><input id="workspace" name="workspace" class="st-control st-control--md" type="text" autocomplete="off" spellcheck="false" placeholder="UUID de l'espace" aria-describedby="workspace-help" required></span>
<span id="workspace-help" class="st-field__help">Identifiant explicite de votre espace. Aucune valeur implicite.</span>
</div>
<div class="st-field">
<span class="st-field__label"><label for="city">Ville</label></span>
<span class="st-field__control"><input id="city" name="city" class="st-control st-control--md" type="text" autocomplete="off" spellcheck="false" placeholder="ex. salaberry-de-valleyfield" aria-describedby="city-help" required></span>
<span id="city-help" class="st-field__help">Identifiant de ville (lettres minuscules, chiffres, tirets).</span>
</div>
<div class="st-field">
<span class="st-field__label"><label for="basket">Panier</label></span>
<span class="st-field__control"><select id="basket" name="basket" class="st-select st-select--md">
<option value="all">Tous</option>
<option value="pertinent">Pertinents</option>
<option value="a_surveiller">À surveiller</option>
</select></span>
</div>
<div class="st-field">
<span class="st-field__label"><label for="limit">Par page</label></span>
<span class="st-field__control"><select id="limit" name="limit" class="st-select st-select--md">
<option value="10">10</option>
<option value="20" selected>20</option>
<option value="50">50</option>
</select></span>
</div>
<button id="load" type="submit" class="st-button st-button--primary st-button--md">Lire les signaux</button>
</form>
<div id="status" class="radar-status" role="status" aria-live="polite"></div>
<section id="results" hidden aria-label="Résultats">
<p id="summary" class="radar-summary"></p>
<ol id="items" class="radar-list"></ol>
<div id="more-wrap" class="radar-more" hidden>
<button id="more" type="button" class="st-button st-button--secondary st-button--md">Charger la suite</button>
</div>
</section>
<div id="reopen-wrap" class="radar-more" hidden>
<a id="reopen" class="st-button st-button--secondary st-button--md" href="/__reader/start">Réouvrir la page</a>
</div>
</main>
<script src="/reader.js"></script>
<script src="/app.js"></script>
</body>
</html>
`;

export const STARTER_APP_CSS = `* { box-sizing: border-box; }
body { margin: 0; background: var(--st-semantic-surface-subtle); }
[hidden] { display: none !important; }
.radar-page {
  background: var(--st-semantic-surface-default);
  color: var(--st-semantic-text-primary);
  font-family: var(--st-font-sans);
  margin: 0 auto;
  max-width: 56rem;
  padding: var(--st-spacing-8) var(--st-spacing-4);
}
.radar-head {
  display: grid;
  gap: var(--st-spacing-2);
  margin-bottom: var(--st-spacing-6);
}
.radar-eyebrow {
  color: var(--st-semantic-text-muted);
  font-size: var(--st-typography-label-size);
  font-weight: var(--st-typography-label-weight);
  letter-spacing: 0.04em;
  margin: 0;
  text-transform: uppercase;
}
.radar-head h1 {
  font-family: var(--st-font-display);
  font-size: 1.75rem;
  line-height: 1.25;
  margin: 0;
}
.radar-lede {
  color: var(--st-semantic-text-secondary);
  font-size: var(--st-typography-control-size);
  line-height: var(--st-typography-field-lineHeight);
  margin: 0;
  max-width: 40rem;
}
.radar-filters {
  align-items: end;
  background: var(--st-semantic-surface-subtle);
  border: var(--st-borderWidth-thin) var(--st-borderStyle-solid) var(--st-semantic-border-subtle);
  border-radius: var(--st-radius-lg);
  display: flex;
  flex-wrap: wrap;
  gap: var(--st-spacing-4);
  padding: var(--st-spacing-4);
}
.radar-grow {
  flex: 1 1 16rem;
  min-width: 12rem;
}
.radar-filters .st-button {
  flex: 0 0 auto;
}
.radar-status {
  margin-top: var(--st-spacing-4);
  min-height: var(--st-spacing-6);
}
.radar-summary {
  color: var(--st-semantic-text-secondary);
  font-size: var(--st-typography-label-size);
  margin: var(--st-spacing-4) 0 var(--st-spacing-2);
}
.radar-list {
  display: grid;
  gap: var(--st-spacing-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.radar-item-title {
  font-size: var(--st-typography-control-size);
  font-weight: var(--st-typography-control-weight);
  margin: 0 0 var(--st-spacing-1);
}
.radar-item-meta {
  color: var(--st-semantic-text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: var(--st-spacing-2);
  font-size: var(--st-typography-label-size);
  margin: 0;
}
.radar-more {
  margin-top: var(--st-spacing-4);
}
.radar-foot {
  border-top: var(--st-borderWidth-thin) var(--st-borderStyle-solid) var(--st-semantic-border-subtle);
  color: var(--st-semantic-text-muted);
  font-size: var(--st-typography-label-size);
  margin-top: var(--st-spacing-8);
  padding-top: var(--st-spacing-4);
}
.radar-foot code {
  font-family: var(--st-font-mono);
}
:focus-visible {
  outline: var(--st-focus-width) var(--st-borderStyle-solid) var(--st-focus-color);
  outline-offset: var(--st-focus-offset);
}
`;

/**
 * Framework-agnostic H5 reader client. Loads before app.js and exposes
 * window.ImmoReader. Grant cycle: read once from the URL, keep in memory,
 * drop that parameter only, renew through POST /__reader/renew, recover a
 * sealed session once without a grant, then stop and offer reopening.
 */
export const STARTER_READER_JS = `(function () {
"use strict";
var KIND_BY_CODE = {
  workspace_required: "no_workspace",
  workspace_ambiguous: "no_workspace",
  workspace_missing: "no_workspace",
  workspace_not_authorized: "denied",
  account_not_approved: "denied",
  capability_required: "denied",
  delegated_scope_refused: "denied",
  forbidden: "denied",
  unauthenticated: "session",
  session_expired: "session",
  snapshot_changed: "changed",
  cursor_expired: "changed",
  projection_revision_unstable: "changed",
  invalid_query: "invalid",
  invalid_cursor: "invalid",
  incompatible_continuation: "invalid",
  request_uri_too_long: "invalid",
  invalid_params: "invalid",
  target_not_found: "invalid",
  unknown_operation: "invalid"
};
function ReadError(kind, code, status, requestId) {
  var err = new Error(code);
  err.name = "ReadError";
  err.kind = kind;
  err.code = code;
  err.status = status;
  err.requestId = requestId || "";
  return err;
}
function kindOf(code, status) {
  if (Object.prototype.hasOwnProperty.call(KIND_BY_CODE, code)) return KIND_BY_CODE[code];
  if (status === 401) return "session";
  if (status === 403) return "denied";
  if (status >= 500) return "unavailable";
  return "unknown";
}
var TIMEOUT_MS = 20000;
var REFRESH_BEFORE_MS = 30000;
var here = new URL(location.href);
var grant = here.searchParams.get("grant") || "";
var grantAt = grant ? Date.now() : 0;
var renewing = null;
if (here.searchParams.has("grant")) {
  here.searchParams.delete("grant");
  var rest = here.searchParams.toString();
  history.replaceState(null, "", here.pathname + (rest ? "?" + rest : "") + here.hash);
}
function timedFetch(path, init) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  var options = { method: init.method, cache: "no-store", credentials: "same-origin", signal: controller.signal };
  if (init.headers) options.headers = init.headers;
  return fetch(path, options).then(
    function (response) { clearTimeout(timer); return response; },
    function (error) {
      clearTimeout(timer);
      throw ReadError("network", error && error.name === "AbortError" ? "timeout" : "network_error", 0, "");
    }
  );
}
function readGrantBody(body) {
  if (body && typeof body.grant === "string" && body.grant && body.grant.length <= 4096) return body.grant;
  return "";
}
function failureCode(body, status) {
  if (!body) return status === 401 ? "unauthenticated" : "internal_error";
  if (body.error && typeof body.error.code === "string") return body.error.code;
  if (typeof body.error === "string") return body.error;
  return status === 401 ? "unauthenticated" : "internal_error";
}
function requestIdOf(body) {
  if (body && typeof body.requestId === "string") return body.requestId;
  if (body && body.error && typeof body.error.requestId === "string") return body.error.requestId;
  return "";
}
function renewOnce(withGrant) {
  var headers = withGrant && grant ? { "x-preview-grant": grant } : {};
  return timedFetch("/__reader/renew", { method: "POST", headers: headers }).then(function (response) {
    return response.json().catch(function () { return null; }).then(function (body) {
      if (!response.ok) {
        var code = body && typeof body.error === "string" ? body.error : "unauthenticated";
        throw ReadError(kindOf(code, response.status || 401), code, response.status, "");
      }
      var next = readGrantBody(body);
      if (!next) throw ReadError("session", "unauthenticated", response.status, "");
      return next;
    });
  });
}
function renewGrant() {
  return renewOnce(true).catch(function (error) {
    if (error && error.status === 401 && grant) return renewOnce(false);
    throw error;
  }).then(function (next) {
    grant = next;
    grantAt = Date.now();
  });
}
function ensureGrant() {
  if (grant && Date.now() - grantAt < REFRESH_BEFORE_MS) return Promise.resolve();
  if (!renewing) {
    renewing = renewGrant().then(
      function () { renewing = null; },
      function (error) { renewing = null; throw error; }
    );
  }
  return renewing;
}
function read(operation, params) {
  return ensureGrant().then(function () {
    var query = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      if (key === "grant") return;
      var value = params[key];
      if (value === undefined || value === null || value === "") return;
      query.set(key, String(value));
    });
    return timedFetch("/__reader/api/" + operation + "?" + query.toString(), {
      method: "GET",
      headers: { "x-preview-grant": grant }
    });
  }).then(function (response) {
    return response.json().catch(function () { return null; }).then(function (body) {
      if (response.ok && body && body.ok === true) return body;
      var code = failureCode(body, response.status);
      throw ReadError(kindOf(code, response.status), code, response.status, requestIdOf(body));
    });
  });
}
function context(workspaceId) {
  return read("baskets.context.v1", { workspaceId: workspaceId }).then(function (body) {
    var availability = body.context && body.context.signals && body.context.signals.availability;
    if (!availability || availability.state !== "open") {
      throw ReadError("unavailable", availability && availability.reason || "signal_capability_unavailable", 503, "");
    }
    return body;
  });
}
function search(args) {
  return read("baskets.search.v1", {
    workspaceId: args.workspaceId,
    citySlug: args.citySlug,
    basket: args.basket,
    limit: args.limit,
    cursor: args.cursor,
    archive: args.archive,
    personalHistory: args.personalHistory
  });
}
window.ImmoReader = {
  ReadError: ReadError,
  context: context,
  search: search,
  ensureGrant: ensureGrant,
  reopenUrl: function () { return "/__reader/start"; }
};
})();
`;

export const STARTER_APP_JS = `(function () {
"use strict";
window.ImmoArtifact = { mount: function (root) {
var Reader = window.ImmoReader;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SLUG_RE = /^[a-z0-9-]{1,128}$/;
function el(id) { return root.querySelector("#" + id); }
var form = el("filters");
var workspaceInput = el("workspace");
var cityInput = el("city");
var basketInput = el("basket");
var limitInput = el("limit");
var loadButton = el("load");
var statusBox = el("status");
var results = el("results");
var summary = el("summary");
var items = el("items");
var moreWrap = el("more-wrap");
var moreButton = el("more");
var reopenWrap = el("reopen-wrap");
var state = { workspaceId: "", citySlug: "", basket: "all", limit: 20, cursor: null, loading: false };
(function init() {
  var query = new URLSearchParams(location.search);
  var workspaceId = query.get("workspaceId") || "";
  var citySlug = query.get("citySlug") || "";
  if (UUID_RE.test(workspaceId)) workspaceInput.value = workspaceId;
  if (SLUG_RE.test(citySlug)) cityInput.value = citySlug;
})();
function setStatus(text) {
  statusBox.textContent = text;
}
function showReopen(show) {
  reopenWrap.hidden = !show;
}
function readFilters() {
  return {
    workspaceId: workspaceInput.value.trim().toLowerCase(),
    citySlug: cityInput.value.trim().toLowerCase(),
    basket: basketInput.value,
    limit: parseInt(limitInput.value, 10) || 20
  };
}
function stateMessage(kind, code) {
  if (kind === "no_workspace") return "Renseignez un identifiant d'espace de travail (UUID) pour lire vos paniers.";
  if (kind === "denied") return "Cet espace ne vous est pas accessible avec vos droits actuels (" + code + ").";
  if (kind === "session") return "Votre accès a expiré. Réouvrez la page pour continuer.";
  if (kind === "changed") return "La vue de classement a changé (" + code + "). Relancez la lecture.";
  if (kind === "invalid") return "Paramètres invalides (" + code + "). Vérifiez la ville et les filtres.";
  if (kind === "network") return code === "timeout" ? "La lecture a expiré. Réessayez." : "Réseau indisponible. Réessayez.";
  return "Lecture indisponible (" + code + "). Réessayez plus tard.";
}
function tagFor(item) {
  var selection = item && item.facets && item.facets.selection;
  if (selection && selection.pertinent && selection.pertinent.state === "active") return "Pertinent";
  if (selection && selection.a_surveiller && selection.a_surveiller.state === "active") return "À surveiller";
  return state.basket === "all" ? "Signal" : basketInput.options[basketInput.selectedIndex].text;
}
function appendItems(list) {
  list.forEach(function (item) {
    var li = document.createElement("li");
    li.className = "st-card";
    var title = document.createElement("p");
    title.className = "radar-item-title";
    title.textContent = (item && item.card && item.card.label) || "Signal sans titre";
    var meta = document.createElement("p");
    meta.className = "radar-item-meta";
    var tag = document.createElement("span");
    tag.className = "st-tag st-tag--sm st-tag--info";
    tag.textContent = tagFor(item);
    var ref = document.createElement("span");
    var target = (item && item.target) || {};
    ref.textContent = (target.type || "Signal") + " · " + (target.id || "?");
    var stage = document.createElement("span");
    stage.textContent = (item && item.card && item.card.stage) || "";
    meta.appendChild(tag);
    meta.appendChild(ref);
    if (stage.textContent) meta.appendChild(stage);
    li.appendChild(title);
    li.appendChild(meta);
    items.appendChild(li);
  });
}
function render(body, reset) {
  var list = (body && body.items) || [];
  var counts = (body && body.counts) || {};
  var page = (body && body.page) || {};
  var matched = typeof counts.matched === "number" ? counts.matched : list.length;
  summary.textContent = String(matched) + (matched > 1 ? " signaux — " : " signal — ") + state.citySlug;
  if (reset && list.length === 0) {
    setStatus("Aucun signal pour ces filtres. Essayez un autre panier ou une autre ville.");
  } else {
    setStatus("");
  }
  state.cursor = page.nextCursor || null;
  moreWrap.hidden = !state.cursor;
  if (page.truncated) setStatus("D'autres résultats sont disponibles. Chargez la suite.");
  results.hidden = false;
}
function fail(error) {
  var kind = (error && error.kind) || "unknown";
  var code = (error && error.code) || "internal_error";
  setStatus(stateMessage(kind, code));
  showReopen(kind === "session" || kind === "denied");
  moreWrap.hidden = true;
}
function load(reset) {
  if (state.loading) return;
  var filters = readFilters();
  if (!UUID_RE.test(filters.workspaceId) || !SLUG_RE.test(filters.citySlug)) {
    setStatus(stateMessage(!UUID_RE.test(filters.workspaceId) ? "no_workspace" : "invalid", "invalid_query"));
    showReopen(false);
    return;
  }
  var filtersChanged = filters.workspaceId !== state.workspaceId || filters.citySlug !== state.citySlug ||
    filters.basket !== state.basket || filters.limit !== state.limit;
  if (filtersChanged) reset = true;
  state.workspaceId = filters.workspaceId;
  state.citySlug = filters.citySlug;
  state.basket = filters.basket;
  state.limit = filters.limit;
  if (reset) {
    state.cursor = null;
    items.textContent = "";
    results.hidden = true;
  }
  state.loading = true;
  loadButton.disabled = true;
  showReopen(false);
  setStatus("Chargement des signaux…");
  Reader.context(state.workspaceId).then(function () {
    return Reader.search({
      workspaceId: state.workspaceId,
      citySlug: state.citySlug,
      basket: state.basket,
      limit: state.limit,
      cursor: state.cursor || undefined
    });
  }).then(function (body) {
    state.loading = false;
    loadButton.disabled = false;
    appendItems((body && body.items) || []);
    render(body, reset);
  }).catch(function (error) {
    state.loading = false;
    loadButton.disabled = false;
    fail(error);
  });
}
function submit(event) {
  event.preventDefault();
  load(true);
}
function more() {
  load(false);
}
form.addEventListener("submit", submit);
moreButton.addEventListener("click", more);
return function () {
  form.removeEventListener("submit", submit);
  moreButton.removeEventListener("click", more);
};
} };
if (document.getElementById("filters")) window.ImmoArtifact.mount(document);
})();
`;
