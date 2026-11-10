import { describe, expect, it } from "vitest";
import { normalizeBuilderImageAllowlist, normalizeBuilderImageDigest } from "./host-ledger.js";

const HEX = "add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68";
const DIGEST = `sha256:${HEX}`;

describe("builder image allowlist normalisation", () => {
  it("accepts a bare digest and a full reference, both as the bare digest", () => {
    expect(normalizeBuilderImageDigest(DIGEST)).toBe(DIGEST);
    expect(normalizeBuilderImageDigest(`docker.io/library/node@${DIGEST}`)).toBe(DIGEST);
    expect(normalizeBuilderImageAllowlist([DIGEST])).toEqual([DIGEST]);
    expect(normalizeBuilderImageAllowlist([`docker.io/library/node@${DIGEST}`])).toEqual([DIGEST]);
  });

  it("refuses anything that is neither a bare digest nor a full reference", () => {
    for (const entry of ["docker.io/library/node:latest", "node", "sha256:xyz", `sha256:${HEX.slice(0, 63)}`,
      `${DIGEST}ff`, `@${DIGEST}`, `docker.io/library/node@sha256:${HEX.slice(0, 10)}`, ""]) {
      expect(normalizeBuilderImageDigest(entry)).toBeUndefined();
    }
    expect(normalizeBuilderImageAllowlist(["docker.io/library/node:latest", "latest"])).toEqual([]);
  });

  it("trims, lowercases and deduplicates entries", () => {
    expect(normalizeBuilderImageAllowlist([`  docker.io/library/node@${DIGEST} `, DIGEST.toUpperCase().replace("SHA256:", "sha256:")]))
      .toEqual([DIGEST]);
  });
});
