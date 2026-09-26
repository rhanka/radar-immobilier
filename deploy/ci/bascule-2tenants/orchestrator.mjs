#!/usr/bin/env node
// =============================================================================
// orchestrator.mjs — e2e immo + geo restore FROM BACKUPS, proven coherence.
//
// Driven by .github/workflows/bascule-e2e.yml (environment radar-e2e, main-only).
// Each tenant's CI drives its own cluster; this orchestrator only uses the GitHub
// API (dispatch, run status, artefacts) — 0 kubectl, 0 S3/DB credential:
//
//   cycle-open        G3 CONFIRM (today) → CYCLE_ID + cycle.json.
//   capabilities      both legs' bascule-preprod.yml must declare CONFIRM,
//                     DRY_RUN, MODE (list|restore), BACKUP_ID, CYCLE_ID — checked
//                     BEFORE any dispatch (geo without a restore-from-backup mode
//                     ⇒ fail-closed with the list of what geo-cond must add).
//   list-backups      dispatch MODE=list on both legs (read-only), follow, read
//                     their `backup-list-<tenant>-<CYCLE_ID>` artefacts (each
//                     tenant reads its own backup bucket with its own reader
//                     identity, in its own cluster).
//   choose-date       common date D with a `complete` backup on BOTH tenants
//                     (newest, or BACKUP_DATE when given).
//   dispatch-restore  (not DRY) MODE=restore BACKUP_ID=D CYCLE_ID on both legs.
//   follow            status only, until both runs complete.
//   collect           `cycle-leg-<tenant>-<CYCLE_ID>`: verdict pg/s3 + backup date.
//   join-verify       `<tenant>-served-canonical-ids-<CYCLE_ID>`: INCLUSION
//                     immo ⊆ geo (zones first); `city-not-served-by-geo` is
//                     reported, only `divergent-code` fails.
//   publish           cycle.json + step summary; exit 1 unless the verdict is green.
// =============================================================================
import { Buffer } from "node:buffer";
import console from "node:console";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  artefacts, assertCycleId, checkCapabilities, checkLeg, chooseCommonDate, CONFIRM_RE, correlateRun, FILES, filterInputs,
  inclusionCheck, isValidDate, LEGS, makeCycleId, newCycle, parseBackupList, parseDispatchInputs, TENANTS,
} from "./cycle.mjs";
import { GithubClient } from "./github.mjs";

const log = (m) => console.log(`[bascule-e2e] ${m}`);
const warn = (m) => console.log(`::warning title=bascule-e2e::${m}`);
class Die extends Error {}
const die = (m) => { throw new Die(m); };
const opt = (n, d) => { const v = process.env[n]; return v === undefined || v === "" ? d : v; };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function workdir() {
  const d = opt("BASCULE2_WORKDIR", join(process.cwd(), ".bascule2-work"));
  mkdirSync(d, { recursive: true });
  return d;
}
const cyclePath = () => join(workdir(), "cycle.json");
function loadCycle() {
  if (!existsSync(cyclePath())) die("no cycle.json — run 'cycle-open' first.");
  return JSON.parse(readFileSync(cyclePath(), "utf8"));
}
function saveCycle(c) { writeFileSync(cyclePath(), `${JSON.stringify(c, null, 2)}\n`, { mode: 0o644 }); return c; }
function exportEnv(name, value) {
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name.toLowerCase()}=${value}\n`);
}
function summary(md) { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`); }

function assertConfirm() {
  const confirm = opt("CONFIRM", "");
  if (!CONFIRM_RE.test(confirm)) die("GARDE G3 — CONFIRM absent or malformed (expected iso-prod-AAAA-MM-JJ). Nothing dispatched.");
  const expected = opt("CONFIRM_EXPECTED", "");
  if (expected && confirm !== expected) die(`GARDE G3 — CONFIRM does not match today's value (${expected}). Anti-replay: nothing dispatched.`);
  return confirm;
}
const isDry = () => opt("DRY_RUN", "true") !== "false";

export function makeOrchestrator({ gh, now = Date.now, pollSec = Number(opt("BASCULE2_POLL_SEC", "30")) } = {}) {
  const client = gh || new GithubClient({ env: process.env, legs: LEGS });

  async function dispatchAndCorrelate(cycle, tenant, mode, wanted) {
    const declared = cycle.legs[tenant].capabilities?.inputs || {};
    const inputs = filterInputs(wanted, declared);
    const dispatchedAtMs = now();
    await client.dispatch(tenant, inputs);
    log(`${tenant}: dispatched ${LEGS[tenant].repo} ${LEGS[tenant].workflow}@${LEGS[tenant].ref} MODE=${mode} (${Object.keys(inputs).join(", ")})`);
    const deadline = now() + Number(opt("BASCULE2_CORRELATE_TIMEOUT_SEC", "180")) * 1000;
    const since = new Date(dispatchedAtMs - 60000).toISOString();
    for (;;) {
      const { run, correlation } = correlateRun(await client.recentRuns(tenant, since), { cycleId: cycle.cycle_id, mode, dispatchedAtMs });
      if (run) {
        if (correlation !== "run-name") warn(`${tenant}: run correlated by time only — the leg should put MODE + CYCLE_ID in its run-name.`);
        return { run_id: run.id, html_url: run.html_url, correlation, dispatched_at: new Date(dispatchedAtMs).toISOString() };
      }
      if (correlation.startsWith("ambiguous")) die(`${tenant}: dispatched run is ambiguous (${correlation}) — refusing to guess.`);
      if (now() >= deadline) die(`${tenant}: dispatched run not found (${correlation}).`);
      await sleep(Math.min(pollSec, 10) * 1000);
    }
  }

  async function followRuns(cycle, key, timeoutSec) {
    const deadline = now() + timeoutSec * 1000;
    const pending = new Set(TENANTS);
    while (pending.size) {
      for (const t of [...pending]) {
        const r = await client.run(t, cycle.legs[t][key].run_id);
        cycle.legs[t][key].status = r.status;
        cycle.legs[t][key].conclusion = r.conclusion ?? null;
        if (r.status === "completed") { pending.delete(t); log(`${t}: ${key} completed (${r.conclusion}) ${r.html_url ?? ""}`); }
      }
      saveCycle(cycle);
      if (!pending.size) break;
      if (now() >= deadline) die(`${key}: still running after ${timeoutSec}s on [${[...pending].join(", ")}].`);
      await sleep(pollSec * 1000);
    }
  }

  const commands = {
    async "cycle-open"() {
      const confirm = assertConfirm();
      const t0 = now();
      const cycle = newCycle({ cycleId: makeCycleId(confirm, t0), confirm, createdAt: new Date(t0).toISOString(),
        orchestratorRunId: opt("GITHUB_RUN_ID", null), dryRun: isDry() });
      saveCycle(cycle);
      exportEnv("CYCLE_ID", cycle.cycle_id);
      log(`CYCLE_ID=${cycle.cycle_id} dry_run=${cycle.dry_run}`);
    },

    async capabilities() {
      const cycle = loadCycle();
      for (const t of TENANTS) client.headers(t); // tokens present, fail-closed before any dispatch
      const problems = [];
      for (const t of TENANTS) {
        const inputs = parseDispatchInputs(await client.workflowFile(t));
        const cap = checkCapabilities(inputs);
        cycle.legs[t].capabilities = { ok: cap.ok, missing: cap.missing, inputs };
        if (!cap.ok) problems.push(`${t} (${LEGS[t].repo} ${LEGS[t].workflow}@main) lacks: ${cap.missing.join(", ")}`);
      }
      saveCycle(cycle);
      if (problems.length) {
        const geoMsg = cycle.legs.geo.capabilities.ok ? "" :
          " — geo-cond must add a restore-from-backup mode to rhanka/geo bascule-preprod.yml: inputs MODE (list|restore), " +
          "BACKUP_ID (YYYY-MM-DD), restore of geo-preprod from geo-backup (manifests/<D>.json complete), artefacts " +
          "backup-list-geo-<CYCLE_ID> (backup-list.json, radar-backup-list/v1) and legs.geo.backup.date (see deploy/ci/bascule-2tenants/README.md)";
        die(`capabilities — ${problems.join(" | ")}${geoMsg}. Nothing dispatched.`);
      }
      log("capabilities OK — both legs declare CONFIRM, DRY_RUN, MODE(list|restore), BACKUP_ID, CYCLE_ID.");
    },

    async "list-backups"() {
      const cycle = loadCycle();
      const confirm = assertConfirm();
      for (const t of TENANTS) {
        cycle.legs[t].list_run = await dispatchAndCorrelate(cycle, t, "list", { CONFIRM: confirm, DRY_RUN: "true", MODE: "list", CYCLE_ID: cycle.cycle_id });
        saveCycle(cycle);
      }
      await followRuns(cycle, "list_run", Number(opt("BASCULE2_LIST_TIMEOUT_SEC", "1800")));
      for (const t of TENANTS) {
        if (cycle.legs[t].list_run.conclusion !== "success") die(`${t}: MODE=list run concluded ${cycle.legs[t].list_run.conclusion}.`);
        const buf = await client.artefactFile(t, cycle.legs[t].list_run.run_id, artefacts.backupList(t, cycle.cycle_id), FILES.backupList);
        if (!buf) die(`${t}: artefact ${artefacts.backupList(t, cycle.cycle_id)}/${FILES.backupList} missing.`);
        const list = parseBackupList(JSON.parse(buf.toString("utf8")), t);
        writeFileSync(join(workdir(), `backup-list-${t}.json`), `${JSON.stringify(list, null, 2)}\n`);
        log(`${t}: ${list.backups.length} backups listed (latest complete ${list.latestComplete})`);
      }
      saveCycle(cycle);
    },

    async "choose-date"() {
      const cycle = loadCycle();
      const read = (t) => JSON.parse(readFileSync(join(workdir(), `backup-list-${t}.json`), "utf8"));
      const requested = opt("BACKUP_DATE", "");
      if (requested && !isValidDate(requested)) die("BACKUP_DATE must be YYYY-MM-DD.");
      let choice;
      try { choice = chooseCommonDate({ immo: read("immo"), geo: read("geo"), requested }); } catch (e) { die(`choose-date — ${e.message}`); }
      cycle.backup = { date: choice.date, requested: choice.requested, candidates: choice.candidates,
        immo: choice.immo, geo: choice.geo, geo_after_immo: choice.geoAfterImmo };
      saveCycle(cycle);
      if (choice.geoAfterImmo === false) warn(`geo backup of ${choice.date} started BEFORE immo's: the superset-by-order property may not hold (join-verify decides).`);
      if (choice.truncatedLists) warn("a backup list was truncated to its newest entries.");
      exportEnv("BACKUP_DATE_CHOSEN", choice.date);
      log(`date D=${choice.date} (${choice.requested ? "requested" : "newest common complete"}; candidates ${choice.candidates.join(", ")})`);
    },

    async "dispatch-restore"() {
      const cycle = loadCycle();
      if (isDry()) { log("DRY_RUN — no restore dispatched (capabilities + lists + date only)."); return; }
      const confirm = assertConfirm();
      if (!cycle.backup?.date) die("no backup date chosen.");
      assertCycleId(cycle.cycle_id);
      for (const t of TENANTS) {
        cycle.legs[t].restore_run = await dispatchAndCorrelate(cycle, t, "restore",
          { CONFIRM: confirm, DRY_RUN: "false", MODE: "restore", BACKUP_ID: cycle.backup.date, CYCLE_ID: cycle.cycle_id, SKIP_ROLLOUT: "false" });
        saveCycle(cycle);
      }
    },

    async follow() {
      const cycle = loadCycle();
      if (isDry()) return;
      await followRuns(cycle, "restore_run", Number(opt("BASCULE2_RESTORE_TIMEOUT_SEC", "18000")));
    },

    async collect() {
      const cycle = loadCycle();
      if (isDry()) return;
      const problems = [];
      for (const t of TENANTS) {
        const buf = await client.artefactFile(t, cycle.legs[t].restore_run.run_id, artefacts.cycleLeg(t, cycle.cycle_id), FILES.cycleLeg(t));
        cycle.legs[t].cycle_leg = buf ? JSON.parse(buf.toString("utf8")) : null;
        const c = checkLeg(t, cycle.legs[t].cycle_leg, cycle.backup.date);
        problems.push(...c.problems);
      }
      cycle.problems = problems;
      saveCycle(cycle);
      if (problems.length) die(`collect — ${problems.join("; ")}`);
      log(`collect OK — both legs restored the backups of ${cycle.backup.date} (pg + s3 success).`);
    },

    async "join-verify"() {
      const cycle = loadCycle();
      if (isDry()) return;
      const texts = {};
      for (const t of TENANTS) {
        const runId = cycle.legs[t].restore_run.run_id;
        const name = artefacts.servedIds(t, cycle.cycle_id);
        const ids = await client.artefactFile(t, runId, name, FILES.servedIds);
        const side = await client.artefactFile(t, runId, name, FILES.servedIdsSha);
        if (!ids || !side) die(`join-verify — ${t}: artefact ${name} (${FILES.servedIds} + ${FILES.servedIdsSha}) missing${t === "immo" ? " (PENDING O1: immo RAW refs endpoint)" : ""}.`);
        const declared = /^([0-9a-f]{64})/.exec(side.toString("utf8").trim())?.[1];
        const actual = sha256(ids);
        if (declared !== actual) die(`join-verify — ${t}: ${FILES.servedIdsSha} differs from sha256(${FILES.servedIds}).`);
        const legSha = cycle.legs[t].cycle_leg?.served_ids_sha256;
        if (legSha && legSha !== actual) die(`join-verify — ${t}: artefact sha256 differs from legs.${t}.served_ids_sha256.`);
        texts[t] = Buffer.from(ids).toString("utf8");
      }
      let diff;
      try { diff = inclusionCheck(texts.immo, texts.geo); } catch (e) { die(`join-verify — ${e.message}`); }
      cycle.join_verify = { status: diff.status, scope: diff.scope, compared_at: new Date(now()).toISOString(), diff_summary: diff };
      saveCycle(cycle);
      log(`join-verify ${diff.status.toUpperCase()} — immo=${diff.immo_count} geo=${diff.geo_count} included=${diff.included} ` +
        `city-not-served-by-geo=${diff.city_not_served_by_geo.count} (${diff.city_not_served_by_geo.cities} cities) divergent-code=${diff.divergent_code.count}`);
      if (diff.status !== "match") die(`join-verify DRIFT — ${diff.divergent_code.count} immo zone id(s) whose city geo serves but not the code (sample in cycle.json).`);
    },

    async publish() {
      const cycle = loadCycle();
      const legsOk = TENANTS.every((t) => checkLeg(t, cycle.legs[t].cycle_leg, cycle.backup?.date).ok);
      cycle.verdict = cycle.dry_run ? (cycle.backup?.date ? "dry-run-ok" : "failure")
        : legsOk && cycle.join_verify.status === "match" ? "success" : "failure";
      saveCycle(cycle);
      const j = cycle.join_verify.diff_summary;
      summary(`### bascule e2e immo + geo — ${cycle.cycle_id}\n\n| item | value |\n|---|---|\n` +
        `| verdict | **${cycle.verdict}** |\n| backup date D | ${cycle.backup?.date ?? "-"} (geo after immo: ${cycle.backup?.geo_after_immo ?? "unknown"}) |\n` +
        TENANTS.map((t) => `| ${t} restore run | ${cycle.legs[t].restore_run?.html_url ?? "-"} (${cycle.legs[t].restore_run?.conclusion ?? "-"}) |`).join("\n") + "\n" +
        `| join-verify (zones, immo ⊆ geo) | ${cycle.join_verify.status}${j ? ` — included ${j.included}/${j.immo_count}, city-not-served-by-geo ${j.city_not_served_by_geo.count}, divergent-code ${j.divergent_code.count}` : ""} |`);
      log(`verdict ${cycle.verdict} — cycle.json at ${cyclePath()}`);
      if (cycle.verdict === "failure") die("e2e verdict failure (see cycle.json).");
    },
  };
  return commands;
}

async function main() {
  const cmd = process.argv[2];
  const commands = makeOrchestrator();
  if (!commands[cmd]) {
    console.log(`usage: node orchestrator.mjs <${Object.keys(commands).join("|")}>`);
    process.exit(!cmd || cmd === "--help" ? 0 : 1);
  }
  await commands[cmd]();
}

const invokedDirectly = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedDirectly) {
  main().catch((e) => {
    console.log(`::error title=bascule-e2e failed::${e instanceof Die ? e.message : `${e?.name ?? "Error"}: ${e?.message ?? e}`}`);
    process.exit(1);
  });
}
