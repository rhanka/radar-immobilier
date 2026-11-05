/**
 * Versioned artifact authoring guide (single definition).
 *
 * Feeds the artifacts_ensure / artifacts_publish / artifacts_get MCP
 * surface: the tool descriptions carry only a stable pointer at the guide,
 * while the full guide object is returned as `authoringGuide` in the MCP
 * response of artifacts_ensure and artifacts_get. artifacts_get_source carries
 * only a small guide reference (guideId/revision plus the lifecycle
 * hint) so the source payload stays within the model tool-result budget.
 * The durable publication receipt is unchanged. A future dedicated guide
 * tool or MCP resource would return exactly this definition.
 */

import {
  DESIGN_KIT_ASSETS,
  DESIGN_KIT_REACT_SNAPSHOT,
  DESIGN_KIT_THEME,
  DESIGN_KIT_THEMES_VERSION,
  DESIGN_KIT_VERSION,
  MAP_KIT_ASSETS,
  MAP_KIT_VERSION,
  designKitAssetUrl,
  mapKitAssetUrl,
  ARTIFACT_P0B, ARTIFACT_PROFILE_DESCRIPTOR, ARTIFACT_STRICT, ARTIFACT_PART1,
} from "@radar/artifacts-host";
import {
  STARTER_APP_CSS,
  STARTER_APP_JS,
  STARTER_INDEX_HTML,
  STARTER_READER_JS,
} from "./starter-files.js";
import { FRAMEWORK_STARTERS, FRAMEWORK_BUILD_RULE } from "./framework-starters.js";
import { ARTIFACT_LIST_ORDER } from "./artifact-read-schema.js";

export const AUTHORING_GUIDE_ID = "immo-artifact-authoring" as const;
export const AUTHORING_GUIDE_REVISION = ARTIFACT_STRICT ? `2026-11-05-${ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId}`
  : ARTIFACT_P0B ? "2026-11-05-p0b-r7" : "2026-11-05-r7";
export const STARTER_VERSION = "1.1.0" as const;
export const STRICT_ARTIFACT_GUIDE = "This profile requires expectedCurrentReleaseId for artifacts_publish, artifacts_revert and artifacts_delete. First read the artifact with artifacts_get or artifacts_list. For a first publication, send expectedCurrentReleaseId: null only after that read returns currentReleaseId: null. For an update, read the observed release with artifacts_get_source, edit those files, and send its releaseId as expectedCurrentReleaseId. Conversation files alone do not establish the current release. For a revert or deletion, send the currentReleaseId observed by your read. On conflict, re-read and reconcile before submitting a changed command with a new idempotencyKey. For a lost response or commitState: unknown, reconcile with the same idempotencyKey and unchanged command before attempting a new write. Read resultEnvelopeVersion in this guide: version 1 keeps business fields at the root; version 2 places them in output and the guide in output.authoringGuide.";

/**
 * Stable pointer embedded in the artifacts_ensure, artifacts_publish,
 * artifacts_get and artifacts_get_source tool descriptions. Identical in
 * every profile on purpose: claude.ai resets the owner's per-tool "Always
 * allow" grant whenever a tool description changes, so no profile, contract
 * or guide-revision text may appear here. The full versioned contract
 * (starter, H5 bridge, lifecycle, availability) comes from the
 * `authoringGuide` response field, which already carries its descriptor.
 */
export const AUTHORING_GUIDE_SNIPPET =
  "Fetch `authoringGuide` from artifacts_ensure (or artifacts_get for an existing page) and follow it.";

function freeze<T extends object>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) if (entry && typeof entry === "object") freeze(entry as object);
    return Object.freeze(value) as T;
  }
  for (const entry of Object.values(value)) if (entry && typeof entry === "object") freeze(entry);
  return Object.freeze(value);
}

export interface AuthoringGuideStarterFile {
  readonly path: string;
  readonly mimeType: string;
  readonly text: string;
}

const STARTER_FILES: readonly AuthoringGuideStarterFile[] = freeze([
  { path: "index.html", mimeType: "text/html", text: STARTER_INDEX_HTML },
  { path: "app.css", mimeType: "text/css", text: STARTER_APP_CSS },
  { path: "app.js", mimeType: "text/javascript", text: STARTER_APP_JS },
  { path: "reader.js", mimeType: "text/javascript", text: STARTER_READER_JS },
]);

export interface AuthoringGuideComponentRef {
  /** Upstream CSS recipe provenance, independent of the Elements catalogue. */
  readonly sourcePackage: "@sentropic/design-system-react";
  readonly componentName: string;
  readonly snapshotVersion: typeof DESIGN_KIT_REACT_SNAPSHOT;
  /** Prompt doc ref + sha256 of its bytes at guide revision time. */
  readonly promptRef: string;
  readonly promptHash: string;
  /** CSS classes used by the starter (native markup, no React runtime). */
  readonly classes: readonly string[];
}

const COMPONENTS: readonly AuthoringGuideComponentRef[] = freeze([
  { sourcePackage: "@sentropic/design-system-react", componentName: "Button", snapshotVersion: DESIGN_KIT_REACT_SNAPSHOT,
    promptRef: "ds-bundle/components/general/Button/Button.prompt.md",
    promptHash: "e8ab6e3ba088a571d75ae6c6a6215541e864d519b07b9951c648fa61345921b7",
    classes: ["st-button", "st-button--primary", "st-button--secondary", "st-button--md"] },
  { sourcePackage: "@sentropic/design-system-react", componentName: "Tag", snapshotVersion: DESIGN_KIT_REACT_SNAPSHOT,
    promptRef: "ds-bundle/components/general/Tag/Tag.prompt.md",
    promptHash: "43e00e9ffff65a4ebf87c94780ae25aece5070f9d4d39e8ea583c763c17035f5",
    classes: ["st-tag", "st-tag--sm", "st-tag--info"] },
  { sourcePackage: "@sentropic/design-system-react", componentName: "Card", snapshotVersion: DESIGN_KIT_REACT_SNAPSHOT,
    promptRef: "ds-bundle/components/general/Card/Card.prompt.md",
    promptHash: "900840598009a841fe73c345822d163922d69fc3c5b1f81fcb95f90611d2b127",
    classes: ["st-card"] },
  { sourcePackage: "@sentropic/design-system-react", componentName: "Notification", snapshotVersion: DESIGN_KIT_REACT_SNAPSHOT,
    promptRef: "ds-bundle/components/general/Notification/Notification.prompt.md",
    promptHash: "92cb7ffd7c60db14982e32915f905b532468f3326c9b5beb0dc27affb589a5d6",
    classes: ["st-notification", "st-notification--error"] },
  { sourcePackage: "@sentropic/design-system-react", componentName: "Select", snapshotVersion: DESIGN_KIT_REACT_SNAPSHOT,
    promptRef: "ds-bundle/components/general/Select/Select.prompt.md",
    promptHash: "e37cc0c9b69a502c0d8cd09d8819189c9741d21fef1483061c8b9e61ac2272bf",
    classes: ["st-select", "st-select--md", "st-field", "st-field__label", "st-field__control", "st-field__help"] },
  { sourcePackage: "@sentropic/design-system-react", componentName: "Input", snapshotVersion: DESIGN_KIT_REACT_SNAPSHOT,
    promptRef: "ds-bundle/components/general/Input/Input.prompt.md",
    promptHash: "173ff92dd7e8029788cf698c6cdca2f56ba173add854a3ffa4e91df356b7b33b",
    classes: ["st-control", "st-control--md"] },
  { sourcePackage: "@sentropic/design-system-react", componentName: "ContentSwitcher", snapshotVersion: DESIGN_KIT_REACT_SNAPSHOT,
    promptRef: "ds-bundle/components/general/ContentSwitcher/ContentSwitcher.prompt.md",
    promptHash: "b8be750c7f4a799ac6882d58744224b64cdb85f8cdb9448571e75630f483ad86",
    classes: ["st-contentSwitcher", "st-contentSwitcher--md", "st-contentSwitcher__option"] },
  { sourcePackage: "@sentropic/design-system-react", componentName: "InlineLoading", snapshotVersion: DESIGN_KIT_REACT_SNAPSHOT,
    promptRef: "ds-bundle/components/general/InlineLoading/InlineLoading.prompt.md",
    promptHash: "9045c154480f466f91a349890dedcfc005612c0bee3ad05f5ae0f9e049a11929",
    classes: ["st-inlineLoading"] },
]);

export interface AuthoringGuide {
  readonly descriptor: typeof ARTIFACT_PROFILE_DESCRIPTOR;
  readonly guideId: typeof AUTHORING_GUIDE_ID;
  readonly revision: typeof AUTHORING_GUIDE_REVISION;
  readonly starterVersion: typeof STARTER_VERSION;
  readonly theme: typeof DESIGN_KIT_THEME;
  readonly designPackages: Readonly<{ react: string; themes: string; snapshotLag: string }>;
  readonly rule: string;
  readonly assets: Readonly<{ loadOrder: readonly string[]; note: string;
    manifest: readonly Readonly<{ file: string; sha256Hex: string; sizeBytes: number; mediaType: string; url: string }>[] }>;
  readonly mapBase: Readonly<{ tiles: string; labels: string; note: string;
    attribution: readonly Readonly<{ text: string; licenseUrl: string }>[]; howTo: readonly string[];
    kit: string; version: string;
    manifest: readonly Readonly<{ file: string; sha256Hex: string; sizeBytes: number; mediaType: string; url: string }>[];
    load: readonly string[]; feed: readonly string[]; paint: readonly string[];
    events: readonly string[]; limits: readonly string[] }>;
  readonly starter: Readonly<{ version: string; files: readonly AuthoringGuideStarterFile[]; adapt: string }>;
  readonly data: Readonly<{
    warning: string;
    grantCycle: readonly string[];
    operations: readonly Readonly<{ name: string; method: string; path: string; params: string; response: string }>[];
    errorKinds: readonly Readonly<{ kind: string; codes: string; ui: string }>[];
  }>;
  readonly components: readonly AuthoringGuideComponentRef[];
  readonly checklist: readonly string[];
  readonly frameworks: readonly Readonly<{ framework: string; fastPath: string }>[];
  readonly frameworkBuild: string;
  readonly uiState: Readonly<{ contractId: string; ownership: string; bootstrap: string; persistence: string; example: object }>;
  readonly elements: Readonly<{ package: string; packageVersion: string; catalogId: string; componentIds: readonly string[]; status: string }>;
  readonly componentUsage: string;
  readonly artifactDiscovery: Readonly<{ displayLabel: string; listOrder: string; timestamps: string; links: string; state: string }>;
  readonly artifactLifecycle?: Readonly<{ descriptor: typeof ARTIFACT_PROFILE_DESCRIPTOR;
    edit: readonly string[]; share: readonly string[]; delete: readonly string[] }>;
  readonly lifecycle: Readonly<{
    editing: readonly string[];
    unavailableTools: readonly string[];
    deleteRestore: string;
    sharing: string;
  }>;
}

let cached: AuthoringGuide | undefined;

export function getAuthoringGuide(): AuthoringGuide {
  if (!cached) {
    cached = freeze<AuthoringGuide>({
      guideId: AUTHORING_GUIDE_ID,
      descriptor: ARTIFACT_PROFILE_DESCRIPTOR,
      revision: AUTHORING_GUIDE_REVISION,
      starterVersion: STARTER_VERSION,
      artifactDiscovery: {
        displayLabel: ARTIFACT_PART1 ? "Use title, description and icon when supplied; bindingName remains the binding identity."
          : "Use bindingName as the display label until part1 title/description metadata is available.",
        listOrder: `artifacts_list orders by ${ARTIFACT_LIST_ORDER}, before offset/limit pagination.`,
        timestamps: "createdAt is artifact creation; updatedAt is the current release publication time, or null if never published.",
        links: "artifacts_list and artifacts_get return stableUrl and currentReleaseId; pinnedUrl is the current release URL, or null if unpublished.",
        state: "state is the lifecycle state; published indicates that a current release exists.",
      },
      lifecycle: {
        editing: [
          "The complete editing journey is artifacts_get_source → edit → artifacts_publish on the same artifactId. " +
            (ARTIFACT_P0B
              ? "artifacts_get returns metadata and permissions; artifacts_get_source returns the retained manifest and file text (UTF-8; bytes only for non-text or undecodable files). Follow artifactLifecycle.edit."
              : "Currently source retrieval is blocked: artifacts_get_source is unavailable and artifacts_get returns metadata plus this guide, without editable files."),
          ARTIFACT_STRICT ? STRICT_ARTIFACT_GUIDE : "When the complete original source bundle is already available in the conversation, edit those files and publish the full bundle with artifacts_publish on the same artifactId. Do not call artifacts_ensure to replace an existing artifact.",
          "Each publication creates a new release/version and pinnedUrl; stableUrl stays the same. Use a fresh idempotencyKey for changed content, and reuse a previous key only to retry the identical publication.",
          "When page files are large (photographs, PDF) or exceed the inline budget, stage bytes outside the model: artifacts_create_upload({artifactId, mimeType, maxSize:<exact file byte size>}) returns a signed PUT URL that binds that exact Content-Length: PUT exactly those bytes with exactly the announced requiredHeaders and nothing else, artifacts_commit_upload pins them to a manifest path, and artifacts_publish_bundle releases inline files plus staged assets atomically (expectedCurrentReleaseId is always required, null only for a first publication after a read with no current release). When the Product Owner supplies the files, mint an upload page: artifacts_create_upload_page({artifactId}) returns an uploadPageUrl for PNG/PDF originals — bytes go browser to storage, never through a model payload. List assets with artifacts_list_assets; publish with artifacts_publish_bundle or artifacts_publish_bundle_v2. Release ceilings: 255 files, 16 MiB per file, 64 MiB per release. Served binaries: image/png, image/jpeg, image/gif, image/webp, image/svg+xml, application/pdf, font/woff2, video/mp4; magic-byte verified at commit; SVG must carry no script, handler or external reference — served sandboxed, never executable.",
        ],
        unavailableTools: ARTIFACT_P0B ? ["artifacts_restore", "artifacts_fork", "artifacts_promote", "artifacts_renew"]
          : ["artifacts_get_source", "artifacts_delete", "artifacts_restore", "artifacts_set_access",
          "artifacts_fork", "artifacts_promote", "artifacts_renew"],
        deleteRestore: ARTIFACT_P0B
          ? "Owner-only artifacts_delete requires explicit human confirmation through the normal IMMO application; follow artifactLifecycle.delete. Deletion is terminal and artifacts_restore remains unavailable."
          : "artifacts_delete and artifacts_restore are unavailable. Deletion and restoration cannot be performed through this MCP catalogue.",
        sharing: ARTIFACT_P0B
          ? "Default share is VIEW ONLY (read). Owner-only artifacts_set_access grants or revokes named read access to one approved colleague at a time (confirm the colleague with the Product Owner); follow artifactLifecycle.share. \"Everyone\" means every approved platform user (platform mode, read-only); set it with artifacts_set_access({artifactId, action:'grant', principalId:'sentropic:platform', grant:'read', idempotencyKey}). Public sharing (no login) is permanently disabled and unavailable: never offer it, and a public request is refused with a typed refusal. A share covers all retained versions; a paused share (suspended account) resumes automatically once the account is approved again. Find colleagues with artifacts_lookup_people (opaque userRef, never an email, never a sub) and review the mode and grants with artifacts_list_access. The first baskets call on a shared page asks for the reader's baskets consent once per page (memorized until revoked); artifacts_revoke_reader_consent withdraws it and the next baskets call asks again. Confirm each named grant with the Product Owner (Chaperon Immobilier) before calling."
          : "artifacts_set_access is unavailable. Granting or revoking read/source access and changing public visibility cannot be performed through this MCP catalogue; do not claim sharing was changed. Public sharing stays disabled regardless.",
      },
      theme: DESIGN_KIT_THEME,
      designPackages: {
        react: `@sentropic/design-system-react@${DESIGN_KIT_REACT_SNAPSHOT}`,
        themes: `@sentropic/design-system-themes@${DESIGN_KIT_THEMES_VERSION}`,
        snapshotLag: "npm now ships design-system-react 0.38.0 ESM-only (no UMD); " +
          "the browser snapshot stays pinned at 0.36.46 until a newer bundle is qualified under the release CSP.",
      },
      rule: "Sentropic DS is mandatory: set data-st-theme=\"sent-tech\" on <html>, load the two " +
        "official kit stylesheets plus ThemeProvider when DS React components are used, and style only with DS " +
        "components and --st-* tokens. Never write your own palette and never redefine --st-* " +
        "tokens to recreate one. Claude default styling (orange or any author theme) is forbidden.",
      assets: {
        manifest: DESIGN_KIT_ASSETS.map((asset) => ({ ...asset, url: designKitAssetUrl(asset) })),
        loadOrder: [...DESIGN_KIT_ASSETS.map((asset) => designKitAssetUrl(asset)), "/app.css"],
        note: "Official kit stylesheets served same-origin from the reserved design path " +
          `(${DESIGN_KIT_VERSION}, sha256-pinned, text/css, outside the 256 KiB publication budget). ` +
          "Load sent-tech.css, then components.css, then the page stylesheet; load reader.js before app.js.",
      },
      mapBase: {
        tiles: "/__artifacts/tiles/v1/{z}/{x}/{y}",
        labels: "/__artifacts/tiles/v1/labels/{z}/{x}/{y}",
        note: "Same-origin raster basemap for artifact pages (lot I-10): served by the content origin " +
          "under img-src 'self', no worker required. Render the tile layer from the tiles template; paint " +
          "the labels template over it only when the fallback upstream is active. Always keep the " +
          "attribution below visible. Templates mirror api/src/artifacts/tile-proxy.ts (source of truth). " +
          "The worker-free Canvas 2D map base (I-4 skeleton, read-only first) is served pinned " +
          `(${MAP_KIT_VERSION}, sha256, outside the 256 KiB publication budget) on the same reserved ` +
          "design path as the kit stylesheets; a wrong digest answers 404. Full application map parity is I-12.",
        attribution: [
          { text: "© Gouvernement du Québec — Cartes topographiques 1/20 000 (CC-BY 4.0)",
            licenseUrl: "https://www.donneesquebec.ca/licence/" },
          { text: "© Sa Majesté le Roi du chef du Canada, représenté par le ministre de Ressources naturelles Canada",
            licenseUrl: "https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada" },
        ],
        howTo: [
          "Load the I-4 worker-free map base (PR #996: map-v1 pinned at " +
            "/__artifacts/design/map-v1/<sha256>/map-base.mjs plus map-base.css on the same reserved design path). " +
            "Import { createMap } from the pinned map-base.mjs URL, render <div class=\"map-base\">, then call " +
            "createMap(container, { basemapTemplate: '/__artifacts/tiles/v1/{z}/{x}/{y}' }). A configured template " +
            "must be a same-origin /z/x/y path; anything else throws. The background stays the neutral fill until " +
            "the first tile arrives, and on any tile error the neutral fill plus the overlays still paint.",
          "Feed the base only through GET /__reader/api/<operation> with the x-preview-grant header, exactly like " +
            "basket reads; never call /api/* from a published page. First GET geo.cities.v1 for the served cities, " +
            "then GET geo.collection-items.v1?collectionId=<served-qc-zonage> for the chosen city; pass the returned " +
            "FeatureCollections to map.setZones(collection) and map.setLots(collection), then map.fitToBounds().",
          "Paint only through map.setPaint({ zones, lots, outlines }) with page-supplied expressions; subscribe " +
            "with map.on('click', cb) and map.on('hover', cb); zoom with map.zoomIn()/zoomOut()/setView(view).",
          "Keep both attribution strings above visible in a bottom-right overlay that is never hidden and never " +
            "behind a toggle; never paint tiles when the attribution for the active upstream is absent. img-src " +
            "stays 'self' with zero external origin and zero CSP violation; worker-src 'none' is invariant.",
        ],
        kit: "map",
        version: MAP_KIT_VERSION,
        manifest: MAP_KIT_ASSETS.map((asset) => ({ ...asset, url: mapKitAssetUrl(asset) })),
        load: [
          "Link the two pinned kit stylesheets (assets.manifest), then the pinned map-base.css, then the page stylesheet; " +
            "import { createMap } from the pinned map-base.mjs URL (mapBase.manifest).",
          "Render <div class=\"map-base\" id=\"map\"> and call createMap(container, { basemapTemplate: null }). " +
            "The module appends its own <canvas>; never set inline styles, never inject <style>.",
          "Set the basemap template to the tiles path above (and the labels template when the fallback upstream is active). " +
            "A configured template must be a same-origin /z/x/y path; anything else throws.",
        ],
        feed: [
          "Read GeoJSON only through GET /__reader/api/<operation> with the x-preview-grant header, exactly like " +
            "basket reads; never call /api/* from a published page and never bundle dataset bytes into page files.",
          "Pass the returned FeatureCollections to map.setZones(collection) and map.setLots(collection); " +
            "municipal outlines, when required, travel the same way through map.setOutlines(collection).",
          "Call map.fitToBounds() after the sources are set; the view (center/scale) stays in the page.",
        ],
        paint: [
          "Paint only through map.setPaint({ zones, lots, outlines }) with page-supplied expressions: " +
            "a literal color string, a (properties) => color function, or " +
            "{ property, stops: [[value, color], ...], fallback }.",
          "Keep the neutral background for unstyled layers; style only with DS tokens in page CSS.",
        ],
        events: [
          "Subscribe with map.on('click', cb) and map.on('hover', cb); the click payload carries " +
            "{ layer, feature, index, lon, lat } with the topmost feature (lots over zones over outlines).",
          "Zoom with map.zoomIn()/zoomOut()/setView(view); the wheel and drag gestures are built in.",
          "Keep the mapBase.attribution entries visible below the map whenever a tile layer is on.",
        ],
        limits: [
          "worker-src 'none' is invariant: no Worker, no service worker, no blob: URL — the base needs none.",
          "No inline style attribute, no injected <style>, no external tile, glyph or font fetch by default; " +
            "tile images, once enabled, stay same-origin under img-src 'self'. " +
            "A page violating this fails the CSP gate and stays unpublished.",
          "The page (HTML/CSS/JS/JSON it publishes) must stay under the 256 KiB publication cap; " +
            "the map base is proven outside the budget because no publication can claim the __artifacts path.",
        ],
      },
      starter: {
        version: STARTER_VERSION,
        files: STARTER_FILES,
        adapt: "Publish the four files as-is, then adapt presentation and allowed filters only: " +
          "title, lede, result card fields (card.label, card.stage, target), basket/limit options. " +
          "Keep reader.js untouched; keep every data call on the H5 bridge.",
      },
      data: {
        warning: "Never call /api/* from a published page: the content host answers 401 there. " +
          "Basket reads go only through GET /__reader/api/<operation> with the x-preview-grant header.",
        grantCycle: [
          "Read grant once from the URL (?grant=), keep it in memory, then remove that parameter only with history.replaceState (keep the other query parameters).",
          "Send same-origin requests with cookies plus the x-preview-grant header. Never store the grant (no localStorage, no logs) and never embed it in published files.",
          "The opening grant is document-only: the first baskets.context/search/state or workspaces.list call answers 403 basket_consent_required. Navigate top-level to /__reader/consent once, approve reading YOUR OWN baskets on the control page, then replay the call with the renewed grant. That approval is the persistent baskets consent (baskets.read, plus baskets.write.prepare when the page prepares actions): it is memorized per page until the reader revokes it, later sessions skip the screen after a fresh rights check, and withdrawing it (account settings or artifacts_revoke_reader_consent) makes the next baskets call ask again.",
          "Renew with POST /__reader/renew before the 55 s expiry; concurrent reads share one renewal.",
          "After a 401 renewal with a grant, retry once without a grant to recover the sealed session, then stop.",
          "Every opening of a shared page shows a neutral screen on the control origin; confirming it opens the document only and records nothing. The baskets consent above is separate: after the reader withdraws it with artifacts_revoke_reader_consent the next baskets call asks again; a suspended account is refused without a screen.",
          "When the session or rights are gone, stop and offer “Réouvrir la page” to /__reader/start. No retry loop and never render an error as an empty list.",
        ],
        operations: [
          { name: "workspaces.list.v1", method: "GET", path: "/__reader/api/workspaces.list.v1",
            params: "None. Unknown and duplicate parameters are rejected. Requires signals.protected-read, the same H5 grant and session as baskets.context.v1.",
            response: "{ ok: true, workspaces: [{ id, slug, label, signals: { availability: { state: 'open' } | { state: 'closed' | 'unavailable', reason } } }] }. Only the approved reader's active memberships; no publisher authority or account details. Availability reuses baskets.context.v1 (not_activated, maintenance, not_configured, transport_closed, unresolved_history, dependency_unavailable, catalog_unavailable). Call first, fill a labelled select, preselect a sole workspace, otherwise require a choice. Manual UUID entry only when the list is empty; errors never mean an empty list." },
          { name: "baskets.context.v1", method: "GET",
            path: "/__reader/api/baskets.context.v1?workspaceId=<UUID>",
            params: "workspaceId (UUID, required).",
            response: "{ ok: true, context: { workspaceId, signals, lots, reasonCatalog, … } }. Call after workspaces.list.v1 with the selected explicit workspaceId; recheck availability before searching." },
          { name: "baskets.search.v1", method: "GET",
            path: "/__reader/api/baskets.search.v1?workspaceId=<UUID>&citySlug=<slug>&basket=all&limit=20",
            params: "workspaceId (required UUID), citySlug (required lowercase slug), basket=all|none|pertinent|a_surveiller (default all), limit=1-100 (default 20), cursor (opaque), archive=exclude|include|only (default exclude), personalHistory=any|untouched|has_history (default any), dateBasis=document, sort=freshness_desc. Unknown or duplicate parameters are rejected.",
            response: "{ ok: true, workspaceId, citySlug, items, counts, snapshot, page: { limit, nextCursor, truncated } }. Use server counts, keep the opaque cursor, reset pagination when filters change." },
          { name: "baskets.state.v1", method: "GET", path: "/__reader/api/baskets.state.v1",
            params: "workspaceId (UUID), citySlug, type=Signal|DesignationEvent, id (1-512 characters), reveal=true|false (default false).",
            response: "{ ok: true, contractVersion: 'signal-state-v1', workspaceId, snapshot, item: { target, readiness, displayedFingerprint, card, facets } }. Read one authorized target; reveal_required is an explicit action, not an empty result." },
          { name: "geo.read.v1", method: "GET", path: "/__reader/api/geo.read.v1",
            params: "collectionId=qc-(zonage|lots)-<slug>, limit=1-100 (default 10). Requires geo.read.",
            response: "Legacy synthetic operation on fixtures only: { type: 'FeatureCollection', features: [{ zoneCode, citySlug }] }. Never a map source; for real zones use geo.collection-items.v1. Do not present synthetic data as current." },
          { name: "geo.cities.v1", method: "GET", path: "/__reader/api/geo.cities.v1",
            params: "None (extra query parameters are ignored). Requires geo.read, the same H5 grant and session as baskets.context.v1.",
            response: "{ ok: true, cities: [{ citySlug, zoneCount, lotCount, signalCount, collections }] }. Served-catalogue cities only (known-licence qc-zonage); municipal, non-personal data that never triggers the basket consent. Call before geo.collection-items.v1; never invent a city slug." },
          { name: "geo.collection-items.v1", method: "GET",
            path: "/__reader/api/geo.collection-items.v1?collectionId=<served-qc-zonage>&limit=200",
            params: "collectionId (served qc-zonage only, required), limit=1-1000 (default 200; above 200 requires bbox), bbox=minLon,minLat,maxLon,maxLat, offset>=0. Requires geo.read. Extra query parameters are ignored.",
            response: "{ type: 'FeatureCollection', features, numberMatched, numberReturned, truncated, collectionId, licenseId, contract }. Bounded in features and bytes; a refused collection answers typed geo_governed_not_served without upstream call. Never serves adresse, code_postal* or extrait_brut. Feed the returned collection to the I-4 map base (see mapBase.howTo)." },
          { name: "signals.protected-read.v1", method: "GET", path: "/__reader/api/signals.protected-read.v1",
            params: "city (1-64 characters). Requires signals.protected-read.",
            response: "Synthetic legacy operation: { city, reader, signals: [{ id, city, kind, detail }] }. For real signals use baskets.search.v1." },
          { name: "status.closed.v1", method: "GET", path: "/__reader/api/status.closed.v1",
            params: "None. Closed capability diagnostic only.", response: "Unavailable; never a production data source." },
        ],
        errorKinds: [
          { kind: "no_workspace", codes: "workspace_required, workspace_ambiguous, workspace_missing", ui: "Prompt for an explicit workspace." },
          { kind: "consent", codes: "basket_consent_required", ui: "One-time top-level consent at /__reader/consent, then replay the call once." },
          { kind: "denied", codes: "workspace_not_authorized, account_not_approved, capability_required, delegated_scope_refused, forbidden", ui: "Readable refusal plus reopen link." },
          { kind: "session", codes: "unauthenticated, session_expired", ui: "Access-expired state plus reopen link." },
          { kind: "changed", codes: "snapshot_changed, cursor_expired, projection_revision_unstable", ui: "Restart-the-query state." },
          { kind: "invalid", codes: "invalid_query, invalid_cursor, incompatible_continuation, request_uri_too_long, invalid_params, target_not_found, unknown_operation", ui: "Parameter-check state." },
          { kind: "unavailable", codes: "5xx capability codes (signal_capability_unavailable, catalog_unavailable, …)", ui: "Unavailable state with retry." },
        ],
      },
      components: COMPONENTS,
      checklist: [
        "Page root carries data-st-theme=\"sent-tech\" and links the two pinned kit stylesheets (exact digest URLs).",
        "No author color: author CSS/JS reference only --st-* tokens and the documented st-* classes.",
        "Zero calls to /api/*; reader.js discovers the READER's workspaces first (workspaces.list.v1), then reads context and searches with the selected workspaceId. Never hardcode an author basket or workspace id.",
        "Grant is read from the URL once, removed from the URL, renewed, never stored or logged.",
        "Empty, unavailable, denied, consent and expired-session states are visually distinct; expired access offers reopening.",
        "Empty results stay empty (no workspace list shown is not an empty result); a 403 basket_consent_required triggers the one-time consent navigation, never an empty list.",
        "No inline <script> or <style> blocks: the release CSP stays hash-free and browser-clean.",
        "Keyboard and mobile pass: labelled fields, visible focus, aria-live status, French copy.",
        "Run npx --yes -p @sentropic/design-system-skills@0.1.0 design audit ./index.html with the pinned kit styles resolved locally; exit 1 (findings) and exit 2 (tool error) both block publication. Static checks do not replace browser acceptance. Server-side publication enforcement is a follow-up.",
      ],
      frameworks: FRAMEWORK_STARTERS,
      frameworkBuild: FRAMEWORK_BUILD_RULE,
      uiState: {
        contractId: "immo.page-state.v1",
        ownership: "IMMO owns page state, templates and H5 data mapping. No UI-state persistence API exists. The generic registry/transport may later be capitalized in cluster-mesh; no ui:// dependency here.",
        bootstrap: "URL parameters override local preferences, then defaults. workspaceId is explicit and always checked through H5; local state never grants access. The starter keeps filters/loading/cursor/results in memory. Reset the cursor when filters change.",
        persistence: "Optional localStorage key immo.page-state.v1: only whitelisted non-sensitive filters/preferences, at most 32 KiB, v=1, parse/validate in try/catch, unknown version resets, memory fallback and explicit erase. Never persist grants, credentials, basket results, opaque cursors or identifying free text. Pinned releases and the app have different origins: no shared localStorage/BroadcastChannel, no cross-release continuity promised. Service workers remain blocked on artifact hosts; no postMessage relay is implemented.",
        example: { v: 1, workspaceId: null, filters: { citySlug: "", basket: "all", limit: 20 }, selection: {}, page: {} },
      },
      elements: {
        package: "@sentropic/design-system-elements", packageVersion: "0.1.0",
        catalogId: "https://design-system.sent-tech.ca/catalogs/elements/v1/catalog.json",
        componentIds: ["BarChart", "BpmnCanvas", "DecisionDossier"],
        status: "Framework-agnostic custom elements st-bar-chart, st-bpmn-canvas, st-decision-dossier; contractVersion 1.0, JSON envelope with root.component and hostConfig in script#st-host-config[type=application/json]. Package exports an envelope validator for server use. Not vendored/qualified in this CSS-only revision: do not import a CDN. Runtime assets, validator and prompt hashes must be pinned before use.",
      },
      componentUsage: "React CSS recipes use components[].sourcePackage + componentName + snapshotVersion with promptRef/hash for provenance. Elements catalogue contracts are described separately in elements. Essential snapshot prompts: the full React DS runtime uses window.SentropicDS.<componentName> inside ThemeProvider; load DS styles + ThemeProvider, never write your own palette. The native CSS fast path uses the listed st-* markup without the DS React runtime: Button is a native button (variant primary/secondary/ghost/danger, size sm/md/lg); Input/Select need a visible label and help/error association; Card is a noninteractive container unless a real link/button is provided; Tag is informational, not an action; Notification needs readable title/message and status/alert semantics; ContentSwitcher needs keyboard behavior and selection state; InlineLoading needs accessible status text and reduced motion. Do not imitate complex component behavior; use a qualified runtime. Prompt files are provenance, these inline instructions are available to the remote author.",
      ...(ARTIFACT_P0B ? { artifactLifecycle: {
        descriptor: ARTIFACT_PROFILE_DESCRIPTOR,
        edit: ["Read artifacts_get for permissions and currentReleaseId, then artifacts_get_source({artifactId}) for the retained manifest and file text. Source requires immo:artifacts:read; immo:read alone is insufficient. get_source stays bounded (at most 32 files / 256 KiB total): a release larger than that cannot be re-read whole through this call — republish from the author's own files instead; never invent missing source.",
          "For large assets (photographs, PDF) stage bytes outside the model: artifacts_create_upload({artifactId, mimeType, maxSize:<exact file byte size>}) for a signed PUT URL — the signature binds that exact Content-Length, so measure the bytes first: a PUT of any other size is refused. PUT the exact bytes with exactly the announced requiredHeaders and nothing else, artifacts_commit_upload({artifactId, uploadId, path, mimeType, digest, size, idempotencyKey}) to pin, then artifacts_publish_bundle({artifactId, files, assets, expectedCurrentReleaseId, idempotencyKey}) for one atomic release — or artifacts_publish_bundle_v2 for the copy/carry/keep asset forms. When the Product Owner supplies the files, mint an upload page: artifacts_create_upload_page({artifactId}) returns an uploadPageUrl for originals — bytes go browser to storage, never through a model payload; review staged and released files with artifacts_list_assets. Release ceilings: 255 files, 16 MiB per file, 64 MiB per release. Served binaries: image/png, image/jpeg, image/gif, image/webp, image/svg+xml, application/pdf, font/woff2, video/mp4; magic-byte verified at commit. Commit re-verifies the staged bytes server-side and refuses a mismatch with verification_failed, deleting the staging and closing the session with no release.",
          ARTIFACT_STRICT ? STRICT_ARTIFACT_GUIDE : "Edit the returned text locally with the supplied DS starter rules, preserve every required file, then artifacts_publish({artifactId, files, idempotencyKey}) with a fresh key. Publish the complete snapshot, not a patch. expectedCurrentReleaseId is not required by this profile.",
          `Keep the same key and identical content on retries. resultEnvelopeVersion: ${ARTIFACT_PROFILE_DESCRIPTOR.resultEnvelopeVersion}. ` +
            (ARTIFACT_PART1 ? "Results are in output; use either full files or edits:[{path,oldStr,newStr}], never both. Supply title/description/icon on ensure or publish. list_versions returns retained releases; revert({artifactId,targetReleaseId,expectedCurrentReleaseId,idempotencyKey}) creates a new release with current metadata and ACL. " : "Results remain at the root. ") +
            "release_unavailable requires another retained release or the original author files; never invent missing source."],
        share: ["Only the owner calls artifacts_set_access({artifactId, action:'grant', principalId:<colleague userRef>, grant:'read', idempotencyKey}). The principalId is the opaque userRef returned by artifacts_lookup_people for the approved colleague — never an email, never an IdP sub (grants and listings only ever show userRef). \"Share with Farid\" means one nominative read grant for Farid, view only. Named read sharing never widens the artifact mode and grants neither source nor editing. Confirm each named grant with the Product Owner (Chaperon Immobilier) before calling.",
          "List the mode and grants first with artifacts_list_access({artifactId}): the owner and platform admins see every entry, a simple reader sees the mode and its own entry only.",
          "Revoke with action:'revoke', the same principalId and a fresh idempotencyKey; omit grant. A reader withdraws their own persistent baskets consent separately with artifacts_revoke_reader_consent({artifactId, idempotencyKey}) — one scope (baskets.read or baskets.write.prepare) when scope names it, every scope when omitted; the next baskets call asks again. Publication quota exhaustion does not prevent sharing or revocation.",
          "Collab (source/editing) for ONE named colleague only exists as a schema-level reserve (restricted mode, case by case — never platform-wide, never public): no catalogue tool grants source in this delivery, artifacts_set_access grants read only, so never promise collab to the human.",
          "\"Everyone\" (platform mode: every approved platform user reads) is set with artifacts_set_access({artifactId, action:'grant', principalId:'sentropic:platform', grant:'read', idempotencyKey}) — read-only, like every grant. The sentropic:platform sentinel names no person; sentropic:public is refused (public mode, no login, is permanently disabled: never offer it).",
          "Every share covers all retained versions, current and past: warn the human before sharing. A paused share (suspended colleague account) stays listed and resumes automatically once the account is approved again.",
          "Source grants beyond one named collab and any public visibility change remain unavailable through this catalogue."],
        delete: [ARTIFACT_STRICT ? "Owner: read artifacts_get, then artifacts_delete({artifactId,expectedCurrentReleaseId:<observed currentReleaseId>,idempotencyKey}). Never send actor, owner, scope or a fabricated confirmation."
          : "Owner: artifacts_delete({artifactId, idempotencyKey}). expectedCurrentReleaseId is optional; the server binds the observed release to the confirmation. Never send actor, owner, scope or a fabricated confirmation.",
          "On confirmation_required, show details.managementUrl and expiresAt to the human. They sign into the normal IMMO application and explicitly approve permanent deletion. MCP bearer tokens cannot approve.",
          "Retry identical arguments with the same key plus details.confirmationRef. The proof is consumed in the deletion transaction. Invalid, expired or stale confirmation requires reading the page and starting a new deletion with a fresh key.",
          "Deletion is terminal for stable and exact-version readers. Physical purge remains pending; restore, fork, promote and renew remain unavailable."],
      } } : {}),
    });
  }
  return cached;
}
