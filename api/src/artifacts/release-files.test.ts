import { describe, expect, it } from "vitest";
import {
  contentTypeForPath,
  createMemoryReleaseFiles,
  injectGrantIntoHtml,
  normalizeReleasePath,
  RELEASE_CSP,
} from "./release-files.js";
import { READER_EXAMPLE_SCRIPT_HASH } from "./reader-example.js";

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

  it("should carry the page grant on relative sub-resources only", () => {
    const html = `<link rel="stylesheet" href="/styles.css"><script src="/app.js"></script>` +
      `<script src="https://evil.example/x.js"></script><a href="/__reader/api/baskets.search.v1">x</a>`;
    const rewritten = injectGrantIntoHtml(html, "grant-value");
    expect(rewritten).toContain(`/styles.css?grant=grant-value`);
    expect(rewritten).toContain(`/app.js?grant=grant-value`);
    expect(rewritten).toContain("https://evil.example/x.js");
    expect(rewritten).not.toContain("/__reader/api/baskets.search.v1?grant=");
  });

  it("should authorize release sub-resources and H5 calls without opening isolation", () => {
    expect(RELEASE_CSP).toContain("script-src 'self'");
    expect(RELEASE_CSP).toContain("style-src 'self'");
    expect(RELEASE_CSP).toContain("connect-src 'self'");
    expect(RELEASE_CSP).toContain(`sha256-${READER_EXAMPLE_SCRIPT_HASH}`);
    expect(RELEASE_CSP).toContain("worker-src 'none'");
    expect(RELEASE_CSP).toContain("frame-ancestors 'none'");
  });
});
