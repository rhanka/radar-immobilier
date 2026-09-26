// =============================================================================
// cycle.mjs — PURE model of the e2e immo+geo restore FROM BACKUPS (no I/O).
//
// The orchestrator (orchestrator.mjs, workflow bascule-e2e.yml) restores BOTH
// tenants' preprod from their daily backups of the SAME date D and proves the
// cross-tenant coherence by an INCLUSION join-verify of the served canonical ids
// (immo ⊆ geo, zones first). Everything here is side-effect free and unit-tested
// (orchestrator.selftest.mjs):
//   - CYCLE_ID (RFC1123, also valid for the geo pattern ^[A-Za-z0-9._-]{1,100}$);
//   - workflow_dispatch input discovery (capability check before any dispatch);
//   - run correlation (run-name carrying MODE + CYCLE_ID, time fallback);
//   - common backup date D (both tenants `complete`);
//   - inclusion join-verify with classes `city-not-served-by-geo` (tolerated,
//     reported) vs `divergent-code` (fails);
//   - cycle.json schema.
// =============================================================================
import { Buffer } from "node:buffer";

export const TENANTS = Object.freeze(["immo", "geo"]);
export const CONFIRM_RE = /^iso-prod-\d{4}-\d{2}-\d{2}$/;
export const GEO_CYCLE_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
const RFC1123_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

// Per-leg workflow + artefact contract (immo: PR "restore preprod from a daily
// backup"; geo: to be added by geo-cond — see README "What geo must add").
export const LEGS = Object.freeze({
  immo: Object.freeze({ repo: "rhanka/radar-immobilier", workflow: "bascule-preprod.yml", ref: "main" }),
  geo: Object.freeze({ repo: "rhanka/geo", workflow: "bascule-preprod.yml", ref: "main" }),
});
export const REQUIRED_INPUTS = Object.freeze(["CONFIRM", "DRY_RUN", "MODE", "BACKUP_ID", "CYCLE_ID"]);
export const REQUIRED_MODES = Object.freeze(["list", "restore"]);
export const artefacts = Object.freeze({
  backupList: (t, c) => `backup-list-${t}-${c}`,
  cycleLeg: (t, c) => `cycle-leg-${t}-${c}`,
  servedIds: (t, c) => `${t}-served-canonical-ids-${c}`,
  cycle: (c) => `cycle-${c}`,
});
export const FILES = Object.freeze({
  backupList: "backup-list.json",
  cycleLeg: (t) => `cycle-leg-${t}.json`,
  servedIds: "served-ids.txt",
  servedIdsSha: "served-ids.txt.sha256",
});

export function isValidDate(d) {
  if (typeof d !== "string" || !DATE_RE.test(d)) return false;
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
}

// CYCLE_ID = <CONFIRM>-<base36 epoch seconds of T0>: unique per second, RFC1123.
export function makeCycleId(confirm, t0Ms) {
  if (!CONFIRM_RE.test(String(confirm ?? ""))) throw new Error("CONFIRM must match iso-prod-AAAA-MM-JJ");
  const t0 = Number(t0Ms);
  if (!Number.isFinite(t0) || t0 <= 0) throw new Error("t0Ms must be a positive epoch-ms");
  const id = `${confirm}-${Math.floor(t0 / 1000).toString(36)}`;
  return assertCycleId(id);
}
export function assertCycleId(id) {
  const s = String(id ?? "");
  if (!RFC1123_RE.test(s) || !GEO_CYCLE_ID_RE.test(s)) throw new Error("CYCLE_ID is not a valid RFC1123 label");
  return s;
}

// Minimal reader of `on.workflow_dispatch.inputs` of a workflow file (no YAML
// dependency): { NAME: { type, options[] } }. Handles block and inline lists.
export function parseDispatchInputs(yamlText) {
  const lines = String(yamlText ?? "").replace(/\r/g, "").split("\n");
  const indentOf = (l) => l.length - l.trimStart().length;
  const isContent = (l) => l.trim() !== "" && !l.trim().startsWith("#");
  let i = lines.findIndex((l) => /^\s*workflow_dispatch:\s*$/.test(l));
  if (i < 0) return {};
  const wdIndent = indentOf(lines[i]);
  let inputsIndent = -1;
  for (i += 1; i < lines.length; i++) {
    if (!isContent(lines[i])) continue;
    if (indentOf(lines[i]) <= wdIndent) return {};
    if (/^\s*inputs:\s*$/.test(lines[i])) { inputsIndent = indentOf(lines[i]); break; }
  }
  if (inputsIndent < 0) return {};
  const inputs = {};
  let current = null; let nameIndent = -1; let inOptions = false; let optionsIndent = -1;
  for (i += 1; i < lines.length; i++) {
    const l = lines[i];
    if (!isContent(l)) continue;
    const ind = indentOf(l);
    if (ind <= inputsIndent) break;
    const t = l.trim();
    if (nameIndent < 0) nameIndent = ind;
    if (ind === nameIndent) {
      const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(t);
      if (m) { current = { type: null, options: [] }; inputs[m[1]] = current; inOptions = false; }
      continue;
    }
    if (!current) continue;
    if (inOptions && ind > optionsIndent && t.startsWith("- ")) { current.options.push(t.slice(2).trim().replace(/^["']|["']$/g, "")); continue; }
    inOptions = false;
    let m = /^type:\s*(\S+)/.exec(t);
    if (m) current.type = m[1];
    m = /^options:\s*\[(.*)\]\s*$/.exec(t);
    if (m) current.options = m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else if (/^options:\s*$/.test(t)) { inOptions = true; optionsIndent = ind; }
  }
  return inputs;
}

// Capability of a leg for the restore-from-backup e2e; `missing` lists what the
// leg's workflow must still declare.
export function checkCapabilities(inputs) {
  const missing = REQUIRED_INPUTS.filter((k) => !inputs[k]);
  if (inputs.MODE) {
    for (const m of REQUIRED_MODES) if (inputs.MODE.options.length && !inputs.MODE.options.includes(m)) missing.push(`MODE option '${m}'`);
  }
  return { ok: missing.length === 0, missing };
}

// Only the inputs the target workflow declares (GitHub refuses unknown inputs, 422).
export function filterInputs(wanted, declared) {
  return Object.fromEntries(Object.entries(wanted).filter(([k]) => Object.prototype.hasOwnProperty.call(declared, k)));
}

// Correlate a workflow_dispatch with its run: run-name carrying MODE + CYCLE_ID
// first (immo: "bascule-preprod <MODE> <CYCLE_ID>"), else the single run created
// after the dispatch (time fallback, ambiguous ⇒ null).
export function correlateRun(runs, { cycleId, mode, dispatchedAtMs, skewMs = 15000 }) {
  const list = Array.isArray(runs) ? runs : [];
  const byTitle = list.filter((r) => typeof r?.display_title === "string" &&
    r.display_title.split(/\s+/).includes(cycleId) && r.display_title.split(/\s+/).includes(mode));
  if (byTitle.length === 1) return { run: byTitle[0], correlation: "run-name" };
  if (byTitle.length > 1) return { run: null, correlation: "ambiguous-run-name" };
  const after = list.filter((r) => r?.event === "workflow_dispatch" && Date.parse(r.created_at) >= dispatchedAtMs - skewMs);
  if (after.length === 1) return { run: after[0], correlation: "time" };
  return { run: null, correlation: after.length ? "ambiguous-time" : "not-found" };
}

// Backup list artefact (format radar-backup-list/v1) → validated entries.
export function parseBackupList(json, tenant) {
  if (!json || json.format !== "radar-backup-list/v1" || !Array.isArray(json.backups)) {
    throw new Error(`${tenant}: backup list is not radar-backup-list/v1`);
  }
  return {
    tenant,
    bucket: typeof json.bucket === "string" ? json.bucket : null,
    truncated: json.truncated === true,
    latestComplete: isValidDate(json.latestComplete) ? json.latestComplete : null,
    backups: json.backups.filter((b) => b && isValidDate(b.date)).map((b) => ({
      date: b.date,
      status: typeof b.status === "string" ? b.status : "invalid",
      pgSha256: typeof b.pgSha256 === "string" && /^[0-9a-f]{8,64}$/.test(b.pgSha256) ? b.pgSha256 : null,
      startedAt: typeof b.startedAt === "string" && Number.isFinite(Date.parse(b.startedAt)) ? new Date(Date.parse(b.startedAt)).toISOString() : null,
    })),
  };
}

// Common date D: newest date where BOTH tenants have a `complete` backup, or the
// requested date (refused unless complete on both sides).
export function chooseCommonDate({ immo, geo, requested }) {
  const complete = (l) => new Map(l.backups.filter((b) => b.status === "complete").map((b) => [b.date, b]));
  const a = complete(immo);
  const b = complete(geo);
  const common = [...a.keys()].filter((d) => b.has(d)).sort().reverse();
  let date;
  if (requested) {
    if (!isValidDate(requested)) throw new Error("BACKUP_DATE must be YYYY-MM-DD");
    if (!a.has(requested)) throw new Error(`immo has no complete backup at ${requested}`);
    if (!b.has(requested)) throw new Error(`geo has no complete backup at ${requested}`);
    date = requested;
  } else {
    if (!common.length) throw new Error("no date with a complete backup on BOTH tenants");
    date = common[0];
  }
  const ia = a.get(date).startedAt; const gb = b.get(date).startedAt;
  // Coherence by order (dossier §5): geo captured at or after immo ⇒ superset.
  const geoAfterImmo = ia && gb ? Date.parse(gb) >= Date.parse(ia) : null;
  return { date, requested: requested || null, candidates: common.slice(0, 7), immo: a.get(date), geo: b.get(date), geoAfterImmo,
    truncatedLists: immo.truncated || geo.truncated };
}

// Served-ids file → ids, checked: `ogc:zones:<slug>:<code>`, strictly increasing byte order.
export function parseServedIds(text, label) {
  const ids = String(text ?? "").split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length);
  const shape = /^ogc:zones:[a-z0-9][a-z0-9-]*:\S+$/;
  for (let i = 0; i < ids.length; i++) {
    if (!shape.test(ids[i])) throw new Error(`${label}: id out of the zones format at line ${i + 1}`);
    if (i > 0 && Buffer.compare(Buffer.from(ids[i - 1]), Buffer.from(ids[i])) >= 0) throw new Error(`${label}: ids not strictly byte-ordered at line ${i + 1}`);
  }
  if (!ids.length) throw new Error(`${label}: empty served-ids file (fail-closed)`);
  return ids;
}
const cityOf = (id) => id.split(":")[2];

// INCLUSION immo ⊆ geo (zones). An immo id absent from geo is
//   city-not-served-by-geo  when geo serves NO zone of that city (tolerated, reported),
//   divergent-code          when geo serves the city but not that code (FAILS).
export function inclusionCheck(immoText, geoText, { sample = 50 } = {}) {
  const immo = parseServedIds(immoText, "immo");
  const geo = parseServedIds(geoText, "geo");
  const geoSet = new Set(geo);
  const geoCities = new Set(geo.map(cityOf));
  const notServed = new Map();
  const divergent = [];
  let included = 0;
  for (const id of immo) {
    if (geoSet.has(id)) { included += 1; continue; }
    const city = cityOf(id);
    if (!geoCities.has(city)) notServed.set(city, (notServed.get(city) || 0) + 1);
    else divergent.push(id);
  }
  const cities = [...notServed.keys()].sort();
  return {
    status: divergent.length ? "drift" : "match",
    scope: "zones",
    immo_count: immo.length,
    geo_count: geo.length,
    included,
    city_not_served_by_geo: { count: [...notServed.values()].reduce((s, n) => s + n, 0), cities: cities.length, sample: cities.slice(0, sample) },
    divergent_code: { count: divergent.length, sample: divergent.slice(0, sample) },
  };
}

// A leg is green when its cycle-leg reports pg/s3 success for the backup date D.
export function checkLeg(tenant, leg, date) {
  const problems = [];
  if (!leg || typeof leg !== "object") return { ok: false, problems: [`${tenant}: cycle-leg artefact missing`] };
  if (leg.verdict?.pg !== "success") problems.push(`${tenant}: verdict.pg=${leg.verdict?.pg ?? "missing"}`);
  if (leg.verdict?.s3 !== "success") problems.push(`${tenant}: verdict.s3=${leg.verdict?.s3 ?? "missing"}`);
  if (!leg.backup || leg.backup.date !== date) problems.push(`${tenant}: legs.${tenant}.backup.date is ${leg.backup?.date ?? "missing"} (expected ${date})`);
  if (leg.served_ids_sha256 !== null && leg.served_ids_sha256 !== undefined && !SHA_RE.test(leg.served_ids_sha256)) problems.push(`${tenant}: served_ids_sha256 invalid`);
  return { ok: problems.length === 0, problems };
}

export function newCycle({ cycleId, confirm, createdAt, orchestratorRunId = null, dryRun = true }) {
  assertCycleId(cycleId);
  if (!CONFIRM_RE.test(String(confirm ?? ""))) throw new Error("CONFIRM must match iso-prod-AAAA-MM-JJ");
  const leg = (t) => ({ repo: LEGS[t].repo, workflow: LEGS[t].workflow, capabilities: null, list_run: null, restore_run: null, cycle_leg: null });
  return {
    format: "radar-bascule-cycle/v1",
    cycle_id: cycleId,
    confirm,
    created_at: createdAt,
    orchestrator_run_id: orchestratorRunId,
    dry_run: !!dryRun,
    backup: null,
    legs: { immo: leg("immo"), geo: leg("geo") },
    join_verify: { status: "pending", scope: "zones", compared_at: null, diff_summary: null },
    verdict: "pending",
    problems: [],
  };
}
