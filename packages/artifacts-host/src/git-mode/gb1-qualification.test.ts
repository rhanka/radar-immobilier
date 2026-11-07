import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GB1_POSTINSTALL_ALLOWLIST, installScriptRowsFromLock } from "./gb1-qualification.js";
import committed from "./gb1-install-script-rows.json" with { type: "json" };

const repo = (path: string) => JSON.parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8"));

describe("GB1 install-script qualification rows", () => {
  it("match the repository lock exactly (regenerate with make -f tools/make/git-artifact.mk gb1-rows)", () => {
    expect(committed).toEqual({ postinstallAllowlist: [], installScriptRows: installScriptRowsFromLock(repo("package-lock.json")) });
    expect(GB1_POSTINSTALL_ALLOWLIST).toEqual([]);
  });

  it("disable exactly the packages the root allowScripts lists", () => {
    const allowScripts = repo("package.json").allowScripts as Record<string, boolean>;
    expect(Object.values(allowScripts).every((value) => value === false)).toBe(true);
    expect([...new Set(committed.installScriptRows.map((row) => row.package))].sort()).toEqual(Object.keys(allowScripts).sort());
    expect(committed.installScriptRows.every((row) => row.scripts === "disabled")).toBe(true);
  });

  it("refuses an install-script entry without integrity", () => {
    expect(() => installScriptRowsFromLock({ packages: { "node_modules/esbuild": { version: "0.25.0", hasInstallScript: true } } }))
      .toThrow("dependency_integrity_missing");
    expect(installScriptRowsFromLock({ packages: { "node_modules/a/node_modules/@s/b": { version: "1.0.0",
      integrity: "sha512-AAAA", hasInstallScript: true }, "node_modules/c": { version: "1.0.0" } } }))
      .toEqual([{ path: "node_modules/a/node_modules/@s/b", package: "@s/b", version: "1.0.0", integrity: "sha512-AAAA", scripts: "disabled" }]);
  });
});
