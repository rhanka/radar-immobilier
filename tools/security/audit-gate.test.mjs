import { test } from "node:test";
import assert from "node:assert/strict";
import { collectFindings, evaluateAudit, parseRegister } from "./audit-lib.mjs";

const NOW = "2026-10-25";
const ADVISORY = "GHSA-mrhx-c7xc-m3w5";
const URL = `https://github.com/advisories/${ADVISORY}`;

const packages = {
  "node_modules/zod": { version: "3.25.76" },
  "node_modules/ollama-ai-provider": { version: "1.2.0" },
  "node_modules/fast-uri": { version: "3.1.0" },
};
const entry = (name, path, severity, url = URL) => ({ name, severity, via: [{ url }], nodes: [path] });
const auditOf = (entries) => ({ vulnerabilities: Object.fromEntries(entries.map((e) => [e.name, e])) });
const row = (over = {}) => ({
  id: "EXC-2026-10-25-zod", advisory: ADVISORY, identifier: "zod", version: "3.25.76",
  embedded_path: "node_modules/zod", status: "accepted", accepted_by: "repository owner",
  component: "root npm workspace", owner: "repository owner", scanner: "npm-audit", scanner_input: "package-lock.json",
  finding_kind: "direct-advisory", severity: "high", severity_source: "GitHub advisory",
  rationale: "Temporary acceptance pending a compatible patch.",
  finding_ref: ".security/findings/2026-10-24-zod-body-parser-highs.md",
  removal_plan: { target: "patched Zod", action: "Upgrade and rescan." },
  accepted_on: "2026-10-25", review_by: "2026-11-08", expires: "2026-11-08", ...over,
});
const zodAudit = (severity = "high") => auditOf([entry("zod", "node_modules/zod", severity)]);
const run = (audit, registerRows, now = NOW) => evaluateAudit({ audit, packages, registerRows, now });

test("valid exception covers the matching high finding", () => {
  const r = run(zodAudit(), [row()]);
  assert.equal(r.ok, true);
  assert.deepEqual([r.covered.length, r.uncovered.length, r.expired.length, r.malformed.length], [1, 0, 0, 0]);
});

test("expired exception suppresses nothing after review_by", () => {
  const r = run(zodAudit(), [row()], "2026-11-09");
  assert.equal(r.ok, false);
  assert.deepEqual([r.covered.length, r.expired.length], [0, 1]);
  assert.equal(r.expired[0].id, "EXC-2026-10-25-zod");
});

test("non-matching version, path, advisory, or identifier stays uncovered", () => {
  for (const over of [{ version: "3.25.77" }, { embedded_path: "node_modules/zod/nested" },
    { advisory: "GHSA-27r3-jxmh-p828" }, { identifier: "zod-to-json-schema" }]) {
    const r = run(zodAudit(), [row(over)]);
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.uncovered.length, 1, JSON.stringify(over));
  }
});

test("malformed accepted row suppresses nothing and fails the gate", () => {
  const r = run(zodAudit(), [row({ accepted_by: undefined })]);
  assert.equal(r.ok, false);
  assert.deepEqual([r.malformed.length, r.covered.length, r.uncovered.length], [1, 0, 1]);
});

test("new high advisory without any exception is uncovered", () => {
  const r = run(auditOf([entry("qs", "node_modules/qs", "high", "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz")]), [row()]);
  assert.equal(r.ok, false);
  assert.equal(r.uncovered[0].package, "qs");
});

test("moderate and low findings never block", () => {
  const r = run(auditOf([
    entry("fast-uri", "node_modules/fast-uri", "moderate", "https://github.com/advisories/GHSA-w74x-v6f9-j3xg"),
    entry("katex", "node_modules/katex", "low", "https://github.com/advisories/GHSA-238p-pmpm-9mq7"),
  ]), []);
  assert.equal(r.ok, true);
  assert.deepEqual([r.blocking, r.tolerated], [0, 2]);
});

test("unrecognized audit shape fails closed instead of passing vacuously", () => {
  const r = run({ advisories: {} }, []);
  assert.equal(r.ok, false);
  assert.match(r.error, /unrecognized npm audit format/);
});

test("parseRegister reads the register field layout", () => {
  const rows = parseRegister([
    "schema_version: 1", "exceptions:", "  - id: EXC-2026-10-25-zod", `    advisory: ${ADVISORY}`,
    "    affected: { identifier: zod, version: 3.25.76 }", "    embedded_path: node_modules/zod",
    "    status: accepted", "    accepted_by: repository owner", '    accepted_on: "2026-10-25"',
    '    review_by: "2026-11-08"', '    expires: "2026-11-08"', "    component: root npm workspace",
    "    owner: repository owner", "    scanner: npm-audit", "    scanner_input: package-lock.json",
    "    finding_kind: direct-advisory", "    severity: high", "    severity_source: GitHub advisory",
    "    rationale: Temporary acceptance pending a compatible patch.",
    "    finding_ref: .security/findings/2026-10-24-zod-body-parser-highs.md",
    "    removal_plan: { target: patched Zod, action: Upgrade and rescan. }", "",
  ].join("\n"));
  assert.equal(rows.length, 1);
  for (const [key, value] of Object.entries({
    id: "EXC-2026-10-25-zod", advisory: ADVISORY, status: "accepted", embedded_path: "node_modules/zod",
    accepted_by: "repository owner", accepted_on: "2026-10-25", review_by: "2026-11-08", expires: "2026-11-08",
    identifier: "zod", version: "3.25.76",
  })) assert.equal(rows[0][key], value);
});

test("collectFindings expands one entry per node path", () => {
  const findings = collectFindings(auditOf([{ ...entry("zod", "node_modules/zod", "high"), nodes: ["node_modules/zod", "./node_modules/zod/"] }]), packages);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.path === "node_modules/zod" && f.version === "3.25.76"));
});
