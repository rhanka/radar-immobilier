import assert from "node:assert/strict";
import test from "node:test";

import { releaseAnchor } from "./integration-contract.mjs";
import { assertInstalledRelease, releaseState } from "./release-readiness.mjs";

const historicalAnchor = Object.freeze({
  ...releaseAnchor,
  version: "0.19.0",
  publicationEvidence: "docs/reviews/refresh-benchmark/v4/gemini-debug-01-mesh-low.json",
});
const graphifyPackage = { name: "@sentropic/graphify", version: "0.18.0" };
const meshPackage = { name: "@sentropic/llm-mesh", version: "0.19.0" };

test("empty anchor is a valid preparation state but never integration-ready", () => {
  assert.equal(releaseState(), "awaiting-release");
  assert.throws(() => assertInstalledRelease({ graphifyPackage, meshPackage }),
    /release anchor is empty/);
});

test("readiness requires an exact anchor and exact installed package identities", () => {
  assert.deepEqual(assertInstalledRelease({ anchor: historicalAnchor,
    graphifyPackage, meshPackage }), {
    state: "ready", llmMeshVersion: "0.19.0", graphifyVersion: "0.18.0",
  });
  assert.throws(() => releaseState({ ...historicalAnchor, version: "^0.19.0" }),
    /exact published version/);
  assert.throws(() => assertInstalledRelease({ anchor: historicalAnchor, graphifyPackage,
    meshPackage: { ...meshPackage, version: "0.18.0" } }), /differs from/);
});
