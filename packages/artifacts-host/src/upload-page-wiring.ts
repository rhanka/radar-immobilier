import type { UploadPageRouteConfig } from "./composition.js";

/**
 * Minimum dedicated page-cookie secret length (characters). The page cookie
 * secret is dedicated (never the session secret): it signs the
 * single-exchange `__Host-` page cookie only.
 */
export const UPLOAD_PAGE_SECRET_MIN_LENGTH = 32;

export interface UploadPageWiringInput {
  /** `ARTIFACTS_UPLOAD_PAGE_SECRET` value (absent or short keeps the page closed). */
  readonly secret?: string | undefined;
  /** Application origin the page is served from (API `appBaseUrl`, MCP `RADAR_PUBLIC_BASE_URL`). */
  readonly controlOrigin: string;
  /** Resolved storage endpoint (https origins only are advertised to the page). */
  readonly s3Endpoint: string;
}

/**
 * Shared browser-upload-page wiring for BOTH processes (API control plane
 * and immo-mcp binding). The wiring covers the shared secret (≥32 chars),
 * the application origin, the derived `pageBaseUrl` and the https S3
 * origins. Returns null when the wiring is absent or invalid so both
 * processes close the page capability identically instead of diverging.
 * Empty S3 origins (plain-http storage) keep the HTML route closed; the
 * mint, exchange and file endpoints keep working.
 */
export function readUploadPageWiring(input: UploadPageWiringInput): UploadPageRouteConfig | null {
  const secret = (input.secret ?? "").trim();
  if (secret.length < UPLOAD_PAGE_SECRET_MIN_LENGTH) return null;
  let control: URL;
  try {
    control = new URL(input.controlOrigin);
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(control.protocol) || control.username !== "" ||
    control.password !== "" || control.search !== "" || control.hash !== "" ||
    control.pathname !== "/") return null;
  const controlOrigin = control.origin;
  let s3Origins: readonly string[] = [];
  try {
    const endpoint = new URL(input.s3Endpoint);
    if (endpoint.protocol === "https:" && endpoint.username === "" && endpoint.password === "" &&
      endpoint.search === "" && endpoint.hash === "") s3Origins = [endpoint.origin];
  } catch {
    s3Origins = [];
  }
  return { cookieSecret: secret, controlOrigin, pageBaseUrl: `${controlOrigin}/api/v1`, s3Origins };
}
