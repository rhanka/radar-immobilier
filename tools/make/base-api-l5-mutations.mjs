import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const path = "/workspace/tools/make/base-api-pwc-review-mutations.mjs";
const original = readFileSync(path, "utf8");
const anchor = 'from "./base-api-pwc-review-cases.mjs"';
if (original.split(anchor).length !== 2) throw new Error("Expected reviewed mutation engine import");
const materialized = original.replace(anchor, 'from "/workspace/tools/make/base-api-l5-cases.mjs"')
  .replaceAll("/evidence/pwcr", "/evidence/l5").replaceAll("PWCR_MUTATION_FILTER", "L5_MUTATION_FILTER");
const script = "/tmp/l5-mutations.mjs";
writeFileSync(script, materialized);
const result = spawnSync(process.execPath, [script], { stdio: "inherit", cwd: "/workspace/api" });
writeFileSync("/evidence/l5-mutation-harness.json", JSON.stringify({
  engineSha256: createHash("sha256").update(original).digest("hex"),
  casesSha256: createHash("sha256").update(readFileSync("/workspace/tools/make/base-api-l5-cases.mjs")).digest("hex"),
  status: result.status, signal: result.signal,
}, null, 2));
if (result.error || result.signal || result.status !== 0) process.exitCode = 1;
