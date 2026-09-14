// Builds docs/reviews/refresh-benchmark/manual-oracle-v2.json from the frozen v1 oracle.
//
// The v1 oracle stays byte-identical and is never rewritten: every unit keeps its id, city, label,
// stage, citation, anchor, page, doc_sha and sourceUrl exactly as frozen. v2 only adds, per unit,
// an `alternate_sites` array, and each added site is proven here against the frozen page text before
// it is written: the build fails rather than emit a site the PDF does not carry.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { oracleV2Rules, ORACLE_V2_ELIGIBLE_NODE_TYPES, stripItemNumber } from "./score-oracle-v2.mjs";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalized = (value) => value.normalize("NFC").toLocaleLowerCase("fr-CA")
  .replace(/\s+/g, " ").trim();
const key = (value) => stripItemNumber(normalized(value));

// Each addition is adjudicated by hand against the frozen PDF text and justified here. Nothing is
// added because it would raise a score: B04-B10 and B158 are the same council acts cited where the
// decision is actually taken, and the two BC anchors are frozen values that match no page at all.
const ADDITIONS = [
  ...["B04", "B05", "B06", "B07", "B08", "B09", "B10"].map((id) => ({ id, page: 10,
    anchor: null, reason: "frozen page 2 is the agenda list; resolution 2026-08-150 on page 10 is "
      + "where the council adopts these seven by-laws, and the frozen anchor is verbatim there" })),
  { id: "B158", page: 14, anchor: null,
    reason: "frozen page 2 is the agenda list; item k is introduced verbatim on page 14" },
  { id: "BC2014-11", page: 11, anchor: "Règlement 2014-11 sur les conditions",
    reason: "the frozen anchor '- Règlement 2014-11' matches no page: pdftotext keeps a single "
      + "bullet for the three by-laws, so only the first one carries the dash" },
  { id: "BC2023-02", page: 11, anchor: "Règlement 2023-02 relatif à la démolition",
    reason: "same single-bullet extraction artefact as BC2014-11" },
];

const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
  "docs/reviews/refresh-benchmark/v13/manifest.json"), "utf8"));
const v1Path = resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v13/manual-oracle.json");
const v1Bytes = await readFile(v1Path);
const v1 = JSON.parse(v1Bytes.toString("utf8"));

const pagesByDocument = new Map();
for (const document of manifest.documents) {
  const text = await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8");
  const pages = text.split("\f");
  if (pages.at(-1) === "") pages.pop();
  if (pages.length !== document.pageCount) throw new Error(`Page count mismatch: ${document.id}`);
  pages.forEach((page, index) => {
    if (sha256(page) !== document.pageTextSha256[index]) {
      throw new Error(`Frozen page hash mismatch: ${document.id} page ${index + 1}`);
    }
  });
  pagesByDocument.set(document.sha256, pages);
}

const byId = new Map(v1.units.map((unit) => [unit.id, unit]));
const additionsByUnit = new Map();
for (const addition of ADDITIONS) {
  const unit = byId.get(addition.id);
  if (!unit) throw new Error(`Unknown unit: ${addition.id}`);
  const pages = pagesByDocument.get(unit.doc_sha);
  const pageText = pages[addition.page - 1];
  if (!pageText) throw new Error(`Unknown page ${addition.page} for ${addition.id}`);
  const anchor = addition.anchor ?? unit.anchor;
  if (!key(pageText).includes(key(anchor))) {
    throw new Error(`Added anchor is not verbatim on page ${addition.page}: ${addition.id}`);
  }
  if (addition.page === unit.page && anchor === unit.anchor) {
    throw new Error(`Addition duplicates the frozen site: ${addition.id}`);
  }
  // Provenance is a verbatim window of the frozen page around the match, so a reader can check the
  // addition without rerunning anything.
  const index = normalized(pageText).indexOf(normalized(anchor).replace(/^\d+(?:\.\d+)*[.)]?\s+/, ""));
  const rawIndex = pageText.indexOf(anchor) >= 0 ? pageText.indexOf(anchor) : Math.max(0, index);
  const provenanceText = pageText.slice(Math.max(0, rawIndex - 120), rawIndex + 240);
  additionsByUnit.set(addition.id, [...(additionsByUnit.get(addition.id) ?? []), {
    page: addition.page, anchor,
    anchorIsFrozenValue: addition.anchor === null,
    provenance: { pageTextSha256: sha256(pageText), text: provenanceText, reason: addition.reason },
  }]);
}

const units = v1.units.map((unit) => {
  const sites = additionsByUnit.get(unit.id);
  return sites ? { ...unit, alternate_sites: sites } : { ...unit };
});
// The unit count is the recall denominator: v2 adds citation sites, never units.
if (units.length !== v1.units.length) throw new Error("v2 must not change the unit count");

const result = {
  schemaVersion: 2,
  builtAt: new Date().toISOString(),
  derivedFrom: { path: "docs/reviews/refresh-benchmark/v13/manual-oracle.json",
    sha256: sha256(v1Bytes), units: v1.units.length,
    note: "Frozen since v9 and byte-identical across v9, v12 and v13. Never rewritten here." },
  realignment: { rules: oracleV2Rules, eligibleNodeTypes: ORACLE_V2_ELIGIBLE_NODE_TYPES,
    addedUnits: 0, addedSites: [...additionsByUnit.values()].reduce((sum, s) => sum + s.length, 0) },
  knownLimitsNotCorrected: [
    "Units whose frozen stage is 'inconnu' (BC2010-11, BC2014-11, BC2023-02, V132) can never match: "
      + "no model emits that stage value. v2 leaves the frozen stage untouched.",
    "The macro average still covers only the documents an arm got accepted, unless the replay is "
      + "asked for the fixed population.",
    "Waterloo keeps a deliberately partial oracle: precision and F1 are null there by construction.",
  ],
  lineage: v1.lineage, rules: v1.rules, units,
};
const outputPath = process.env.BENCHMARK_ORACLE_V2_OUTPUT
  ?? resolve(repositoryRoot, "docs/reviews/refresh-benchmark/manual-oracle-v2.json");
await writeFile(outputPath, `${JSON.stringify(result, null, 1)}\n`, "utf8");
console.log(JSON.stringify({ units: units.length, addedSites: result.realignment.addedSites,
  derivedFromSha256: result.derivedFrom.sha256 }));
