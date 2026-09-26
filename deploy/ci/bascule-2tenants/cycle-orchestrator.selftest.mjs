#!/usr/bin/env node
// =============================================================================
// cycle-orchestrator.selftest.mjs — pure-function + geo-import self-test.
//
// 0 network, 0 GitHub API, 0 dispatch: exercises the PURE model (cycle.mjs),
// the join-verify byte-identity core (served-canonical-ids.mjs) against the REAL
// @sentropic/geo@>=0.6.2 (this is the Task-1 import proof AND the dossier §9
// anti-divergence proof), and the INERT defaults of both seams.
//
//   node deploy/ci/bascule-2tenants/cycle-orchestrator.selftest.mjs  → exit 0 if all pass.
// =============================================================================
import console from "node:console";
import process from "node:process";

import { assertCycleId, makeCycleId, newCycle, sanitizeRfc1123, setJoinVerify, setLeg, validateCycle } from "./cycle.mjs";
import { buildServedIds, byteCompare, sha256Hex, subsetCheck } from "./served-canonical-ids.mjs";
import { loadGeo } from "./geo-loader.mjs";
import { dispatchUrl, InertDispatcher, jobVerdict, LEG_DEFAULTS, resolveLegToken, runJobsUrl } from "./dispatch.mjs";
import { InertRendezvous, servedIdsArtifactName } from "./join-verify.mjs";

let passed = 0;
let failed = 0;
const ok = (name, cond) => { if (cond) { passed += 1; console.log(`  ok   ${name}`); } else { failed += 1; console.log(`  FAIL ${name}`); } };
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const throws = (name, fn) => { try { fn(); ok(name, false); } catch { ok(name, true); } };
const rejects = async (name, p) => { try { await p; ok(name, false); } catch { ok(name, true); } };

// ── cycle.mjs — CYCLE_ID + RFC1123 ───────────────────────────────────────────
eq("sanitizeRfc1123 — lowercases + strips", sanitizeRfc1123("Iso Prod #9"), "iso-prod--9");
eq("sanitizeRfc1123 — trims trailing dashes", sanitizeRfc1123("--x--"), "x");
ok("sanitizeRfc1123 — bounded to 63", sanitizeRfc1123("a".repeat(200)).length <= 63);
{
  const cid = makeCycleId("iso-prod-2026-09-25", Date.UTC(2026, 8, 25, 3, 0, 0));
  ok("makeCycleId — starts with CONFIRM", cid.startsWith("iso-prod-2026-09-25-"));
  ok("makeCycleId — RFC1123 valid", assertCycleId(cid) === cid);
  eq("makeCycleId — deterministic on same T0", cid, makeCycleId("iso-prod-2026-09-25", Date.UTC(2026, 8, 25, 3, 0, 0)));
}
throws("makeCycleId — bad CONFIRM throws", () => makeCycleId("nope", Date.now()));
throws("assertCycleId — uppercase rejected", () => assertCycleId("ISO-PROD"));

// ── cycle.mjs — schema (locked) ──────────────────────────────────────────────
{
  const cid = makeCycleId("iso-prod-2026-09-25", 1_800_000_000_000);
  const c = newCycle({ cycleId: cid, confirm: "iso-prod-2026-09-25", createdAt: "2026-09-25T03:00:00.000Z" });
  eq("newCycle — cycle_id set", c.cycle_id, cid);
  eq("newCycle — legs pending", [c.legs.immo.verdict.pg, c.legs.geo.verdict.s3], ["pending", "pending"]);
  eq("newCycle — join_verify pending", c.join_verify.status, "pending");
  ok("validateCycle — accepts a fresh cycle", validateCycle(c) === c);
  setLeg(c, "immo", { run_id: 123, verdict: { pg: "success" } });
  eq("setLeg — merges verdict field-wise (s3 kept)", [c.legs.immo.verdict.pg, c.legs.immo.verdict.s3], ["success", "pending"]);
  setJoinVerify(c, { status: "match", comparedAt: "2026-09-25T04:00:00.000Z", diffSummary: { immo_count: 2, geo_count: 2 } });
  eq("setJoinVerify — match recorded", c.join_verify.status, "match");
  throws("setJoinVerify — invalid status throws", () => setJoinVerify(c, { status: "bogus" }));
}
throws("validateCycle — rejects malformed cycle", () => validateCycle({ cycle_id: "BAD", confirm: "x" }));

// ── served-canonical-ids.mjs — sha + byteCompare + subset (pure) ─────────────
eq("sha256Hex — deterministic", sha256Hex("abc\n"), sha256Hex("abc\n"));
{
  const a = "ogc:lots:x:1\nogc:zones:x:C-1\n";
  eq("byteCompare — identical ⇒ match", byteCompare(a, a).status, "match");
  const b = "ogc:lots:x:1\n";
  const d = byteCompare(a, b);
  eq("byteCompare — differ ⇒ drift", d.status, "drift");
  eq("byteCompare — immo_only count", d.diff_summary.immo_only.count, 1);
  eq("subsetCheck — immo ⊆ served ⇒ ok", subsetCheck(b, a).ok, true);
  eq("subsetCheck — pending when immo has extra", subsetCheck(a, b).ok, false);
}

// ── dispatch.mjs — pure helpers + token resolution + inert default ───────────
eq("dispatchUrl — immo leg", dispatchUrl(LEG_DEFAULTS.immo.repo, LEG_DEFAULTS.immo.workflow), "https://api.github.com/repos/rhanka/radar-immobilier/actions/workflows/bascule-preprod.yml/dispatches");
eq("runJobsUrl — geo leg", runJobsUrl(LEG_DEFAULTS.geo.repo, 42), "https://api.github.com/repos/rhanka/geo/actions/runs/42/jobs");
eq("jobVerdict — completed/success", jobVerdict({ status: "completed", conclusion: "success" }), "success");
eq("jobVerdict — in_progress", jobVerdict({ status: "in_progress" }), "in_progress");
throws("resolveLegToken — geo without token fails closed", () => resolveLegToken({}, "geo"));
eq("resolveLegToken — geo with token", resolveLegToken({ GEO_DISPATCH_TOKEN: "t" }, "geo"), "t");
eq("resolveLegToken — immo falls back to GITHUB_TOKEN", resolveLegToken({ GITHUB_TOKEN: "g" }, "immo"), "g");

// ── join-verify.mjs — artefact naming + inert default ────────────────────────
eq("servedIdsArtifactName — locked pattern", servedIdsArtifactName("geo", "iso-prod-2026-09-25-abc"), "geo-served-canonical-ids-iso-prod-2026-09-25-abc");

// ── async block: geo import (Task 1) + §9 byte-identity + inert rejects ───────
async function asyncSuite() {
  const geo = await loadGeo();
  console.log(`  info @sentropic/geo@${geo.version} resolved (via api anchor)`);
  for (const sym of ["buildServedCanonicalIds", "serializeServedCanonicalIds", "canonicalizeZoneCodeForJoin", "canonicalizeNoLotForJoin"]) {
    ok(`geo symbol '${sym}' is a function`, typeof geo[sym] === "function");
  }
  {
    const [major, minor] = String(geo.version).split(".").map(Number);
    ok(`geo version >= 0.6.2 (got ${geo.version})`, major > 0 || (major === 0 && minor >= 6));
  }

  // dossier §9(a): two RAW variants of the SAME entities converge byte-identically
  // through the SINGLE-SOURCE geo canonicalizers (no locale/normalizer divergence).
  const immoSide = buildServedIds(geo, {
    zones: [{ citySlug: "montreal", zoneCode: "C408" }, { citySlug: "montreal", zoneCode: "C 408" }],
    lots: [{ citySlug: "montreal", noLot: "1 234 567" }],
  });
  const geoSide = buildServedIds(geo, {
    zones: [{ citySlug: "montreal", zoneCode: "C-408" }],
    lots: [{ citySlug: "montreal", noLot: "1234567" }],
  });
  ok("§9 — RAW zone variants (C408 / 'C 408' / C-408) fold to one served id", immoSide.ids.filter((s) => s.startsWith("ogc:zones:montreal:")).length === 1);
  ok("§9 — immo/geo RAW variants byte-identical", immoSide.text === geoSide.text && immoSide.sha256 === geoSide.sha256);
  eq("§9 — byteCompare of converged sets ⇒ match", byteCompare(immoSide.text, geoSide.text).status, "match");

  // A genuinely different served set ⇒ drift (fail-closed signal).
  const geoMissingLot = buildServedIds(geo, { zones: [{ citySlug: "montreal", zoneCode: "C-408" }] });
  const drift = byteCompare(immoSide.text, geoMissingLot.text);
  eq("§9 — missing entity ⇒ drift", drift.status, "drift");
  ok("§9 — drift surfaces the pending lot", drift.diff_summary.immo_only.count === 1);

  // Inert seam defaults fail closed on use (documented no-op posture).
  await rejects("InertDispatcher.dispatch rejects", new InertDispatcher().dispatch({ tenant: "geo", ref: "main", inputs: {} }));
  await rejects("InertRendezvous.fetchServedIds rejects", new InertRendezvous().fetchServedIds({ tenant: "geo", cycleId: "x", runId: 1 }));
}

await asyncSuite();
console.log(`\ncycle-orchestrator.selftest — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
