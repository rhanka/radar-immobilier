// Proves that one campaign reproduces another everywhere except on the contract snapshot and the
// hashes that depend on it. v16 changes the emitted schema on purpose — the two majors of the v9
// review — so claiming an exact replay would be false. What must stay identical is everything that
// is not the contract: corpus, oracle, cap, system prompt, document set, pages. What is allowed to
// move is named here, one field at a time, and every named delta must actually have moved: a v16
// freeze that still carried the v15 profile hash would mean the snapshot never changed.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const reference = required("BENCHMARK_REPLAY_REFERENCE");
const replay = required("BENCHMARK_REPLAY_CAMPAIGN");
const expectedT1Commit = process.env.BENCHMARK_EXPECTED_T1_COMMIT;
const campaignPath = (campaign, file) =>
  resolve(repositoryRoot, `docs/reviews/refresh-benchmark/${campaign}/${file}`);

const [referenceFreeze, replayFreeze] = await Promise.all([reference, replay].map(async (campaign) =>
  JSON.parse(await readFile(campaignPath(campaign, "prompt-freeze.json"), "utf8"))));

const invariants = ["maxOutputTokens", "systemPromptSha256", "graphifyVersion", "meshVersion"];
for (const field of invariants) {
  if (JSON.stringify(referenceFreeze[field]) !== JSON.stringify(replayFreeze[field])) {
    throw new Error(`${replay} deviates from ${reference} on ${field}, which must not move`);
  }
}
const mustMove = ["t1Commit", "profileModuleSha256", "corpusModuleSha256"];
for (const field of mustMove) {
  if (referenceFreeze[field] === replayFreeze[field]) {
    throw new Error(`${replay} carries the ${reference} ${field}: the contract snapshot never changed`);
  }
}
if (expectedT1Commit && replayFreeze.t1Commit !== expectedT1Commit) {
  throw new Error(`${replay} froze ${replayFreeze.t1Commit}, expected ${expectedT1Commit}`);
}

const byId = new Map(referenceFreeze.documents.map((document) => [document.id, document]));
if (byId.size !== replayFreeze.documents.length) {
  throw new Error(`${replay} does not carry the same number of documents as ${reference}`);
}
const documentDeltas = replayFreeze.documents.map((document) => {
  const before = byId.get(document.id);
  if (!before) throw new Error(`${replay} adds an unknown document ${document.id}`);
  // The chunk identity and its pages are the input: they must be the same input, byte for byte.
  for (const field of ["chunkId", "pages"]) {
    if (JSON.stringify(before[field]) !== JSON.stringify(document[field])) {
      throw new Error(`${replay} deviates from ${reference} on ${document.id}.${field}`);
    }
  }
  if (before.schemaSha256 === document.schemaSha256) {
    throw new Error(`${replay} reproduces the ${reference} schema hash on ${document.id}`);
  }
  return { id: document.id, schemaBytes: [before.schemaBytes, document.schemaBytes],
    promptBytes: [before.promptBytes, document.promptBytes],
    promptSha256Moved: before.promptSha256 !== document.promptSha256 };
});

for (const file of ["manual-oracle.json", "manifest.json"]) {
  const [a, b] = await Promise.all([reference, replay]
    .map((campaign) => readFile(campaignPath(campaign, file))));
  // The manifest carries the campaign name by design; everything else must match byte for byte.
  const strip = (buffer) => buffer.toString("utf8").replace(/"campaign":"v\d+"/, '"campaign":"*"');
  if (strip(a) !== strip(b)) throw new Error(`${replay} deviates from ${reference} on ${file}`);
}

console.log(JSON.stringify({ contractOnlyDelta: true, reference, replay,
  documents: replayFreeze.documents.length, maxOutputTokens: replayFreeze.maxOutputTokens,
  unchanged: ["corpus", "oracle", "cap", "systemPrompt", "graphifyVersion", "meshVersion",
    "chunkIds", "pages"],
  moved: Object.fromEntries(mustMove.map((field) =>
    [field, [referenceFreeze[field], replayFreeze[field]]])),
  documentDeltas }, null, 2));
