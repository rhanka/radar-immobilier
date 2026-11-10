// bench-v11: extract real usage + terminal text from `muse exec --json` JSONL.
// Usage: node extract-usage.mjs <jsonl> <outText> <outUsageJson>
import { readFile, writeFile } from "node:fs/promises";

const [jsonl, outText, outUsage] = process.argv.slice(2);
const lines = (await readFile(jsonl, "utf8")).split("\n").filter(Boolean);
let terminal = "";
let usage = null;
for (const line of lines) {
  try {
    const o = JSON.parse(line);
    if (o.payload_type === "run.terminal.completed") terminal = o.payload?.text ?? "";
    if (o.payload_type === "run.usage") usage = o.payload ?? null;
  } catch { /* ignore malformed lines */ }
}
await writeFile(outText, terminal, "utf8");
const model = usage?.models?.[0] ?? null;
await writeFile(outUsage, `${JSON.stringify({
  calls: usage?.calls ?? null,
  model: model?.model ?? null,
  inputTokens: model?.input_tokens ?? null,
  outputTokens: model?.output_tokens ?? null,
  reasoningTokens: model?.reasoning_tokens ?? null,
  cachedTokens: model?.cached_tokens ?? null,
  allowance: usage?.allowance ?? null,
  terminalChars: terminal.length,
}, null, 1)}\n`, "utf8");
console.log(JSON.stringify({ terminalChars: terminal.length,
  inputTokens: model?.input_tokens ?? null,
  outputTokens: model?.output_tokens ?? null,
  weeklyUsedPercent: usage?.allowance?.weekly?.used_percent ?? null }));
