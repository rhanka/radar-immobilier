/**
 * Artifact transport — the ONE place where the real UI, built in artifact
 * mode (`VITE_ARTIFACT_MODE=1`), talks to the reader host instead of the
 * app API. Components and API clients are unchanged: they keep calling
 * their app paths; this adapter, installed once at boot in front of
 * `fetch`, relays EVERY `/api/*` call (all methods, body and headers
 * preserved) to the generic reader relay `/__reader/app/api/*` on the
 * same content host (owner decision: RW, no per-operation filtering,
 * no local gaps or refusals). The relay authenticates the reader
 * (grant read once from the URL, kept in memory, `x-preview-grant`
 * header, `POST /__reader/renew`, one top-level navigation to
 * `/__reader/consent` on `basket_consent_required`) and dispatches to
 * the application with the reader's own identity; the application's
 * authorisations are the only limit and its responses — refusals
 * included — return unchanged.
 *
 * Reader paths (`/__reader/*`, `/__artifacts/*`), release files and
 * non-`/api/*` URLs pass through untouched (pdf.js loads
 * `documents.pv.v1` on the sealed cookie).
 *
 * The normal app build never contains this module: `main.ts` imports it
 * behind a build-time constant that Vite folds away.
 */

export type ArtifactRoute =
  /** App path (base stripped, query preserved) for the generic relay. */
  | { kind: "relay"; path: string }
  | { kind: "passthrough" };

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
 * Every `/api/*` call relays, whatever its method; anything else —
 * including absolute URLs outside the API base — passes through.
 */
export function routeArtifactRequest(rawUrl: string, origin: string, apiBase = ""): ArtifactRoute {
  let url: URL;
  try {
    url = new URL(rawUrl, origin);
  } catch {
    return { kind: "passthrough" };
  }
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
  return { kind: "relay", path: `${pathname}${url.search}` };
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
 * Fetch-compatible adapter. Every app path relays through
 * `/__reader/app` with its method, headers and body preserved; the
 * application response is returned as is.
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

  return async function artifactFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routeArtifactRequest(url, deps.location.origin, deps.apiBase ?? "");
    if (route.kind === "passthrough") return deps.fetch(input, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    if (!grant || now() - grantAt >= REFRESH_BEFORE_MS) await renew();
    const send = async (): Promise<Response> => {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      if (grant) headers.set("x-preview-grant", grant);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      let body: BodyInit | undefined = init?.body ?? undefined;
      if (body === undefined && input instanceof Request && method !== "GET" && method !== "HEAD") {
        body = await input.clone().arrayBuffer();
      }
      return deps.fetch(`/__reader/app${route.path}`, {
        method, headers, cache: "no-store", credentials: "same-origin",
        ...(body !== undefined ? { body } : {}),
        ...(signal ? { signal } : {}),
      });
    };
    let response = await send();
    if (response.status === 401 && await renew()) response = await send();
    if (response.status === 401 && route.path.startsWith("/api/v1/auth/me") && !reopenRedirected) {
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
