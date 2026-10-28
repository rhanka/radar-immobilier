import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { collectFindings, evaluateAudit } from "./audit-lib.mjs";
/* global structuredClone */

// Anonymized npm 11 audit: plugin <-> inspector, plugin -> merge advisory.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/npm-audit-peer-cycle.json", import.meta.url)));
const run = (audit) => evaluateAudit({ audit, now: "2026-10-27" });

test("should resolve a peer cycle to its advisory regardless of traversal order", () => {
  const reversed = structuredClone(fixture);
  reversed.vulnerabilities = Object.fromEntries(Object.entries(reversed.vulnerabilities).reverse());
  for (const entry of Object.values(reversed.vulnerabilities)) entry.via.reverse();
  for (const audit of [fixture, reversed]) {
    const findings = collectFindings(audit);
    assert.equal(findings.length, 3);
    assert.deepEqual(findings.map((f) => f.package).sort(), Object.keys(audit.vulnerabilities).sort());
    assert.ok(findings.every((f) => f.advisory === "GHSA-AAAA-BBBB-CCCC" && f.severity === "low" &&
      f.path === `node_modules/${f.package}`));
    const result = run(audit);
    assert.equal(result.error, null);
    assert.equal(result.ok, true);
    assert.deepEqual([result.blocking, result.tolerated], [0, 3]);
  }
});

test("should keep high and critical advisories blocking through a peer cycle", () => {
  for (const severity of ["high", "critical"]) {
    const audit = structuredClone(fixture);
    for (const entry of Object.values(audit.vulnerabilities)) entry.severity = severity;
    audit.vulnerabilities["merge-helper"].via[0].severity = severity;
    const result = run(audit);
    assert.equal(result.error, null);
    assert.equal(result.ok, false);
    assert.deepEqual([result.blocking, result.uncovered.length, result.tolerated], [3, 3, 0]);
  }
});

test("should fail closed on malformed entries reachable through a peer cycle", () => {
  for (const patch of [{ via: ["missing"] }, { via: [] }, { nodes: [] }, { nodes: [null] },
    { severity: "unknown" }, { via: [{ url: "invalid" }] }, { via: ["@example/build-inspector"] }]) {
    const audit = structuredClone(fixture);
    Object.assign(audit.vulnerabilities["@example/build-inspector"], patch);
    const result = run(audit);
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.ok(result.error, JSON.stringify(patch));
  }
  const noAdvisory = structuredClone(fixture);
  noAdvisory.vulnerabilities["merge-helper"].via = ["@example/build-plugin"];
  assert.equal(run(noAdvisory).ok, false);
  assert.match(run(noAdvisory).error, /dependency chain has no advisory/);
});
