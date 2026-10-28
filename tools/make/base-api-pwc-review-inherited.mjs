import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { materializeInherited } from "./base-api-pwc-review-legacy.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const protectedFile = "/workspace/api/src/artifacts/write-intent-transaction.ts";
const original = readFileSync(protectedFile);
const receipts = [];
let failed = false;
const filter = new RegExp(process.env.PWCR_INHERITED_BATCH_FILTER ?? ".*");
const batches = ["pwa", "pwb", "pwd", "pwc"].filter((batch) => filter.test(batch));
if (!batches.length) throw new Error("No inherited batch selected");
for (const batch of batches) {
  const directory = `/evidence/${batch}-mutants`;
  mkdirSync(directory, { recursive: true });
  const source = `/workspace/tools/make/base-api-${batch}-mutations.mjs`;
  const bytes = readFileSync(source);
  const materialized = materializeInherited(batch, bytes.toString());
  const isolated = `/tmp/pwe-inherited-${batch}.mjs`;
  writeFileSync(isolated, materialized.source.replaceAll("/evidence/", `${directory}/`));
  const result = spawnSync(process.execPath, [isolated], { cwd: "/workspace/api", encoding: "utf8", timeout: 900_000 });
  writeFileSync(`${directory}/campaign.log`, (result.stdout ?? "") + (result.stderr ?? ""));
  const restored = sha(readFileSync(protectedFile)) === sha(original);
  receipts.push({ batch, scriptSha256: sha(bytes), materializedSha256: sha(materialized.source),
    adjustments: materialized.changes, status: result.status,
    signal: result.signal, error: result.error?.message ?? null, protectedBytesRestored: restored });
  writeFileSync("/evidence/inherited-mutants.json", JSON.stringify(receipts, null, 2));
  console.log(`Inherited ${batch}: exit ${result.status}; protected bytes restored=${restored}`);
  if (!restored) { writeFileSync(protectedFile, original); throw new Error("Protected source restoration failed"); }
  if (result.status !== 0 || result.error || result.signal) failed = true;
}
if (failed) process.exitCode = 1;
