import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { parseRegister, evaluateAudit } from "./audit-lib.mjs";

const register = readFileSync(new URL("./fixtures/legacy-zod3-register.yaml", import.meta.url), "utf8");
const unsigned = (value) => register.replace("accepted_by: repository owner", `accepted_by: ${value}`);

for (const value of ["null", "null # pending signature", "~", "", "# pending signature", '""', '"   "', "[]", "{}", "false", "123"]) {
  test(`rejects an accepted row with invalid YAML signer ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseRegister(unsigned(value)), /accepted_by/);
  });
}

test("rejects accepted rows moved outside the active exceptions section", () => {
  const split = register.indexOf("  - id: EXC-2026-10-25-zod\n");
  assert.throws(() => parseRegister(`${register.slice(0, split)}archived_exceptions:\n${register.slice(split)}`));
  assert.throws(() => parseRegister(register.replace("exceptions:", "exceptions: []\narchived_exceptions:")));
});

for (const key of ["advisory", "scanner", "scanner_input", "component", "finding_kind", "affected",
  "embedded_path", "severity", "severity_source", "rationale", "finding_ref", "owner", "accepted_by",
  "accepted_on", "review_by", "expires", "removal_plan"]) {
  test(`rejects an accepted row missing ${key}`, () => {
    const split = register.indexOf("  - id: EXC-2026-10-25-zod\n");
    const tail = register.slice(split).replace(new RegExp(`^    ${key}:.*(?:\\n {6}.*)*\\n`, "m"), "");
    assert.throws(() => parseRegister(register.slice(0, split) + tail), undefined, key);
  });
}

for (const key of ["accepted_on", "review_by", "expires"]) {
  for (const value of ['"2026-02-30"', '"2026-13-01"', '"not-a-date"', "null", "20261108"]) {
    test(`rejects invalid ${key}: ${value}`, () => {
      const text = register.replace(new RegExp(`(${key}: )"2026-(10-25|11-08)"`), `$1${value}`);
      assert.throws(() => parseRegister(text), new RegExp(key));
    });
  }
}

test("rejects unknown structures, duplicate keys, aliases, and multiple YAML documents", () => {
  for (const text of ["null", "[]", "schema_version: 1\nexceptions: {}", "schema_version: 2\nexceptions: []",
    register.replace("    status: accepted", "    status: accepted\n    unknown_field: value"),
    register.replace("affected: { identifier: zod, version: 3.25.76 }", "affected: { identifier: zod, version: [] }"),
    register.replace("affected: { identifier: zod, version: 3.25.76 }", "affected: { identifier: zod, version: 3.25.76, extra: yes }"),
    register.replace("    status: accepted", "    status: accepted\n    status: proposed"),
    register.replace("accepted_by: repository owner", "accepted_by: &signer repository owner")
      .replace("accepted_by: repository owner", "accepted_by: *signer"),
    `${register}\n---\nschema_version: 1\nexceptions: []\n`]) assert.throws(() => parseRegister(text));
});

test("reads YAML comments and folded rationale while retaining unsigned proposals", () => {
  const rows = parseRegister(register.replace("accepted_by: repository owner", 'accepted_by: "repository owner" # approved'));
  assert.equal(rows.find((row) => row.status === "accepted").accepted_by, "repository owner");
  assert.match(rows.find((row) => row.id === "EXC-2026-10-25-zod").rationale, /Memory exhaustion/);
  assert.equal(rows.find((row) => row.status === "proposed").accepted_by, null);
});

test("invalid rows fail even without current findings or when they are proposed", () => {
  assert.throws(() => parseRegister(unsigned("null")));
  assert.throws(() => parseRegister(register.replace("status: accepted", "status: proposed").replace("expires: \"2026-11-08\"", "expires: wrong")));
  const rows = parseRegister(register);
  rows[0].rationale = [];
  assert.equal(evaluateAudit({ audit: { vulnerabilities: {} }, registerRows: rows, now: "2026-10-25" }).ok, false);
});
