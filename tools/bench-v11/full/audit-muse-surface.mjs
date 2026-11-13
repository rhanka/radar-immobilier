// bench-v11: audit the Muse CLI access surface of a `--json` arm.
// Usage: node full/audit-muse-surface.mjs <armDir> [effort]
//   -> <armDir>/surface.json (per-document tool calls, model responses,
//      reminder tasks, skills line from stderr) + summary on stdout.
// Reads only the captured JSONL/stderr; no model call.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const armDir = process.argv[2];
if (!armDir) throw new Error("usage: audit-muse-surface.mjs <armDir>");
const dir = existsSync(`${armDir}/jsonl/attempts`) ? `${armDir}/jsonl/attempts` : `${armDir}/jsonl`;
const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort();
const docs = [];
for (const f of files) {
  const stem = f.replace(/\.jsonl$/, "").replace(/\.\d{13}$/, "");
  const doc = stem.includes("--") ? stem.split("--").slice(1).join("--") : stem;
  const lines = (await readFile(`${dir}/${f}`, "utf8")).split("\n").filter(Boolean);
  const taskKinds = {};
  const tools = [];
  let userTurns = 0;
  for (const line of lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.payload_type === "task.lifecycle.proposed") {
      const k = o.payload?.event?.task_kind ?? "unknown";
      taskKinds[k] = (taskKinds[k] ?? 0) + 1;
    }
    if (o.payload_type === "turn.input.user") userTurns += 1;
    if (o.payload_type === "tool.result") {
      const text = String(o.payload?.text ?? "");
      const cmd = (() => { try { return JSON.parse(text).command ?? null; } catch { return null; } })();
      tools.push({ tool: o.payload?.correlation_facts?.tool_name ?? "unknown",
        outcome: o.payload?.correlation_facts?.outcome ?? null,
        paths: [...new Set((cmd ?? text).match(/\/tmp\/[A-Za-z0-9._-]+/g) ?? [])],
        commandHead: cmd ? cmd.split("\n")[0].slice(0, 120) : null });
    }
  }
  let skillsLine = null;
  try {
    const err = await readFile(`${dir}/${f}.stderr`, "utf8");
    skillsLine = err.split("\n").find((l) => /Skills: \d+ loaded/.test(l))?.replace(/^muse:\s*/, "") ?? null;
  } catch { /* no stderr */ }
  const modelResponses = taskKinds["model.meta.response"] ?? 0;
  const reminders = Object.fromEntries(Object.entries(taskKinds).filter(([k]) => k.startsWith("reminder.")));
  const toolTasks = Object.fromEntries(Object.entries(taskKinds).filter(([k]) => k.startsWith("tool.")));
  docs.push({ doc, userTurns, modelResponses, toolTasks, tools, reminders, skillsLine,
    extraTurn: modelResponses > 1 });
}
const summary = {
  arm: armDir.split("/").pop(), docs: docs.length,
  docsWithToolCalls: docs.filter((d) => d.tools.length || Object.keys(d.toolTasks).length).map((d) => ({ doc: d.doc, toolTasks: d.toolTasks, tools: d.tools })),
  docsWithMoreThanOneModelResponse: docs.filter((d) => d.extraTurn).map((d) => ({ doc: d.doc, modelResponses: d.modelResponses, tools: d.tools.length, reminders: d.reminders })),
  modelResponsesHistogram: docs.reduce((h, d) => { h[d.modelResponses] = (h[d.modelResponses] ?? 0) + 1; return h; }, {}),
  skillsLines: [...new Set(docs.map((d) => d.skillsLine))],
};
await writeFile(`${armDir}/surface.json`, JSON.stringify({ summary, docs }, null, 1));
console.log(JSON.stringify(summary, null, 1));
