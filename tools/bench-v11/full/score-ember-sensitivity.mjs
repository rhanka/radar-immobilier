// bench-v11: sensitivity of a Muse Ember arm when given documents are
// treated as refused (accepted output ignored, oracle units counted as
// missed), same scoreSource path as score-ember.mjs. The published score is
// not changed; this only reports the alternative for the owner to decide.
// Usage: node full/score-ember-sensitivity.mjs <effort> <docId> [docId...]
//   -> full/scores-ember-<effort>-sensitivity.json
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const [effort, ...excluded] = process.argv.slice(2);
if (!["xhigh", "max"].includes(effort) || !excluded.length) throw new Error("usage: score-ember-sensitivity.mjs <xhigh|max> <docId>...");
const { scoreSource } = await import(`${DIR}/full/score-676.mjs`);
const armDir = `${DIR}/full/arms/muse-ember-${effort}`;
const resolveDoc = async (documentId) => {
  const out = `${armDir}/validated/${effort}--${documentId}.output.json`;
  if (excluded.includes(documentId) || !existsSync(out)) return { state: "refused_or_missing" };
  return { state: "accepted", output: JSON.parse(await readFile(out, "utf8")) };
};
const s = await scoreSource(`muse-ember-${effort}-excl`, "muse-ember-seat", resolveDoc);
const row = { effort, excludedAsRefused: excluded, accepted: s.accepted, strict: s.net };
await writeFile(`${DIR}/full/scores-ember-${effort}-sensitivity.json`, JSON.stringify(row, null, 1));
console.log(JSON.stringify(row));
