import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const PINNED_GIT_REFS = [
  ["tools/h5-sol.mk", ["724b2c10b064dda14b580882f743f5bb204b575f"]],
  ["api/tests/fixtures/refresh-018/v11-citation-cases.json", ["f2d7cb40256953964e69adafe9b049a686dd66aa"]],
  ["api/tests/fixtures/refresh-018/v13-citation-cases.json", ["e77e8fe4ede718824a24264f85fbbf865e4996be"]],
  ["packages/immo-mcp/src/fixtures/immo-tools.provenance.v1.json", [
    "d32a1f02229e5c75dc432f41bdc501ca96c9cc1e",
    "5a5ce810b6132da9d5f0374ace8461531ff788e2",
  ]],
  ["tools/make/artefacts-a4-deliver.sh", ["4522d5fe"]],
  ["tools/make/artefacts-a4-run.sh", ["90edb37a"]],
  ["tools/make/artefacts-a5-deliver.sh", ["d01921a7"]],
  ["tools/make/artefacts-a5-run.sh", ["56ec8c7cf0fc7c73ef71fdd8c98379430473df46", "1710edb2"]],
  ["tools/make/artefacts-ouv-l3-deliver.sh", [
    "56ec8c7cf0fc7c73ef71fdd8c98379430473df46",
    "ed206a6dc129c9201a420b37d2eb89f488f2607d",
  ]],
  ["tools/make/base-api-a2base-deliver.sh", ["23ee568e8eb69844b72601d286c4476c03de3ede"]],
  ["tools/make/base-api-a2mcp-deliver.sh", ["688aea5b"]],
  ["tools/make/base-api-a2rest-deliver.sh", ["f507541a"]],
  ["tools/make/base-api-b2-deliver.sh", [
    "b6400c29488df9ef2c7f7660299cfa2803c3d283",
    "f489805b7494890d8aad589c2e54156c109083b8",
  ]],
  ["tools/make/base-api-bundle-proof.sh", [
    "dcd795afba3142ce106ea097ea1497b8c4cecfc4",
    "eac134dc095dcbb51897ada3f24af2ea7d46de86",
    "29fa51ec1442ccd9378c337fd4516e304203d625",
    "b6400c29488df9ef2c7f7660299cfa2803c3d283",
  ]],
  ["tools/make/base-api-contract-proof.sh", ["7a0645b32ccbe58bc4b626c0d5c9fe0a2cbb76bf"]],
  ["tools/make/base-api-deliver.sh", [
    "30635f90be6b8db97dd155d727a6b87f1d40e21b",
    "7a0645b32ccbe58bc4b626c0d5c9fe0a2cbb76bf",
    "eac134dc095dcbb51897ada3f24af2ea7d46de86",
    "29fa51ec1442ccd9378c337fd4516e304203d625",
    "dcd795afba3142ce106ea097ea1497b8c4cecfc4",
  ]],
  ["tools/make/base-api-l5-deliver.sh", [
    "2e2a0fa8a5eea46b1c173e8222165a0cab1d2b7d",
    "f9bbf7f99b66ce332ec0b3864f7d7318e819cf59",
  ]],
  ["tools/make/base-api-l5-r2-deliver.sh", ["2e2a0fa8a5eea46b1c173e8222165a0cab1d2b7d"]],
  ["tools/make/base-api-l5-r3-deliver.sh", ["2e2a0fa8a5eea46b1c173e8222165a0cab1d2b7d"]],
  ["tools/make/base-api-l5-r4-deliver.sh", ["2e2a0fa8a5eea46b1c173e8222165a0cab1d2b7d"]],
  ["tools/make/base-api-pwa-deliver.sh", [
    "62eae653bb5ad0a777b7fd6a334edbe622e72b01",
    "a99fa5db",
    "3843bd54",
    "ee655826",
    "23e203b4194683b52c767f8e7cb5374d4db0a292",
    "56ec8c7cf0fc7c73ef71fdd8c98379430473df46",
    "180eb6be",
  ]],
  ["tools/make/base-api-pwa-git.sh", ["3843bd54"]],
  ["tools/make/base-api-pwa-sequence-deliver.sh", ["2627dea7c600cae1297192f640d509fa5337401a"]],
  ["tools/make/base-api-pwb-deliver.sh", ["98ec1fcde6e8adc3491e9a1875da3354e8558fc9"]],
  ["tools/make/base-api-pwc-deliver.sh", ["2627dea7c600cae1297192f640d509fa5337401a"]],
  ["tools/make/base-api-pwc-review-deliver.sh", [
    "062ec2ee6d8856666f9102626a30acf6cfcb4b52",
    "6734c8b4e7e728b85f6b9c3b3a278d4bc9df68f3",
  ]],
  ["tools/make/base-api-pwd-corrections-deliver.sh", ["59d8eec37bf52827c54b7c1d7f9bb1c65dd0a025"]],
  ["tools/make/base-api-pwd-deliver.sh", ["98ec1fcd"]],
  ["tools/make/base-api-pwd.mk", ["59d8eec3", "59d8eec37bf52827c54b7c1d7f9bb1c65dd0a025"]],
  ["tools/make/base-api-pwe-deliver.sh", ["062ec2ee6d8856666f9102626a30acf6cfcb4b52"]],
  ["tools/make/base-api-worktree-proof.sh", [
    "dcd795afba3142ce106ea097ea1497b8c4cecfc4",
    "dcd795af",
    "40f8e485268157d0125c1ecbc471c4c2dc1b4d14",
  ]],
  ["tools/make/classification-deliver.sh", ["7ffbc0504886f30c46f3bebeaa5b292c6c9e0509"]],
  ["tools/make/classification-verify.sh", ["aea3660c8b245eb6a3637f762c57f4904e6442b2"]],
  ["tools/make/paniers-lot6-verify.sh", ["478d0967"]],
  ["tools/make/paniers-lot6g-deliver.sh", ["529ee3b6"]],
  ["tools/make/paniers-lot6h-deliver.sh", ["c3e3beac"]],
  ["tools/make/paniers-lot6h-fix-deliver.sh", ["96f24640"]],
  ["tools/make/paniers-lot6i-deliver.sh", ["b4341f3a"]],
  ["tools/make/paniers-lot6i-fix-deliver.sh", ["2a929dba"]],
  ["tools/make/paniers-lot6j-deliver.sh", ["104d660c"]],
  ["tools/make/paniers-lot6j-fix-deliver.sh", ["104cb616"]],
  ["tools/make/paniers-lot6j-fix2-deliver.sh", ["4bef660e"]],
  ["tools/make/paniers-lot6k-deliver.sh", ["478d0967"]],
  ["tools/make/paniers-lot6k-fix-deliver.sh", ["abdbff2c", "26d6ae74", "5bd30c3e"]],
  ["tools/make/paniers-lot6l1-deliver.sh", ["104d660c"]],
  ["tools/make/paniers-lot6l2-deliver.sh", ["478d0967"]],
  ["tools/make/paniers-lot6l2-fix-deliver.sh", ["c31dfb24"]],
  ["tools/make/paniers-lot6l2-fix2-deliver.sh", ["a0bd7761"]],
];

function git(args) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();
}

test("all repointed git references exist in the rewritten repository", () => {
  const shallow = git(["rev-parse", "--is-shallow-repository"]) === "true";
  for (const [relPath, shas] of PINNED_GIT_REFS) {
    const content = readFileSync(resolve(ROOT, relPath), "utf8");
    for (const sha of shas) {
      assert.ok(content.includes(sha), `${relPath} should contain ${sha}`);
      if (!shallow) {
        const objType = git(["cat-file", "-t", `${sha}^{commit}`]);
        assert.equal(objType, "commit", `${relPath}: ${sha} must resolve to a git commit`);
      }
    }
  }
});

test("immo-tools provenance gitRef entries resolve to their declared gitBlob hashes", () => {
  const shallow = git(["rev-parse", "--is-shallow-repository"]) === "true";
  const provenance = JSON.parse(
    readFileSync(resolve(ROOT, "packages/immo-mcp/src/fixtures/immo-tools.provenance.v1.json"), "utf8"),
  );
  for (const section of [provenance.captured, provenance.amendment]) {
    assert.match(section.gitRef, /^[0-9a-f]{40}$/);
    assert.match(section.gitBlob, /^[0-9a-f]{40}$/);
    if (!shallow) {
      const line = git(["ls-tree", section.gitRef, "packages/immo-mcp/src/fixtures/immo-tools.v1.json"]);
      assert.ok(line.includes(`blob ${section.gitBlob}`), `expected blob ${section.gitBlob} at ${section.gitRef}`);
    }
  }
});
