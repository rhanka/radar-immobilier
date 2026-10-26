// Mutate disposable container sources only. Each leg proves green/red/green.
import { readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = "/workspace/api/src/services/facets/";
const admission = "signal-write-admission.ts";
const tests = [
  { name: "authority", suite: "locks", test: "should recheck moderation",
    changes: [[admission, '!isPersonalOperation(input.operation) && !access.moderateArchive', "false"],
      ["workspace-writer.ts", "if (!access.moderateArchive)", "if (false)"]] },
  { name: "expiry", suite: "atomic", test: "on final expiration",
    changes: [[admission, "assertAdmissionWindow(now, input.expiresAtMs);", "/* final expiry bypass */"]] },
  { name: "snapshot", suite: "locks", test: "after waiting for a city source refresh",
    changes: [[admission, "await lockCityGraph(tx, input.target.citySlug);", "/* late writer lock only */"]] },
  { name: "replay", suite: "qualification", test: "refuse confirmation replay",
    changes: [[admission, "operationDigest: signalWriteOperationDigest(input) });", "operationDigest: signalWriteOperationDigest(input) }).catch(() => undefined);"],
      [admission, 'if (receipt || context) throw new FacetError(409, "command_context_unresolved");',
        'if (receipt) return { event: projectSignalWriteEvent((receipt.result as {event: unknown}).event), scopeBefore: "", scopeAfter: "" }; void context;']] },
  { name: "digest", suite: "qualification", test: "refuse confirmation replay",
    changes: [["signal-write-operations.ts", "expectedProjectionToken: input.expectedProjectionToken,", 'expectedProjectionToken: "omitted",']] },
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const results = [];
function run(leg, phase, failed) {
  const output = `/evidence/mutation-${leg.name}-${phase}`;
  const fd = openSync(`${output}.log`, "w");
  let result;
  try {
    result = spawnSync("../node_modules/.bin/vitest", ["run", "--config", "vitest.isolated.config.ts",
      `src/services/facets/signal-write-${leg.suite}-db.test.ts`, "-t", leg.test,
      "--reporter=default", "--reporter=json", `--outputFile.json=${output}.json`],
    { cwd: "/workspace/api", stdio: ["ignore", fd, fd], timeout: 60_000 });
  } finally { closeSync(fd); }
  if (result.error || result.status !== (failed ? 1 : 0)) throw new Error(`Unexpected exit: ${leg.name}/${phase}`);
  const report = JSON.parse(readFileSync(`${output}.json`, "utf8"));
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
  const executed = assertions.filter((test) => ["passed", "failed"].includes(test.status));
  if (executed.length !== 1 || executed[0].status !== (failed ? "failed" : "passed")) {
    throw new Error(`Mutation did not execute exactly one assertion group: ${leg.name}/${phase}`);
  }
  if (failed && !readFileSync(`${output}.log`, "utf8").includes("AssertionError")) {
    throw new Error(`Failure was not an assertion: ${leg.name}`);
  }
}
for (const leg of tests) {
  const originals = new Map(leg.changes.map(([file]) => [file, readFileSync(root + file)]));
  run(leg, "baseline", false);
  try {
    for (const [file, before, after] of leg.changes) {
      const source = readFileSync(root + file, "utf8");
      if (source.split(before).length !== 2) throw new Error(`Ambiguous mutation anchor: ${file}`);
      writeFileSync(root + file, source.replace(before, after));
      writeFileSync(`/evidence/mutation-${leg.name}-${file}`, readFileSync(root + file));
    }
    run(leg, "mutated", true);
  } finally {
    for (const [file, bytes] of originals) writeFileSync(root + file, bytes);
  }
  run(leg, "restored", false);
  const identities = [...originals].map(([file, bytes]) => {
    const digest = hash(bytes);
    if (hash(readFileSync(root + file)) !== digest) throw new Error(`Source not restored: ${file}`);
    return { file, sha256: digest };
  });
  results.push({ name: leg.name, baseline: "passed", mutated: "assertion_failed", restored: "passed", identities });
  writeFileSync("/evidence/mutations.json", JSON.stringify(results, null, 2));
  process.stdout.write(`MUTATION ${leg.name}: baseline PASS, mutation KILLED, restored PASS\n`);
}
