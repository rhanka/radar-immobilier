import { describe, expect, it } from "vitest";
import { APPLICATION_HTML_CSP } from "@sentropic/artifacts/content/headers";
import { EXTERNAL_MEDIA_MAX_OBJECT_BYTES, YOUTUBE_EMBED_ORIGIN, parseExternalMediaOrigin,
  readExternalMediaPolicy, withExternalMediaSources } from "./external-media.js";

const BUCKET = "https://media-bucket.s3.bhs.io.cloud.ovh.net";

describe("external heavy media policy", () => {
  it("allows the YouTube nocookie frame origin and no bucket by default", () => {
    expect(readExternalMediaPolicy({})).toEqual({ frameOrigins: [YOUTUBE_EMBED_ORIGIN], mediaOrigins: [] });
    expect(EXTERNAL_MEDIA_MAX_OBJECT_BYTES).toBe(10_000_000_000);
  });

  it("reads exact HTTPS bucket origins and refuses anything wider", () => {
    expect(readExternalMediaPolicy({ ARTIFACTS_EXTERNAL_MEDIA_ORIGINS: ` ${BUCKET} ,${BUCKET}` }).mediaOrigins)
      .toEqual([BUCKET]);
    for (const bad of ["http://bucket.example", "https://*.example.com", "https://bucket.example/path",
      "https://bucket.example/", "https://user:pw@bucket.example", "https://bucket.example?x=1", "bucket.example"]) {
      expect(() => parseExternalMediaOrigin(bad), bad).toThrow();
    }
    expect(() => readExternalMediaPolicy({ ARTIFACTS_EXTERNAL_MEDIA_ORIGINS:
      Array.from({ length: 9 }, (_, i) => `https://b${i}.example`).join(",") })).toThrow();
  });

  it("extends only frame-src, media-src and img-src of the application CSP", () => {
    const csp = withExternalMediaSources(APPLICATION_HTML_CSP,
      readExternalMediaPolicy({ ARTIFACTS_EXTERNAL_MEDIA_ORIGINS: BUCKET }));
    expect(csp).toContain(`frame-src ${YOUTUBE_EMBED_ORIGIN};`);
    expect(csp).not.toContain("frame-src 'none'");
    expect(csp).toContain(`media-src 'self' blob: ${BUCKET};`);
    expect(csp).toContain(`img-src 'self' data: blob: ${BUCKET};`);
    const untouched = (policy: string) => policy.split("; ")
      .filter((d) => !/^(frame-src|media-src|img-src) /.test(d));
    expect(untouched(csp)).toEqual(untouched(APPLICATION_HTML_CSP));
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self';");
  });

  it("adds a missing directive and keeps the policy unchanged without sources", () => {
    expect(withExternalMediaSources("default-src 'self'", { frameOrigins: [YOUTUBE_EMBED_ORIGIN], mediaOrigins: [] }))
      .toBe(`default-src 'self'; frame-src ${YOUTUBE_EMBED_ORIGIN}`);
    expect(withExternalMediaSources(APPLICATION_HTML_CSP, { frameOrigins: [], mediaOrigins: [] }))
      .toBe(APPLICATION_HTML_CSP);
  });
});
