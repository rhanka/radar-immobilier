/**
 * Content-origin Host classifier: single-level UUID resolution (owner decision
 * 2026-11-02). The content base is `pages.<app>` (preprod:
 * `pages.preprod.immo.sent-tech.ca`); both the stable page
 * (`<artifactId>.<base>/`) and the exact version (`<releaseId>.<base>/`) share
 * that one wildcard. Artifact ids and release ids are both UUIDs: the label is
 * resolved server-side as either an artifact (stable, serves the current
 * release) or a release (exact version). An unknown UUID answers 404 without
 * leaking which kind exists; a label that matches both fails closed as 404.
 *
 * Only a single UUID label is ever a content host. The apex, non-UUID labels,
 * extra labels (including the retired `.pinned.` form) and foreign bases all
 * parse as { kind: "other" }. Application hosts (`preprod.immo.sent-tech.ca`,
 * auth, mcp) can therefore never parse as content hosts.
 *
 * Reads the Host header ALONE: X-Forwarded-Host and any other forwarding
 * metadata are never consulted, so a forged forwarded host can divert a
 * request neither onto nor off a content origin.
 *
 * This module is the immo-side projection. Upstream `@sentropic/artifacts@0.2.8`
 * implements the same single-level scheme (`parseContentHost` returns
 * `{ kind: 'id', id }` for exactly one UUID label; the exact release is
 * exposed as `versionUrl`). Immo never imports that subpath here: its own
 * parser (`{ kind: 'content' }`) and its `pinnedUrl` contract stay the
 * converged single-label behavior without tracking upstream renames.
 *
 * Legacy transition (remove per docs/runbooks/ARTIFACTS_PREPROD_ACTIVATION.md
 * section "Legacy redirect removal"): hosts under
 * `preprod.immo-pages.sent-tech.ca` and
 * `pinned.preprod.immo-pages.sent-tech.ca` answer 301 to the same
 * artifact/release on the new base, path and query preserved. The redirect
 * helper never logs the URL (grants must not leak into logs); operators must
 * keep grant query params out of access logs as well.
 */

export type ParsedContentHost =
  | { readonly kind: "other" }
  | { readonly kind: "content"; readonly id: string };

export type ParsedLegacyHost =
  | { readonly kind: "legacy-stable"; readonly artifactId: string }
  | { readonly kind: "legacy-pinned"; readonly releaseId: string };

const MAX_HOST_LENGTH = 253;

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Retired content bases, kept for the 301 transition only. */
export const LEGACY_CONTENT_BASE = "preprod.immo-pages.sent-tech.ca";
export const LEGACY_PINNED_BASE = "pinned.preprod.immo-pages.sent-tech.ca";

function normalizeBase(base: string): string {
  let value = base.trim().toLowerCase();
  if (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

function stripNumericPort(host: string): string {
  const colon = host.lastIndexOf(":");
  if (colon === -1) return host;
  const port = host.slice(colon + 1);
  if (port === "") return host;
  for (const ch of port) {
    if (ch < "0" || ch > "9") return host;
  }
  return host.slice(0, colon);
}

function normalizeHost(host: string): string {
  let name = host.trim().toLowerCase();
  name = stripNumericPort(name);
  if (name.endsWith(".")) name = name.slice(0, -1);
  return name;
}

/** Reserve the entire content domain, including labels without a valid UUID. */
export function belongsToContentDomain(host: string | undefined, contentBase: string): boolean {
  const base = normalizeBase(contentBase);
  if (!host || !base || base.length > MAX_HOST_LENGTH) return false;
  // Reserve malformed authorities without admitting them as artifact hosts.
  const name = host.trim().toLowerCase().replace(/:.*$/, "").replace(/\.+$/, "");
  return name === base || name.endsWith(`.${base}`);
}

/** True when the Host header belongs to the retired immo-pages domain. */
export function belongsToLegacyContentDomain(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.trim().toLowerCase().replace(/:.*$/, "").replace(/\.+$/, "");
  if (name.length > MAX_HOST_LENGTH) return false;
  return name === LEGACY_CONTENT_BASE || name.endsWith(`.${LEGACY_CONTENT_BASE}`) ||
    name === LEGACY_PINNED_BASE || name.endsWith(`.${LEGACY_PINNED_BASE}`);
}

export function parseContentHost(
  host: string | null | undefined,
  contentBase: string | null | undefined,
): ParsedContentHost {
  if (!host || !contentBase) return { kind: "other" };
  const base = normalizeBase(contentBase);
  if (base === "" || base.length > MAX_HOST_LENGTH) return { kind: "other" };
  const name = normalizeHost(host);
  if (name === "" || name.length > MAX_HOST_LENGTH) return { kind: "other" };
  if (name === base) return { kind: "other" };
  if (!name.endsWith(`.${base}`)) return { kind: "other" };
  const label = name.slice(0, -(base.length + 1));
  if (label === "" || label.includes(".")) return { kind: "other" };
  if (!UUID_RE.test(label)) return { kind: "other" };
  return { kind: "content", id: label };
}

/**
 * Parse a retired immo-pages host. Returns null for anything that is not
 * exactly one UUID label on either legacy base (including the retired
 * `<release>.pinned.<legacy>` form). Used only for the 301 transition.
 */
export function parseLegacyContentHost(host: string | null | undefined): ParsedLegacyHost | null {
  if (!host) return null;
  const name = normalizeHost(host);
  if (name === "" || name.length > MAX_HOST_LENGTH) return null;
  for (const [base, kind] of [
    [LEGACY_PINNED_BASE, "legacy-pinned"],
    [LEGACY_CONTENT_BASE, "legacy-stable"],
  ] as const) {
    if (name === base || !name.endsWith(`.${base}`)) continue;
    const label = name.slice(0, -(base.length + 1));
    if (label === "" || label.includes(".") || !UUID_RE.test(label)) return null;
    return kind === "legacy-pinned"
      ? { kind, releaseId: label }
      : { kind, artifactId: label };
  }
  return null;
}

/**
 * Build the 301 target for a legacy host: the same UUID label on the new base,
 * path and query preserved. Returns null when the host is not a legacy content
 * host. The caller must not log the returned URL (it may carry `?grant=`).
 */
export function legacyContentRedirectTarget(
  host: string | null | undefined,
  contentBase: string,
  pathAndQuery: string,
): string | null {
  const parsed = parseLegacyContentHost(host);
  if (!parsed) return null;
  const base = normalizeBase(contentBase);
  if (base === "" || base.length > MAX_HOST_LENGTH) return null;
  const id = parsed.kind === "legacy-pinned" ? parsed.releaseId : parsed.artifactId;
  const suffix = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `https://${id}.${base}${suffix}`;
}
