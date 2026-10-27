#!/usr/bin/env node
// tools/security/audit-gate.mjs — HIGH/CRITICAL npm audit gate with exact-match, expiring exceptions.
// Reads `npm audit --json` (or --audit-file), resolves installed versions from
// the lockfile, and fails on any high/critical finding without a valid register
// exception. Output carries advisory/package/path/dates only (no secrets).
// Usage: node tools/security/audit-gate.mjs [--audit-file P] [--register P] [--lockfile P] [--now YYYY-MM-DD]

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
/* global console, process */
import { evaluateAudit, parseRegister } from "./audit-lib.mjs";
import { validDate } from "./audit-register.mjs";


function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!["--audit-file", "--register", "--lockfile", "--now"].includes(argv[i]) ||
      !argv[i + 1] || argv[i + 1].startsWith("--")) fail("[audit-gate] invalid arguments");
    opts[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  return opts;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`[audit-gate] cannot parse ${label}: ${path}`);
  }
  return null;
}

function main(argv, root = process.cwd()) {
  const opts = parseArgs(argv);
  const now = opts.now || new Date().toISOString().slice(0, 10);
  if (!validDate(now)) fail(`[audit-gate] invalid --now date (want YYYY-MM-DD): ${now}`);
  let audit;
  if (opts["audit-file"]) {
    audit = readJson(opts["audit-file"], "audit file");
  } else {
    const run = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.signal || ![0, 1].includes(run.status)) fail("[audit-gate] npm audit execution failed");
    try {
      audit = JSON.parse(String(run.stdout || "").trim());
    } catch {
      fail("[audit-gate] npm audit produced no parseable JSON output");
    }
  }
  const registerPath = opts.register || `${root}/.security/vulnerability-register.yaml`;
  const lockfilePath = opts.lockfile || `${root}/package-lock.json`;
  let registerText;
  try {
    registerText = readFileSync(registerPath, "utf8");
  } catch {
    fail(`[audit-gate] cannot read register: ${registerPath}`);
  }
  const packages = readJson(lockfilePath, "lockfile").packages || {};
  const result = evaluateAudit({ audit, packages, registerRows: parseRegister(registerText), now });
  console.log(
    `[audit-gate] blocking: ${result.blocking} high/critical (covered ${result.covered.length}, ` +
      `uncovered ${result.uncovered.length}, expired ${result.expired.length}, malformed ${result.malformed.length}); ` +
      `tolerated ${result.tolerated} (moderate/low/info)`,
  );
  if (result.error) fail(`[audit-gate] ERROR: ${result.error}`);
  for (const f of result.uncovered) {
    console.log(`[audit-gate] UNCOVERED ${f.severity} ${f.advisory || "(no advisory)"} ${f.package}@${f.version || "?"} ${f.path}`);
  }
  for (const row of result.expired) {
    console.log(`[audit-gate] EXPIRED ${row.id} ${row.advisory} owner=${row.owner} component=${row.component} ${row.path} review_by=${row.review_by} expires=${row.expires || row.review_by} now=${result.day}`);
  }
  for (const { id, errors } of result.malformed) {
    console.log(`[audit-gate] MALFORMED exception ${id || "(no id)"}: ${errors.join("; ")}`);
  }
  if (!result.ok) fail("[audit-gate] FAIL: unresolved high/critical findings or invalid exceptions");
  console.log("[audit-gate] PASS: no uncovered high/critical findings");
}

try { main(process.argv.slice(2)); }
catch (error) { fail(`[audit-gate] ERROR: ${error.message}`); }
