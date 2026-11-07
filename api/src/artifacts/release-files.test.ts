import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  contentTypeForPath,
  createMemoryReleaseFiles,
  normalizeReleaseHtml,
  normalizeReleasePath,
  releaseCspForHtml,
  RELEASE_CONTENT_MODE,
} from "./release-files.js";
import { APPLICATION_HTML_CSP, contentHeaders } from "@sentropic/artifacts/content/headers";
import { READER_CONTENT_HEADERS } from "./content-isolation.js";

describe("published release files", () => {
  it("should normalize paths and block traversal", () => {
    expect(normalizeReleasePath("/")).toBe("index.html");
    expect(normalizeReleasePath("/app.js")).toBe("app.js");
    expect(normalizeReleasePath("/../secret")).toBeNull();
    expect(normalizeReleasePath("/a/../../b")).toBeNull();
  });

  it("should map content types for the published set", () => {
    expect(contentTypeForPath("index.html")).toContain("text/html");
    expect(contentTypeForPath("app.js")).toContain("text/javascript");
    expect(contentTypeForPath("styles.css")).toContain("text/css");
  });

  it("should serve files of the pinned release only", async () => {
    const provider = createMemoryReleaseFiles([
      { artifactId: "a1", releaseId: "r1", path: "/index.html", body: "<html></html>" },
    ]);
    await expect(provider.getFile("a1", "r1", "/index.html")).resolves.not.toBeNull();
    await expect(provider.getFile("a1", "r2", "/index.html")).resolves.toBeNull();
  });

  it("should preserve HTML and JavaScript URLs while normalizing input line endings", () => {
    const html = '<script>\r\nconst s=document.createElement("script");\rs.src="/dep.js?v=1";\r\n</script>';
    expect(normalizeReleaseHtml(html)).toBe(html.replace(/\r\n?/g, "\n"));
    expect(normalizeReleaseHtml(html)).not.toContain("grant=");
  });

  it("should serve the generic application CSP (J1.0 §6, no profile opt-in)", () => {
    expect(RELEASE_CONTENT_MODE).toBe("application");
    expect(APPLICATION_HTML_CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; " +
      "worker-src 'self'; child-src 'self'; frame-src 'none'; frame-ancestors 'none'; " +
      "object-src 'none'; base-uri 'none'; form-action 'none'");
  });

  it("should map the real-UI asset types to served MIME types", () => {
    expect(contentTypeForPath("municipalities.geojson")).toBe("application/json");
    expect(contentTypeForPath("pdf.worker.min-yatZIOMy.mjs")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForPath("inter-latin-wght-normal-Dx4kXJAl.woff2")).toBe("font/woff2");
    expect(contentTypeForPath("tiles.pbf")).toBe("application/x-protobuf");
    expect(contentTypeForPath("module.wasm")).toBe("application/wasm");
  });

  it("should authorize release sub-resources and H5 calls without opening isolation", () => {
    expect(APPLICATION_HTML_CSP).toContain("script-src 'self'");
    expect(APPLICATION_HTML_CSP).toContain("style-src 'self' 'unsafe-inline'");
    expect(APPLICATION_HTML_CSP).toContain("connect-src 'self'");
    expect(APPLICATION_HTML_CSP).toContain("worker-src 'self'");
    expect(APPLICATION_HTML_CSP).toContain("frame-ancestors 'none'");
    expect(releaseCspForHtml("<html><body>ok</body></html>")).not.toContain("sha256-");
  });

  it("should take the release CSP from the provider application mode", () => {
    expect(READER_CONTENT_HEADERS["Content-Security-Policy"]).toBe(APPLICATION_HTML_CSP);
    expect(releaseCspForHtml("<html><body>ok</body></html>")).toBe(APPLICATION_HTML_CSP);
    const script = "document.body.textContent='ok'";
    const hash = `'sha256-${createHash("sha256").update(script).digest("base64")}'`;
    const csp = releaseCspForHtml(`<script>${script}</script>`);
    expect(csp).toBe(contentHeaders({ mimeType: "text/html", size: 0, mode: "application",
      scriptHashes: [hash] })["content-security-policy"]);
    expect(csp).toContain(`script-src 'self' ${hash};`);
    expect(csp).toContain("worker-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });
});
