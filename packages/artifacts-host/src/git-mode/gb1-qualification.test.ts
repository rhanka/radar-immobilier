import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  gb1Qualification, GB1_QUALIFICATION_MAX_BYTES, GB1_QUALIFICATION_PATH, scriptQualificationFromLock,
} from "./gb1-qualification.js";

const repoFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url));
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("GB1 qualification (artifact-build/gb1-qualification.json)", () => {
  it("matches the repository lock exactly (regenerate: make -f tools/make/git-artifact.mk gb1-rows ENV=test-<slug>)", () => {
    const raw = repoFile(GB1_QUALIFICATION_PATH);
    expect(raw.byteLength).toBeLessThanOrEqual(GB1_QUALIFICATION_MAX_BYTES);
    const committed = JSON.parse(raw.toString("utf8"));
    expect(Object.keys(committed)).toEqual(["v", "lockSha256", "postinstallAllowlist", "scriptQualification"]);
    expect(committed).toEqual(gb1Qualification(new Uint8Array(repoFile("package-lock.json")), sha256Hex));
  });

  it("declares exactly the 19 install-script entries, sorted by package then version, of the allowScripts packages", () => {
    const committed = JSON.parse(repoFile(GB1_QUALIFICATION_PATH).toString("utf8")) as {
      postinstallAllowlist: unknown[]; scriptQualification: { package: string; version: string; integrity: string }[] };
    expect(committed.postinstallAllowlist).toEqual([]);
    expect(committed.scriptQualification).toHaveLength(19);
    for (const row of committed.scriptQualification) expect(Object.keys(row)).toEqual(["package", "version", "integrity"]);
    const sorted = [...committed.scriptQualification].sort((a, b) =>
      a.package < b.package ? -1 : a.package > b.package ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
    expect(committed.scriptQualification).toEqual(sorted);
    const allowScripts = JSON.parse(repoFile("package.json").toString("utf8")).allowScripts as Record<string, boolean>;
    expect(Object.values(allowScripts).every((value) => value === false)).toBe(true);
    expect([...new Set(committed.scriptQualification.map((row) => row.package))].sort()).toEqual(Object.keys(allowScripts).sort());
  });

  it("refuses an install-script entry without a literal SRI", () => {
    expect(() => scriptQualificationFromLock({ packages: { "node_modules/esbuild": { version: "0.25.0", hasInstallScript: true } } }))
      .toThrow("dependency_integrity_missing");
    expect(scriptQualificationFromLock({ packages: {
      "node_modules/b": { version: "1.0.0", integrity: "sha512-BBBB", hasInstallScript: true },
      "node_modules/x/node_modules/a": { version: "2.0.0", integrity: "sha512-AAA2", hasInstallScript: true },
      "node_modules/a": { version: "1.0.0", integrity: "sha512-AAA1", hasInstallScript: true },
      "node_modules/c": { version: "1.0.0" } } }))
      .toEqual([{ package: "a", version: "1.0.0", integrity: "sha512-AAA1" }, { package: "a", version: "2.0.0", integrity: "sha512-AAA2" },
        { package: "b", version: "1.0.0", integrity: "sha512-BBBB" }]);
  });
});
