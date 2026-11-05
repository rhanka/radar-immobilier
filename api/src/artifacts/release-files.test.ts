import { describe, expect, it } from "vitest";
import {
  contentTypeForPath,
  createMemoryReleaseFiles,
  normalizeReleaseHtml,
  normalizeReleasePath,
  releaseCspForHtml,
  RELEASE_CSP,
} from "./release-files.js";

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
    expect(RELEASE_CSP).toBe(
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
    expect(RELEASE_CSP).toContain("script-src 'self'");
    expect(RELEASE_CSP).toContain("style-src 'self' 'unsafe-inline'");
    expect(RELEASE_CSP).toContain("connect-src 'self'");
    expect(RELEASE_CSP).toContain("worker-src 'self'");
    expect(RELEASE_CSP).toContain("frame-ancestors 'none'");
    expect(releaseCspForHtml("<html><body>ok</body></html>")).not.toContain("sha256-");
  });
});
