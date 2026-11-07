/**
 * Published release files seam (ARTEFACTS L3, relecture 1).
 *
 * Serves the real HTML/CSS/JS set of the exact release — never the static
 * example — under the same isolation headers. Native resources, including
 * transitive imports, use a sealed session on the bound host (stable
 * artifact serving the current release, or exact release serving its own).
 * HTML attributes and inline source are never rewritten. JavaScript calls H5 with fetch and
 * the x-preview-grant header (same pattern as the technical example):
 * - const grant = new URLSearchParams(location.search).get("grant")
 * - fetch("/__reader/api/baskets.search.v1?...", { headers: { "x-preview-grant": grant } })
 *
 * reader-storage binds this port to committed PostgreSQL manifests and
 * digest-verified S3 blobs. The in-memory provider below is for module tests.
 */
import { createHash } from "node:crypto";
import { HOST_MIME_TYPES } from "@radar/artifacts-host";
import { contentHeaders, type ContentMode } from "@sentropic/artifacts/content/headers";
import { mimeTypeForPath } from "@sentropic/artifacts/server/mime";
import { parse, type DefaultTreeAdapterMap } from "parse5";

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

/**
 * Provider application content mode (@sentropic/artifacts 0.2.17, owner
 * decision 05/11: every immo artifact runs in application mode, no profile
 * opt-in). The base header on every content path is the provider's
 * APPLICATION_HTML_CSP (the J1.0 policy); per-release inline script hashes
 * are added by releaseCspForHtml when an HTML file carries inline script.
 */
export const RELEASE_CONTENT_MODE: ContentMode = "application";

/**
 * Authorize only the inline script bytes of this immutable release: script-src
 * never carries unsafe-inline. Inline <style> is NOT hashed: style-src already
 * carries 'unsafe-inline' (Svelte style attributes, pdf.js runtime <style>),
 * and any style hash would make CSP2/3 browsers ignore that 'unsafe-inline'.
 * The provider appends the hashes to script-src only.
 */
export function releaseCspForHtml(html: string): string {
  const scriptHashes: string[] = [];
  const visit = (node: DefaultTreeAdapterMap["node"]): void => {
    if ("tagName" in node && node.tagName === "script") {
      const text = node.childNodes.map((child) => "value" in child ? child.value : "").join("");
      scriptHashes.push(`'sha256-${createHash("sha256").update(text).digest("base64")}'`);
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
    if ("content" in node) visit(node.content);
  };
  const normalized = normalizeReleaseHtml(html);
  visit(parse(normalized));
  return contentHeaders({ mimeType: "text/html", size: Buffer.byteLength(normalized),
    mode: RELEASE_CONTENT_MODE, scriptHashes })["content-security-policy"]!;
}

/**
 * Release content types come from the provider extension map
 * (`mimeTypeForPath` / `EXTENSION_TO_MIME`, exported from
 * `@sentropic/artifacts/server/mime` since 0.2.18). It covers every asset
 * type the real UI ships (.geojson, .mjs pdf.js worker, .woff2 fonts, .pbf
 * tiles, .wasm, images, PDF, MP4). As in reader-storage, text types carry
 * `charset=utf-8` and binary types are served bare; an unmapped extension
 * falls back to `application/octet-stream`.
 *
 * This resolves a type for any path; it does not decide what is served.
 * Production (reader-storage) only serves a committed file whose manifest
 * type is in `HOST_MIME_TYPES` (@radar/artifacts-host) and 404s the rest;
 * createMemoryReleaseFiles applies the same gate.
 */
export function contentTypeForPath(path: string): string {
  const mimeType = mimeTypeForPath(path);
  if (mimeType === undefined) return "application/octet-stream";
  return mimeType.startsWith("text/") ? `${mimeType}; charset=utf-8` : mimeType;
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

/**
 * Same gate as reader-storage: a path whose resolved type is outside
 * `HOST_MIME_TYPES` (e.g. .wasm, .pbf, .avif, .ico, .woff, .ttf, .otf, .webm,
 * or an unmapped extension) is never served by the in-memory provider, so a
 * module test cannot pass on a type production refuses.
 */
function isHostServedPath(path: string): boolean {
  const mimeType = mimeTypeForPath(path);
  return mimeType !== undefined && HOST_MIME_TYPES.includes(mimeType);
}

export function createMemoryReleaseFiles(
  entries: ReadonlyArray<{ artifactId: string; releaseId: string; path: string; body: string | Uint8Array }>,
): ReleaseFileProvider {
  const files = new Map<string, ReleaseFile>();
  for (const entry of entries) {
    const normalized = normalizeReleasePath(entry.path.startsWith("/") ? entry.path : `/${entry.path}`);
    if (!normalized || !isHostServedPath(normalized)) continue;
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
