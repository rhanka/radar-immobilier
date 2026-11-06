/**
 * Artifact transport (J1.2d/e wagon 7) — the ONE place where the real UI,
 * built in artifact mode (`VITE_ARTIFACT_MODE=1`), talks to the reader host
 * instead of the app API. Components and API clients are unchanged: they
 * keep calling their app paths; this adapter, installed once at boot in
 * front of `fetch`, maps each app path to a NAMED reader op through the
 * existing reader bridge protocol (grant read once from the URL, kept in
 * memory, `x-preview-grant` header, `POST /__reader/renew`, one top-level
 * navigation to `/__reader/consent` on `basket_consent_required`).
 *
 * There is no generic relay (field review J1.2b §14.1: `/__app/` stays a
 * reserved 404). Every app path is either:
 * - mapped to one named op (`app.me.v1`, `workspaces.list.v1`,
 *   `signals.by-city.v1`, `signals.coherent-city.v1`);
 * - the zoning layer (`qc-zonage-<slug>/items`) read through the governed
 *   `geo.collection-items.v1` op (#1010), paged and reshaped by
 *   `zonesCollectionResponseViaReader` for the unchanged `fetchZones`;
 * - a named source gap answered LOCALLY with a typed error and zero network
 *   call (zones §9, lots §8, CPTAQ §10): the views show their
 *   « indisponible » notices, never an empty dataset;
 * - refused locally and typed (`/api/documents/raw?…` — PDFs only travel
 *   through the server-built `documents.pv.v1` URL of the DTO; any other
 *   `/api/*` path).
 * Reader paths (`/__reader/*`, `/__artifacts/*`) and release files pass
 * through untouched (pdf.js loads `documents.pv.v1` on the sealed cookie).
 *
 * The normal app build never contains this module: `main.ts` imports it
 * behind a build-time constant that Vite folds away.
 */

import { zonesCollectionResponseViaReader, type ReaderOpResult } from "$lib/maps/zones-reader-transport";

export type ArtifactOperation =
  | "geo.collection-items.v1"
  | "app.me.v1"
  | "workspaces.list.v1"
  | "signals.by-city.v1"
  | "signals.coherent-city.v1";

/** Named gaps of the field review (§8–§10): refused locally, never relayed. */
export type ArtifactSourceGap = "zones" | "lots" | "cptaq";

export type ArtifactRoute =
  | { kind: "op"; op: ArtifactOperation; params: URLSearchParams }
  /** Zoning items: app path (base stripped) for `zonesCollectionResponseViaReader`. */
  | { kind: "zoning"; path: string }
  | { kind: "gap"; gap: ArtifactSourceGap }
  | { kind: "refused"; status: 400 | 404 | 405; code: string }
  | { kind: "passthrough" };

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SCOPED = new RegExp(`^/api/v1/workspaces/(${UUID})/signal-facets/(by-city|coherent-city)$`);
const ZONAGE = /^\/api\/geo\/collections\/qc-zonage-[^/]+\/items$/;
const LOTS = /^\/api\/geo\/collections\/qc-lots-[^/]+\/items$/;
const ZONES = /^\/api\/geo\/[^/]+\/zones$/;
const CPTAQ = /\/collections\/ca-qc-constraints-[^/]+\/items$/;

/** Strip an optional build-time API base path (e.g. `/__app`) from a same-origin path. */
function stripBase(pathname: string, apiBase: string): string {
  const base = apiBase.replace(/\/$/, "");
  if (base.startsWith("/") && base !== "" && (pathname === base || pathname.startsWith(`${base}/`))) {
    return pathname.slice(base.length) || "/";
  }
  return pathname;
}

/**
 * Pure routing decision for one request. `origin` is the page origin;
 * `apiBase` the build-time `VITE_API_BASE_URL` (path or absolute URL).
 */
export function routeArtifactRequest(rawUrl: string, method: string, origin: string, apiBase = ""): ArtifactRoute {
  let url: URL;
  try {
    url = new URL(rawUrl, origin);
  } catch {
    return { kind: "passthrough" };
  }
  // CPTAQ is read DIRECTLY from the geo OGC base (possibly cross-origin):
  // a named gap on any origin, refused before any network call.
  if (CPTAQ.test(url.pathname)) return { kind: "gap", gap: "cptaq" };
  let pathname = url.pathname;
  if (url.origin !== origin) {
    let absoluteBase: URL | null = null;
    try { absoluteBase = /^https?:\/\//.test(apiBase) ? new URL(apiBase) : null; } catch { absoluteBase = null; }
    if (absoluteBase === null || absoluteBase.origin !== url.origin) return { kind: "passthrough" };
    pathname = stripBase(pathname, absoluteBase.pathname);
  } else {
    pathname = stripBase(pathname, apiBase);
  }
  if (!(pathname === "/api" || pathname.startsWith("/api/"))) return { kind: "passthrough" };
  // Defence in depth: a storage key must never reach the reader host.
  if (pathname === "/api/documents/raw") return { kind: "refused", status: 400, code: "raw_document_refused" };
  if (ZONAGE.test(pathname)) {
    return method.toUpperCase() === "GET" ? { kind: "zoning", path: `${pathname}${url.search}` }
      : { kind: "refused", status: 405, code: "method_not_allowed" };
  }
  if (LOTS.test(pathname)) return { kind: "gap", gap: "lots" };
  if (ZONES.test(pathname)) return { kind: "gap", gap: "zones" };
  const isGet = method.toUpperCase() === "GET";
  const params = new URLSearchParams(url.search);
  if (pathname === "/api/v1/auth/me") {
    return isGet ? { kind: "op", op: "app.me.v1", params } : { kind: "refused", status: 405, code: "method_not_allowed" };
  }
  if (pathname === "/api/v1/workspaces") {
    return isGet ? { kind: "op", op: "workspaces.list.v1", params } : { kind: "refused", status: 405, code: "method_not_allowed" };
  }
  const scoped = SCOPED.exec(pathname);
  if (scoped) {
    if (!isGet) return { kind: "refused", status: 405, code: "method_not_allowed" };
    // The page-supplied workspace becomes an explicit op param; any
    // `workspaceId` already in the query is a duplicate the op refuses.
    params.append("workspaceId", scoped[1]!.toLowerCase());
    return { kind: "op", op: scoped[2] === "by-city" ? "signals.by-city.v1" : "signals.coherent-city.v1", params };
  }
  return { kind: "refused", status: 404, code: "artifact_route_not_served" };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** Typed local answer of a named gap: no network, never an empty dataset. */
export function sourceGapResponse(gap: ArtifactSourceGap): Response {
  return jsonResponse(503, { ok: false, error: "artifact_source_gap", gap }, { "X-Artifact-Source-Gap": gap });
}

function failureCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return null;
}

export interface ArtifactTransportDeps {
  /** The real network fetch (captured before installation). */
  fetch: typeof fetch;
  /** Page location: grant read once, consent/reopen navigations. */
  location: Pick<Location, "href" | "origin" | "assign">;
  /** Drops the `grant` parameter from the visible URL (never kept in history). */
  replaceUrl: (url: string) => void;
  /** Build-time API base (`VITE_API_BASE_URL`), stripped before routing. */
  apiBase?: string;
  now?: () => number;
}

const REFRESH_BEFORE_MS = 30_000;
const GRANT_MAX_LENGTH = 4096;

/**
 * Fetch-compatible adapter. Mapped app paths become named reader ops; the
 * rest follows `routeArtifactRequest`. The reader op response is returned
 * as is (its body already has the app wire shape the clients parse).
 */
export function createArtifactTransport(deps: ArtifactTransportDeps): typeof fetch {
  const now = deps.now ?? (() => Date.now());
  const page = new URL(deps.location.href);
  let grant = page.searchParams.get("grant") ?? "";
  if (grant.length > GRANT_MAX_LENGTH) grant = "";
  let grantAt = grant ? now() : 0;
  if (page.searchParams.has("grant")) {
    page.searchParams.delete("grant");
    const rest = page.searchParams.toString();
    deps.replaceUrl(`${page.pathname}${rest ? `?${rest}` : ""}${page.hash}`);
  }
  let renewing: Promise<boolean> | null = null;
  let consentRedirected = false;
  let reopenRedirected = false;

  async function renewOnce(withGrant: boolean): Promise<string> {
    const headers: Record<string, string> = withGrant && grant ? { "x-preview-grant": grant } : {};
    const response = await deps.fetch("/__reader/renew", {
      method: "POST", headers, cache: "no-store", credentials: "same-origin",
    });
    const body = await response.json().catch(() => null) as { grant?: unknown } | null;
    if (!response.ok || typeof body?.grant !== "string" || body.grant === "" || body.grant.length > GRANT_MAX_LENGTH) {
      return "";
    }
    return body.grant;
  }

  /** Renew through the bridge: presented grant first, then sealed-session recovery. */
  function renew(): Promise<boolean> {
    if (!renewing) {
      renewing = (async () => {
        let next = await renewOnce(true).catch(() => "");
        if (!next && grant) next = await renewOnce(false).catch(() => "");
        if (next) { grant = next; grantAt = now(); }
        return next !== "";
      })().finally(() => { renewing = null; });
    }
    return renewing;
  }

  async function callOperation(op: ArtifactOperation, params: URLSearchParams, init: { signal?: AbortSignal | null } | undefined): Promise<Response> {
    if (!grant || now() - grantAt >= REFRESH_BEFORE_MS) await renew();
    const send = () => {
      const search = params.toString();
      return deps.fetch(`/__reader/api/${op}${search ? `?${search}` : ""}`, {
        method: "GET", cache: "no-store", credentials: "same-origin",
        headers: grant ? { "x-preview-grant": grant } : {},
        ...(init?.signal ? { signal: init.signal } : {}),
      });
    };
    let response = await send();
    if (response.status === 401 && await renew()) response = await send();
    if (response.status === 401 && op === "app.me.v1" && !reopenRedirected) {
      // Session lost: re-run the reader exchange, never the app login.
      reopenRedirected = true;
      deps.location.assign("/__reader/start");
    }
    if (response.status === 403 && !consentRedirected) {
      const code = failureCode(await response.clone().json().catch(() => null));
      if (code === "basket_consent_required") {
        consentRedirected = true;
        deps.location.assign("/__reader/consent");
      }
    }
    return response;
  }

  return async function artifactFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    const route = routeArtifactRequest(url, method, deps.location.origin, deps.apiBase ?? "");
    if (route.kind === "passthrough") return deps.fetch(input, init);
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    if (route.kind === "gap") return sourceGapResponse(route.gap);
    if (route.kind === "refused") return jsonResponse(route.status, { ok: false, error: route.code });
    if (route.kind === "zoning") {
      // Pages of the governed zoning op through the same bridge call; a
      // request the zoning mapping does not cover (bbox, norms) fails typed.
      const invoke = async (op: "geo.collection-items.v1", params: Readonly<Record<string, string>>,
        opInit?: { signal?: AbortSignal }): Promise<ReaderOpResult> => {
        const response = await callOperation(op, new URLSearchParams(params), opInit);
        const retryAfter = Number(response.headers.get("retry-after"));
        return { status: response.status, body: await response.json().catch(() => null),
          ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSec: retryAfter } : {}) };
      };
      const mapped = await zonesCollectionResponseViaReader(route.path, invoke,
        init?.signal ? { signal: init.signal } : {});
      return mapped ?? jsonResponse(400, { ok: false, error: "zones_request_not_mapped" });
    }
    return callOperation(route.op, route.params, init);
  };
}

/** Install the adapter in front of the page `fetch` (artifact build only). */
export function installArtifactTransport(target: typeof globalThis = globalThis): void {
  const network = target.fetch.bind(target);
  target.fetch = createArtifactTransport({
    fetch: network,
    location: target.location,
    replaceUrl: (url) => target.history.replaceState(target.history.state, "", url),
    apiBase: import.meta.env.VITE_API_BASE_URL ?? "",
  });
}
