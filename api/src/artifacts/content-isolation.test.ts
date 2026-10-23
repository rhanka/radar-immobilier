import { describe, expect, it } from "vitest";
import {
  applyReaderContentHeaders,
  isEmbedPath,
  isServiceWorkerPath,
  servedBodyLeaksCredentials,
} from "./content-isolation.js";

describe("content isolation", () => {
  it("should refuse service workers and embed paths", () => {
    expect(isServiceWorkerPath("/sw.js")).toBe(true);
    expect(isServiceWorkerPath("/service-worker.js")).toBe(true);
    expect(isServiceWorkerPath("/__reader/sw-register")).toBe(true);
    expect(isServiceWorkerPath("/index.html")).toBe(false);
    expect(isEmbedPath("/embed")).toBe(true);
    expect(isEmbedPath("/embed/artifact-demo")).toBe(true);
    expect(isEmbedPath("/index.html")).toBe(false);
  });

  it("should detect credential leakage in served bodies", () => {
    expect(servedBodyLeaksCredentials("<html>hello</html>")).toBe(false);
    expect(servedBodyLeaksCredentials("x radar_session y")).toBe(true);
    expect(servedBodyLeaksCredentials("publisher-secret")).toBe(true);
  });

  it("should stamp isolation headers without cookies", () => {
    const headers = new Map<string, string>();
    applyReaderContentHeaders({ header: (n: string, v: string) => void headers.set(n, v) } as never);
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
});
