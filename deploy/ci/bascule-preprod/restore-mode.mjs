// =============================================================================
// restore-mode.mjs — runner side of the bascule MODE=restore|list (restore
// preprod FROM a daily backup of radar-immobilier-backup instead of a live dump).
//
// Same contract as bascule.mjs: the runner is KUBECTL-ONLY (0 S3 credential,
// 0 pg tool, 0 listing). Every backup read, the dump download + sha256 check,
// pg_restore and the docs copy run in preprod Jobs (backup-restore.cjs embedded
// in the templates). The runner reads the Job `.status` and, for the verdict
// details it must carry forward (resolved date D, manifest/dump sha256, backup
// list), the pod TERMINATION MESSAGE written by backup-restore.cjs — a JSON of
// dates/statuses/sizes/sha256/counts (<= 4 KiB), never a doc key, a row or a
// credential. Never `kubectl logs`.
//
//   MODE=chain   (default) bascule.mjs as before: live dump S1 → S2 → … (unchanged).
//   MODE=restore S0 preflight-backup → R0 backup-resolve (read-only, BEFORE quiesce:
//                guards) → QUIESCE (G2) → S2 restore-backup (G1 rollback, then
//                pg/<D>/radar.dump) → S2c migrate → S3' docs-restore (state at D
//                from docs-inventory/<D>.json) → S3b' recon-backup → S5 flip (G4 =
//                recon-backup) → UN-QUIESCE → S7 smoke.
//   MODE=list    read-only: backups available (date, status, size, schema, sha).
//
// Subcommands (registered in bascule.mjs COMMANDS): preflight-backup,
// backup-resolve, backup-list, restore-backup, docs-restore, recon-backup.
// =============================================================================
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export const MODES = Object.freeze(["chain", "restore", "list"]);
export const CYCLE_ID_RE = /^[A-Za-z0-9._-]{1,100}$/; // same pattern as the geo leg (rhanka/geo#399)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const K8S_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const STATUS_RE = /^[a-z0-9._-]{1,32}$/i;

export const JOBS = Object.freeze({
  resolve: "radar-bascule-backup-resolve",
  list: "radar-bascule-backup-list",
  db: "radar-db-restore-backup",
  docs: "radar-docs-restore-backup",
  recon: "radar-bascule-recon-backup",
});
export const PIN_FILE = "backup-pin.json";
export const LIST_FILE = "backup-list.json";

// ── pure helpers (exported for the selftest) ─────────────────────────────────
export function isValidDate(date) {
  if (typeof date !== "string" || !DATE_RE.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

export function basculeMode(env = process.env) {
  const m = String(env.MODE ?? "").trim() || "chain";
  if (!MODES.includes(m)) throw new Error(`MODE must be one of ${MODES.join("|")}`);
  return m;
}

// BACKUP_ID input, validated BEFORE it is rendered into a Job (never echoed raw).
export function validateBackupIdInput(raw, today) {
  const id = String(raw ?? "").trim();
  if (id === "" || id === "latest") return "latest";
  if (!isValidDate(id)) throw new Error("BACKUP_ID must be 'latest' or a valid YYYY-MM-DD date");
  if (today && id > today) throw new Error(`BACKUP_ID ${id} is in the future`);
  return id;
}

export function validateCycleId(raw) {
  const id = String(raw ?? "").trim();
  if (id === "") return "";
  if (!CYCLE_ID_RE.test(id)) throw new Error(`CYCLE_ID must match ${CYCLE_ID_RE}`);
  return id;
}

// Indent a script for a YAML literal block (`- |`): every non-empty line gets n spaces.
export function indentBlock(text, n) {
  const pad = " ".repeat(n);
  return String(text).replace(/\r/g, "").split("\n").map((l) => (l.length ? pad + l : l)).join("\n");
}

// A value rendered inside a double-quoted YAML scalar must not be able to escape it.
export function assertYamlSafeVars(vars, skip = ["BR_SCRIPT"]) {
  const bad = Object.entries(vars).filter(([k, v]) => !skip.includes(k) && /["\\\r\n]/.test(String(v)));
  if (bad.length) throw new Error(`unsafe template value(s): ${bad.map(([k]) => k).join(", ")}`);
  return true;
}

// backup-restore.cjs must never contain a ${UPPER} sequence: renderTemplate would
// treat it as an unresolved placeholder (or substitute it).
export function assertScriptEmbeddable(script) {
  const hit = String(script).match(/\$\{[A-Z0-9_]+\}/);
  if (hit) throw new Error(`backup-restore.cjs contains a template placeholder pattern (${hit[0]})`);
  return true;
}

// Termination message of `container` in the newest pod of a Job
// (`kubectl get pods -l job-name=<job> -o json`), init containers included.
export function pickTerminationMessage(podList, container) {
  const items = Array.isArray(podList?.items) ? [...podList.items] : [];
  items.sort((a, b) => String(b?.metadata?.creationTimestamp ?? "").localeCompare(String(a?.metadata?.creationTimestamp ?? "")));
  for (const pod of items) {
    const statuses = [...(pod?.status?.initContainerStatuses ?? []), ...(pod?.status?.containerStatuses ?? [])];
    const s = statuses.find((c) => c?.name === container);
    const msg = s?.state?.terminated?.message ?? s?.lastState?.terminated?.message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return null;
}

export function parseTermination(msg) {
  if (typeof msg !== "string" || !msg.trim()) return null;
  try {
    const v = JSON.parse(msg);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

// Refusal reason printed on the runner: only printable text, no workflow command.
export function safeReason(reason) {
  return String(reason ?? "no reason recorded").replace(/[\r\n]+/g, " ").replace(/::/g, ": :").replace(/[^\x20-\x7E]/g, "?").slice(0, 400);
}

const isoOrNull = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const numOrNull = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

// PIN produced by the resolve Job; every field re-validated before use.
export function validatePin(p) {
  const errs = [];
  if (!p || p.ok !== true) errs.push("resolve verdict is not ok");
  if (!p || !isValidDate(p.date)) errs.push("date invalid");
  if (!p || !SHA_RE.test(String(p.manifestSha256 ?? ""))) errs.push("manifestSha256 invalid");
  if (!p || !SHA_RE.test(String(p.pgSha256 ?? ""))) errs.push("pgSha256 invalid");
  if (!p || !(Number(p.pgSizeBytes) > 0)) errs.push("pgSizeBytes invalid");
  if (p && p.backupId !== "latest" && !isValidDate(p.backupId)) errs.push("backupId invalid");
  if (errs.length) throw new Error(`backup PIN rejected: ${errs.join("; ")}`);
  return {
    backupId: p.backupId,
    date: p.date,
    manifestSha256: p.manifestSha256,
    pgSha256: p.pgSha256,
    pgSizeBytes: Number(p.pgSizeBytes),
    docsObjects: numOrNull(p.docsObjects),
    migrations: numOrNull(p.migrations),
    lastTag: typeof p.lastTag === "string" && STATUS_RE.test(p.lastTag) ? p.lastTag : null,
    codeSha: /^[0-9a-f]{7,40}$/.test(String(p.codeSha ?? "")) ? p.codeSha : null,
    dumpStartedAt: isoOrNull(p.dumpStartedAt),
    ageHours: numOrNull(p.ageHours),
    stale: p.stale === true,
    staleOverridden: p.staleOverridden === true,
  };
}

// Backup list produced by the list Job, re-validated field by field.
export function validateListing(l) {
  if (!l || l.ok !== true || !Array.isArray(l.backups)) throw new Error("backup list verdict is not ok");
  const backups = l.backups
    .filter((b) => b && isValidDate(b.date))
    .map((b) => ({
      date: b.date,
      status: STATUS_RE.test(String(b.status ?? "")) ? b.status : "invalid",
      pgBytes: numOrNull(b.pgBytes),
      pgSha256: /^[0-9a-f]{8,64}$/.test(String(b.pgSha256 ?? "")) ? b.pgSha256 : null,
      migrations: numOrNull(b.migrations),
      lastTag: typeof b.lastTag === "string" && STATUS_RE.test(b.lastTag) ? b.lastTag : null,
      docs: numOrNull(b.docs),
      code: /^[0-9a-f]{7,40}$/.test(String(b.code ?? "")) ? b.code : null,
      startedAt: isoOrNull(b.startedAt),
    }));
  return {
    format: "radar-backup-list/v1",
    tenant: "immo",
    bucket: BUCKET_RE.test(String(l.bucket ?? "")) ? l.bucket : null,
    latest: isValidDate(l.latest) ? l.latest : null,
    latestComplete: isValidDate(l.latestComplete) ? l.latestComplete : null,
    count: numOrNull(l.count),
    truncated: l.truncated === true,
    backups,
  };
}

export function formatBackupTable(listing) {
  const mb = (b) => (b === null ? "-" : `${(b / 1e6).toFixed(1)} MB`);
  const rows = listing.backups.map((b) => [
    b.date + (b.date === listing.latestComplete ? " *" : ""), b.status, mb(b.pgBytes),
    b.migrations === null ? "-" : `${b.migrations}${b.lastTag ? ` (${b.lastTag})` : ""}`,
    b.pgSha256 ?? "-", b.docs === null ? "-" : String(b.docs), b.code ?? "-",
  ]);
  const head = ["date", "status", "pg dump", "schema (migrations)", "pg sha256 (16)", "docs", "code"];
  const text = [head, ...rows].map((r) => r.join(" | ")).join("\n");
  const md = [
    `| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
  return { text, md };
}

// ── runner side (helpers injected by bascule.mjs: no circular import) ────────
export function makeRestoreMode(h) {
  const { log, warn, die, section, req, opt, run, assertConfirm, assertQuiesced, runJobFromTemplate, jobDefaults, workdir,
    resolvePreprodImage, runRollbackG1 } = h;

  const today = () => new Date().toISOString().slice(0, 10);
  const mode = () => {
    try { return basculeMode(process.env); } catch (e) { return die(e.message); }
  };

  function backupParams() {
    const jd = jobDefaults();
    const bucket = opt("BACKUP_BUCKET", "radar-immobilier-backup");
    const readerSecret = opt("BACKUP_READER_SECRET", "radar-backup-reader-preprod");
    // Dedicated copy signer, never a fallback on the reader (the reader cannot read docs/*).
    const copySecret = opt("BACKUP_DOCS_COPY_SECRET", "radar-backup-restore-docs");
    if (!BUCKET_RE.test(bucket)) die("BACKUP_BUCKET invalid");
    for (const [k, v] of [["BACKUP_READER_SECRET", readerSecret], ["BACKUP_DOCS_COPY_SECRET", copySecret]]) {
      if (!K8S_NAME_RE.test(v)) die(`${k} is not a valid Secret name`);
    }
    return {
      jd, bucket, readerSecret, copySecret,
      forcePathStyle: opt("BACKUP_S3_FORCE_PATH_STYLE", "true") === "false" ? "false" : "true",
      maxAgeHours: String(Number(opt("BACKUP_MAX_AGE_HOURS", "24")) > 0 ? Number(opt("BACKUP_MAX_AGE_HOURS", "24")) : 24),
    };
  }

  let scriptCache = null;
  function brScript() {
    if (scriptCache) return scriptCache;
    const text = readFileSync(join(import.meta.dirname, "backup-restore.cjs"), "utf8");
    try { assertScriptEmbeddable(text); } catch (e) { die(e.message); }
    scriptCache = indentBlock(text, 14);
    return scriptCache;
  }

  function dispatch({ tmpl, jobName, vars, timeoutSec }) {
    try { assertYamlSafeVars(vars); } catch (e) { die(e.message); }
    return runJobFromTemplate({ tmpl, jobName, vars: { ...vars, BR_SCRIPT: brScript() }, timeoutSec, failClosed: false });
  }

  // Verdict JSON of a Job's container (pods .status only — never logs).
  function readVerdict(ns, jobName, container) {
    const r = run("kubectl", ["-n", ns, "get", "pods", "-l", `job-name=${jobName}`, "-o", "json"], { capture: true, allowFail: true });
    if (r.status !== 0) return { verdict: null, readable: false };
    let pods = null;
    try { pods = JSON.parse(r.stdout || "{}"); } catch { pods = null; }
    return { verdict: parseTermination(pickTerminationMessage(pods, container)), readable: true };
  }

  function failWithVerdict(res, ns, jobName, container, what) {
    const { verdict, readable } = readVerdict(ns, jobName, container);
    const reason = verdict && verdict.reason ? safeReason(verdict.reason)
      : verdict && verdict.ok === true ? `step '${container}' OK — a later container failed (inspect the Job in-cluster)`
        : readable ? "no verdict recorded (inspect the Job in-cluster)"
          : "pods not readable by the CI (RBAC get/list pods in the preprod namespace — see README)";
    die(`${what} — Job ${jobName} ${res.state}: ${reason}`);
  }

  function loadPin() {
    const p = join(workdir(), PIN_FILE);
    if (!existsSync(p)) die(`${PIN_FILE} absent — run 'backup-resolve' first (the PIN pins the backup date and sha256).`);
    try { return validatePin({ ok: true, ...JSON.parse(readFileSync(p, "utf8")) }); } catch (e) { return die(e.message); }
  }

  function writeOutputs(pairs) {
    if (!process.env.GITHUB_OUTPUT) return;
    appendFileSync(process.env.GITHUB_OUTPUT, pairs.map(([k, v]) => `${k}=${v ?? ""}\n`).join(""));
  }
  function summary(md) {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  }

  // ── S0 preflight (restore / list) ───────────────────────────────────────────
  function cmdPreflightBackup() {
    const m = mode();
    section(`S0 preflight (MODE=${m})`);
    if (m === "chain") die("preflight-backup is for MODE=restore|list (MODE=chain uses 'preflight').");
    const bins = ["node", "kubectl", "curl"];
    const missing = bins.filter((b) => run("bash", ["-lc", `command -v ${b}`], { capture: true, allowFail: true }).status !== 0);
    if (missing.length) die(`missing runner binaries: ${missing.join(", ")}`);
    const required = m === "restore" ? ["EXPECTED_DATABASE", "BHS", "PREPROD_DOCS", "DUMP_BUCKET"] : ["BHS"];
    const absent = required.filter((k) => !process.env[k]);
    if (absent.length) die(`missing CI parameters: ${absent.join(", ")}`);
    const bp = backupParams();
    let backupId = "n/a";
    try {
      if (m === "restore") backupId = validateBackupIdInput(opt("BACKUP_ID", "latest"), today());
      validateCycleId(opt("CYCLE_ID", ""));
    } catch (e) { die(e.message); }
    if (m === "restore") {
      const prod = opt("PROD_DOCS", "");
      if (prod && prod === req("PREPROD_DOCS")) die("PREPROD_DOCS equals PROD_DOCS — refusing to restore docs into production.");
      if (!BUCKET_RE.test(req("PREPROD_DOCS"))) die("PREPROD_DOCS invalid");
    }
    log(`MODE=${m} backup_bucket=${bp.bucket} reader_secret=${bp.readerSecret} docs_copy_secret=${bp.copySecret} ` +
      `backup_id=${backupId} allow_stale=${opt("ALLOW_STALE_BACKUP", "false")} max_age_h=${bp.maxAgeHours} (0 S3/DB credential on the runner)`);
    log("S0 preflight OK");
  }

  // ── R0 resolve (read-only, BEFORE quiesce) ──────────────────────────────────
  function cmdBackupResolve() {
    section("R0 backup-resolve — Job read-only (BACKUP_ID → date D + guards + PIN)");
    if (mode() !== "restore") die("backup-resolve requires MODE=restore.");
    const bp = backupParams();
    let backupId;
    try { backupId = validateBackupIdInput(opt("BACKUP_ID", "latest"), today()); } catch (e) { die(e.message); }
    const ns = bp.jd.NAMESPACE;
    const res = dispatch({
      tmpl: "backup-read-job.tmpl.yaml",
      jobName: JOBS.resolve,
      vars: {
        JOB_NAME: JOBS.resolve, NAMESPACE: ns, IMAGE: resolvePreprodImage(ns), BR_STEP: "resolve",
        READER_SECRET: bp.readerSecret, S3_ENDPOINT: bp.jd.S3_ENDPOINT, S3_REGION: bp.jd.S3_REGION,
        S3_FORCE_PATH_STYLE: bp.forcePathStyle, EXPECTED_BACKUP_BUCKET: bp.bucket, BACKUP_ID: backupId,
        ALLOW_STALE_BACKUP: opt("ALLOW_STALE_BACKUP", "false") === "true" ? "true" : "false",
        MAX_AGE_HOURS: bp.maxAgeHours, TTL_SECONDS: bp.jd.TTL_SECONDS,
      },
      timeoutSec: Number(opt("BACKUP_RESOLVE_TIMEOUT", "600")),
    });
    if (!res.ok) failWithVerdict(res, ns, JOBS.resolve, "read", "R0 backup refused");
    const { verdict, readable } = readVerdict(ns, JOBS.resolve, "read");
    if (!verdict) {
      die(readable ? "R0 — resolve Job succeeded but wrote no PIN (termination message missing)."
        : "R0 — the CI cannot read the resolve pod status (RBAC get/list pods in the preprod namespace is required for MODE=restore — see README).");
    }
    let pin;
    try { pin = validatePin(verdict); } catch (e) { die(e.message); }
    writeFileSync(join(workdir(), PIN_FILE), `${JSON.stringify(pin, null, 2)}\n`, { mode: 0o600 });
    if (pin.stale && backupId !== "latest") warn(`backup ${pin.date} is ${pin.ageHours} h old — explicit BACKUP_ID, age not blocking.`);
    if (pin.staleOverridden) warn(`latest backup ${pin.date} is ${pin.ageHours} h old — accepted by ALLOW_STALE_BACKUP=true.`);
    log(`R0 OK — BACKUP_ID=${pin.backupId} → date=${pin.date} (complete) age=${pin.ageHours} h pg=${pin.pgSizeBytes} bytes ` +
      `pg.sha256=${pin.pgSha256} manifest.sha256=${pin.manifestSha256} docs=${pin.docsObjects} migrations=${pin.migrations}` +
      `${pin.lastTag ? ` (${pin.lastTag})` : ""} code=${pin.codeSha ?? "unknown"}`);
    writeOutputs([["backup_id", pin.backupId], ["backup_date", pin.date], ["manifest_sha256", pin.manifestSha256],
      ["pg_sha256", pin.pgSha256], ["dump_started_at", pin.dumpStartedAt]]);
    summary(`### Backup resolved\n\n| BACKUP_ID | date | age (h) | pg dump | pg sha256 | manifest sha256 | docs | migrations |\n` +
      `|---|---|---|---|---|---|---|---|\n| ${pin.backupId} | ${pin.date} | ${pin.ageHours} | ${pin.pgSizeBytes} | ${pin.pgSha256} | ` +
      `${pin.manifestSha256} | ${pin.docsObjects ?? "-"} | ${pin.migrations ?? "-"} |`);
  }

  // ── list (read-only) ────────────────────────────────────────────────────────
  function cmdBackupList() {
    section("backup-list — Job read-only (backups available)");
    if (mode() !== "list") die("backup-list requires MODE=list.");
    const bp = backupParams();
    const ns = bp.jd.NAMESPACE;
    const res = dispatch({
      tmpl: "backup-read-job.tmpl.yaml",
      jobName: JOBS.list,
      vars: {
        JOB_NAME: JOBS.list, NAMESPACE: ns, IMAGE: resolvePreprodImage(ns), BR_STEP: "list",
        READER_SECRET: bp.readerSecret, S3_ENDPOINT: bp.jd.S3_ENDPOINT, S3_REGION: bp.jd.S3_REGION,
        S3_FORCE_PATH_STYLE: bp.forcePathStyle, EXPECTED_BACKUP_BUCKET: bp.bucket, BACKUP_ID: "latest",
        ALLOW_STALE_BACKUP: "false", MAX_AGE_HOURS: bp.maxAgeHours, TTL_SECONDS: bp.jd.TTL_SECONDS,
      },
      timeoutSec: Number(opt("BACKUP_LIST_TIMEOUT", "600")),
    });
    if (!res.ok) failWithVerdict(res, ns, JOBS.list, "read", "backup-list failed");
    const { verdict, readable } = readVerdict(ns, JOBS.list, "read");
    if (!verdict) die(readable ? "backup-list wrote no verdict." : "the CI cannot read the list pod status (RBAC get/list pods — see README).");
    let listing;
    try { listing = validateListing(verdict); } catch (e) { die(e.message); }
    writeFileSync(join(workdir(), LIST_FILE), `${JSON.stringify(listing, null, 2)}\n`, { mode: 0o644 });
    const t = formatBackupTable(listing);
    log(`backups in ${listing.bucket}: ${listing.count} (latest=${listing.latest}, latest complete=${listing.latestComplete}; * = latest complete)` +
      `${listing.truncated ? " — list truncated to the newest entries" : ""}\n${t.text}`);
    summary(`### Backups available — ${listing.bucket}\n\nlatest = ${listing.latest} · latest complete (*) = ${listing.latestComplete}` +
      `${listing.truncated ? " · truncated to the newest entries" : ""}\n\n${t.md}`);
  }

  // ── S2 restore from pg/<D>/radar.dump ───────────────────────────────────────
  function cmdRestoreBackup() {
    section("S2 restore préprod FROM the backup (G2 quiesce + G1 rollback + Job restore-backup)");
    assertConfirm(); // G3
    if (mode() !== "restore") die("restore-backup requires MODE=restore.");
    const pin = loadPin();
    const bp = backupParams();
    assertQuiesced(); // G2
    runRollbackG1(); // G1 (same Job as the chain mode)
    const ns = bp.jd.NAMESPACE;
    const res = dispatch({
      tmpl: "db-restore-backup-job.tmpl.yaml",
      jobName: JOBS.db,
      vars: {
        NAMESPACE: ns, IMAGE: resolvePreprodImage(ns), DUMP_IMAGE: bp.jd.DUMP_IMAGE, READER_SECRET: bp.readerSecret,
        S3_ENDPOINT: bp.jd.S3_ENDPOINT, S3_REGION: bp.jd.S3_REGION, S3_FORCE_PATH_STYLE: bp.forcePathStyle,
        EXPECTED_BACKUP_BUCKET: bp.bucket, BACKUP_DATE: pin.date, PIN_MANIFEST_SHA256: pin.manifestSha256,
        PIN_PG_SHA256: pin.pgSha256, DB_SECRET: bp.jd.DB_SECRET, PGHOST: bp.jd.PGHOST,
        EXPECTED_DATABASE: req("EXPECTED_DATABASE"), RESTORE_ASSERT_DB: opt("RESTORE_ASSERT_DB", "1") !== "0" ? "1" : "0",
        TTL_SECONDS: bp.jd.TTL_SECONDS,
      },
      timeoutSec: Number(opt("RESTORE_TIMEOUT", "1800")),
    });
    if (!res.ok) failWithVerdict(res, ns, JOBS.db, "fetch", "S2 restore-backup failed (fetch verdict shown when the fetch step refused)");
    log(`S2 OK — backup ${pin.date} restored into preprod (sha256 ${pin.pgSha256} verified in-cluster, G1 rollback durable).`);
  }

  function docsJob({ step, dry }) {
    const pin = loadPin();
    const bp = backupParams();
    const ns = bp.jd.NAMESPACE;
    const dst = req("PREPROD_DOCS");
    const forbidden = [opt("PROD_DOCS", ""), opt("BACKUP_FORBIDDEN_DST_BUCKETS", "")].filter(Boolean).join(",");
    const jobName = step === "docs" ? JOBS.docs : JOBS.recon;
    const res = dispatch({
      tmpl: "docs-restore-backup-job.tmpl.yaml",
      jobName,
      vars: {
        JOB_NAME: jobName, NAMESPACE: ns, IMAGE: resolvePreprodImage(ns), BR_STEP: step,
        READER_SECRET: bp.readerSecret, COPY_SECRET: bp.copySecret, S3_ENDPOINT: bp.jd.S3_ENDPOINT,
        S3_REGION: bp.jd.S3_REGION, S3_FORCE_PATH_STYLE: bp.forcePathStyle, EXPECTED_BACKUP_BUCKET: bp.bucket,
        BACKUP_DATE: pin.date, PIN_MANIFEST_SHA256: pin.manifestSha256, DST_BUCKET: dst,
        FORBIDDEN_DST_BUCKETS: forbidden, COPY_GRANTEE: opt("DOCS_SYNC_GRANTEE", ""),
        COPY_CONCURRENCY: String(Math.max(1, Math.min(32, Number(opt("BACKUP_COPY_CONCURRENCY", "8")) || 8))),
        DOCS_DRY: dry ? "1" : "0", TTL_SECONDS: bp.jd.TTL_SECONDS,
      },
      timeoutSec: Number(opt(step === "docs" ? "DOCS_RESTORE_TIMEOUT" : "RECON_TIMEOUT", step === "docs" ? "7500" : "900")),
    });
    const { verdict } = readVerdict(ns, jobName, "docs");
    return { res, verdict, pin, dst, ns, jobName };
  }

  const countsLine = (v) => (v ? Object.entries(v).filter(([k]) => !["ok", "step", "reason"].includes(k))
    .map(([k, x]) => `${k}=${typeof x === "object" ? JSON.stringify(x) : x}`).join(" ").slice(0, 600) : "no verdict readable");

  // ── S3' docs state at D ─────────────────────────────────────────────────────
  function cmdDocsRestore() {
    const dry = opt("DRY", "") === "1" || process.argv.includes("--dry");
    section(`S3' docs-restore FROM the backup (${dry ? "DRY: plan only, 0 copy" : "server-side CopyObject, additive"})`);
    if (mode() !== "restore") die("docs-restore requires MODE=restore.");
    if (!dry) assertConfirm(); // G3 for the real copy
    const { res, verdict, pin, ns, jobName } = docsJob({ step: "docs", dry });
    if (!res.ok) failWithVerdict(res, ns, jobName, "docs", `S3' docs-restore ${dry ? "plan " : ""}failed [${countsLine(verdict)}]`);
    log(`S3' ${dry ? "DRY " : ""}OK — docs state of ${pin.date} ${dry ? "restorable" : "restored"} [${countsLine(verdict)}]`);
  }

  // ── S3b' recon dest ⊇ inventory(D) + sentinel for G4 ────────────────────────
  function cmdReconBackup() {
    section("S3b' recon-backup — preprod docs ⊇ docs-inventory(D) (Key + Size, Job verdict)");
    if (mode() !== "restore") die("recon-backup requires MODE=restore.");
    const { res, verdict, pin, dst, ns, jobName } = docsJob({ step: "recon", dry: false });
    if (!res.ok) failWithVerdict(res, ns, jobName, "docs", `S3b' recon-backup failed [${countsLine(verdict)}]`);
    const sentinel = { ok: true, mode: "restore", backupDate: pin.date, manifestSha256: pin.manifestSha256, preprod: dst, at: new Date().toISOString() };
    writeFileSync(join(workdir(), "recon.ok.json"), `${JSON.stringify(sentinel)}\n`, { mode: 0o600 });
    log(`S3b' OK — preprod docs ⊇ inventory of ${pin.date} [${countsLine(verdict)}]. Sentinel recon.ok written.`);
  }

  // G4 of the flip in MODE=restore: sentinel of THIS backup + recon re-run.
  function assertReconOk() {
    const p = join(workdir(), "recon.ok.json");
    if (!existsSync(p)) die("GARDE G4 — recon.ok sentinel absent: run recon-backup (S3b') and get it GREEN before the flip.");
    let s;
    try { s = JSON.parse(readFileSync(p, "utf8")); } catch { die("GARDE G4 — recon.ok sentinel unreadable."); }
    const pin = loadPin();
    if (!s.ok || s.mode !== "restore" || s.backupDate !== pin.date || s.manifestSha256 !== pin.manifestSha256 || s.preprod !== req("PREPROD_DOCS")) {
      die("GARDE G4 — recon.ok sentinel does not match the current backup/bucket: re-run recon-backup.");
    }
    cmdReconBackup();
    log("GARDE G4 OK — recon vs inventory(D) re-confirmed (Job) right before the flip.");
  }

  return {
    assertReconOk,
    commands: {
      "preflight-backup": cmdPreflightBackup,
      "backup-resolve": cmdBackupResolve,
      "backup-list": cmdBackupList,
      "restore-backup": cmdRestoreBackup,
      "docs-restore": cmdDocsRestore,
      "recon-backup": cmdReconBackup,
    },
  };
}
