/**
 * Content-origin Host classifier (861c lot H1). Reads the Host header ALONE:
 * X-Forwarded-Host and any other forwarding metadata are never consulted, so
 * a forged forwarded host can divert a request neither onto nor off a content
 * origin. The address scheme is owned by @sentropic/artifacts: this module
 * only extracts the Host value (absent/empty, numeric port, single DNS root
 * dot, 253-character bound) and maps an unknown origin to { kind: "other" }.
 * Import the pinned "./content/routing" subpath only — never the package root:
 * its index re-exports mcp.js, which needs the optional @sentropic/mcp-platform
 * peer that is absent here and fails at startup.
 */
import { parseContentHost as parseLibContentHost } from "@sentropic/artifacts/content/routing";

export type ParsedContentHost =
  | { readonly kind: "other" }
  | { readonly kind: "stable"; readonly artifactId: string }
  | { readonly kind: "pinned"; readonly releaseId: string };

const MAX_HOST_LENGTH = 253;

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

/** Reserve the entire content domain, including labels without a valid UUID. */
export function belongsToContentDomain(host: string | undefined, contentBase: string): boolean {
  const base = contentBase.trim().toLowerCase().replace(/\.$/, "");
  if (!host || !base || base.length > MAX_HOST_LENGTH) return false;
  const name = stripNumericPort(host.trim().toLowerCase()).replace(/\.$/, "");
  return name === base || name.endsWith(`.${base}`);
}

export function parseContentHost(
  host: string | null | undefined,
  contentBase: string | null | undefined,
): ParsedContentHost {
  if (!host || !contentBase) return { kind: "other" };
  let base = contentBase.trim().toLowerCase();
  if (base.endsWith(".")) base = base.slice(0, -1);
  if (base === "" || base.length > MAX_HOST_LENGTH) return { kind: "other" };
  let name = host.trim().toLowerCase();
  if (name === "") return { kind: "other" };
  name = stripNumericPort(name);
  if (name.endsWith(".")) name = name.slice(0, -1);
  if (name === "" || name.length > MAX_HOST_LENGTH) return { kind: "other" };
  const parsed = parseLibContentHost(name, base);
  if (!parsed) return { kind: "other" };
  return parsed;
}
