import { executionContract, releaseAnchor } from "./integration-contract.mjs";

const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function releaseState(anchor = releaseAnchor) {
  if (anchor.version === null && anchor.publicationEvidence === null) return "awaiting-release";
  if (typeof anchor.version !== "string" || !exactVersion.test(anchor.version)) {
    throw new Error("llm-mesh release anchor must be an exact published version");
  }
  if (typeof anchor.publicationEvidence !== "string" || !anchor.publicationEvidence.trim()) {
    throw new Error("llm-mesh release anchor requires publication evidence");
  }
  return "pinned";
}

export function assertInstalledRelease({ anchor = releaseAnchor, graphifyPackage, meshPackage }) {
  if (releaseState(anchor) !== "pinned") throw new Error("llm-mesh release anchor is empty");
  if (meshPackage.name !== anchor.packageName || meshPackage.version !== anchor.version) {
    throw new Error("installed llm-mesh package differs from the published release anchor");
  }
  const expectedGraphify = executionContract.graphify;
  if (graphifyPackage.name !== expectedGraphify.packageName
    || graphifyPackage.version !== expectedGraphify.version) {
    throw new Error("installed Graphify package differs from the frozen 0.18 contract");
  }
  return Object.freeze({ state: "ready", llmMeshVersion: meshPackage.version,
    graphifyVersion: graphifyPackage.version });
}
