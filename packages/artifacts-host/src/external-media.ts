/**
 * External heavy media (AQX): media above the page budgets stays outside the
 * release. Two paths only, every other CSP directive unchanged:
 * - YouTube embeds through the privacy-enhanced origin (frame-src);
 * - objects of the Sentropic buckets, by exact HTTPS origin configured in
 *   ARTIFACTS_EXTERNAL_MEDIA_ORIGINS (media-src and img-src). No origin is
 *   configured by default: until an operator sets one, no bucket is allowed.
 * The 10 GB object ceiling is a documented policy of the bucket path; the
 * release never stores or proxies those bytes.
 */
export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
export const EXTERNAL_MEDIA_MAX_OBJECT_BYTES = 10_000_000_000;
export const EXTERNAL_MEDIA_ORIGINS_ENV = "ARTIFACTS_EXTERNAL_MEDIA_ORIGINS";
const MAX_ORIGINS = 8;

export interface ExternalMediaPolicy {
  readonly frameOrigins: readonly string[];
  readonly mediaOrigins: readonly string[];
}

/** Exact `https://host[:port]` only: no wildcard, path, query, fragment or credentials. */
export function parseExternalMediaOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`invalid ${EXTERNAL_MEDIA_ORIGINS_ENV} origin`); }
  if (url.protocol !== "https:" || url.origin !== value || url.hostname.includes("*") ||
    url.username || url.password) {
    throw new Error(`invalid ${EXTERNAL_MEDIA_ORIGINS_ENV} origin`);
  }
  return url.origin;
}

export function readExternalMediaPolicy(env: NodeJS.ProcessEnv = process.env): ExternalMediaPolicy {
  const raw = (env[EXTERNAL_MEDIA_ORIGINS_ENV] ?? "").trim();
  const origins = raw === "" ? [] : [...new Set(raw.split(",").map((entry) => parseExternalMediaOrigin(entry.trim())))];
  if (origins.length > MAX_ORIGINS) throw new Error(`too many ${EXTERNAL_MEDIA_ORIGINS_ENV} origins`);
  return Object.freeze({ frameOrigins: Object.freeze([YOUTUBE_EMBED_ORIGIN]), mediaOrigins: Object.freeze(origins) });
}

function extendDirective(directives: string[], name: string, sources: readonly string[]): string[] {
  if (sources.length === 0) return directives;
  const index = directives.findIndex((entry) => entry === name || entry.startsWith(`${name} `));
  if (index === -1) return [...directives, `${name} ${sources.join(" ")}`];
  const values = directives[index]!.slice(name.length).trim().split(/\s+/).filter((v) => v !== "" && v !== "'none'");
  const next = [...directives];
  next[index] = `${name} ${[...values, ...sources.filter((s) => !values.includes(s))].join(" ")}`;
  return next;
}

/** Adds only the external sources to frame-src, media-src and img-src of a release HTML policy. */
export function withExternalMediaSources(csp: string, policy: ExternalMediaPolicy): string {
  let directives = csp.split(";").map((entry) => entry.trim()).filter((entry) => entry !== "");
  directives = extendDirective(directives, "frame-src", policy.frameOrigins);
  directives = extendDirective(directives, "media-src", policy.mediaOrigins);
  directives = extendDirective(directives, "img-src", policy.mediaOrigins);
  return directives.join("; ");
}
