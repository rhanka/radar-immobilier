import { controlTestHost } from "./control-test-host.js";
import { describe, expect, it, vi } from "vitest";
import { assertContentIdsDisjoint, createArtifactControl, projectContentUrls } from "./facade.js";

describe("publication content links", () => {
  it.each(["pages.example.test/path", "pages.example.test:443", "bad host"])(
    "refuses invalid stable origin %s before calling storage", async (contentBase) => {
      const handle = vi.fn().mockResolvedValue({ status: 201, body: {} });
      const host = controlTestHost(handle);
      const response = await createArtifactControl(host, "scope", contentBase).handle("publish", "alice", {
        artifactId: "123e4567-e89b-12d3-a456-426614174000", idempotencyKey: "key",
        files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
      });
      expect(response).toEqual({ status: 400, body: { error: "invalid_request" } });
      expect(handle).not.toHaveBeenCalled();
    },
  );
});

describe("content url projection (single-label host contract)", () => {
  it("should rename versionUrl to pinnedUrl without leaking versionUrl", () => {
    const v1 = projectContentUrls({ artifactId: "a", stableUrl: "https://a.base/", versionUrl: "https://r.base/" });
    expect(v1).toEqual({ artifactId: "a", stableUrl: "https://a.base/", pinnedUrl: "https://r.base/" });
    expect(v1).not.toHaveProperty("versionUrl");
    const v2 = projectContentUrls({ ok: true, output: { artifactId: "a", versionUrl: "https://r.base/" } });
    expect(v2).toEqual({ ok: true, output: { artifactId: "a", pinnedUrl: "https://r.base/" } });
    const versions = projectContentUrls({ versions: [{ releaseId: "r", versionUrl: "https://r.base/" }] });
    expect(versions).toEqual({ versions: [{ releaseId: "r", pinnedUrl: "https://r.base/" }] });
  });

  it("should keep an existing pinnedUrl and drop a colliding versionUrl", () => {
    const merged = projectContentUrls({ pinnedUrl: "https://r.base/", versionUrl: "https://other.base/" });
    expect(merged).toEqual({ pinnedUrl: "https://r.base/" });
  });

  it("should fail closed when a release reuses its artifact id", () => {
    expect(() => assertContentIdsDisjoint("123e4567-e89b-12d3-a456-426614174000", "123E4567-E89B-12D3-A456-426614174000"))
      .toThrow("invalid content links");
    expect(() => assertContentIdsDisjoint("123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174001"))
      .not.toThrow();
  });
});
