import { laneArms } from "./v101-arms.mjs";
import { runArm } from "./run-arm.mjs";
import { scoreArm } from "./score-v101.mjs";
import { advanceCircuit, laneCircuitAction } from "./v101-runner-state.mjs";

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const lane = process.argv[2];
const campaign = process.env.BENCHMARK_CAMPAIGN ?? "v101";
const names = laneArms[lane];
if (!names) throw new Error(`Unknown ${campaign} lane: ${lane ?? "N-A"}`);
let codexFirstTwentyClear = lane === "codex";
let codexObserved = 0;
let providerCircuit = advanceCircuit(undefined, null, 2);
let providerStopped = false;
campaign: for (let block = 0; block < 5; block += 1) {
  const from = block * 20 + 1; const to = from + 19;
  const offset = block % names.length;
  const rotated = [...names.slice(offset), ...names.slice(0, offset)];
  const pending = rotated.map((name) => ({ name, readyAt: 0 }));
  while (pending.length > 0) {
    const now = Date.now();
    const readyIndex = pending.findIndex(({ readyAt }) => readyAt <= now);
    if (readyIndex === -1) {
      await wait(Math.max(0, Math.min(...pending.map(({ readyAt }) => readyAt)) - now));
      continue;
    }
    const [{ name }] = pending.splice(readyIndex, 1);
    const concurrency = lane === "codex" && codexFirstTwentyClear ? 2 : 1;
    const result = await runArm(name, { slice: `${from}-${to}`, concurrency });
    if (result.deferred) {
      pending.push({ name, readyAt: Date.parse(result.resumeAt) });
      continue;
    }
    providerCircuit = advanceCircuit(providerCircuit,
      result.circuitOpen ? "arm-circuit-open" : null, 2);
    if (laneCircuitAction(lane, providerCircuit) === "stop-lane") {
      providerStopped = true; break campaign;
    }
    if (providerCircuit.open) providerCircuit = advanceCircuit(undefined, null, 2);
    if (lane === "codex" && codexObserved < 20) {
      codexObserved += result.requests;
      if (result.rateLimited) codexFirstTwentyClear = false;
    }
  }
}
if (!providerStopped) for (const name of names) await scoreArm(name);
console.log(JSON.stringify({ campaign, lane, arms: names.length,
  codexConcurrency: lane === "codex" && codexFirstTwentyClear ? 2 : 1,
  state: providerStopped ? "provider-circuit-open" : "completed" }));
if (providerStopped) process.exitCode = 2;
