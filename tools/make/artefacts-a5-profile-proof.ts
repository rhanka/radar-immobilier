import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { computeManifestDigest } from "@sentropic/cluster-mesh/mcp/registry";
import { IMMO_ARTIFACT_PROFILE, IMMO_ARTIFACT_MANIFEST } from "../../packages/immo-mcp/src/registry/artifact-provider.js";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const configBytes = readFileSync("packages/immo-mcp/config/immo-artifacts.v1.json");
const config = JSON.parse(configBytes.toString());
const mcp = read("packages/immo-mcp/package.json");
const host = read("packages/artifacts-host/package.json");
const api = read("api/package.json");
assert.equal(mcp.dependencies["@sentropic/artifacts"], "0.2.0");
assert.equal(mcp.dependencies["@sentropic/cluster-mesh"], "0.22.0");
assert.equal(config.provider.selectionStatus, "unselected");
assert.equal(config.provider.version, "0.2.0");
assert.equal(IMMO_ARTIFACT_MANIFEST.audit.artifactsProfileDigest, IMMO_ARTIFACT_PROFILE.profileDigest);
assert.equal(IMMO_ARTIFACT_MANIFEST.tools.length, 4);
for (const tool of IMMO_ARTIFACT_MANIFEST.tools) assert.deepEqual(tool.requiredScopes, [config.invocationScope]);
const receipt = {
  qualification: "profile-and-composition-only",
  candidate: readFileSync("/evidence/candidate-sha.txt", "utf8").trim(),
  profile: IMMO_ARTIFACT_PROFILE.profile,
  profileDigest: IMMO_ARTIFACT_PROFILE.profileDigest,
  manifest: IMMO_ARTIFACT_MANIFEST,
  manifestDigest: computeManifestDigest(IMMO_ARTIFACT_MANIFEST),
  embeddedConfigurationSha256: createHash("sha256").update(configBytes).digest("hex"),
  dependencies: { mcp: mcp.dependencies, hostArtifacts: host.dependencies["@sentropic/artifacts"],
    apiArtifacts: api.dependencies["@sentropic/artifacts"] },
  activation: config.provider,
};
writeFileSync("/evidence/profile-proof.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ profileDigest: receipt.profileDigest, manifestDigest: receipt.manifestDigest,
  configurationSha256: receipt.embeddedConfigurationSha256, activation: receipt.activation }));
