import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const original = readFileSync("/workspace/tools/make/base-api-pwc-review-inherited.mjs", "utf8");
const anchor = 'from "./base-api-pwc-review-legacy.mjs"';
assert.equal(original.split(anchor).length, 2);
const script = "/tmp/l5-inherited.mjs";
writeFileSync(script, original.replace(anchor, 'from "/workspace/tools/make/base-api-l5-legacy.mjs"'));
const result = spawnSync(process.execPath, [script], { stdio: "inherit", cwd: "/workspace/api" });
writeFileSync("/evidence/l5-inherited-harness.json", JSON.stringify({
  originalSha256: createHash("sha256").update(original).digest("hex"),
  legacySha256: createHash("sha256").update(readFileSync("/workspace/tools/make/base-api-l5-legacy.mjs")).digest("hex"),
  status: result.status, signal: result.signal,
}, null, 2));
if (result.error || result.signal || result.status !== 0) process.exitCode = 1;
