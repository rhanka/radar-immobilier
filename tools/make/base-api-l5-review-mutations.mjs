import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cases } from "./base-api-l5-review-cases.mjs";
const original = readFileSync("/workspace/tools/make/base-api-pwc-review-mutations.mjs", "utf8");
const anchor = 'from "./base-api-pwc-review-cases.mjs"';
assert.equal(original.split(anchor).length, 2);
const script = "/tmp/l5-review-mutations.mjs";
writeFileSync(script, original.replace(anchor, 'from "/workspace/tools/make/base-api-l5-review-cases.mjs"'));
const result = spawnSync(process.execPath, [script], { stdio: "inherit", cwd: "/workspace/api" });
writeFileSync("/evidence/l5-review-harness.json", JSON.stringify({
  engineSha256: createHash("sha256").update(original).digest("hex"),
  casesSha256: createHash("sha256").update(readFileSync("/workspace/tools/make/base-api-l5-review-cases.mjs")).digest("hex"),
  adjustment: "A6 disables the composed document fallback without shadowing real L3 release files",
  caseNames: cases.map(([name]) => name), status: result.status, signal: result.signal,
}, null, 2));
if (result.error || result.signal || result.status !== 0) process.exitCode = 1;
