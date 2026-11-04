import { describe, expect, it } from "vitest";
import { projectListVersionsAuthors } from "./list-versions-projection.js";

const ALICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function stubDirectory() {
  return {
    async describePrincipal(_scope: string, principalId: string) {
      if (principalId === "alice") return { userRef: ALICE_ID, displayName: "Alice", email: "" };
      if (principalId === ALICE_ID) return { userRef: ALICE_ID, displayName: "Alice", email: "" };
      if (principalId.startsWith("sentropic:")) return undefined;
      if (principalId === "idp-gone") {
        const { unknownUserRef } = await import("./directory.js");
        return { userRef: unknownUserRef(principalId), displayName: "Unknown reader", email: "" };
      }
      const { unknownUserRef } = await import("./directory.js");
      return { userRef: unknownUserRef(principalId), displayName: "Unknown reader", email: "" };
    },
  };
}

describe("list_versions author projection", () => {
  it("should project v2 authorPrincipalId for known and deleted authors", async () => {
    const body = { versions: [
      { releaseId: "r1", authorPrincipalId: "alice" },
      { releaseId: "r2", authorPrincipalId: "idp-gone" },
      { releaseId: "r3", authorPrincipalId: null },
    ] };
    await projectListVersionsAuthors(body, "p0b", stubDirectory());
    expect(body.versions[0]!.authorPrincipalId).toBe(ALICE_ID);
    expect(String(body.versions[1]!.authorPrincipalId)).toMatch(/^unknown-[0-9a-f]{12}$/);
    expect(body.versions[2]!.authorPrincipalId).toBeNull();
    expect(JSON.stringify(body)).not.toContain("alice");
    expect(JSON.stringify(body)).not.toContain("idp-gone");
  });

  it("should project v2 output envelope and v1 releases author", async () => {
    const v2 = { ok: true, output: { versions: [{ releaseId: "r1", authorPrincipalId: "alice" }] } };
    await projectListVersionsAuthors(v2, "p0b", stubDirectory());
    expect((v2.output.versions[0] as { authorPrincipalId: string }).authorPrincipalId).toBe(ALICE_ID);

    const v1 = { artifactId: "a", total: 1, releases: [{ releaseId: "r1", author: "alice" }] };
    await projectListVersionsAuthors(v1, "p0b", stubDirectory());
    expect((v1.releases[0] as { author: string }).author).toBe(ALICE_ID);
    expect(JSON.stringify(v1)).not.toContain("alice");
  });

  it("should leave mode sentinels untouched", async () => {
    const body = { versions: [{ releaseId: "r1", authorPrincipalId: "sentropic:platform" }] };
    await projectListVersionsAuthors(body, "p0b", stubDirectory());
    expect(body.versions[0]!.authorPrincipalId).toBe("sentropic:platform");
  });
});
