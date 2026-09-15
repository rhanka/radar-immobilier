import { resolve } from "node:path";

import { CODEX_CAP_REASON, laneArms, OUTPUT_CAP } from "./v101-arms.mjs";
import { updateCampaignStatus } from "./v101-runner-state.mjs";

const root = process.env.BENCHMARK_RESULT_ROOT
  || (() => { throw new Error("BENCHMARK_RESULT_ROOT is required"); })();
const names = laneArms.codex;
const status = await updateCampaignStatus(resolve(root, "status.json"), (current) => {
  current.codexIncluded = true;
  current.files = { ...current.files, codex: names.length };
  current.codexCapException = { requested: OUTPUT_CAP, enforced: false,
    reason: CODEX_CAP_REASON };
  for (const name of names) current.arms[name] ??= { state: "queued", total: 100,
    processed: 0, accepted: 0, errors: 0, lastReceipt: null, requests: 0, etaSeconds: null };
  return current;
});
console.log(JSON.stringify({ codexIncluded: status.codexIncluded,
  arms: names.length, cap: status.codexCapException }));
