/**
 * Authorized artifact content serving (ARTEFACTS A6/H5, L3).
 *
 * Serves the pinned release files (real HTML/CSS/JS set) to holders of a
 * valid session cookie plus a matching signed grant. The ticket is exchanged
 * before custom code runs and never appears in the final URL, Referer or
 * logs. Old tabs keep their pinned release; a newer release never leaks
 * through an old grant. The only exception is the official design-kit
 * stylesheets: public upstream bytes (sha256-pinned, no tenant data),
 * served without reader authorization so every page view is styled.
 *
 * Native files use the session scoped to one bound host — the stable
 * artifact host (serving the CURRENT release, revalidated fresh) or the
 * exact release host (serving its pinned release) — including module/CSS
 * imports and dynamic scripts. Published JavaScript calls H5 with
 * fetch and the x-preview-grant header:
 *   const grant = new URLSearchParams(location.search).get("grant");
 *   fetch("/__reader/api/baskets.search.v1?workspaceId=...&citySlug=...", {
 *     headers: { "x-preview-grant": grant },
 *   });
 * Grant renewal is available at POST /__reader/renew (presented grant in
 * header, session cookie required) before the 55 s expiry. After expiry, a
 * same-origin POST without a grant can recover from a current sealed P.
 */
import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { upgradeLegacyReaderBridge } from "@radar/artifacts-host";
import {
  applyReaderContentHeaders,
  isEmbedPath,
  isServiceWorkerPath,
  servedBodyLeaksCredentials,
} from "./content-isolation.js";
import {
  belongsToLegacyContentDomain,
  legacyContentRedirectTarget,
  parseContentHost,
} from "./content-host.js";
import { mintGrant, verifyGrant, type GrantIssuer } from "./preview-grant.js";
import { renewGrant } from "./preview-renewal.js";
import { mintConsentPendingCookie, readSessionClaims, type ConsentPendingReason } from "./preview-session.js";
import { readerEventEmitter, readerFailureCode, type ReaderEventSink } from "./reader-event-log.js";
import { adaptGrantToReader, canInvoke, type ApiReaderContext } from "./reader-context.js";
import type { AuthorityReader } from "./reader-profile.js";
import { validateReaderResponse } from "./reader-responses.js";
import {
  GEO_COLLECTION_ITEMS_QUERY_KEYS,
  isDocumentOperation,
  isGateBOperation,
  isGeoReadOperation,
  isScopedSignalOperation,
  isWorkspaceReadOperation,
  workspacesListParams,
  basketsContextParams,
  basketsSearchParams,
  basketsStateParams,
  isReaderOperation,
  operationMethod,
  validateOperationParams,
  type ReaderOperationName,
} from "./reader-operations.js";
import { GeoItemsRefusal } from "./reader-geo.js";
import { createGeoReaderBudget, type GeoReaderBudget } from "./reader-geo-budget.js";
import { appMeParams, buildAppMeResponse } from "./reader-me.js";
import { byCityParams } from "./reader-by-city.js";
import { coherentCityParams } from "./reader-coherent-city.js";
import { documentsPvParams, type ReaderDocumentRead } from "./reader-documents.js";
import {
  READER_CONCURRENCY,
  READER_GLOBAL_BUDGET,
  READER_OP_BUDGETS,
  READER_WORKSPACE_BUDGET,
  budgetKey,
  createBudgetStore,
  type ReaderBudgetStore,
} from "./reader-budgets.js";
import { BASKET_READ_SCOPE_ID, type BasketConsentGate } from "./reader-consent.js";
import {
  TILE_CLIENT_MAX_AGE_SECONDS,
  TILE_OSM_RATE_LIMIT_DEFAULT,
  TILE_PATH_PREFIX,
  TileProxy,
  createTileProxyApp,
} from "./tile-proxy.js";
import { READER_EXAMPLE_HTML } from "./reader-example.js";
import {
  normalizeReleaseHtml,
  normalizeReleasePath,
  releaseCspForHtml,
  type ReleaseFileProvider,
} from "./release-files.js";
import { designKitMimeFor, getDesignKitBytes, resolveDesignKitAsset } from "./design-kit.js";
import { ClassificationError, classificationFailure } from "../services/facets/classification-errors.js";
import { decodeQuery } from "../services/facets/classification-query.js";
import type { WritePageSurface } from "./write-intent-page-surface.js";

/**
 * Files parity LOT 2 §B.4 — RFC 9110 §14 single-range subset, mirrored from
 * the provider content handler: only the `bytes=` unit with one satisfiable
 * range is honored; malformed or multi-range headers fall back to the whole
 * file (never an error).
 */
export type ParsedContentRange =
  | { readonly start: number; readonly end: number }
  | "full"
  | "ignore"
  | "unsatisfiable";

export function parseContentRange(header: string | undefined, size: number): ParsedContentRange {
  if (header === undefined) return "full";
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return "ignore";
  const first = match[1]!;
  const last = match[2]!;
  if (first === "" && last === "") return "ignore";
  if (first === "") {
    // Suffix range: the last N bytes; longer than the file ⇒ the file.
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    if (suffix >= size) return size === 0 ? "unsatisfiable" : { start: 0, end: size - 1 };
    return { start: size - suffix, end: size - 1 };
  }
  const start = Number(first);
  if (!Number.isSafeInteger(start) || start >= size) return "unsatisfiable";
  if (last === "") return { start, end: size - 1 };
  const end = Number(last);
  if (!Number.isSafeInteger(end) || end < start) return "ignore";
  return { start, end: Math.min(end, size - 1) };
}

/** J1 zonage §0.4: the items query carries known keys only, each at most once. */
function geoItemsQueryIsStrict(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  if (Buffer.byteLength(url.pathname + url.search) > 16384) return false;
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (key === "grant") continue;
    if (!(GEO_COLLECTION_ITEMS_QUERY_KEYS as readonly string[]).includes(key)) return false;
  }
  return true;
}

export interface ContentServeDeps {
  readonly contentBase: string;
  readonly grantSecret: string;
  readonly sessionSecret: string;
  readonly issuer: GrantIssuer;
  readonly authority?: AuthorityReader;
  readonly readOperation?: (op: ReaderOperationName, params: unknown, context: ApiReaderContext) => Promise<unknown>;
  readonly releaseFiles?: ReleaseFileProvider | undefined;
  readonly openingContent?: Hono;
  readonly now?: () => number;
  /** Optional revocation predicate; revoked sessions fail closed. */
  readonly isRevoked?: (sessionId: string) => boolean;
  /**
   * Gate B (reader-consent design §2–§3.3): durable baskets consent,
   * re-read from the store on every business call. Absent keeps the
   * sealed-session flow only; present, a revoked or missing row refuses
   * the call even under a live cookie. A store failure fails closed.
   */
  readonly basketConsent?: BasketConsentGate;
  /**
   * J1.2d/e §13 reader budgets (process-local fixed windows). Absent, the
   * dispatch creates one store per content app. Each replica enforces its
   * own windows: with N replicas the effective budget (and the concurrency
   * and anti-enumeration caps) is up to N times LOOSER — `partial` until a
   * shared store exists.
   */
  readonly budgets?: ReaderBudgetStore;
  /**
   * J1.2d/e §0.4/§13 typed access journal: one line per reader op call,
   * 429 included — op, reader digest, artifact, release, status, bytes,
   * duration. Never a city, a signal, a workspace or a query. Absent, a JSON
   * line on `console.info`.
   */
  readonly accessLog?: (line: ReaderAccessLine) => void;
  /**
   * J1.2d/e §11.3 `documents.pv.v1`: PV PDF resolved from a signal the
   * reader can see. Absent keeps the op closed (503, no store read).
   */
  readonly readDocument?: ReaderDocumentRead;
  /**
   * Lot J1.3a: typed reader journal (closed shape: code, status, operation
   * name, request id, row count). Absent, nothing is logged.
   */
  readonly readerEvents?: ReaderEventSink;
  /** PW-C page write listener (prepare/status); absent keeps writes closed. */
  readonly pageWrite?: Hono;
  readonly writePageSurface?: WritePageSurface;
  /**
   * I-10B tile proxy override (tests inject a stub fetch here). Absent, the
   * mount creates a default live proxy — production serves real tiles with
   * zero extra wiring. Isolated optional field for the I2-partage rebase.
   */
  readonly tileProxy?: TileProxy;
  /**
   * J1 zonage §13 budget for `geo.collection-items.v1` (30/min per reader
   * and artifact). Absent, a process-local store is created. Isolated
   * optional field (tests inject a tight budget).
   */
  readonly geoBudget?: GeoReaderBudget;
}
type AuthorizedReader = ApiReaderContext & { readonly validUntil: number; readonly authorityVersion: string };

/** Typed reader-op access line (§0.4): no business data by construction. */
export interface ReaderAccessLine {
  readonly event: "reader_op";
  readonly op: string;
  readonly reader: string | null;
  readonly artifact: string | null;
  readonly release: string | null;
  readonly status: number;
  readonly bytes: number | null;
  readonly durationMs: number;
}

/** Non-reversible short reader digest for the access journal. */
export function readerDigest(readerSub: string): string {
  return createHash("sha256").update(`reader-access-v1:${readerSub}`, "utf8").digest("hex").slice(0, 16);
}

function bareHost(header: string | undefined): string {
  const raw = (header ?? "").trim().toLowerCase();
  if (raw === "" || raw.includes("]")) return raw;
  const colon = raw.lastIndexOf(":");
  if (colon !== -1) {
    const port = raw.slice(colon + 1);
    if (port !== "" && /^[0-9]+$/.test(port)) return raw.slice(0, colon);
  }
  return raw;
}

function presentedGrant(c: Context): string {
  return c.req.query("grant") ?? c.req.header("x-preview-grant") ?? "";
}

export function createReaderContentApp(deps: ContentServeDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => Date.now());
  const geoBudget = deps.geoBudget ?? createGeoReaderBudget();

  /**
   * Lot I2: deferred basket consent. H5 business calls (workspace/basket
   * reads) without a consented session answer a typed 403 the bridge turns
   * into a single top-level navigation to `/__reader/consent`. The envelope
   * already carries a requestId so the classification middleware above lets
   * the typed code through instead of remapping it to `capability_required`.
   * The document, files and design-kit never require this scope.
   */
  function basketConsentRefusal(c: Context, reason: ConsentPendingReason) {
    applyReaderContentHeaders(c);
    // J1.3a: remember the typed refusal on this host so a « Réouvrir la
    // page » (old bridges included) lands on the consent screen instead of
    // a document-only opening that would answer this 403 again.
    c.header("Set-Cookie", mintConsentPendingCookie(reason), { append: true });
    return c.json({ ok: false, error: { code: "basket_consent_required",
      message: "Basket reading needs a one-time consent.",
      retryable: false, action: "consent_baskets" }, requestId: randomUUID() }, 403);
  }

  /**
   * Gate B per business call: the sealed `basketScope` claim is a routing
   * hint only — the live store row at the current scope version is
   * authority, re-read here on every call (design §3.3).
   */
  async function basketConsentState(reader: AuthorizedReader): Promise<"live" | ConsentPendingReason | "unavailable"> {
    if (!reader.basketScope) return "required";
    if (!deps.basketConsent) return "live";
    try {
      // A basket-scoped session was minted on a recorded consent: a missing
      // row now means it was revoked since.
      return await deps.basketConsent.hasLiveConsent(
        reader.readerSub, reader.artifactId, BASKET_READ_SCOPE_ID) ? "live" : "revoked";
    } catch { return "unavailable"; }
  }

  /**
   * J1.3a: a ledger outage still fails closed, but as an explicit typed
   * error, never as a consent prompt the reader cannot satisfy.
   */
  function consentLedgerUnavailable(c: Context) {
    applyReaderContentHeaders(c);
    return c.json({ ok: false, error: { code: "consent_ledger_unavailable",
      message: "The consent ledger is unavailable.", retryable: true, action: "retry_later" },
    requestId: randomUUID() }, 503);
  }

  /** Gate B outcome as a response, or null when the live consent covers the call. */
  async function basketGate(c: Context, reader: AuthorizedReader): Promise<Response | null> {
    const state = await basketConsentState(reader);
    if (state === "live") return null;
    if (state === "unavailable") return consentLedgerUnavailable(c);
    return basketConsentRefusal(c, state);
  }

  function stillOpen(reader: AuthorizedReader): boolean {
    return reader.validUntil > now() && !deps.isRevoked?.(reader.sessionId);
  }

  /**
   * J1.2d/e §13 budgets: fixed windows per (reader, artifact, op) plus the
   * global per-(reader, artifact) envelope. Consumed BEFORE param validation
   * and resolution, so validation failures and resolution misses count
   * against the budget (anti-enumeration). Nothing is recorded on refusal.
   */
  const budgets = deps.budgets ?? createBudgetStore();
  function spendBudget(
    reader: AuthorizedReader, op: string,
  ): { ok: true } | { ok: false; retryAfterSec: number } {
    // The global envelope is shared across ops (one key); the op budget has
    // its own key. Global first, so a global refusal does not burn the op
    // window — and a later op refusal keeps the global spend (no unspend).
    const global = budgets.consume(
      budgetKey(reader.readerSub, reader.artifactId, "*"), READER_GLOBAL_BUDGET, now());
    if (!global.ok) return global;
    const windows = READER_OP_BUDGETS[op] ?? [];
    if (windows.length === 0) return { ok: true };
    return budgets.consume(budgetKey(reader.readerSub, reader.artifactId, op), windows, now());
  }
  function rateLimited(c: Context, retryAfterSec: number): Response {
    applyReaderContentHeaders(c);
    c.header("Retry-After", String(retryAfterSec));
    return c.json({ error: "rate_limited" }, 429);
  }

  async function authorityCurrent(reader: AuthorizedReader): Promise<boolean> {
    if (!deps.authority) return false;
    try {
      return await deps.authority.getAuthorizationVersion(reader.artifactId, reader.readerSub, reader.releaseId) === reader.authorityVersion && stillOpen(reader);
    } catch { return false; }
  }

  async function authorized(c: Context, resource = false): Promise<AuthorizedReader | null> {
    const grant = presentedGrant(c);
    const host = bareHost(c.req.header("host"));
    const session = readSessionClaims(c.req.header("cookie"), deps.sessionSecret, now());
    const parsed = parseContentHost(c.req.header("host"), deps.contentBase);
    const sealed = session?.resource;
    // Cookie-only authority is restricted to native files on the one bound
    // host: the exact release host (sealed.releaseId) or the stable artifact
    // host (sealed.artifactId). An explicitly presented invalid grant never
    // falls back to the cookie. Release freshness on the stable host is
    // enforced below against the live authority, not here.
    const claims = grant ? await verifyGrant(grant, { ...deps.issuer, host }, deps.grantSecret, now())
      : resource && parsed.kind === "content" && sealed?.host === host &&
        (sealed.artifactId === parsed.id || sealed.releaseId === parsed.id) &&
        sealed.issuer === deps.issuer.issuer && sealed.audience === deps.issuer.audience && sealed.tier === deps.issuer.tier
        ? { ...sealed, expiresAtMs: session!.expiresAt } : null;
    if (!claims) return null;
    if (!session || session.sid !== claims.sessionId || session.readerSub !== claims.readerSub || session.artifactId !== claims.artifactId) return null;
    const content = parseContentHost(c.req.header("host"), deps.contentBase);
    if (content.kind === "other") return null;
    if (content.id !== claims.artifactId && content.id !== claims.releaseId) return null;
    if (deps.isRevoked?.(session.sid)) return null;
    if (!deps.authority) return null;
    // Stable artifact host serves only the CURRENT release: a session pinned
    // at exchange time fails closed after a republish and the browser re-runs
    // the exchange cleanly. The exact release host keeps its pinned release
    // so old tabs never leak the new one. An id that is both an artifact and
    // a release fails closed.
    if (claims.artifactId === claims.releaseId) return null;
    if (content.id === claims.artifactId) {
      let current: { artifactId: string; releaseId: string } | null;
      try {
        current = await deps.authority.getRelease(claims.artifactId);
      } catch { return null; }
      if (!current || current.artifactId !== claims.artifactId || current.releaseId !== claims.releaseId) return null;
    } else if (content.id !== claims.releaseId) {
      return null;
    }
    try {
      const version = await deps.authority.getAuthorizationVersion(claims.artifactId, claims.readerSub, claims.releaseId);
      if (!version) return null;
      const context = await adaptGrantToReader(claims, deps.authority);
      if (!context) return null;
      if (await deps.authority.getAuthorizationVersion(claims.artifactId, claims.readerSub, claims.releaseId) !== version) return null;
      const reader = { ...context, validUntil: Math.min(claims.expiresAtMs, session.expiresAt), authorityVersion: version };
      if (!stillOpen(reader)) return null;
      c.set("readerAudit" as never, { reader: readerDigest(reader.readerSub),
        artifact: reader.artifactId, release: reader.releaseId } as never);
      return reader;
    } catch { return null; }
  }

  app.get("/livez", (c) => c.json({ status: "ok" }));
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Retired immo-pages hosts: 301 to the same UUID label on the new base,
  // path and query preserved. Never logged (may carry `?grant=`). Transition
  // only; remove with the legacy Ingress rules (runbook "Legacy redirect
  // removal").
  app.use("*", async (c, next) => {
    if (!belongsToLegacyContentDomain(c.req.header("host"))) return next();
    const url = new URL(c.req.url);
    const target = legacyContentRedirectTarget(
      c.req.header("host"), deps.contentBase, `${url.pathname}${url.search}`);
    if (!target) {
      applyReaderContentHeaders(c);
      return c.json({ error: "not_found" }, 404);
    }
    applyReaderContentHeaders(c);
    c.header("Cache-Control", "private, no-store");
    return c.redirect(target, 301);
  });

  // J1.2d/e §0.4/§13 typed access journal, outermost on the op surface so it
  // records the final status (429 and classification remaps included).
  const accessLog = deps.accessLog ?? ((line: ReaderAccessLine) => console.info(JSON.stringify(line)));
  app.use("/__reader/api/*", async (c, next) => {
    const started = performance.now();
    await next();
    const name = c.req.path.slice("/__reader/api/".length);
    const audit = c.get("readerAudit" as never) as { reader: string; artifact: string; release: string } | undefined;
    let bytes: number | null = Number(c.res.headers.get("content-length") ?? Number.NaN);
    if (!Number.isFinite(bytes)) {
      bytes = (c.res.headers.get("content-type") ?? "").includes("json")
        ? (await c.res.clone().arrayBuffer().catch(() => null))?.byteLength ?? null : null;
    }
    try {
      accessLog({ event: "reader_op", op: isReaderOperation(name) ? name : "unknown",
        reader: audit?.reader ?? null, artifact: audit?.artifact ?? null, release: audit?.release ?? null,
        status: c.res.status, bytes, durationMs: Math.round(performance.now() - started) });
    } catch { /* journaling never fails a read */ }
  });

  // J1.3a: typed journal of every H5 outcome, registered outside the
  // classification below so it records the code the page actually receives.
  // Closed shape only (see reader-event-log.ts): never a city, signal,
  // query, basket, workspace or reader identifier.
  const emit = readerEventEmitter(deps.readerEvents);
  if (deps.readerEvents) app.use("/__reader/api/*", async (c, next) => {
    await next();
    const op = c.req.path.slice("/__reader/api/".length);
    const status = c.res.status;
    const body = await c.res.clone().json().catch(() => null) as Record<string, unknown> | null;
    const requestId = body && typeof body.requestId === "string" ? body.requestId : undefined;
    if (status < 400) {
      const rows = body && Array.isArray(body.items) ? body.items.length
        : body && Array.isArray(body.workspaces) ? body.workspaces.length : undefined;
      emit({ surface: "h5", code: "ok", status, op, ...(requestId ? { requestId } : {}),
        ...(rows !== undefined ? { count: rows } : {}) });
      return;
    }
    emit({ surface: "h5", code: readerFailureCode(body, status), status, op, ...(requestId ? { requestId } : {}) });
  });

  app.use("/__reader/api/*", async (c, next) => {
    if (c.req.method !== "GET" || !isWorkspaceReadOperation(c.req.path.slice("/__reader/api/".length))) return next();
    try {
      await next();
      // §13: an exhausted budget stays a typed 429 + Retry-After (rate_limited).
      if (c.res.status < 400 || c.res.status === 429) return;
      const body = await c.res.clone().json().catch(() => null);
      if (body?.ok === false && typeof body.requestId === "string") return;
      const code = c.res.status === 401 ? "unauthenticated" : c.res.status === 403 ? "capability_required"
        : c.res.status === 400 ? "invalid_query" : c.res.status === 503 ? "transport_unavailable" : "internal_error";
      const failure = classificationFailure(new ClassificationError(code));
      c.res = c.json(failure.body, failure.status);
    } catch (error) {
      const failure = classificationFailure(error);
      c.res = c.json(failure.body, failure.status);
    }
  });

  app.use("*", async (c, next) => {
    applyReaderContentHeaders(c);
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return c.json({ error: "unauthenticated" }, 401);
    if (c.req.header("authorization") || c.req.header("x-reader-sub")) return c.json({ error: "invalid_authority" }, 400);
    if (c.req.header("service-worker") || isServiceWorkerPath(c.req.path) || isEmbedPath(c.req.path)) {
      return c.json({ error: "not_found" }, 404);
    }
    return next();
  });

  // PW-C page write listener owns the two page write operations. It runs
  // after the parent gate and before the read-only operation dispatch; an
  // absent listener keeps writes closed without disabling publication, page
  // opening, or unrelated read operations.
  if (deps.pageWrite) app.route("/", deps.pageWrite);
  app.post("/__reader/renew", async (c) => {
    const parsed = parseContentHost(c.req.header("host"), deps.contentBase);
    if (parsed.kind === "other") return c.json({ error: "not_found" }, 404);
    if (!deps.authority) {
      applyReaderContentHeaders(c);
      return c.json({ error: "capability_unavailable" }, 503);
    }
    const presented = presentedGrant(c);
    if (!presented) {
      // Recovery adopts only the already approved, sealed resource. It cannot
      // choose a reader, release or profile, nor renew the page session itself.
      const host = c.req.header("host");
      const site = c.req.header("sec-fetch-site");
      if (c.req.header("origin") !== `https://${host}` || (site !== undefined && site !== "same-origin")) {
        return c.json({ error: "forbidden_origin" }, 403);
      }
      const reader = await authorized(c, true);
      if (!reader) return c.json({ error: "unauthenticated" }, 401);
      const session = readSessionClaims(c.req.header("cookie"), deps.sessionSecret, now());
      if (!session?.resource) return c.json({ error: "unauthenticated" }, 401);
      const grant = await mintGrant(session.resource, deps.grantSecret, now());
      if (!await authorityCurrent(reader)) return c.json({ error: "unauthenticated" }, 401);
      return c.json({ grant });
    }
    const host = bareHost(c.req.header("host"));
    const claims = await verifyGrant(presented, { ...deps.issuer, host }, deps.grantSecret, now());
    if (!claims) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    const session = readSessionClaims(c.req.header("cookie"), deps.sessionSecret, now());
    if (!session || session.sid !== claims.sessionId || session.readerSub !== claims.readerSub || session.artifactId !== claims.artifactId) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    // Stable artifact host renews only the CURRENT release: a stale grant
    // fails closed here and the browser re-runs the exchange instead of
    // extending the old release. The exact release host renews its pinned
    // release. The cookie-recovery path above already enforces the same rule
    // through authorized().
    if (deps.authority && parsed.kind === "content" && parsed.id === claims.artifactId &&
      claims.artifactId !== claims.releaseId) {
      let current: { artifactId: string; releaseId: string } | null = null;
      try {
        current = await deps.authority.getRelease(claims.artifactId);
      } catch { current = null; }
      if (!current || current.artifactId !== claims.artifactId || current.releaseId !== claims.releaseId) {
        applyReaderContentHeaders(c);
        return c.json({ error: "unauthenticated" }, 401);
      }
    }
    applyReaderContentHeaders(c);
    const renewed = await renewGrant(
      presented,
      { authority: deps.authority, secret: deps.grantSecret, issuer: deps.issuer },
      (sid) => deps.isRevoked?.(sid) ?? false,
      now(),
    );
    if (!renewed) return c.json({ error: "unauthenticated" }, 401);
    return c.json({ grant: renewed });
  });

  if (deps.openingContent) app.route("/", deps.openingContent);
  if (!deps.readOperation && deps.writePageSurface) for (const operation of ["state", "search"] as const) app.get(`/__reader/api/baskets.${operation}.v1`, async (c) => {
    if (!deps.writePageSurface) return c.json({ error: "capability_unavailable" }, 503);
    const reader = await authorized(c);
    if (!reader || !canInvoke(reader, "signals.protected-read", reader.releaseId)) return c.json({ error: "unauthenticated" }, 401);
    const gated = await basketGate(c, reader);
    if (gated) return gated;
    try {
      const params = new URL(c.req.url).searchParams;
      params.delete("grant");
      const body = await deps.writePageSurface.read(operation, params, reader);
      if (!await authorityCurrent(reader)) return c.json({ error: "unauthenticated" }, 401);
      return c.json(body);
    } catch (error) { const failure = classificationFailure(error); return c.json(failure.body, failure.status); }
  });

  // J1.2d/e wagon 1 (§14.1): the /__app/ relay prefix is reserved and
  // closed on content origins — explicit local 404 with no upstream call and
  // no release-file lookup, registered before every serving route.
  app.all("/__app", (c) => {
    applyReaderContentHeaders(c);
    return c.json({ error: "not_found" }, 404);
  });
  app.all("/__app/*", (c) => {
    applyReaderContentHeaders(c);
    return c.json({ error: "not_found" }, 404);
  });

  /**
   * J1.2d/e wagon 5 (§11.3): binary resource op. Same gates as the JSON ops
   * (content host, GET, Gate B, capability, authority before and after,
   * budget, strict params) but authorized by the sealed session cookie of
   * the bound host — pdf.js sets no grant header, and a `?grant=` URL is
   * refused before any authorization. Every failure is closed and typed;
   * a missing, archived or unattached document answers the same 404.
   */
  async function serveDocument(c: Context): Promise<Response> {
    applyReaderContentHeaders(c);
    const url = new URL(c.req.url);
    if (url.searchParams.has("grant")) return c.json({ error: "invalid_query" }, 400);
    const auth = await authorized(c, true);
    if (!auth) return c.json({ error: "unauthenticated" }, 401);
    const gated = await basketGate(c, auth);
    if (gated) return gated;
    if (!canInvoke(auth, "signals.protected-read", auth.releaseId)) return c.json({ error: "forbidden" }, 403);
    if (!deps.readDocument) return c.json({ error: "capability_unavailable" }, 503);
    if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
    // Spent before validation and resolution: refusals count (anti-enumeration).
    const spent = spendBudget(auth, "documents.pv.v1");
    if (!spent.ok) return rateLimited(c, spent.retryAfterSec);
    let params;
    try {
      if (Buffer.byteLength(url.pathname + url.search) > 16384) throw new ClassificationError("request_uri_too_long");
      params = decodeQuery(url.searchParams, documentsPvParams);
    } catch (error) {
      const failure = classificationFailure(error);
      return c.json(failure.body, failure.status);
    }
    const slot = budgetKey(auth.readerSub, auth.artifactId, "documents.pv.v1");
    if (!budgets.tryEnter(slot, READER_CONCURRENCY["documents.pv.v1"] ?? 2)) return rateLimited(c, 1);
    try {
      const result = await deps.readDocument(params, auth);
      if (!stillOpen(auth) || !await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
      if (result.kind === "not_found") return c.json({ error: "document_not_found" }, 404);
      if (result.kind === "unsupported_media") return c.json({ error: "unsupported_media_type" }, 415);
      if (result.kind === "too_large") return c.json({ error: "payload_too_large" }, 413);
      if (result.kind === "refused") {
        // Closed classification table: never a raw service message.
        const failure = classificationFailure(result.cause);
        return c.json({ error: failure.body.error.code }, failure.status);
      }
      c.header("Content-Type", "application/pdf");
      c.header("Content-Length", String(result.bytes.byteLength));
      c.header("Content-Disposition", "inline; filename=\"document.pdf\"");
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Content-Security-Policy", "sandbox; default-src 'none'");
      c.header("Cache-Control", "private, no-store");
      return c.body(new Uint8Array(result.bytes), 200);
    } catch {
      return c.json({ error: "capability_unavailable" }, 503);
    } finally {
      budgets.leave(slot);
    }
  }

  app.all("/__reader/api/:op", async (c) => {
    const parsed = parseContentHost(c.req.header("host"), deps.contentBase);
    if (parsed.kind === "other") return c.json({ error: "not_found" }, 404);
    const op = c.req.param("op");
    if (!isReaderOperation(op)) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unknown_operation" }, 404);
    }
    if (c.req.method !== operationMethod(op)) {
      applyReaderContentHeaders(c);
      return c.json({ error: "method_not_allowed" }, 405);
    }
    if (isDocumentOperation(op)) return serveDocument(c);
    const auth = await authorized(c);
    if (!auth) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    // Lot I2: the document opens without this scope; the first business
    // call carries the one-time consent instead. Gate B re-reads the live
    // store row on every call: revocation refuses here at once, even under
    // a live cookie.
    if (isGateBOperation(op)) {
      const gated = await basketGate(c, auth);
      if (gated) return gated;
    }
    if (op === "status.closed.v1") {
      applyReaderContentHeaders(c);
      return c.json({ error: "capability_unavailable" }, 503);
    }
    // I-1B: the governed catalogue operations share the `geo.read` gate
    // with the synthetic legacy `geo.read.v1` (isolated predicate).
    const capability = isGeoReadOperation(op) ? "geo.read" : "signals.protected-read";
    if (!canInvoke(auth, capability, auth.releaseId)) return c.json({ error: "forbidden" }, 403);
    if (!deps.readOperation) return c.json({ error: "capability_unavailable" }, 503);
    // J1.2d/e wagon 2 (§2.3): identity bootstrap synthesized server-side
    // from the verified reader context — no Gate B (the consent screen
    // boots from this call), no business call, no write. Strict empty
    // params: any unknown or duplicated key refuses before any build.
    if (op === "app.me.v1") {
      applyReaderContentHeaders(c);
      const spent = spendBudget(auth, op);
      if (!spent.ok) return rateLimited(c, spent.retryAfterSec);
      try {
        const url = new URL(c.req.url);
        if (Buffer.byteLength(url.pathname + url.search) > 16384) throw new ClassificationError("request_uri_too_long");
        if (url.searchParams.getAll("grant").length > 1) throw new ClassificationError("invalid_query");
        url.searchParams.delete("grant");
        decodeQuery(url.searchParams, appMeParams);
        const body = validateReaderResponse(op,
          buildAppMeResponse(deps.sessionSecret, auth.artifactId, auth.readerSub), auth.readerSub);
        if (!stillOpen(auth)) return c.json({ error: "unauthenticated" }, 401);
        if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
        return c.json(body);
      } catch (error) {
        const failure = classificationFailure(error);
        return c.json(failure.body, failure.status);
      }
    }
    if (isWorkspaceReadOperation(op) || isScopedSignalOperation(op)) {
      applyReaderContentHeaders(c);
      if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
      if (op === "workspaces.list.v1" || isScopedSignalOperation(op)) {
        const spent = spendBudget(auth, op);
        if (!spent.ok) return rateLimited(c, spent.retryAfterSec);
      }
      try {
        const url = new URL(c.req.url);
        if (Buffer.byteLength(url.pathname + url.search) > 16384) throw new ClassificationError("request_uri_too_long");
        if (url.searchParams.getAll("grant").length > 1) throw new ClassificationError("invalid_query");
        url.searchParams.delete("grant");
        const schema = op === "workspaces.list.v1" ? workspacesListParams
          : op === "signals.by-city.v1" ? byCityParams
          : op === "signals.coherent-city.v1" ? coherentCityParams
          : op === "baskets.context.v1" ? basketsContextParams : op === "baskets.search.v1"
          ? basketsSearchParams : basketsStateParams;
        const params = decodeQuery(url.searchParams, schema) as { workspaceId?: string };
        // J1.2d/e §4.3/§5.5: per-workspace admission, bounded in-flight calls
        // per reader, and a serialized-response ceiling — never a silent
        // truncation of cities or signals.
        if (isScopedSignalOperation(op) && params.workspaceId !== undefined) {
          // The page chooses the workspace id: admission is only CHECKED here
          // and spent after the scoped service re-verified the membership, so
          // a non-member cannot drain a workspace it merely knows the id of.
          const admissionKey = `ws\u0000${params.workspaceId}\u0000${op}`;
          const admitted = budgets.check(admissionKey, READER_WORKSPACE_BUDGET, now());
          if (!admitted.ok) return rateLimited(c, admitted.retryAfterSec);
          const slot = budgetKey(auth.readerSub, auth.artifactId, op);
          if (!budgets.tryEnter(slot, READER_CONCURRENCY[op] ?? 1)) return rateLimited(c, 1);
          try {
            const raw = await deps.readOperation(op, params, auth);
            budgets.consume(admissionKey, READER_WORKSPACE_BUDGET, now());
            const body = validateReaderResponse(op, raw, auth.readerSub);
            const ceiling = op === "signals.by-city.v1" ? 1048576 : 2097152;
            if (Buffer.byteLength(JSON.stringify(body)) > ceiling) {
              throw new ClassificationError(op === "signals.by-city.v1"
                ? "upstream_bad_payload" : "projection_payload_too_large");
            }
            if (!stillOpen(auth)) return c.json({ error: "unauthenticated" }, 401);
            if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
            return c.json(body);
          } finally {
            budgets.leave(slot);
          }
        }
        const body = validateReaderResponse(op, await deps.readOperation(op, params, auth), auth.readerSub);
        if (!stillOpen(auth)) return c.json({ error: "unauthenticated" }, 401);
        if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
        return c.json(body);
      } catch (error) {
        const failure = classificationFailure(error);
        return c.json(failure.body, failure.status);
      }
    }
    if (op === "geo.read.v1") {
      const params = validateOperationParams(op, {
        ...Object.fromEntries(Object.entries(c.req.query()).filter(([key]) => key !== "grant")),
        collectionId: c.req.query("collectionId") ?? "qc-zonage-valleyfield",
        limit: Number(c.req.query("limit") ?? "10"),
      });
      if (!params.ok) {
        applyReaderContentHeaders(c);
        return c.json({ error: "invalid_params" }, 400);
      }
      applyReaderContentHeaders(c);
      if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
      try {
        const body = validateReaderResponse(op, await deps.readOperation(op, params.params, auth), auth.readerSub);
        if (!stillOpen(auth)) return c.json({ error: "unauthenticated" }, 401);
        if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
        return c.json(body);
      }
      catch { return c.json({ error: "capability_unavailable" }, 503); }
    }
    // ── I-1B governed catalogue operations (converged-geo-mesh r3 §2) ──
    // Municipal, non-personal reads for an authorized reader: they MUST NOT
    // trigger the deferred basket consent (triggers stay baskets.*,
    // signals.query.v1 and workspace discovery). Bounded responses with
    // numberMatched/numberReturned/truncated; served catalogue is
    // known-licence qc-zonage only. Typed refusals (GeoItemsRefusal) answer
    // before any upstream call; anything else stays 503. Isolated block for
    // the I2-partage rebase — no line above or below is touched.
    if (op === "geo.cities.v1" || op === "geo.collection-items.v1") {
      const query = c.req.query();
      // J1 zonage §13: the items budget is spent BEFORE param validation, so
      // invalid params and catalogue refusals count against it.
      if (op === "geo.collection-items.v1") {
        const spent = geoBudget.consume(auth.readerSub, auth.artifactId, now());
        if (!spent.ok) {
          applyReaderContentHeaders(c);
          c.header("Retry-After", String(spent.retryAfterSec));
          return c.json({ error: "rate_limited", retryAfterSec: spent.retryAfterSec }, 429);
        }
      }
      // J1 zonage §0.4: unknown or duplicated query key = local refusal.
      const strictQuery = op === "geo.collection-items.v1" ? geoItemsQueryIsStrict(c.req.url) : true;
      const params = !strictQuery ? { ok: false as const } : validateOperationParams(op, op === "geo.cities.v1" ? {} : {
        collectionId: query["collectionId"] ?? "",
        ...(query["limit"] !== undefined ? { limit: Number(query["limit"]) } : {}),
        ...(query["bbox"] !== undefined ? { bbox: query["bbox"] } : {}),
        ...(query["offset"] !== undefined ? { offset: Number(query["offset"]) } : {}),
        ...(query["fields"] !== undefined ? { fields: query["fields"] } : {}),
      });
      if (!params.ok) {
        applyReaderContentHeaders(c);
        return c.json({ error: "invalid_params" }, 400);
      }
      applyReaderContentHeaders(c);
      if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
      try {
        const body = validateReaderResponse(op, await deps.readOperation(op, params.params, auth), auth.readerSub);
        if (!stillOpen(auth)) return c.json({ error: "unauthenticated" }, 401);
        if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
        return c.json(body);
      }
      catch (error) {
        if (error instanceof GeoItemsRefusal) return c.json(error.body, error.status);
        return c.json({ error: "capability_unavailable" }, 503);
      }
    }
    const checked = validateOperationParams(op as ReaderOperationName, { ...Object.fromEntries(Object.entries(c.req.query()).filter(([key]) => key !== "grant")), city: c.req.query("city") ?? "valleyfield" });
    if (!checked.ok) {
      applyReaderContentHeaders(c);
      return c.json({ error: "invalid_params" }, 400);
    }
    applyReaderContentHeaders(c);
    if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
    try {
      const body = validateReaderResponse(op, await deps.readOperation(op, checked.params, auth), auth.readerSub);
      if (!stillOpen(auth)) return c.json({ error: "unauthenticated" }, 401);
      if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
      return c.json(body);
    }
    catch { return c.json({ error: "capability_unavailable" }, 503); }
  });

  // ── I-10B same-origin tile proxy mount (pass-wonder §4) ──
  // The merged I-10A byte relay (`tile-proxy.ts`, #993) on the frozen
  // reserved path GET /__artifacts/tiles/v1/{z}/{x}/{y} (+ labels overlay),
  // next to the design-kit route, before the final app.get("*"). Gates run
  // before any upstream call: non-GET 405, off-content-host 404, no sealed
  // reader session 401 (an <img> carries no grant header; ?grant= in the URL
  // is honored by presentedGrant, then ignored downstream — never relayed).
  // Forged paths (bad z/x/y, outside the Quebec emprise, suffixes,
  // traversal, queries) are refused locally with zero upstream calls.
  // img-src stays 'self': tiles are same-origin bytes, the release CSP is
  // untouched. Attribution is served to the I-4 map base via the guide
  // (mapBase.attribution). The 200 Cache-Control is rewritten to private
  // caching after the global no-store middleware. Isolated block for the
  // I2-partage rebase — no line above or below is touched.
  {
    const tiles = deps.tileProxy ?? new TileProxy();
    const tileApp = createTileProxyApp({
      proxy: tiles,
      isContentHost: (c) => parseContentHost(c.req.header("host"), deps.contentBase).kind !== "other",
      authorize: async (c) => (await authorized(c, true)) !== null,
      // J1.1 OSM relay (B1): per-reader abuse guard on the OSM path only.
      // The key is the sealed session reader; anonymous requests already
      // fail closed on authorize, so a null key only skips the guard.
      osmRateLimit: TILE_OSM_RATE_LIMIT_DEFAULT,
      rateLimitKey: (c) =>
        readSessionClaims(c.req.header("cookie"), deps.sessionSecret, now())?.readerSub ?? null,
    });
    app.use(`${TILE_PATH_PREFIX}/*`, async (c, next) => {
      await next();
      if (c.res.status === 200) {
        c.header("Cache-Control", `private, max-age=${TILE_CLIENT_MAX_AGE_SECONDS}`);
      }
    });
    app.route("/", tileApp);
  }

  // Official design-kit stylesheets on a reserved path of every content
  // origin: same-origin ('self') for published pages, sha256-pinned,
  // outside the publication budget. The bytes are public upstream content
  // (identical for every page, no tenant data; the approval page serves
  // the same bytes unauthenticated), so no reader authorization is
  // required: page <link> tags carry no grant and styles must load with
  // or without reader.js. Unknown versions and traversal stay refused,
  // and non-content hosts stay 404. Author files can never shadow this
  // prefix because "__artifacts" is a reserved first segment of the
  // publish policy.
  app.get("/__artifacts/design/:kit/:digest/:file", async (c) => {
    const asset = resolveDesignKitAsset(c.req.param("kit"), c.req.param("digest"), c.req.param("file"));
    if (!asset) {
      applyReaderContentHeaders(c);
      return c.json({ error: "not_found" }, 404);
    }
    if (parseContentHost(c.req.header("host"), deps.contentBase).kind === "other") {
      applyReaderContentHeaders(c);
      return c.json({ error: "not_found" }, 404);
    }
    applyReaderContentHeaders(c);
    c.header("Content-Type", designKitMimeFor(asset));
    // Pinned public bytes (no tenant data): same immutable regime as the
    // application-origin kit mount, applied after the reader headers and
    // only on success. Unknown digests stay 404 with private, no-store.
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(getDesignKitBytes(asset));
  });

  /**
   * J1.1 SPA history fallback (application mode): on both content hosts, a
   * request for an extension-less path that is not a reserved prefix serves
   * the release index.html when the client navigates (Accept: text/html).
   * Real files — including missing ones, which keep their 404 — and the
   * reserved `/__reader`, `/__artifacts`, `/__app` subtrees never fall back.
   */
  function isSpaFallbackRequest(c: Context): boolean {
    const path = c.req.path;
    if (path === "/" || path === "/index.html") return false;
    const first = path.split("/")[1] ?? "";
    if (first === "__reader" || first === "__artifacts" || first === "__app") return false;
    const last = path.split("/").pop() ?? "";
    if (last === "" || last.includes(".")) return false;
    return (c.req.header("accept") ?? "").includes("text/html");
  }

  const serveRelease = async (c: Context) => {
    const parsed = parseContentHost(c.req.header("host"), deps.contentBase);
    if (parsed.kind === "other") return c.json({ error: "not_found" }, 404);
    if (isServiceWorkerPath(c.req.path) || isEmbedPath(c.req.path)) {
      applyReaderContentHeaders(c);
      return c.json({ error: "not_found" }, 404);
    }
    const auth = await authorized(c, true);
    if (!auth) {
      applyReaderContentHeaders(c);
      // A document reload after the grant expired (or a forged-grant probe)
      // restarts at the styled reader opening instead of returning raw
      // unstyled JSON: the redirect drops the stale grant and approval
      // re-runs before any page bytes are served. Sub-resources and reader
      // APIs stay closed with 401.
      if (deps.openingContent && (c.req.path === "/" || c.req.path === "/index.html")) {
        return c.redirect("/__reader/start", 303);
      }
      return c.json({ error: "unauthenticated" }, 401);
    }
    const normalized = normalizeReleasePath(c.req.path);
    if (normalized) {
      const direct = await deps.releaseFiles?.getFile(auth.artifactId, auth.releaseId, `/${normalized}`) ?? null;
      // SPA history fallback: an extension-less navigation that matches no
      // release file serves the release entry point with its CSP.
      const file = direct ?? (isSpaFallbackRequest(c)
        ? await deps.releaseFiles?.getFile(auth.artifactId, auth.releaseId, "/index.html") ?? null
        : null);
      if (file) {
        if (!stillOpen(auth) || !await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
        // Files parity LOT 1 — binary sub-resources (PNG, PDF, …) are never
        // decoded: the credential-leak scan and the legacy-bridge upgrade
        // run on text files only; binary bytes go out byte-identical.
        const textual = file.contentType.startsWith("text/") || file.contentType === "application/json";
        const text = !textual ? null
          : typeof file.body === "string" ? file.body : Buffer.from(file.body).toString("utf8");
        if (text !== null && servedBodyLeaksCredentials(text)) {
          applyReaderContentHeaders(c);
          return c.json({ error: "not_found" }, 404);
        }
        applyReaderContentHeaders(c);
        if (file.contentType.startsWith("text/html")) {
          if (!presentedGrant(c)) {
            const session = readSessionClaims(c.req.header("cookie"), deps.sessionSecret, now())!;
            const grant = await mintGrant(session.resource!, deps.grantSecret, now());
            const target = new URL(c.req.url);
            target.searchParams.set("grant", grant);
            return c.redirect(`${target.pathname}${target.search}`, 303);
          }
          const html = normalizeReleaseHtml(text!);
          c.header("Content-Security-Policy", releaseCspForHtml(html));
          return c.html(html);
        }
        c.header("Content-Type", file.contentType);
        // Files parity LOT 1 — SVG and PDF are active-content types: even
        // though commit verification rejects scripts, handlers and external
        // references, direct navigation gets a sandboxed document on top of
        // nosniff, so no slipped construct can script (provider headers.ts).
        if (file.contentType === "image/svg+xml" || file.contentType === "application/pdf") {
          c.header("Content-Security-Policy", "sandbox");
        }
        // Lot I2 B2: a page published with the pre-I2 bridge maps the typed
        // consent refusal to `denied` and loops on « Réouvrir » until
        // republication. Upgrade exact legacy bridges at serve time so the
        // first H5 call navigates to /__reader/consent instead; every other
        // file goes out byte-identical.
        let out = typeof file.body === "string" ? Buffer.from(file.body, "utf8") : Buffer.from(file.body);
        if (text !== null && file.contentType.startsWith("text/javascript")) {
          const raw = typeof file.body === "string" ? null : Buffer.from(file.body);
          const upgraded = upgradeLegacyReaderBridge(text);
          if (upgraded !== null && (raw === null || Buffer.from(text, "utf8").equals(raw))) {
            out = Buffer.from(upgraded, "utf8");
          }
        }
        // Files parity LOT 2 §B.4 — single-range 206/416 with HEAD parity:
        // byte ranges serve media (fonts, video) progressively; malformed
        // ranges fall back to the whole file, unsatisfiable ones answer 416
        // with the `bytes * /size` hint. Every file response advertises
        // `accept-ranges: bytes`.
        c.header("Accept-Ranges", "bytes");
        const range = parseContentRange(c.req.header("range") ?? undefined, out.length);
        if (range === "unsatisfiable") {
          c.header("Content-Range", `bytes */${out.length}`);
          return c.json({ error: "range_not_satisfiable" }, 416);
        }
        if (range !== "full" && range !== "ignore") {
          const slice = out.subarray(range.start, range.end + 1);
          c.header("Content-Range", `bytes ${range.start}-${range.end}/${out.length}`);
          c.header("Content-Length", String(slice.length));
          return c.body(new Uint8Array(slice), 206);
        }
        c.header("Content-Length", String(out.length));
        return c.body(new Uint8Array(out));
      }
    }
    if (!deps.releaseFiles && deps.writePageSurface && (c.req.path === "/" || c.req.path === "/index.html")) {
      const response = await deps.writePageSurface.document(c.req.raw, auth);
      if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
      c.header("Content-Security-Policy", response.headers.get("content-security-policy") ?? "default-src 'none'");
      return response;
    }
    if (!deps.releaseFiles && (c.req.path === "/" || c.req.path === "/index.html")) {
      applyReaderContentHeaders(c);
      c.header("Content-Type", "text/html; charset=utf-8");
      // The base RELEASE_CSP no longer carries the example script hash: the
      // technical example gets its own inline-script hash like any release.
      c.header("Content-Security-Policy", releaseCspForHtml(READER_EXAMPLE_HTML));
      return c.html(READER_EXAMPLE_HTML);
    }
    applyReaderContentHeaders(c);
    return c.json({ error: "not_found" }, 404);
  };

  // Files parity LOT 2 — HEAD parity on both content hosts (stable artifact
  // and exact release share this handler): same status and content headers
  // as GET (including 206 content-range and 416), never a body. The GET
  // handler runs unchanged so header computation cannot drift; the wrapper
  // only drops the bytes.
  app.get("*", serveRelease);
  app.on("HEAD", "*", async (c) => {
    const res = await serveRelease(c);
    return new Response(null, { status: res.status, headers: res.headers });
  });

  return app;
}
