// Offline JSON recovery measurement for v101b. It performs no provider/model request.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { arms } from "./v101-arms.mjs";
import { receiptAttemptOrder } from "./v101-runner-state.mjs";
import { normalizeExtraction, provenanceViolations } from "./v101-score-lib.mjs";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const root = required("BENCHMARK_REPOSITORY_ROOT");
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const t1Root = required("BENCHMARK_T1_ROOT");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
function stripFenceAndBom(value) {
  const trim = value.replace(/^﻿/u, "").trim();
  const fence = trim.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fence ? fence[1].trim() : trim;
}
function trailingCommas(value) {
  let out = ""; let quoted = false; let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (quoted) { out += c; if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; out += c; continue; }
    if (c === ",") { let j = i + 1; while (/\s/u.test(value[j] ?? "")) j += 1; if (value[j] === "}" || value[j] === "]") continue; }
    out += c;
  }
  return out;
}
function tolerantParse(raw) {
  const candidate = stripFenceAndBom(raw);
  try { return { parsed: JSON.parse(candidate), method: "strict-current" }; } catch {}
  const first = candidate.search(/[\[{]/u); const last = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (first < 0 || last < first) throw new SyntaxError("no JSON object/array envelope");
  return { parsed: JSON.parse(trailingCommas(candidate.slice(first, last + 1))), method: "tolerant-envelope-fence-bom-trailing-comma" };
}
const manifest = await json(resolve(root, "docs/reviews/refresh-benchmark/v101b/manifest.json"));
const docs = new Map(manifest.documents.map((d) => [d.id, d]));
const profilePath = resolve(t1Root, "api/src/services/graph/refresh-profile.ts");
const corpusPath = resolve(t1Root, "api/src/services/graph/refresh-corpus.ts");
const { validateExtraction, validateProfileExtraction } = await import("/workspace/node_modules/@sentropic/graphify/dist/index.js");
const { loadRefreshProfileContext } = await import(pathToFileURL(profilePath));
const context = loadRefreshProfileContext({ root: t1Root, profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });
async function inspect(parsed, document) {
  const extraction = structuredClone(parsed); const contract = normalizeExtraction(extraction, document);
  const base = validateExtraction(extraction);
  const profile = base.length === 0 ? validateProfileExtraction(extraction, { profile: context.profile, registryExtraction: context.registryExtraction }) : null;
  const pages = (await readFile(resolve(root, document.runtimeTextRelativePath), "utf8")).split("\f").filter((p, i, a) => !(i === a.length - 1 && p === ""));
  const provenance = profile?.valid ? provenanceViolations(extraction, document, pages) : [];
  return { accepted: !contract && base.length === 0 && Boolean(profile?.valid) && provenance.length === 0,
    contractViolation: contract?.code ?? null, extractionViolations: base.length, profileViolations: profile?.issues?.length ?? null, provenanceViolations: provenance.length };
}
const rows = []; const byArm = {};
for (const [armName, arm] of Object.entries(arms)) {
  const execution = arm.lane === "codex" ? resolve(resultRoot, "codex-replay") : resultRoot;
  const directory = resolve(execution, "campaign", armName); let names = [];
  try { names = await readdir(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const document of manifest.documents) {
    let receipt = null; let stem = null;
    for (const attempt of receiptAttemptOrder()) { const base = resolve(directory, `${document.id}--${armName}.attempt-${attempt}`); try { receipt = await json(`${base}.receipt.json`); stem = base; break; } catch (e) { if (e.code !== "ENOENT") throw e; } }
    if (!receipt || receipt.validation?.layers?.json?.valid === true || !receipt.artifacts?.raw) continue;
    const raw = await readFile(receipt.artifacts.raw.replace(/^\/results\b/u, resultRoot), "utf8");
    const row = { arm: armName, documentId: document.id, rawSha256: sha256(raw), strictValid: false, tolerantValid: false, acceptedAfterValidation: false, method: null, validation: null };
    try { JSON.parse(stripFenceAndBom(raw)); row.strictValid = true; } catch {}
    try { const recovered = tolerantParse(raw); row.tolerantValid = true; row.method = recovered.method; row.validation = await inspect(recovered.parsed, docs.get(document.id)); row.acceptedAfterValidation = row.validation.accepted; } catch (error) { row.error = String(error.message).slice(0, 180); }
    rows.push(row);
  }
  const own = rows.filter((r) => r.arm === armName); byArm[armName] = { jsonRefusals: own.length, validAfterTolerance: own.filter((r) => r.tolerantValid).length, acceptedAfterProfileAndProvenance: own.filter((r) => r.acceptedAfterValidation).length };
}
const result = { schemaVersion: 1, campaign: "v101b", measuredAt: new Date().toISOString(), networkRequests: 0, policy: "latest terminal receipt; strict current parser then offline fence/BOM/envelope/trailing-comma tolerance; v9 profile and provenance validation", totals: { jsonRefusals: rows.length, validAfterTolerance: rows.filter((r) => r.tolerantValid).length, acceptedAfterProfileAndProvenance: rows.filter((r) => r.acceptedAfterValidation).length }, byArm, rows };
const output = resolve(resultRoot, "replay-test/reparse-offline.json"); await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify({ output, totals: result.totals }));
