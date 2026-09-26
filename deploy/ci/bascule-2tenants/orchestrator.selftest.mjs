#!/usr/bin/env node
// =============================================================================
// orchestrator.selftest.mjs — offline selftest of the e2e immo+geo orchestrator.
// 0 network, 0 GitHub API, 0 dispatch: pure model (cycle.mjs) + the full command
// chain against a FAKE GitHub client (fake clock), + workflow wiring checks.
//   node deploy/ci/bascule-2tenants/orchestrator.selftest.mjs  → exit 0 when all pass.
// =============================================================================
import { Buffer } from "node:buffer";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  artefacts, backupAge, BASELINE_FORMAT, checkCapabilities, checkLeg, chooseCommonDate, confirmAt, correlateRun, filterInputs, inclusionCheck, makeCycleId,
  parseBackupList, parseBaseline, parseDispatchInputs, parseServedIds,
} from "./cycle.mjs";
import { GithubClient, tokenFor } from "./github.mjs";
import { makeOrchestrator } from "./orchestrator.mjs";

let passed = 0;
let failed = 0;
const ok = (name, cond) => { if (cond) { passed += 1; console.log(`  ok   ${name}`); } else { failed += 1; console.log(`  FAIL ${name}`); } };
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const throws = (name, fn) => { try { fn(); ok(name, false); } catch { ok(name, true); } };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const DIR = import.meta.dirname;
// join-verify baselines (fidelity control): JSON object, parsed model, file on disk
const baselineJson = (groups) => ({ format: BASELINE_FORMAT, scope: "zones", recorded_from: { backup_date: "2026-09-26", orchestrator_run_id: "1" },
  causes: { "slug-variant": "s", "data-gap": "d" }, groups });
const baselineOf = (groups) => parseBaseline(baselineJson(groups));
const baselineFile = (groups) => {
  const p = join(mkdtempSync(join(tmpdir(), "jvb-")), "baseline.json");
  writeFileSync(p, JSON.stringify(baselineJson(groups)));
  return p;
};

// ── workflow input discovery ─────────────────────────────────────────────────
const wf = ({ inline = true, withMode = true, extra = "" } = {}) => [
  "name: x", "on:", "  schedule:", "    - cron: '17 3 * * *'", "  workflow_dispatch:", "    inputs:",
  "      CONFIRM:", "        description: \"GO: x\"", "        required: true", "        type: string",
  "      DRY_RUN:", "        required: true", "        type: boolean", "        default: true",
  ...(withMode ? (inline
    ? ["      MODE:", "        type: choice", "        options: [chain, restore, list]", "        default: chain",
      "      BACKUP_ID:", "        type: string", "        default: latest"]
    : ["      MODE:", "        type: choice", "        options:", "          - chain", "          - restore", "          - \"list\"",
      "      BACKUP_ID:", "        type: string"]) : []),
  extra,
  "      # a comment", "      CYCLE_ID:", "        type: string", "        default: \"\"",
  "concurrency:", "  group: g", "jobs:", "  a:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo", "",
].join("\n");
{
  const a = parseDispatchInputs(wf());
  eq("parseDispatchInputs — names", Object.keys(a), ["CONFIRM", "DRY_RUN", "MODE", "BACKUP_ID", "CYCLE_ID"]);
  eq("parseDispatchInputs — inline options", a.MODE.options, ["chain", "restore", "list"]);
  eq("parseDispatchInputs — block options", parseDispatchInputs(wf({ inline: false })).MODE.options, ["chain", "restore", "list"]);
  eq("checkCapabilities — full contract", checkCapabilities(a), { ok: true, missing: [] });
  const geoToday = parseDispatchInputs(wf({ withMode: false, extra: "      SKIP_ROLLOUT:\n        type: boolean" }));
  eq("checkCapabilities — geo today lacks MODE + BACKUP_ID", checkCapabilities(geoToday).missing, ["MODE", "BACKUP_ID"]);
  const noList = parseDispatchInputs(wf().replace("[chain, restore, list]", "[chain, restore]"));
  eq("checkCapabilities — MODE without list", checkCapabilities(noList).missing, ["MODE option 'list'"]);
  const freeMode = parseDispatchInputs(wf().replace("        type: choice\n        options: [chain, restore, list]\n", "        type: string\n"));
  eq("checkCapabilities — MODE as a free string (no options) refused", checkCapabilities(freeMode).missing, ["MODE type 'choice'", "MODE option 'list'", "MODE option 'restore'"]);
  const mainWf = readFileSync(join(DIR, "..", "..", "..", ".github", "workflows", "bascule-preprod.yml"), "utf8");
  const mainInputs = parseDispatchInputs(mainWf);
  ok("parseDispatchInputs — real bascule-preprod.yml parsed (CONFIRM, DRY_RUN found)", !!mainInputs.CONFIRM && !!mainInputs.DRY_RUN);
  eq("filterInputs — only declared inputs are sent", filterInputs({ CONFIRM: "c", SKIP_ROLLOUT: "false", MODE: "list" }, a), { CONFIRM: "c", MODE: "list" });
}

// ── CYCLE_ID, correlation, dates, inclusion ──────────────────────────────────
{
  const id = makeCycleId("iso-prod-2026-09-27", Date.UTC(2026, 8, 27, 10));
  ok("makeCycleId — RFC1123 + geo pattern", /^iso-prod-2026-09-27-[a-z0-9]+$/.test(id) && id.length <= 63);
  throws("makeCycleId — bad CONFIRM", () => makeCycleId("nope", 1));
  const t = Date.parse("2026-09-27T10:00:00Z");
  const runs = [
    { id: 1, event: "workflow_dispatch", created_at: "2026-09-27T09:00:00Z", display_title: "bascule-preprod list c1" },
    { id: 2, event: "workflow_dispatch", created_at: "2026-09-27T10:00:05Z", display_title: "bascule-preprod restore c1" },
  ];
  eq("correlateRun — run-name MODE + CYCLE_ID", correlateRun(runs, { cycleId: "c1", mode: "restore", dispatchedAtMs: t }).run.id, 2);
  const noName = [{ id: 7, event: "workflow_dispatch", created_at: "2026-09-27T10:00:03Z", display_title: "bascule-preprod (iso-prod)" }];
  eq("correlateRun — a run without MODE + CYCLE_ID in its name is never taken (no time fallback)", correlateRun(noName, { cycleId: "c1", mode: "restore", dispatchedAtMs: t }), { run: null, correlation: "not-found" });
  eq("correlateRun — two run-name matches ⇒ ambiguous (no guess)", correlateRun([runs[1], { ...runs[1], id: 8 }], { cycleId: "c1", mode: "restore" }).correlation, "ambiguous-run-name");
  eq("confirmAt — today UTC at the dispatch instant (crossing midnight)", [confirmAt(Date.parse("2026-09-27T23:59:59Z")), confirmAt(Date.parse("2026-09-28T00:00:01Z"))], ["iso-prod-2026-09-27", "iso-prod-2026-09-28"]);
  const L = (tenant, rows, extra = {}) => parseBackupList({ format: "radar-backup-list/v1", bucket: `${tenant}-backup`, latestComplete: null, backups: rows, ...extra }, tenant);
  const immo = L("immo", [{ date: "2026-09-27", status: "partial" }, { date: "2026-09-26", status: "complete", startedAt: "2026-09-26T02:23:00Z" }, { date: "2026-09-25", status: "complete" }]);
  const geo = L("geo", [{ date: "2026-09-27", status: "complete" }, { date: "2026-09-26", status: "complete", startedAt: "2026-09-26T03:10:00Z" }]);
  const NOW = Date.parse("2026-09-27T10:00:00Z");
  const c = chooseCommonDate({ immo, geo, nowMs: NOW });
  eq("chooseCommonDate — newest date complete on BOTH", [c.date, c.geoAfterImmo], ["2026-09-26", true]);
  eq("chooseCommonDate — age from the OLDER capture, ≤ 48 h", [c.freshness.age_hours, c.freshness.max_age_hours, c.freshness.stale], [31.6, 48, false]);
  throws("chooseCommonDate — requested date not complete on geo", () => chooseCommonDate({ immo, geo, requested: "2026-09-25", nowMs: NOW }));
  throws("chooseCommonDate — no common date", () => chooseCommonDate({ immo: L("immo", [{ date: "2026-09-20", status: "complete" }]), geo, nowMs: NOW }));
  const later = Date.parse("2026-09-28T03:00:00Z"); // 48.6 h after immo's 02:23 capture of 09-26
  try { chooseCommonDate({ immo, geo, nowMs: later }); ok("chooseCommonDate — D older than 48 h refused by default", false); } catch (e) {
    ok("chooseCommonDate — D older than 48 h refused by default (ALLOW_STALE_BACKUP named)", /48\.6 h old \(> 48 h/.test(e.message) && /ALLOW_STALE_BACKUP=true/.test(e.message));
  }
  const st = chooseCommonDate({ immo, geo, nowMs: later, allowStale: true });
  eq("chooseCommonDate — ALLOW_STALE_BACKUP=true accepts and records it", [st.date, st.freshness.stale, st.freshness.allow_stale, st.freshness.overridden], ["2026-09-26", true, true, true]);
  eq("backupAge — a missing startedAt ⇒ D 00:00 UTC (conservative)", backupAge({ date: "2026-09-26", immoStartedAt: null, geoStartedAt: "2026-09-26T03:00:00Z", nowMs: NOW }).ageHours, 34);
  const trunc = L("immo", Array.from({ length: 15 }, (_, k) => ({ date: `2026-09-${String(26 - k).padStart(2, "0")}`, status: "complete", startedAt: `2026-09-${String(26 - k).padStart(2, "0")}T02:00:00Z` })), { truncated: true });
  try { chooseCommonDate({ immo: trunc, geo: L("geo", [{ date: "2026-09-05", status: "complete" }]), requested: "2026-09-05", nowMs: NOW, allowStale: true }); ok("chooseCommonDate — date outside a truncated list refused", false); } catch (e) {
    ok("chooseCommonDate — date outside a truncated list refused cleanly (window named)", /truncated to its newest 15 backups \(2026-09-12\.\.2026-09-26\)/.test(e.message) && /outside the listed window/.test(e.message));
  }
  throws("parseBackupList — wrong format", () => parseBackupList({ backups: [] }, "geo"));
  const G = "ogc:zones:laval:A-1\nogc:zones:laval:B-2\nogc:zones:montreal:C-408\n";
  eq("inclusionCheck — immo ⊆ geo ⇒ match", inclusionCheck("ogc:zones:laval:A-1\nogc:zones:montreal:C-408\n", G).status, "match");
  const strict = inclusionCheck("ogc:zones:laval:A-1\nogc:zones:sutton:Z-9\n", G);
  eq("inclusionCheck — no baseline: a city not served by geo is NEW drift ⇒ drift",
    [strict.status, strict.new_drift.city_not_served_by_geo.count, strict.new_drift.city_not_served_by_geo.sample, strict.city_not_served_by_geo.count], ["drift", 1, ["sutton"], 1]);
  const dr = inclusionCheck("ogc:zones:laval:A-1\nogc:zones:laval:C-9\n", G);
  eq("inclusionCheck — divergent-code absent from the baseline ⇒ drift", [dr.status, dr.new_drift.divergent_code.count, dr.divergent_code.sample], ["drift", 1, ["ogc:zones:laval:C-9"]]);
  // fidelity: known-drift does not fail, new drift fails, resolved is reported
  const base = baselineOf([
    { city: "sutton", class: "city-not-served-by-geo", cause: "slug-variant", ids: ["ogc:zones:sutton:Z-9"] },
    { city: "laval", class: "divergent-code", cause: "data-gap", ids: ["ogc:zones:laval:C-9", "ogc:zones:laval:B-2", "ogc:zones:laval:Q-7"] },
  ]);
  const kd = inclusionCheck("ogc:zones:laval:A-1\nogc:zones:laval:C-9\nogc:zones:sutton:Z-9\n", G, { baseline: base });
  eq("inclusionCheck — known-drift only ⇒ status known-drift (does not fail), counted by class and cause",
    [kd.status, kd.included, kd.known_drift.count, kd.known_drift.by_class, kd.known_drift.by_cause, kd.new_drift.count],
    ["known-drift", 1, 2, { "divergent-code": 1, "city-not-served-by-geo": 1 }, { "data-gap": 1, "slug-variant": 1 }, 0]);
  eq("inclusionCheck — resolved: baseline ids no longer drifting (gone from immo) are reported only",
    [kd.resolved.count, kd.resolved.included_now, kd.resolved.absent_from_immo, kd.resolved.sample], [2, 0, 2, ["ogc:zones:laval:B-2", "ogc:zones:laval:Q-7"]]);
  const rs = inclusionCheck("ogc:zones:laval:A-1\nogc:zones:laval:B-2\n", G, { baseline: base });
  eq("inclusionCheck — no drift left ⇒ match, every baseline id resolved (laval:B-2 now included)",
    [rs.status, rs.resolved.count, rs.resolved.included_now, rs.resolved.absent_from_immo], ["match", 4, 1, 3]);
  const nd = inclusionCheck("ogc:zones:laval:C-9\nogc:zones:laval:D-4\nogc:zones:quebec:Q-1\nogc:zones:sutton:Z-9\n", G, { baseline: base });
  eq("inclusionCheck — new divergent-code + new city not served ⇒ drift, known-drift still counted",
    [nd.status, nd.new_drift.count, nd.new_drift.divergent_code.sample, nd.new_drift.city_not_served_by_geo.ids_sample, nd.known_drift.count],
    ["drift", 2, ["ogc:zones:laval:D-4"], ["ogc:zones:quebec:Q-1"], 2]);
  const rc = inclusionCheck("ogc:zones:laval:C-9\n", "ogc:zones:montreal:C-408\n", { baseline: base });
  eq("inclusionCheck — a known id changing class stays known-drift, counted as reclassified", [rc.status, rc.known_drift.reclassified], ["known-drift", 1]);
  throws("parseBaseline — wrong format refused", () => parseBaseline({ ...baselineJson([]), format: "x" }));
  throws("parseBaseline — duplicate id refused", () => baselineOf([{ city: "laval", class: "divergent-code", cause: "data-gap", ids: ["ogc:zones:laval:C-9", "ogc:zones:laval:C-9"] }]));
  throws("parseBaseline — id of another city refused", () => baselineOf([{ city: "laval", class: "divergent-code", cause: "data-gap", ids: ["ogc:zones:sutton:C-9"] }]));
  throws("parseBaseline — unknown class refused", () => baselineOf([{ city: "laval", class: "tolerated", cause: "data-gap", ids: [] }]));
  throws("parseBaseline — undeclared cause refused", () => baselineOf([{ city: "laval", class: "divergent-code", cause: "whatever", ids: [] }]));
  // the recorded baseline (D=2026-09-26, run 36255243747)
  const real = JSON.parse(readFileSync(join(DIR, "join-verify-baseline.json"), "utf8"));
  const rb = parseBaseline(real);
  const byClass = {};
  for (const v of rb.entries.values()) byClass[v.class] = (byClass[v.class] || 0) + 1;
  eq("join-verify-baseline.json — parses; 2888 divergent-code + 1106 city-not-served-by-geo", [rb.entries.size, byClass], [3994, { "divergent-code": 2888, "city-not-served-by-geo": 1106 }]);
  eq("join-verify-baseline.json — recorded from D, run, served-ids sha256 of both legs",
    [real.recorded_from.backup_date, real.recorded_from.orchestrator_run_id, real.recorded_from.immo.served_ids_sha256, real.recorded_from.geo.served_ids_sha256],
    ["2026-09-26", "36255243747", "d823f9621312af18938a31ed87e32cb50745271810d301ad3457e1a0506ed313", "64d4aecbb2d6d2f67d108c6d3a5a65a8af50bf8dceefac96bea48424c8a0312a"]);
  eq("join-verify-baseline.json — causes", Object.keys(real.causes).sort(), ["data-gap", "geo-no-zone-code", "referential-version", "slug-variant"]);
  throws("parseServedIds — unsorted refused", () => parseServedIds("ogc:zones:b:1\nogc:zones:a:1\n", "x"));
  throws("parseServedIds — lots id refused (zones scope)", () => parseServedIds("ogc:lots:laval:123\n", "x"));
  throws("parseServedIds — empty refused", () => parseServedIds("", "x"));
  eq("checkLeg — wrong backup date", checkLeg("geo", { verdict: { pg: "success", s3: "success" }, backup: { date: "2026-09-25" } }, "2026-09-26").ok, false);
  eq("checkLeg — green", checkLeg("immo", { verdict: { pg: "success", s3: "success" }, backup: { date: "2026-09-26" }, served_ids_sha256: null }, "2026-09-26").ok, true);
}

// ── tokens ───────────────────────────────────────────────────────────────────
throws("tokenFor — geo without GEO_DISPATCH_TOKEN fails closed", () => tokenFor({ GH_TOKEN_IMMO: "x" }, "geo"));
eq("tokenFor — immo uses the workflow token", tokenFor({ GH_TOKEN_IMMO: "t" }, "immo"), "t");
throws("GithubClient.headers — geo token missing", () => new GithubClient({ env: {}, legs: {}, fetchImpl: () => {} }).headers("geo"));

// ── full chain against a fake GitHub (fake clock) ────────────────────────────
function fakeGh({ geoHasMode = true, geoIdsText, immoIdsText, geoLegDate = "2026-09-26", restoreConclusion = "success", geoRunName = true, startClock = "2026-09-27T10:00:00Z" }) {
  const runs = { immo: [], geo: [] };
  const art = new Map();
  const dispatched = [];
  let id = 1000;
  let clock = Date.parse(startClock);
  const now = () => (clock += 60000);
  const lists = {
    immo: { format: "radar-backup-list/v1", bucket: "radar-immobilier-backup", latestComplete: "2026-09-26",
      backups: [{ date: "2026-09-27", status: "partial" }, { date: "2026-09-26", status: "complete", startedAt: "2026-09-26T02:23:05Z" }] },
    geo: { format: "radar-backup-list/v1", bucket: "geo-backup", latestComplete: "2026-09-27",
      backups: [{ date: "2026-09-27", status: "complete" }, { date: "2026-09-26", status: "complete", startedAt: "2026-09-26T04:00:00Z" }] },
  };
  const gh = {
    dispatched, now,
    headers() { return {}; },
    async workflowFile(t) { return t === "geo" && !geoHasMode ? wf({ withMode: false, extra: "      SKIP_ROLLOUT:\n        type: boolean" }) : wf({ inline: t === "immo", extra: t === "geo" ? "      SKIP_ROLLOUT:\n        type: boolean" : "" }); },
    async dispatch(t, inputs) {
      dispatched.push({ t, inputs, at: clock });
      const rid = ++id;
      // both legs carry "bascule-preprod <MODE> <CYCLE_ID>" (immo #777, geo #408)
      runs[t].push({ id: rid, event: "workflow_dispatch", created_at: new Date(clock).toISOString(), html_url: `https://github.test/${t}/${rid}`,
        display_title: t === "geo" && !geoRunName ? "bascule-preprod (iso-prod)" : `bascule-preprod ${inputs.MODE} ${inputs.CYCLE_ID}` });
      const c = inputs.CYCLE_ID;
      if (inputs.MODE === "list") art.set(`${rid}/${artefacts.backupList(t, c)}/backup-list.json`, Buffer.from(JSON.stringify(lists[t])));
      if (inputs.MODE === "restore") {
        const text = t === "immo" ? immoIdsText : geoIdsText;
        if (text !== null) {
          art.set(`${rid}/${artefacts.servedIds(t, c)}/served-ids.txt`, Buffer.from(text));
          art.set(`${rid}/${artefacts.servedIds(t, c)}/served-ids.txt.sha256`, Buffer.from(`${sha(text)}  served-ids.txt\n`));
        }
        art.set(`${rid}/${artefacts.cycleLeg(t, c)}/cycle-leg-${t}.json`, Buffer.from(JSON.stringify({
          repo: t, run_id: String(rid), verdict: { pg: "success", s3: "success" }, backup: { id: inputs.BACKUP_ID, date: t === "geo" ? geoLegDate : inputs.BACKUP_ID },
          served_ids_sha256: text === null ? null : sha(text) })));
      }
    },
    async recentRuns(t, since) { return runs[t].filter((r) => r.created_at >= since); },
    async run(t, rid) { const r = runs[t].find((x) => x.id === rid); return { status: "completed", conclusion: restoreConclusion, html_url: r.html_url }; },
    async artefactFile(t, rid, name, file) { return art.get(`${rid}/${name}/${file}`) ?? null; },
  };
  return gh;
}
const today = new Date().toISOString().slice(0, 10);
// default baseline of the chain tests: sutton (not served by geo) is known-drift
const SUTTON_BASELINE = baselineFile([{ city: "sutton", class: "city-not-served-by-geo", cause: "slug-variant", ids: ["ogc:zones:sutton:Z-1"] }]);
const CHAIN_STEPS = ["cycle-open", "capabilities", "list-backups", "choose-date", "dispatch-restore", "follow", "collect", "join-verify"];
async function runChain(gh, env, steps = CHAIN_STEPS) {
  const saved = { ...process.env };
  Object.assign(process.env, { CONFIRM: `iso-prod-${today}`, CONFIRM_EXPECTED: `iso-prod-${today}`, DRY_RUN: "false", BASCULE2_JOIN_BASELINE: SUTTON_BASELINE,
    BASCULE2_WORKDIR: mkdtempSync(join(tmpdir(), "bascule2-")), GITHUB_ENV: "", GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "", ...env });
  const o = makeOrchestrator({ gh, now: gh.now, pollSec: 0 });
  let error = null;
  for (const s of steps) { try { await o[s](); } catch (e) { error = { step: s, message: e.message }; break; } }
  let publishError = null;
  try { await o.publish(); } catch (e) { publishError = e.message; }
  let cycle = null;
  try { cycle = JSON.parse(readFileSync(join(process.env.BASCULE2_WORKDIR, "cycle.json"), "utf8")); } catch { cycle = null; }
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  return { error, publishError, cycle };
}
const GEO_IDS = "ogc:zones:laval:A-1\nogc:zones:laval:B-2\nogc:zones:montreal:C-408\n";
{
  const gh = fakeGh({ geoIdsText: GEO_IDS, immoIdsText: "ogc:zones:laval:A-1\nogc:zones:sutton:Z-1\n" });
  const r = await runChain(gh);
  eq("chain — green end to end", [r.error, r.publishError, r.cycle.verdict], [null, null, "success"]);
  eq("chain — common date D = newest complete on both (not immo's partial)", r.cycle.backup.date, "2026-09-26");
  const restores = gh.dispatched.filter((d) => d.inputs.MODE === "restore");
  eq("chain — both legs restore BACKUP_ID=D with the same CYCLE_ID", restores.map((d) => [d.t, d.inputs.BACKUP_ID, d.inputs.CYCLE_ID === r.cycle.cycle_id]),
    [["immo", "2026-09-26", true], ["geo", "2026-09-26", true]]);
  ok("chain — undeclared inputs never sent (immo: no SKIP_ROLLOUT; geo: SKIP_ROLLOUT)", !("SKIP_ROLLOUT" in restores[0].inputs) && restores[1].inputs.SKIP_ROLLOUT === "false");
  ok("chain — list runs are read-only (DRY_RUN=true, MODE=list) and come first", gh.dispatched.slice(0, 2).every((d) => d.inputs.MODE === "list" && d.inputs.DRY_RUN === "true"));
  const j = r.cycle.join_verify;
  eq("chain — known-drift (sutton in the baseline) does not fail; the three counters are in cycle.json",
    [j.status, j.diff_summary.known_drift.count, j.diff_summary.new_drift.count, j.diff_summary.resolved.count, j.diff_summary.city_not_served_by_geo.sample], ["known-drift", 1, 0, 0, ["sutton"]]);
  eq("chain — cycle.json records the baseline used (entries, D, sha256)", [j.baseline.entries, j.baseline.backup_date, j.baseline.sha256], [1, "2026-09-26", sha(readFileSync(SUTTON_BASELINE))]);
  eq("chain — geo captured after immo recorded", r.cycle.backup.geo_after_immo, true);
  ok("chain — both legs correlated by run-name (MODE + CYCLE_ID)", r.cycle.legs.geo.restore_run.correlation === "run-name" && r.cycle.legs.immo.restore_run.correlation === "run-name");
  ok("chain — CONFIRM recomputed at each dispatch (today UTC of that instant)", gh.dispatched.every((d) => d.inputs.CONFIRM === confirmAt(d.at)) &&
    r.cycle.legs.immo.restore_run.confirm_sent === confirmAt(gh.dispatched.find((d) => d.t === "immo" && d.inputs.MODE === "restore").at));
  eq("chain — freshness recorded (age, max 48 h, not stale, no override)", [r.cycle.backup.freshness.max_age_hours, r.cycle.backup.freshness.stale, r.cycle.allow_stale_backup, r.cycle.legs.geo.restore_run.allow_stale_backup], [48, false, false, false]);
  ok("chain — ALLOW_STALE_BACKUP forwarded only where declared (neither fake leg declares it)", restores.every((d) => !("ALLOW_STALE_BACKUP" in d.inputs)));
}
{
  // a cycle crossing midnight UTC: lists dispatched on day N, restores on day N+1
  const gh = fakeGh({ geoIdsText: GEO_IDS, immoIdsText: GEO_IDS, startClock: "2026-09-27T23:57:00Z" });
  const r = await runChain(gh);
  const sent = [...new Set(gh.dispatched.map((d) => d.inputs.CONFIRM))];
  eq("chain — crossing midnight: each dispatch carries its own day's CONFIRM", [r.error, sent], [null, ["iso-prod-2026-09-27", "iso-prod-2026-09-28"]]);
}
{
  const gh = fakeGh({ geoIdsText: GEO_IDS, immoIdsText: GEO_IDS, geoRunName: false });
  const r = await runChain(gh);
  ok("chain — geo run without MODE + CYCLE_ID in its name ⇒ fail-closed at list-backups (never correlated by time)",
    r.error?.step === "list-backups" && /no run named "bascule-preprod list /.test(r.error.message) && /never correlated by time/.test(r.error.message));
}
{
  const gh = fakeGh({ geoIdsText: GEO_IDS, immoIdsText: GEO_IDS, startClock: "2026-09-29T10:00:00Z" });
  const r = await runChain(gh);
  ok("chain — common date older than 48 h ⇒ refused at choose-date, no restore dispatched",
    r.error?.step === "choose-date" && /ALLOW_STALE_BACKUP=true/.test(r.error.message) && gh.dispatched.every((d) => d.inputs.MODE === "list"));
  const gh2 = fakeGh({ geoIdsText: GEO_IDS, immoIdsText: GEO_IDS, startClock: "2026-09-29T10:00:00Z" });
  const r2 = await runChain(gh2, { ALLOW_STALE_BACKUP: "true" });
  eq("chain — stale D + ALLOW_STALE_BACKUP=true ⇒ green, override recorded in cycle.json and per leg",
    [r2.error, r2.cycle.verdict, r2.cycle.allow_stale_backup, r2.cycle.backup.freshness.overridden, r2.cycle.legs.immo.restore_run.allow_stale_backup], [null, "success", true, true, true]);
}
{
  const r = await runChain(fakeGh({ geoIdsText: GEO_IDS, immoIdsText: "ogc:zones:laval:A-1\nogc:zones:laval:Z-9\n" }));
  eq("chain — new divergent-code (absent from the baseline) ⇒ join-verify fails, verdict failure",
    [r.error?.step, r.cycle.join_verify.status, r.cycle.join_verify.diff_summary.new_drift.divergent_code.count, r.cycle.verdict], ["join-verify", "drift", 1, "failure"]);
  const r2 = await runChain(fakeGh({ geoIdsText: GEO_IDS, immoIdsText: "ogc:zones:laval:A-1\nogc:zones:quebec:Q-1\nogc:zones:sutton:Z-1\n" }));
  eq("chain — new city not served by geo ⇒ join-verify fails (known sutton still counted)",
    [r2.error?.step, r2.cycle.join_verify.diff_summary.new_drift.city_not_served_by_geo.sample, r2.cycle.join_verify.diff_summary.known_drift.count, r2.cycle.verdict],
    ["join-verify", ["quebec"], 1, "failure"]);
  const r3 = await runChain(fakeGh({ geoIdsText: GEO_IDS, immoIdsText: GEO_IDS }), { BASCULE2_JOIN_BASELINE: baselineFile([
    { city: "sutton", class: "city-not-served-by-geo", cause: "slug-variant", ids: ["ogc:zones:sutton:Z-1"] },
    { city: "laval", class: "divergent-code", cause: "data-gap", ids: ["ogc:zones:laval:B-2"] }]) });
  eq("chain — resolved baseline ids are reported (1 now included, 1 gone), verdict success",
    [r3.error, r3.cycle.join_verify.status, r3.cycle.join_verify.diff_summary.resolved.included_now, r3.cycle.join_verify.diff_summary.resolved.absent_from_immo, r3.cycle.verdict],
    [null, "match", 1, 1, "success"]);
  const r4 = await runChain(fakeGh({ geoIdsText: GEO_IDS, immoIdsText: "ogc:zones:laval:A-1\nogc:zones:sutton:Z-1\n" }), { BASCULE2_JOIN_BASELINE: "none" });
  eq("chain — BASCULE2_JOIN_BASELINE=none (strict): the city not served fails", [r4.error?.step, r4.cycle.join_verify.baseline, r4.cycle.verdict], ["join-verify", null, "failure"]);
  const r5 = await runChain(fakeGh({ geoIdsText: GEO_IDS, immoIdsText: GEO_IDS }), { BASCULE2_JOIN_BASELINE: join(tmpdir(), "no-such-baseline.json") });
  ok("chain — baseline file missing ⇒ join-verify fails closed", r5.error?.step === "join-verify" && /baseline .* missing/.test(r5.error.message) && r5.cycle.verdict === "failure");
}
{
  const gh = fakeGh({ geoHasMode: false, geoIdsText: GEO_IDS, immoIdsText: GEO_IDS });
  const r = await runChain(gh);
  ok("chain — geo without MODE/BACKUP_ID ⇒ fail-closed at capabilities, nothing dispatched",
    r.error?.step === "capabilities" && /geo-cond must add/.test(r.error.message) && gh.dispatched.length === 0 && r.cycle.verdict === "failure");
}
{
  const r = await runChain(fakeGh({ geoIdsText: GEO_IDS, immoIdsText: null }));
  ok("chain — immo served-ids missing (O1) ⇒ join-verify fails closed", r.error?.step === "join-verify" && /served-refs Job on the restored DB/.test(r.error.message));
}
{
  const r = await runChain(fakeGh({ geoIdsText: GEO_IDS, immoIdsText: GEO_IDS, geoLegDate: "2026-09-27" }));
  ok("chain — a leg restoring another date ⇒ collect fails", r.error?.step === "collect" && /backup\.date is 2026-09-27/.test(r.error.message));
}
{
  const gh = fakeGh({ geoIdsText: GEO_IDS, immoIdsText: GEO_IDS });
  const r = await runChain(gh, { DRY_RUN: "true" });
  eq("chain — DRY: lists + date, no restore dispatched", [r.cycle.verdict, gh.dispatched.filter((d) => d.inputs.MODE === "restore").length], ["dry-run-ok", 0]);
}
{
  const r = await runChain(fakeGh({ geoIdsText: GEO_IDS, immoIdsText: GEO_IDS }), { CONFIRM: "iso-prod-2020-01-01" });
  eq("chain — stale CONFIRM ⇒ refused at cycle-open, no cycle", [r.error?.step, r.cycle], ["cycle-open", null]);
}

// ── workflow wiring ──────────────────────────────────────────────────────────
{
  const w = readFileSync(join(DIR, "..", "..", "..", ".github", "workflows", "bascule-e2e.yml"), "utf8");
  ok("bascule-e2e.yml — environment radar-e2e", /\n {4}environment: radar-e2e\n/.test(w));
  ok("bascule-e2e.yml — a single job declares environment radar-e2e (the one dispatching geo)",
    (w.match(/environment: radar-e2e/g) || []).length === 1 && /\n {2}e2e:\n[\s\S]*?\n {4}environment: radar-e2e\n[\s\S]*dispatch-restore/.test(w) && (w.match(/\n {2}[a-z][a-z0-9-]*:\n {4}(if|runs-on|needs|environment)/g) || []).length === 1);
  // GEO_DISPATCH_TOKEN: never at job level, only in the env of the steps that call geo
  const jobEnv = (w.match(/\n {4}env:\n((?: {6}.*\n)+)/) || [])[1] || "";
  ok("bascule-e2e.yml — no token in the job-level env", !/GEO_DISPATCH_TOKEN|GH_TOKEN_IMMO|secrets\./.test(jobEnv));
  const steps = w.split(/\n {6}- /).slice(1);
  const stepOf = (re) => steps.find((s) => re.test(s)) || "";
  const geoCallers = ["capabilities", "list-backups", "dispatch-restore", "follow", "collect", "join-verify"];
  ok("bascule-e2e.yml — GEO_DISPATCH_TOKEN in the env of each step calling geo", geoCallers.every((c) =>
    new RegExp(`GEO_DISPATCH_TOKEN: \\$\\{\\{ secrets\\.GEO_DISPATCH_TOKEN \\}\\}\\n\\s+run: node "\\$ORCH" ${c}\\n`).test(stepOf(new RegExp(`run: node "\\$ORCH" ${c}\\n`)))));
  ok("bascule-e2e.yml — token count = the geo-calling steps only", (w.match(/secrets\.GEO_DISPATCH_TOKEN/g) || []).length === geoCallers.length);
  ok("bascule-e2e.yml — no token for checkout / setup-node / upload-artifact / cycle-open / choose-date / publish",
    steps.filter((s) => /uses: actions\/|ORCH" (cycle-open|choose-date|publish)\n/.test(s)).every((s) => !/GEO_DISPATCH_TOKEN|GH_TOKEN_IMMO/.test(s)));
  const uses = [...w.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  ok(`bascule-e2e.yml — every action pinned by a full commit SHA (${uses.length})`, uses.length === 3 && uses.every((u) => /^actions\/[a-z-]+@[0-9a-f]{40}$/.test(u)));
  ok("bascule-e2e.yml — input ALLOW_STALE_BACKUP (boolean, default false) passed via env", /ALLOW_STALE_BACKUP:\n\s+description:[^\n]*\n\s+required: false\n\s+type: boolean\n\s+default: false/.test(w) &&
    w.includes("ALLOW_STALE_BACKUP: ${{ inputs.ALLOW_STALE_BACKUP && 'true' || 'false' }}"));
  ok("bascule-e2e.yml — doc states the real token (gh OAuth, every rhanka repo, PAT debt)", /`gh` OAuth token of rhanka/.test(w) && /EVERY repository of rhanka/.test(w) && /fine-grained PAT/.test(w));
  const cred = readFileSync(join(DIR, "CRED_CYCLE.md"), "utf8");
  ok("CRED_CYCLE.md — GEO_DISPATCH_TOKEN: source, real scope, invalidation, debt", /gh auth token/.test(cred) && /every repository of `rhanka`/.test(cred) &&
    /gh auth logout/.test(cred) && /fine-grained PAT/.test(cred) && /radar-e2e/.test(cred));
  ok("bascule-e2e.yml — main-only guard", w.includes("if: ${{ github.ref == 'refs/heads/main' }}"));
  const runs = [...w.matchAll(/run: (?:\|\n((?: {10,}.*\n?)+)|(.*))/g)].map((m) => m[1] || m[2]);
  ok(`bascule-e2e.yml — no \${{ }} in any of the ${runs.length} run blocks`, runs.length >= 8 && runs.every((r) => !r.includes("${{")));
  ok("bascule-e2e.yml — permissions actions: write, contents: read", /permissions:\n\s+contents: read\n\s+actions: write/.test(w));
  ok("bascule-e2e.yml — publish always()", /- name: publish[^\n]*\n\s+if: \$\{\{ always\(\) \}\}/.test(w));
}

console.log(`\norchestrator.selftest — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
