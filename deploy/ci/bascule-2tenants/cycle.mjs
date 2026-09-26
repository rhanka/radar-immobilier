// =============================================================================
// cycle.mjs — PURE model of the e2e immo+geo restore FROM BACKUPS (no I/O).
//
// The orchestrator (orchestrator.mjs, workflow bascule-e2e.yml) restores BOTH
// tenants' preprod from their daily backups of the SAME date D and proves the
// cross-tenant coherence by an INCLUSION join-verify of the served canonical ids
// (immo ⊆ geo, zones first). Everything here is side-effect free and unit-tested
// (orchestrator.selftest.mjs):
//   - CYCLE_ID (RFC1123, also valid for the geo pattern ^[A-Za-z0-9._-]{1,100}$);
//   - workflow_dispatch input discovery (capability check before any dispatch,
//     MODE choice with options list + restore);
//   - CONFIRM computed at each dispatch (today UTC at that instant);
//   - run correlation by run-name carrying MODE + CYCLE_ID only (never by time);
//   - common backup date D (both tenants `complete`, ≤ 48 h old unless
//     ALLOW_STALE_BACKUP; a date outside a truncated list refused);
//   - inclusion join-verify (classes `city-not-served-by-geo` / `divergent-code`)
//     judged on FIDELITY against the recorded baseline: known-drift (counted),
//     new drift (fails), resolved (reported, to purge from the baseline);
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
// Freshness of the common date D (dossier §5): at most 48 h old by default;
// older only with the explicit input ALLOW_STALE_BACKUP=true (recorded).
export const DEFAULT_MAX_AGE_HOURS = 48;
const HOUR_MS = 3600000;
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
// leg's workflow must still declare. MODE must be a `choice` whose options hold
// `list` and `restore` (a free string MODE, or options without them, is refused).
export function checkCapabilities(inputs) {
  const missing = REQUIRED_INPUTS.filter((k) => !inputs[k]);
  if (inputs.MODE) {
    if (inputs.MODE.type !== "choice") missing.push("MODE type 'choice'");
    const options = Array.isArray(inputs.MODE.options) ? inputs.MODE.options : [];
    for (const m of REQUIRED_MODES) if (!options.includes(m)) missing.push(`MODE option '${m}'`);
  }
  return { ok: missing.length === 0, missing };
}

// CONFIRM sent to a leg = today UTC AT THE DISPATCH (the legs check their own
// anti-replay against their day): a cycle crossing midnight UTC still dispatches
// a CONFIRM the leg accepts. The owner's CONFIRM is checked once, at cycle-open.
export function confirmAt(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) throw new Error("confirmAt needs an epoch-ms");
  return `iso-prod-${new Date(t).toISOString().slice(0, 10)}`;
}

// Only the inputs the target workflow declares (GitHub refuses unknown inputs, 422).
export function filterInputs(wanted, declared) {
  return Object.fromEntries(Object.entries(wanted).filter(([k]) => Object.prototype.hasOwnProperty.call(declared, k)));
}

// Correlate a workflow_dispatch with its run ONLY by the run-name carrying MODE +
// CYCLE_ID (both legs: "bascule-preprod <MODE> <CYCLE_ID>", immo #777, geo #408).
// Never by time: no match ⇒ not-found (the caller waits, then fails closed);
// two matches ⇒ ambiguous (no guess).
export function correlateRun(runs, { cycleId, mode }) {
  const list = Array.isArray(runs) ? runs : [];
  const byTitle = list.filter((r) => typeof r?.display_title === "string" &&
    r.display_title.split(/\s+/).includes(cycleId) && r.display_title.split(/\s+/).includes(mode));
  if (byTitle.length === 1) return { run: byTitle[0], correlation: "run-name" };
  if (byTitle.length > 1) return { run: null, correlation: "ambiguous-run-name" };
  return { run: null, correlation: "not-found" };
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

// Age of the common date D: from the OLDER capture of the two backups (their
// `startedAt`), else D at 00:00 UTC (earlier than any capture of D: conservative).
export function backupAge({ date, immoStartedAt, geoStartedAt, nowMs }) {
  const refs = [immoStartedAt, geoStartedAt].filter((v) => typeof v === "string" && Number.isFinite(Date.parse(v))).map((v) => Date.parse(v));
  const refMs = refs.length === 2 ? Math.min(...refs) : Date.parse(`${date}T00:00:00Z`);
  const source = refs.length === 2 ? "older startedAt of the two backups" : "D 00:00 UTC (a startedAt is missing)";
  return { ageHours: Math.round(((nowMs - refMs) / HOUR_MS) * 10) / 10, reference: new Date(refMs).toISOString(), source };
}

// A requested date absent from a TRUNCATED list (newest entries only: the immo
// list travels in a termination message, ~15 dates) cannot be confirmed: refused
// with the listed window, never assumed complete.
function notCompleteReason(tenant, list, date) {
  const dates = list.backups.map((x) => x.date).sort();
  if (list.truncated && dates.length && date < dates[0]) {
    return `${tenant} list is truncated to its newest ${dates.length} backups (${dates[0]}..${dates[dates.length - 1]}): ` +
      `${date} is outside the listed window and cannot be confirmed — choose a date inside it`;
  }
  return `${tenant} has no complete backup at ${date}`;
}

// Common date D: newest date where BOTH tenants have a `complete` backup, or the
// requested date (refused unless complete on both sides). D older than
// maxAgeHours (default 48) is refused unless allowStale (explicit input).
export function chooseCommonDate({ immo, geo, requested, nowMs = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS, allowStale = false }) {
  const complete = (l) => new Map(l.backups.filter((b) => b.status === "complete").map((b) => [b.date, b]));
  const a = complete(immo);
  const b = complete(geo);
  const common = [...a.keys()].filter((d) => b.has(d)).sort().reverse();
  const truncatedLists = immo.truncated || geo.truncated;
  let date;
  if (requested) {
    if (!isValidDate(requested)) throw new Error("BACKUP_DATE must be YYYY-MM-DD");
    if (!a.has(requested)) throw new Error(notCompleteReason("immo", immo, requested));
    if (!b.has(requested)) throw new Error(notCompleteReason("geo", geo, requested));
    date = requested;
  } else {
    if (!common.length) throw new Error(`no date with a complete backup on BOTH tenants${truncatedLists ? " within the listed windows (a list was truncated to its newest entries)" : ""}`);
    date = common[0];
  }
  const ia = a.get(date).startedAt; const gb = b.get(date).startedAt;
  // Coherence by order (dossier §5): geo captured at or after immo ⇒ superset.
  const geoAfterImmo = ia && gb ? Date.parse(gb) >= Date.parse(ia) : null;
  const age = backupAge({ date, immoStartedAt: ia, geoStartedAt: gb, nowMs });
  const max = Number(maxAgeHours) > 0 ? Number(maxAgeHours) : DEFAULT_MAX_AGE_HOURS;
  const stale = !(age.ageHours <= max);
  if (stale && !allowStale) {
    throw new Error(`common backup date ${date} is ${age.ageHours} h old (> ${max} h, reference ${age.source}): ` +
      "refused — pass ALLOW_STALE_BACKUP=true to restore it anyway (recorded in cycle.json)");
  }
  const freshness = { age_hours: age.ageHours, max_age_hours: max, reference: age.reference, reference_source: age.source, stale, allow_stale: !!allowStale,
    overridden: stale && !!allowStale };
  return { date, requested: requested || null, candidates: common.slice(0, 7), immo: a.get(date), geo: b.get(date), geoAfterImmo, freshness, truncatedLists };
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

// ── join-verify baseline (FIDELITY control, owner decision 2026-09-26) ────────
// The drift measured on the backups of D=2026-09-26 (immo's zone_versions mirror
// behind geo, slug variants, a geo collection without zone_code) is RECORDED in
// join-verify-baseline.json; the restore is then judged on FIDELITY: an entry of
// the baseline is `known-drift` (counted, never fails), an entry absent from it
// FAILS, a baseline entry that no longer drifts is `resolved` (reported, to purge).
// The data drift itself is tracked as a separate debt (README).
export const BASELINE_FORMAT = "radar-join-verify-baseline/v1";
export const DRIFT_CLASSES = Object.freeze(["divergent-code", "city-not-served-by-geo"]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ZONE_ID_RE = /^ogc:zones:[a-z0-9][a-z0-9-]*:\S+$/;

// Baseline JSON → { entries: Map(id → { city, class, cause }), recorded_from }.
// Fail-closed: unknown format/scope, a group with an invalid city, an unknown
// class, an undeclared cause, an id out of format or of another city, a duplicate.
export function parseBaseline(json) {
  if (!json || json.format !== BASELINE_FORMAT || json.scope !== "zones" || !Array.isArray(json.groups)) {
    throw new Error(`join-verify baseline is not ${BASELINE_FORMAT} (scope zones, groups[])`);
  }
  const causes = json.causes && typeof json.causes === "object" ? json.causes : {};
  const entries = new Map();
  for (const [i, g] of json.groups.entries()) {
    const where = `baseline group ${i} (${g?.city ?? "?"})`;
    if (!g || typeof g.city !== "string" || !SLUG_RE.test(g.city)) throw new Error(`${where}: invalid city`);
    if (!DRIFT_CLASSES.includes(g.class)) throw new Error(`${where}: class must be one of ${DRIFT_CLASSES.join(", ")}`);
    if (typeof g.cause !== "string" || !Object.prototype.hasOwnProperty.call(causes, g.cause)) throw new Error(`${where}: cause not declared in causes`);
    if (!Array.isArray(g.ids)) throw new Error(`${where}: ids[] missing`);
    for (const id of g.ids) {
      if (typeof id !== "string" || !ZONE_ID_RE.test(id) || cityOf(id) !== g.city) throw new Error(`${where}: id out of format or of another city: ${id}`);
      if (entries.has(id)) throw new Error(`baseline: duplicate id ${id}`);
      entries.set(id, { city: g.city, class: g.class, cause: g.cause });
    }
  }
  const r = json.recorded_from && typeof json.recorded_from === "object" ? json.recorded_from : {};
  return {
    entries,
    recorded_from: { backup_date: r.backup_date ?? null, orchestrator_run_id: r.orchestrator_run_id ?? null, cycle_id: r.cycle_id ?? null },
  };
}

const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

// INCLUSION immo ⊆ geo (zones). An immo id absent from geo is
//   city-not-served-by-geo  when geo serves NO zone of that city,
//   divergent-code          when geo serves the city but not that code.
// Judged against the baseline (parseBaseline): known-drift (in the baseline, any
// class — a class change is counted in `reclassified`) never fails; NEW drift
// (absent from the baseline, either class) FAILS; baseline ids no longer drifting
// are `resolved`. Without a baseline, every drift is new (strict mode).
// status: match (no drift) | known-drift (only baseline entries) | drift (new).
export function inclusionCheck(immoText, geoText, { sample = 50, baseline = null } = {}) {
  const immo = parseServedIds(immoText, "immo");
  const geo = parseServedIds(geoText, "geo");
  const geoSet = new Set(geo);
  const immoSet = new Set(immo);
  const geoCities = new Set(geo.map(cityOf));
  const known = baseline?.entries ?? new Map();
  const drifting = new Set();
  const all = { divergent: [], notServed: new Map() };
  const fresh = { divergent: [], notServedIds: [], notServed: new Map() };
  const knownDrift = { count: 0, by_class: {}, by_cause: {}, reclassified: 0 };
  let included = 0;
  for (const id of immo) {
    if (geoSet.has(id)) { included += 1; continue; }
    drifting.add(id);
    const city = cityOf(id);
    const cls = geoCities.has(city) ? "divergent-code" : "city-not-served-by-geo";
    if (cls === "divergent-code") all.divergent.push(id); else all.notServed.set(city, (all.notServed.get(city) || 0) + 1);
    const b = known.get(id);
    if (b) {
      knownDrift.count += 1; bump(knownDrift.by_class, cls); bump(knownDrift.by_cause, b.cause);
      if (b.class !== cls) knownDrift.reclassified += 1;
    } else if (cls === "divergent-code") fresh.divergent.push(id);
    else { fresh.notServedIds.push(id); fresh.notServed.set(city, (fresh.notServed.get(city) || 0) + 1); }
  }
  const resolved = { count: 0, included_now: 0, absent_from_immo: 0, sample: [] };
  for (const id of known.keys()) {
    if (drifting.has(id)) continue;
    resolved.count += 1;
    if (immoSet.has(id)) resolved.included_now += 1; else resolved.absent_from_immo += 1;
    if (resolved.sample.length < sample) resolved.sample.push(id);
  }
  const cities = [...all.notServed.keys()].sort();
  const freshCities = [...fresh.notServed.keys()].sort();
  const newCount = fresh.divergent.length + fresh.notServedIds.length;
  return {
    status: newCount ? "drift" : knownDrift.count ? "known-drift" : "match",
    scope: "zones",
    immo_count: immo.length,
    geo_count: geo.length,
    included,
    known_drift: knownDrift,
    new_drift: {
      count: newCount,
      divergent_code: { count: fresh.divergent.length, sample: fresh.divergent.slice(0, sample) },
      city_not_served_by_geo: { count: fresh.notServedIds.length, cities: freshCities.length, sample: freshCities.slice(0, sample), ids_sample: fresh.notServedIds.slice(0, sample) },
    },
    resolved,
    baseline: baseline ? { entries: known.size, ...baseline.recorded_from } : null,
    city_not_served_by_geo: { count: [...all.notServed.values()].reduce((s, n) => s + n, 0), cities: cities.length, sample: cities.slice(0, sample) },
    divergent_code: { count: all.divergent.length, sample: all.divergent.slice(0, sample) },
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
    allow_stale_backup: false,
    backup: null,
    legs: { immo: leg("immo"), geo: leg("geo") },
    join_verify: { status: "pending", scope: "zones", compared_at: null, baseline: null, diff_summary: null },
    verdict: "pending",
    problems: [],
  };
}
