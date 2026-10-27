import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const mutations = [
  ["gcm-tag-truncation", "preview-aead.ts", ", { authTagLength: 16 }", "", "preview-aead.test.ts"],
  ["ticket-single-use", "preview-tickets.ts", "live.delete(ticket);", "void ticket;", "preview-security.test.ts"],
  ["grant-binding", "preview-grant.ts", "const want = expected[field];", "const want = undefined;", "preview-grant.test.ts"],
  ["publisher-substitution", "reader-test-fixture.ts", "reader: context.readerSub", 'reader: "publisher"', "content-serve.test.ts"],
  ["content-url", "reader-operations.ts", /\.strict\(\)/g, ".passthrough()", "reader-security.test.ts"],
  ["renewal-approval", "preview-renewal.ts", /!(freshRights|rights) \|\| !\1.approved \|\| \1.readerSub !== verified.readerSub/g, "!$1", "preview-security.test.ts"],
  ["old-tab-release", "reader-context.ts", "if (!release || release.artifactId !== grant.artifactId || release.releaseId !== grant.releaseId) return null;", "void release;", "reader-context.test.ts"],
  ["service-worker-fallback", "content-serve.ts", 'c.req.header("service-worker") || ', "", "reader-security.test.ts"],
  ["a1-artifact-pair", "reader-context.ts", "authority.getRights(grant.readerSub, grant.artifactId)", "authority.getRights(grant.readerSub, undefined)", "reader-context.test.ts"],
  ["a1-returned-artifact", "reader-context.ts", "if (rights.artifactId !== grant.artifactId) return null;", "", "reader-context.test.ts"],
  ["a2-b4-ticket-profile", "preview-tickets.ts", /ticket.policyRevision === profile.policyRevision[\s\S]*?fingerprintReaderProfile\(profile\)/, "true", "preview-tickets.test.ts"],
  ["a2-b4-exchange-profile", "preview-exchange.ts", / {4}if \(profile.policyRevision[\s\S]*?ticket.profileFingerprint\) return null;\n/, "", "preview-exchange.test.ts"],
  ["a3-b3-page-capability", "preview-renewal.ts", "if (rights.artifactId !== verified.artifactId) return null;", 'if (!rights.capabilities.includes("geo.read") && !rights.capabilities.includes("signals.protected-read")) return null;', "preview-renewal.test.ts"],
  ["b1-stale-activation", "release-activation.ts", / {6}\/\/ Revalidate:[\s\S]*? {6}active.set\(artifactId, record\);/, "const record = { artifactId, releaseId, profileName: profile.name, policyRevision: profile.policyRevision, activatedAt: now() }; active.set(artifactId, record);", "release-activation.test.ts"],
  ["b2-renewal-freshness", "preview-renewal.ts", / {2}const freshRights =[\s\S]*? {2}const issuedAt = now\(\);/, "  const issuedAt = now();", "preview-renewal-waits.test.ts"],
  ["b2-final-read-version", "preview-renewal.ts", "if (await deps.authority.getAuthorizationVersion(verified.artifactId) !== version) return null;", "", "preview-authority-races.test.ts"],
  ["a2-exchange-wait-version", "preview-exchange.ts", "if (await authority.getAuthorizationVersion(ticket.artifactId) !== version) return null;", "", "preview-authority-races.test.ts"],
  ["b1-final-activation-fences", "release-activation.ts", / {6}if \(await authority.getAuthorizationVersion\(artifactId\) !== version\) return null;\n {6}if \(active.get\(artifactId\) !== previous\) return null;/, "", "preview-authority-races.test.ts"],
  ["b5-profile-intersection", "reader-profile.ts", "profile.capabilities.filter((c) => rights.capabilities.includes(c))", "[...rights.capabilities]", "reader-context.test.ts"],
  ["b5-rights-intersection", "reader-profile.ts", "profile.capabilities.filter((c) => rights.capabilities.includes(c))", "[...profile.capabilities]", "reader-context.test.ts"],
  ["b5-operation-guard", "reader-context.ts", "context.releaseId === releaseId && context.capabilities.includes(capability)", "true", "content-serve.test.ts"],
  ["r2-grant-fingerprint-required", "preview-grant.ts", '"policyRevision", "profileFingerprint"] as const', '"policyRevision"] as const', "preview-grant.test.ts"],
  ["r2-adaptation-fingerprint", "reader-context.ts", "if (fingerprintReaderProfile(profile) !== grant.profileFingerprint) return null;", "", "content-serve.test.ts"],
  ["r2-renewal-fingerprint", "preview-renewal.ts", / {2}if \(fingerprintReaderProfile\((?:freshProfile|profile)\) !== verified.profileFingerprint\) return null;\n/g, "", "preview-renewal.test.ts"],
  ["r2-renewal-preservation", "preview-renewal.ts", "{ ...deps.issuer, ...verified }", '{ ...deps.issuer, ...verified, profileFingerprint: "" }', "preview-renewal.test.ts"],
  ["r2-adaptation-version", "reader-context.ts", "if (await authority.getAuthorizationVersion(grant.artifactId) !== version) return null;", "", "reader-context.test.ts"],
  ["r2-content-version", "content-serve.ts", "if (await deps.authority.getAuthorizationVersion(claims.artifactId) !== version) return null;", "", "content-authority-races.test.ts"],
  ["r2-geo-before-call", "content-serve.ts", / {6}if \(!await authorityCurrent\(auth\)\) return c.json\(\{ error: "unauthenticated" \}, 401\);\n {6}try/, "      try", "content-authority-races.test.ts"],
  ["r2-signals-before-call", "content-serve.ts", / {4}if \(!await authorityCurrent\(auth\)\) return c.json\(\{ error: "unauthenticated" \}, 401\);\n {4}try/, "    try", "content-authority-races.test.ts"],
  ["r2-geo-before-response", "content-serve.ts", / {8}if \(!await authorityCurrent\(auth\)\) return c.json\(\{ error: "unauthenticated" \}, 401\);\n {8}return c.json\(body\);/, "        return c.json(body);", "content-authority-races.test.ts"],
  ["r2-signals-before-response", "content-serve.ts", / {6}if \(!await authorityCurrent\(auth\)\) return c.json\(\{ error: "unauthenticated" \}, 401\);\n {6}return c.json\(body\);/, "      return c.json(body);", "content-authority-races.test.ts"],
  ["r2-version-wait-cutoff", "content-serve.ts", " === reader.authorityVersion && stillOpen(reader)", " === reader.authorityVersion", "content-authority-races.test.ts"],
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const base = mkdtempSync("/h5-mutations-");
const receipts = [];
const sourceHashes = new Map(mutations.map(([, file]) => {
  const source = `api/src/artifacts/${file}`;
  return [source, hash(readFileSync(source))];
}));
try {
  for (const [name, file, search, replacement, spec] of mutations) {
    const root = path.join(base, name);
    mkdirSync(path.join(root, "api/src"), { recursive: true });
    cpSync("api/src/artifacts", path.join(root, "api/src/artifacts"), { recursive: true });
    for (const source of ["package.json", "tsconfig.base.json", "api/package.json", "api/tsconfig.json", "api/vitest.config.ts"]) {
      cpSync(source, path.join(root, source));
    }
    symlinkSync("/workspace/node_modules", path.join(root, "node_modules"));
    const target = path.join(root, "api/src/artifacts", file);
    const bytes = readFileSync(target);
    const original = bytes.toString();
    const changed = original.replace(search, replacement);
    assert.notEqual(changed, original, `mutation ${name} must apply`);
    function run(phase) {
      const report = path.join(root, `${phase}.json`);
      const result = spawnSync(process.execPath, ["/workspace/node_modules/vitest/vitest.mjs", "run",
        `src/artifacts/${spec}`, "--reporter=json", `--outputFile=${report}`],
      { cwd: path.join(root, "api"), encoding: "utf8", timeout: 60_000 });
      assert(!result.error, result.error?.message);
      if (result.status !== 0 && phase !== "mutant") process.stderr.write(result.stdout + result.stderr);
      const data = JSON.parse(readFileSync(report, "utf8"));
      if (result.status !== 0 && phase !== "mutant") console.error(JSON.stringify(data));
      return { exit: result.status, passed: data.numPassedTests, failed: data.numFailedTests,
        pending: data.numPendingTests, cases: data.testResults.flatMap(suite => suite.assertionResults)
          .map(test => ({ name: test.fullName, status: test.status })) };
    }
    const before = run("before");
    assert.equal(before.exit, 0, `${name} passing control`);
    assert(before.passed > 0 && before.pending === 0);
    writeFileSync(target, changed);
    const mutant = run("mutant");
    assert.notEqual(mutant.exit, 0, `${name} must fail`);
    assert(mutant.failed > 0, `${name} must fail a behavioral assertion`);
    writeFileSync(target, bytes);
    assert.equal(hash(readFileSync(target)), hash(bytes), `${name} byte restoration`);
    const after = run("after");
    assert.equal(after.exit, 0, `${name} restored control`);
    assert(after.passed > 0 && after.pending === 0);
    receipts.push({ name, before, mutant, after, restoredSha256: hash(bytes) });
    console.log(JSON.stringify(receipts.at(-1)));
  }
  for (const [source, before] of sourceHashes) assert.equal(hash(readFileSync(source)), before, "source unchanged");
  console.log(JSON.stringify({ scope: "module tests only", killed: receipts.length, requiredStreamMutation: "unverified: no stream implementation" }));
} finally {
  rmSync(base, { recursive: true, force: true });
}
