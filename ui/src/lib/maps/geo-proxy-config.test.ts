import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("geo proxy configuration", () => {
  for (const path of ["nginx/default.conf", "../deploy/k8s/nginx/default.conf"]) {
    it(`should preserve encoded geo bytes and Vary in ${path}`, () => {
      const config = readFileSync(path, "utf8");
      const location = config.match(/location \/api\/geo\/collections \{([^}]+)\}/)?.[1];
      expect(location).toContain("proxy_set_header Accept-Encoding $http_accept_encoding;");
      expect(location).toContain("proxy_pass_header Vary;");
      expect(location).toContain("gunzip off;");
      expect(location).toContain("gzip off;");
      expect(location).not.toContain("proxy_hide_header");
    });
  }
  it("should stream display collections directly through Vite before the API proxy", () => {
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config.indexOf('"/api/geo/collections":')).toBeLessThan(config.indexOf('"/api":'));
    expect(config).toContain('path.replace(/^\\/api\\/geo/, "")');
    expect(config).not.toMatch(/selfHandleResponse|proxyRes|accept-encoding.*identity/i);
  });
});
