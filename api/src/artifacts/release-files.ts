/**
 * Published release files seam (ARTEFACTS L3, relecture 1).
 *
 * Serves the real HTML/CSS/JS set of the pinned release — never the static
 * example — under the same isolation headers. Native resources, including
 * transitive imports, use a sealed session on the pinned release host.
 * HTML attributes and inline source are never rewritten. JavaScript calls H5 with fetch and
 * the x-preview-grant header (same pattern as the technical example):
 * - const grant = new URLSearchParams(location.search).get("grant")
 * - fetch("/__reader/api/baskets.search.v1?...", { headers: { "x-preview-grant": grant } })
 *
 * reader-storage binds this port to committed PostgreSQL manifests and
 * digest-verified S3 blobs. The in-memory provider below is for module tests.
 */
import { READER_EXAMPLE_SCRIPT_HASH } from "./reader-example.js";
import { createHash } from "node:crypto";

export interface ReleaseFile {
  readonly body: string | Uint8Array;
  readonly contentType: string;
}

export interface ReleaseFileProvider {
  readonly getFile: (
    artifactId: string,
    releaseId: string,
    path: string,
  ) => Promise<ReleaseFile | null>;
}

export const RELEASE_CSP =
  `default-src 'self'; script-src 'self' 'sha256-${READER_EXAMPLE_SCRIPT_HASH}'; ` +
  `style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'none'; ` +
  `frame-ancestors 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;

/** Authorize only the inline bytes of this immutable release, never unsafe-inline. */
export function releaseCspForHtml(html: string): string {
  const hashes = (tag: string) => [...normalizeReleaseHtml(html).matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))]
    .map((match) => `'sha256-${createHash("sha256").update(match[1]!).digest("base64")}'`).join(" ");
  return RELEASE_CSP.replace("script-src 'self'", `script-src 'self' ${hashes("script")}`)
    .replace("style-src 'self'", `style-src 'self' ${hashes("style")}`);
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function contentTypeForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export function normalizeReleasePath(rawPath: string): string | null {
  let path = rawPath.split("?")[0] ?? "";
  if (!path.startsWith("/")) return null;
  path = path === "/" ? "/index.html" : path;
  if (path.includes("\0") || path.includes("\\")) return null;
  const parts = path.split("/");
  const clean: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    clean.push(part);
  }
  const normalized = clean.join("/");
  if (normalized === "" || normalized.length > 256) return null;
  return normalized;
}

export function createMemoryReleaseFiles(
  entries: ReadonlyArray<{ artifactId: string; releaseId: string; path: string; body: string | Uint8Array }>,
): ReleaseFileProvider {
  const files = new Map<string, ReleaseFile>();
  for (const entry of entries) {
    const normalized = normalizeReleasePath(entry.path.startsWith("/") ? entry.path : `/${entry.path}`);
    if (!normalized) continue;
    files.set(`${entry.artifactId}/${entry.releaseId}/${normalized}`, {
      body: entry.body,
      contentType: contentTypeForPath(normalized),
    });
  }
  return {
    getFile: async (artifactId, releaseId, path) => {
      const normalized = normalizeReleasePath(path.startsWith("/") ? path : `/${path}`);
      if (!normalized) return null;
      return files.get(`${artifactId}/${releaseId}/${normalized}`) ?? null;
    },
  };
}

/** Match HTML input preprocessing before hashing and emitting inline text. */
export function normalizeReleaseHtml(html: string): string {
  return html.replace(/\r\n?/g, "\n");
}
