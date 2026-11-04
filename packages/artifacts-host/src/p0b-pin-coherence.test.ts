import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Lot I2 B3: the pin-integrity gate in tools/mcp-p0b.mk shipped a truncated
 * integrity constant (94 chars vs 95 in the lockfile), so `make integrity`
 * could never pass and the p0b qualification of the pin never ran. This
 * test locks every pin location together without network access: any
 * version bump or hand-truncated hash fails here first.
 */
function readRoot(relative: string): string {
  return readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");
}

const ROOT_PACKAGE = JSON.parse(readRoot("package.json")) as {
  dependencies: Record<string, string>;
};
const LOCK = JSON.parse(readRoot("package-lock.json")) as {
  packages: Record<string, { version?: string; resolved?: string; integrity?: string;
    dependencies?: Record<string, string> }>;
};
const P0B_MK = readRoot("tools/mcp-p0b.mk");
const CANDIDATE_SH = readRoot("tools/mcp-p0b-candidate.sh");
const P0B_PROFILE_TS = readFileSync(new URL("./p0b-profile.ts", import.meta.url), "utf8");
const P0B_V1 = JSON.parse(readRoot("packages/immo-mcp/config/immo-artifacts.p0b.v1.json")) as {
  providerVersion: string;
};
const CAS_V2 = JSON.parse(readRoot("packages/immo-mcp/config/immo-artifacts.cas.v2.json")) as {
  providerVersion: string;
};
const V2 = JSON.parse(readRoot("packages/immo-mcp/config/immo-artifacts.v2.json")) as {
  providerVersion: string;
};

const PINNED = ROOT_PACKAGE.dependencies["@sentropic/artifacts"] as string;
const LOCK_ENTRY = LOCK.packages["node_modules/@sentropic/artifacts"] as {
  version?: string; resolved?: string; integrity?: string;
};
const LOCK_ROOT_DEPS = LOCK.packages[""]?.dependencies as Record<string, string> | undefined;

describe("artifact provider pin coherence", () => {
  it("should pin one version in package.json and the lockfile", () => {
    expect(PINNED).toMatch(/^\d+\.\d+\.\d+$/);
    expect(LOCK_ROOT_DEPS?.["@sentropic/artifacts"]).toBe(PINNED);
    expect(LOCK_ENTRY.version).toBe(PINNED);
    expect(LOCK_ENTRY.resolved).toBe(
      `https://registry.npmjs.org/@sentropic/artifacts/-/artifacts-${PINNED}.tgz`);
  });

  it("should carry a well-formed sha512 integrity in the lockfile", () => {
    expect(LOCK_ENTRY.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
    expect(Buffer.from(LOCK_ENTRY.integrity!.slice("sha512-".length), "base64")).toHaveLength(64);
  });

  it("should gate tools/mcp-p0b.mk on the same version and integrity", () => {
    expect(P0B_MK).toContain(`P0B_VERSION ?= ${PINNED}`);
    expect(P0B_MK).toContain(`view @sentropic/artifacts@${PINNED} dist.integrity`);
    expect(P0B_MK).toContain(`test "$$actual" = "${LOCK_ENTRY.integrity}"`);
    expect(P0B_MK).toContain(`pack @sentropic/artifacts@${PINNED} --pack-destination /tmp`);
    expect(P0B_MK).toContain(`sentropic-artifacts-${PINNED}.tgz`);
    expect(P0B_MK).not.toMatch(/artifacts@0\.2\.(9|10)[\s"]/);
  });

  it("should default tools/mcp-p0b-candidate.sh to the same version", () => {
    expect(CANDIDATE_SH).toContain(`\${P0B_VERSION:=${PINNED}}`);
  });

  it("should qualify the pinned version in p0b-profile and the strict gate", () => {
    expect(P0B_PROFILE_TS).toContain(`"${PINNED}"`);
    expect(P0B_PROFILE_TS).toMatch(
      new RegExp(`ARTIFACT_PROVIDER_VERSION !== "${PINNED.replaceAll(".", "\\.")}"`));
  });

  it("should expose the pinned version in every immo profile revision", () => {
    expect(P0B_V1.providerVersion.split(" || ").map((part) => part.trim())).toContain(PINNED);
    expect(CAS_V2.providerVersion).toBe(PINNED);
    expect(V2.providerVersion).toBe(PINNED);
  });
});
