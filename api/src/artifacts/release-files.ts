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
import { contentHeaders, type ContentMode } from "@sentropic/artifacts/content/headers";
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

// The provider extension map (EXTENSION_TO_MIME, 0.2.17) lives in
// `server/mime`, which the package does not export: this map mirrors it.
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  // J1.1 — the real UI ships these: .geojson (municipal outlines),
  // .mjs (pdf.js module worker), .woff2 (bundled fonts), .pbf (vector
  // tiles, proxy octets only) and .wasm (reserved, none shipped today).
  ".geojson": "application/json",
  ".pbf": "application/x-protobuf",
  ".wasm": "application/wasm",
  // Files parity LOT 1 — binary release assets, served byte-identical under
  // nosniff; SVG/PDF additionally get a sandboxed document CSP at serve time.
  // Files parity LOT 2 — variable fonts and funnel videos ride the same
  // channel (magic-byte verified at commit, declared type served).
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
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
