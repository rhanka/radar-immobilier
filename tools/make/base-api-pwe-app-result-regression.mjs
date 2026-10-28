import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const source = "/workspace/api/src/artifacts/write-intent-app-route.ts";
const original = readFileSync(source);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const current = original.toString();
const anchor = "...(path === api ? result : {})";
const fragment = readFileSync("/workspace/tools/make/base-api-pwe-before-app-result.txt", "utf8").trim();
assert.equal(current.split(anchor).length, 2, "Projection GET unique");
assert.equal(fragment, "...(path === api ? { ...result, receipt: undefined } : {})");
const before = Buffer.from(current.replace(anchor, fragment));
const post = '  for (const action of ["confirm", "revoke"] as const)';
assert.equal(current.split(post).length, 2, "Section POST unique");
assert.equal(before.toString().split(post)[1], current.split(post)[1], "POST courant conservé octet pour octet");
assert.notEqual(sha(original), sha(before), "Le témoin doit supprimer uniquement la projection GET");
function run(phase, failed) {
  const prefix = `/evidence/app-result-${phase}`;
  const result = spawnSync("../node_modules/.bin/vitest", ["run", "--config", "vitest.isolated.config.ts",
    "tests/integration/pwe-app-receipt.spec.ts", "--reporter=json", `--outputFile.json=${prefix}.json`],
  { cwd: "/workspace/api", encoding: "utf8", timeout: 60_000 });
  writeFileSync(`${prefix}.log`, (result.stdout ?? "") + (result.stderr ?? ""));
  assert.ifError(result.error); assert.equal(result.signal, null);
  assert.equal(result.status, failed ? 1 : 0);
  const report = JSON.parse(readFileSync(`${prefix}.json`, "utf8"));
  const cases = report.testResults.flatMap((suite) => suite.assertionResults ?? []);
  assert.equal(cases.length, 5); assert.equal(report.numPendingTests, 0);
  assert.ok(cases.every((test) => test.status === (failed ? "failed" : "passed")));
  if (failed) assert.ok(cases.every((test) => test.failureMessages.some((message) =>
    /AssertionError/.test(message) && message.includes("PW_E_APP_RECEIPT"))), "Cinq assertions de reçu absent exigées");
  else assert.equal(report.success, true);
  return cases.map(({ fullName, status, failureMessages }) => ({ fullName, status,
    ...(failed ? { failureMessages } : {}) }));
}
let negative;
try { writeFileSync(source, before); negative = run("before", true); }
finally { writeFileSync(source, original); }
const positive = run("after", false);
assert.equal(sha(readFileSync(source)), sha(original));
writeFileSync("/evidence/app-result-regression.json", JSON.stringify({
  mutation: "Retirer seulement la restitution du reçu au GET",
  postBytesUnchanged: true, beforeSha256: sha(before), restoredSha256: sha(original), negative, positive,
}, null, 2));
console.log("Témoin GET : cinq échecs fonctionnels attendus, cinq succès après restauration ; POST inchangé");
