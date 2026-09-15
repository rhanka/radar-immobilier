import { laneArms } from "./v101-arms.mjs";
import { runArm } from "./run-arm.mjs";
import { scoreArm } from "./score-v101.mjs";

const lane = process.argv[2];
const names = laneArms[lane];
if (!names) throw new Error(`Unknown v101 lane: ${lane ?? "N-A"}`);
let codexFirstTwentyClear = lane === "codex";
let codexObserved = 0;
for (let block = 0; block < 5; block += 1) {
  const from = block * 20 + 1; const to = from + 19;
  const offset = block % names.length;
  const rotated = [...names.slice(offset), ...names.slice(0, offset)];
  for (const name of rotated) {
    const concurrency = lane === "codex" && codexFirstTwentyClear ? 2 : 1;
    const result = await runArm(name, { slice: `${from}-${to}`, concurrency });
    if (lane === "codex" && codexObserved < 20) {
      codexObserved += result.requests;
      if (result.rateLimited) codexFirstTwentyClear = false;
    }
  }
}
for (const name of names) await scoreArm(name);
console.log(JSON.stringify({ campaign: "v101", lane, arms: names.length,
  codexConcurrency: lane === "codex" && codexFirstTwentyClear ? 2 : 1, state: "completed" }));
