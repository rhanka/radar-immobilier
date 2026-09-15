import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { probeMesh } from "./v101-mesh-ping.mjs";
import { writeOnce } from "./v101-probe-lib.mjs";

const resultRoot = process.env.BENCHMARK_RESULT_ROOT
  || (() => { throw new Error("BENCHMARK_RESULT_ROOT is required"); })();
const gate = process.argv[2];

async function sourceEvidence(root) {
  const matches = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!entry.name.endsWith(".js")) continue;
      const lines = (await readFile(path, "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (line.includes("max_output_tokens") || (line.includes("maxOutputTokens")
          && line.includes("max_output"))) matches.push({
          path: path.replace("/workspace/node_modules/@sentropic/llm-mesh/dist/", "dist/"),
          line: index + 1, excerpt: line.trim().slice(0, 300) });
      });
    }
  }
  await visit(root);
  return matches;
}

async function save(name, value) {
  const path = resolve(resultRoot, "gates", `${name}.json`);
  await writeOnce(path, { schemaVersion: 1, capturedAt: new Date().toISOString(), ...value,
    redaction: { allowlistedFieldsOnly: true, secretsIncluded: false } });
}

if (gate === "codex-cap") {
  const source = await sourceEvidence("/workspace/node_modules/@sentropic/llm-mesh/dist");
  const probe = await probeMesh({ transport: "codex", model: "gpt-5.6-sol", effort: "low",
    maxOutputTokens: 32, requestLimit: 1,
    promptText: "Write the word TOKEN exactly 200 times, separated by spaces." });
  const wireCap = probe.wire?.at(-1)?.maxOutputTokens ?? null;
  const outputTokens = probe.usage?.outputTokens ?? probe.usage?.output_tokens ?? null;
  const truncated = /length|max|incomplete/iu.test(String(probe.finishReason))
    || (Number.isFinite(outputTokens) && outputTokens >= 30);
  const proved = source.length > 0 && wireCap === 32 && probe.httpStatus === 200 && truncated;
  await save("codex-cap", { gate, llmMeshVersion: "0.19.2", sourceEvidence: source,
    requestCount: probe.requestCount, requestedMaxOutputTokens: 32, observedWireMaxOutputTokens: wireCap,
    httpStatus: probe.httpStatus, finishReason: probe.finishReason, outputTokens, truncated, proved });
  console.log(JSON.stringify({ gate, requestCount: probe.requestCount, wireCap, truncated, proved }));
  if (!proved) process.exitCode = 1;
} else if (gate === "gemini-efforts-v2") {
  for (const effort of ["medium", "high"]) {
    const probe = await probeMesh({ transport: "cloud-code", model: "gemini-3.8-flash", effort,
      maxOutputTokens: 512, requestLimit: 3, promptText: "Reply with PING_OK only." });
    const generationRequestCount = probe.wire.filter(({ endpoint }) =>
      endpoint.endsWith("streamGenerateContent")).length;
    await save(`gemini-${effort}-512-v2`, { gate, arm: `gemini-${effort}`,
      requested: { maxOutputTokens: 512, effort }, requestCount: probe.requestCount,
      generationRequestCount,
      httpStatus: probe.httpStatus, finishReason: probe.finishReason,
      outputSha256: probe.output ? (await import("node:crypto")).createHash("sha256")
        .update(probe.output).digest("hex") : null,
      pingExact: probe.output === "PING_OK", usage: probe.usage, wire: probe.wire,
      proved: generationRequestCount === 1 && probe.httpStatus === 200 && probe.output === "PING_OK" });
    console.log(JSON.stringify({ gate, effort, requestCount: probe.requestCount,
      pingExact: probe.output === "PING_OK" }));
    if (probe.httpStatus !== 200 || probe.output !== "PING_OK") process.exitCode = 1;
  }
} else if (gate === "judges") {
  const judges = [
    ["gpt-5.6-terra", { transport: "codex", model: "gpt-5.6-terra", effort: "medium" }],
    ["gpt-oss-120b-medium", { transport: "cloud-code", model: "gpt-oss-120b-medium", effort: null }],
  ];
  for (const [name, arm] of judges) {
    const probe = await probeMesh({ ...arm, maxOutputTokens: 512, requestLimit: 3,
      promptText: "Reply with PING_OK only." });
    const proved = probe.httpStatus === 200 && probe.output === "PING_OK";
    await save(`judge-${name}`, { gate, judge: name, requested: { maxOutputTokens: 512,
      effort: arm.effort }, requestCount: probe.requestCount, httpStatus: probe.httpStatus,
      finishReason: probe.finishReason, pingExact: probe.output === "PING_OK",
      usage: probe.usage, wire: probe.wire, proved });
    console.log(JSON.stringify({ gate, judge: name, requestCount: probe.requestCount, proved }));
    if (!proved) process.exitCode = 1;
  }
} else throw new Error(`Unknown v101 gate: ${gate ?? "N-A"}`);
