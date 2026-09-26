#!/usr/bin/env node
// =============================================================================
// cycle-orchestrator.mjs — e2e bascule orchestrator for 2 tenants (immo + geo).
//
// Quadrant 7 of the backup/restore matrix: e2e immo+geo "bascule iso-prod,
// 2-tenant coherence". This tool ORCHESTRATES the two per-tenant bascule
// workflows around ONE coherence identity (CYCLE_ID) and proves cross-tenant
// coherence by a byte-identity JOIN-VERIFY of the served canonical_id sets. It
// does NOT re-implement the per-tenant bricks (dump/restore/migrate/flip/refresh
// live in each tenant's own bascule) — it dispatches them and reconciles state.
//
//   Subcommands:
//     cycle-open   generate CYCLE_ID (from CONFIRM + T0), write cycle.json (open).
//     dispatch     workflow_dispatch BOTH legs (immo same-repo, geo cross-repo),
//                  record run ids. REQUIRES GEO_DISPATCH_TOKEN for the geo leg.
//     follow       STATUS-ONLY poll of each leg's jobs (pg, s3) until done.
//     join-verify  download both served-ids artefacts, compare byte-à-byte,
//                  set join_verify = match | drift (fail-closed on drift).
//     run          cycle-open → dispatch → follow → join-verify, with bounded
//                  redo-on-drift (BASCULE2_MAX_REDO, default 2).
//     status       print the current cycle.json.
//
//   SEAMS (pluggable, typed): dispatch.mjs (LegDispatcher) and join-verify.mjs
//   (ServedIdsRendezvous). Default = the wired GitHub impls; *_MODE=inert selects
//   the documented inert defaults. 0 python; native binaries only (git/unzip).
//
//   SAFETY: `dispatch`/`follow`/`join-verify`/`run` perform REAL GitHub API calls
//   and TRIGGER the production bascules — they are NOT exercised by the self-test.
// =============================================================================
import console from "node:console";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { CONFIRM_RE, makeCycleId, newCycle, setJoinVerify, setLeg, validateCycle } from "./cycle.mjs";
import { LEG_DEFAULTS, makeDispatcher } from "./dispatch.mjs";
import { makeRendezvous, runJoinVerify } from "./join-verify.mjs";

const log = (m) => console.log(`[bascule2] ${m}`);
const warn = (m) => console.log(`::warning title=bascule2::${m}`);
const die = (m) => { console.log(`::error title=bascule2 failed::${m}`); process.exit(1); };
const section = (t) => log(`──────── ${t} ────────`);

const opt = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

// Follow (STATUS-ONLY) the locked per-leg job set.
const FOLLOW_JOBS = Object.freeze(["pg", "s3"]);

function workdir() {
  const dir = opt("BASCULE2_WORKDIR", join(process.cwd(), ".bascule2-work"));
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cyclePath() { return join(workdir(), "cycle.json"); }
function loadCycle() {
  const p = cyclePath();
  if (!existsSync(p)) die(`no cycle.json in ${workdir()} — run 'cycle-open' first.`);
  const c = JSON.parse(readFileSync(p, "utf8"));
  return validateCycle(c);
}
function saveCycle(cycle) {
  validateCycle(cycle);
  writeFileSync(cyclePath(), `${JSON.stringify(cycle, null, 2)}\n`, { mode: 0o600 });
  return cycle;
}

// GARDE G3 (mirror bascule.mjs assertConfirm): CONFIRM = iso-prod-AAAA-MM-JJ,
// optionally pinned to CONFIRM_EXPECTED (anti-replay = today).
function assertConfirm() {
  const confirm = opt("CONFIRM", "");
  if (!CONFIRM_RE.test(confirm)) die("GARDE G3 — CONFIRM absent/malformed. Expected 'iso-prod-AAAA-MM-JJ'.");
  const expected = opt("CONFIRM_EXPECTED", "");
  if (expected && confirm !== expected) die(`GARDE G3 — CONFIRM='${confirm}' != expected '${expected}' (anti-replay).`);
  log(`GARDE G3 OK — CONFIRM='${confirm}'`);
  return confirm;
}

function legInit(tenant, cycleId) {
  const d = LEG_DEFAULTS[tenant];
  return {
    repo: d.repo,
    workflow: d.workflow,
    served_ids_artifact: `${tenant}-served-canonical-ids-${cycleId}`,
  };
}

// ── cycle-open ───────────────────────────────────────────────────────────────
function cmdCycleOpen() {
  section("cycle-open — generate CYCLE_ID + write cycle.json (open)");
  const confirm = assertConfirm();
  const t0Ms = Date.now();
  const cycleId = makeCycleId(confirm, t0Ms);
  const cycle = newCycle({
    cycleId,
    confirm,
    orchestratorRunId: opt("GITHUB_RUN_ID", null),
    createdAt: new Date(t0Ms).toISOString(),
    legs: { immo: legInit("immo", cycleId), geo: legInit("geo", cycleId) },
  });
  saveCycle(cycle);
  writeFileSync(join(workdir(), "CYCLE_ID.txt"), cycleId, { mode: 0o600 });
  log(`CYCLE_ID=${cycleId}`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `cycle_id=${cycleId}\n`, { flag: "a" });
  log(`cycle.json written to ${cyclePath()}`);
}

// ── dispatch (REAL trigger of BOTH production bascules) ──────────────────────
async function cmdDispatch() {
  section("dispatch — workflow_dispatch BOTH legs (immo + geo)");
  const confirm = assertConfirm();
  const cycle = loadCycle();
  const ref = opt("BASCULE2_REF", "main");
  const dispatcher = makeDispatcher(process.env);
  const inputs = { CONFIRM: confirm, DRY_RUN: "false", SKIP_ROLLOUT: "false", CYCLE_ID: cycle.cycle_id };
  for (const tenant of ["immo", "geo"]) {
    log(`dispatching ${tenant} (${LEG_DEFAULTS[tenant].repo}) with CYCLE_ID=${cycle.cycle_id}`);
    const { dispatchedAt } = await dispatcher.dispatch({ tenant, ref, inputs });
    const { runId, htmlUrl } = await dispatcher.findRun({ tenant, cycleId: cycle.cycle_id, dispatchedAfter: dispatchedAt, ref });
    if (!runId) warn(`${tenant}: dispatched but run id not yet correlated — 'follow' will retry.`);
    setLeg(cycle, tenant, { run_id: runId, t1: dispatchedAt });
    log(`${tenant}: run_id=${runId ?? "pending"} ${htmlUrl ? `(${htmlUrl})` : ""}`);
    saveCycle(cycle);
  }
}

// ── follow (STATUS-ONLY) ─────────────────────────────────────────────────────
async function cmdFollow() {
  section("follow — STATUS-ONLY poll of each leg's jobs (pg, s3)");
  const cycle = loadCycle();
  const dispatcher = makeDispatcher(process.env);
  const timeoutSec = Number(opt("BASCULE2_FOLLOW_TIMEOUT_SEC", "5400"));
  const pollSec = Number(opt("BASCULE2_FOLLOW_POLL_SEC", "30"));
  const deadline = Date.now() + timeoutSec * 1000;
  const pending = new Set(["immo", "geo"]);
  while (pending.size) {
    for (const tenant of [...pending]) {
      const runId = cycle.legs[tenant].run_id;
      if (!runId) { warn(`${tenant}: no run_id yet (dispatch not correlated) — skipping this pass.`); continue; }
      const { runStatus, jobs } = await dispatcher.pollJobs({ tenant, runId, jobNames: FOLLOW_JOBS });
      setLeg(cycle, tenant, { verdict: jobs });
      saveCycle(cycle);
      log(`${tenant}: pg=${jobs.pg} s3=${jobs.s3} (run ${runStatus})`);
      if (runStatus === "completed") {
        pending.delete(tenant);
        const failed = FOLLOW_JOBS.filter((n) => jobs[n] !== "success");
        if (failed.length) die(`${tenant} leg failed: [${failed.map((n) => `${n}=${jobs[n]}`).join(", ")}] — bascule aborted (fail-closed).`);
      }
    }
    if (!pending.size) break;
    if (Date.now() >= deadline) die(`follow timed out after ${timeoutSec}s; still pending: [${[...pending].join(", ")}].`);
    await sleep(pollSec * 1000);
  }
  log("follow OK — both legs completed with pg=success, s3=success.");
}

// ── join-verify (byte-identity, fail-closed) ─────────────────────────────────
async function cmdJoinVerify() {
  section("join-verify — download both served-ids artefacts, compare byte-à-byte");
  const cycle = loadCycle();
  const runIds = { immo: cycle.legs.immo.run_id, geo: cycle.legs.geo.run_id };
  if (!runIds.immo || !runIds.geo) die("join-verify: both legs need a run_id (run 'dispatch'/'follow' first).");
  const rendezvous = makeRendezvous(process.env, { workdir: workdir() });
  const { status, diff_summary, immo, geo } = await runJoinVerify({ rendezvous, cycleId: cycle.cycle_id, runIds });
  setLeg(cycle, "immo", { served_ids_sha256: immo.sha256 });
  setLeg(cycle, "geo", { served_ids_sha256: geo.sha256 });
  setJoinVerify(cycle, { status, diffSummary: diff_summary });
  saveCycle(cycle);
  if (status === "match") { log(`join-verify MATCH — served sets byte-identical (sha256 ${immo.sha256}).`); return true; }
  warn(`join-verify DRIFT — immo_only=${diff_summary.immo_only?.count} geo_only=${diff_summary.geo_only?.count}.`);
  return false;
}

// ── run (full e2e with bounded redo-on-drift) ────────────────────────────────
async function cmdRun() {
  section("run — full e2e (cycle-open → dispatch → follow → join-verify)");
  const maxRedo = Number(opt("BASCULE2_MAX_REDO", "2"));
  for (let attempt = 0; attempt <= maxRedo; attempt += 1) {
    if (attempt > 0) log(`redo-on-drift: attempt ${attempt}/${maxRedo} (new CYCLE_ID).`);
    cmdCycleOpen();
    await cmdDispatch();
    await cmdFollow();
    const ok = await cmdJoinVerify();
    if (ok) { log("e2e OK — 2-tenant coherence proven (join-verify MATCH)."); return; }
    if (attempt === maxRedo) die(`join-verify DRIFT after ${maxRedo} redo(s) — hard-fail for human inspection (SPEC §5.4).`);
  }
}

function cmdStatus() {
  console.log(JSON.stringify(loadCycle(), null, 2));
}

const COMMANDS = {
  "cycle-open": cmdCycleOpen,
  dispatch: cmdDispatch,
  follow: cmdFollow,
  "join-verify": cmdJoinVerify,
  run: cmdRun,
  status: cmdStatus,
};

async function main() {
  const cmd = process.argv[2];
  const isHelp = !cmd || cmd === "-h" || cmd === "--help";
  if (isHelp || !COMMANDS[cmd]) {
    console.log(
      "usage: node cycle-orchestrator.mjs <cycle-open|dispatch|follow|join-verify|run|status>\n" +
        "  Orchestrates the two per-tenant bascules around one CYCLE_ID; proves coherence by a\n" +
        "  byte-identity join-verify of the served canonical_id sets. 0 python.\n" +
        "  dispatch/follow/join-verify/run hit the GitHub API and TRIGGER the production bascules.\n" +
        "  The geo leg REQUIRES GEO_DISPATCH_TOKEN (actions:write on rhanka/geo).",
    );
    process.exit(isHelp ? 0 : 1);
  }
  await COMMANDS[cmd]();
}

const invokedDirectly = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedDirectly) main().catch((e) => die(e && e.message ? e.message : String(e)));
