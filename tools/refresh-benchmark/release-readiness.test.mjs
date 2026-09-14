import assert from "node:assert/strict";
import test from "node:test";

import { releaseAnchor } from "./integration-contract.mjs";
import { assertInstalledRelease, releaseState } from "./release-readiness.mjs";

const historicalAnchor = Object.freeze({
  ...releaseAnchor,
  publicationEvidence: "npm registry shasum 4ea47d90242c58dee638c25e1626b7c6265be511",
});
const graphifyPackage = { name: "@sentropic/graphify", version: "0.18.0" };
const meshPackage = { name: "@sentropic/llm-mesh", version: "0.19.1" };

test("the published anchor is integration-ready", () => {
  assert.equal(releaseState(), "pinned");
  assert.deepEqual(assertInstalledRelease({ graphifyPackage, meshPackage }), {
    state: "ready", llmMeshVersion: "0.19.1", graphifyVersion: "0.18.0",
  });
});

test("readiness requires an exact anchor and exact installed package identities", () => {
  assert.deepEqual(assertInstalledRelease({ anchor: historicalAnchor,
    graphifyPackage, meshPackage }), {
    state: "ready", llmMeshVersion: "0.19.1", graphifyVersion: "0.18.0",
  });
  assert.throws(() => releaseState({ ...historicalAnchor, version: "^0.19.0" }),
    /exact published version/);
  assert.throws(() => assertInstalledRelease({ anchor: historicalAnchor, graphifyPackage,
    meshPackage: { ...meshPackage, version: "0.18.0" } }), /differs from/);
});
