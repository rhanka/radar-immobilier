// Proves that one campaign is an exact replay of another: same contract snapshot, same corpus,
// same oracle, same cap, and the same frozen schema and prompt hash for every document. Anything
// that differs would make a variance reading meaningless, so this fails instead of warning.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const reference = required("BENCHMARK_REPLAY_REFERENCE");
const replay = required("BENCHMARK_REPLAY_CAMPAIGN");
const campaignPath = (campaign, file) =>
  resolve(repositoryRoot, `docs/reviews/refresh-benchmark/${campaign}/${file}`);

const freezes = await Promise.all([reference, replay].map(async (campaign) =>
  JSON.parse(await readFile(campaignPath(campaign, "prompt-freeze.json"), "utf8"))));
const [referenceFreeze, replayFreeze] = freezes;
const invariants = ["maxOutputTokens", "systemPromptSha256", "profileModuleSha256",
  "corpusModuleSha256", "t1Commit", "graphifyVersion", "meshVersion"];
for (const field of invariants) {
  if (JSON.stringify(referenceFreeze[field]) !== JSON.stringify(replayFreeze[field])) {
    throw new Error(`${replay} deviates from ${reference} on ${field}`);
  }
}
if (JSON.stringify(referenceFreeze.documents) !== JSON.stringify(replayFreeze.documents)) {
  throw new Error(`${replay} deviates from ${reference} on a document freeze`);
}
for (const file of ["manual-oracle.json", "manifest.json"]) {
  const [a, b] = await Promise.all([reference, replay]
    .map((campaign) => readFile(campaignPath(campaign, file))));
  // The manifest carries the campaign name by design; everything else must match byte for byte.
  const strip = (buffer) => buffer.toString("utf8").replace(/"campaign":"v\d+"/, '"campaign":"*"');
  if (strip(a) !== strip(b)) throw new Error(`${replay} deviates from ${reference} on ${file}`);
}
console.log(JSON.stringify({ exactReplay: true, reference, replay,
  documents: referenceFreeze.documents.length, maxOutputTokens: referenceFreeze.maxOutputTokens,
  t1Commit: referenceFreeze.t1Commit, profileModuleSha256: referenceFreeze.profileModuleSha256 }));
