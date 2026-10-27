import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { collectFindings, evaluateAudit, parseRegister } from "./audit-lib.mjs";

const register = readFileSync(new URL("../../.security/vulnerability-register.yaml", import.meta.url), "utf8");
const rows = parseRegister(register);
const packages = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url))).packages;
const entry = (name, severity, via) => ({ name, severity, via, nodes: [`node_modules/${name}`] });
const zod = entry("zod", "high", [{ url: "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5", severity: "high" }]);
const audit = { vulnerabilities: { zod } };
const run = (over = {}) => evaluateAudit({ audit, packages, registerRows: rows, now: "2026-10-25", ...over });

test("checked-in register covers Zod through the final UTC acceptance day", () => {
  assert.equal(rows.filter((row) => row.status === "accepted").length, 3);
  assert.equal(run().ok, true);
  assert.equal(run({ now: "2026-11-08" }).ok, true);
  assert.equal(run({ now: "2026-11-09" }).ok, false);
});

test("expired rows fail even when no finding currently matches", () => {
  const result = run({ audit: { vulnerabilities: {} }, now: "2026-11-09" });
  assert.equal(result.ok, false);
  assert.equal(result.expired.length, 3);
  assert.equal(result.expired[0].owner, "repository owner");
});

test("propagated high keeps Zod identity and direct low keeps its severity", () => {
  const provider = entry("ollama-ai-provider", "high", ["zod", {
    url: "https://github.com/advisories/GHSA-866g-f22w-33x8", severity: "low",
  }]);
  const result = run({ audit: { vulnerabilities: { zod, [provider.name]: provider } } });
  assert.equal(result.ok, true);
  assert.deepEqual([result.covered.length, result.tolerated], [2, 1]);
});

test("nested node version never falls back to the root version", () => {
  const nested = { ...zod, nodes: ["node_modules/other/node_modules/zod"] };
  const result = run({ audit: { vulnerabilities: { zod: nested } } });
  assert.equal(result.ok, false);
  assert.equal(result.uncovered[0].version, "");
});

test("invalid calendar dates and scanner scopes suppress nothing", () => {
  for (const fields of [{ review_by: "2026-02-30" }, { scanner: "trivy" },
    { scanner_input: "tmp/other/package-lock.json" }, { component: undefined }]) {
    const registerRows = rows.map((row) => row.status === "accepted" ? { ...row, ...fields } : row);
    assert.equal(run({ registerRows }).ok, false, JSON.stringify(fields));
  }
  assert.equal(run({ now: "2026-02-30" }).ok, false);
});

test("malformed audit records and scanner errors fail closed", () => {
  for (const bad of [{ vulnerabilities: [] }, { vulnerabilities: { zod: null } },
    { vulnerabilities: {}, error: { code: "E503" } },
    { vulnerabilities: { zod: { ...zod, via: [] } } },
    { vulnerabilities: { zod: { ...zod, via: ["missing"] } } },
    { vulnerabilities: { zod: { ...zod, via: ["zod"] } } }]) {
    assert.equal(run({ audit: bad }).ok, false, JSON.stringify(bad));
  }
});

test("critical advisory stays blocking even with valid Zod acceptance", () => {
  const critical = entry("new-package", "critical", [{
    url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "critical",
  }]);
  assert.equal(run({ audit: { vulnerabilities: { [critical.name]: critical } } }).ok, false);
});

test("duplicate register keys or invalid status cannot hide an accepted row", () => {
  assert.throws(() => parseRegister(register.replace("status: accepted", "status: typo")));
  assert.throws(() => parseRegister(register.replace("status: accepted", "status: proposed\n    status: accepted")));
});

test("one audit node may carry independent high advisories", () => {
  const extra = { ...zod, via: [...zod.via, { url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "high" }] };
  const result = run({ audit: { vulnerabilities: { zod: extra } } });
  assert.equal(result.ok, false);
  assert.deepEqual([result.covered.length, result.uncovered.length], [1, 1]);
  assert.equal(collectFindings({ vulnerabilities: { zod: extra } }, packages).length, 2);
});

test("an acceptance for another component cannot cover the root npm tree", () => {
  const registerRows = rows.map((row) => row.status === "accepted" ? { ...row, component: "another npm tree" } : row);
  assert.equal(run({ registerRows }).ok, false);
});
