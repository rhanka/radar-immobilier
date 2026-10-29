import process from 'node:process';
export const MODES = Object.freeze(["restore", "list"]);
export const CYCLE_ID_RE = /^[A-Za-z0-9._-]{1,100}$/; // same pattern as the geo leg (rhanka/geo#399)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
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
// Production docs bucket, frozen here (repo var BASCULE_PROD_DOCS_BUCKET =
// radar-immobilier-docs, 2026-09-22): ALWAYS a forbidden destination of the
// restore copy, whatever the vars say, so the list is never empty.
export const FROZEN_PROD_DOCS_BUCKETS = Object.freeze(["radar-immobilier-docs"]);

// FORBIDDEN_DST_BUCKETS rendered into the docs Jobs: the frozen production docs
// bucket(s) + PROD_DOCS (required in MODE=restore) + the backup bucket + extras.
// Never empty; a malformed name is refused.
export function forbiddenDstBuckets({ prodDocs, extra = "", backupBucket }) {
  const prod = String(prodDocs ?? "").trim();
  if (!prod) throw new Error("PROD_DOCS (var BASCULE_PROD_DOCS_BUCKET) is required in MODE=restore: it is a forbidden destination of the docs copy");
  const names = [...FROZEN_PROD_DOCS_BUCKETS, prod, String(backupBucket ?? "").trim(),
    ...String(extra ?? "").split(",").map((s) => s.trim())].filter(Boolean);
  const bad = names.filter((n) => !BUCKET_RE.test(n));
  if (bad.length) throw new Error(`invalid bucket name(s) in the forbidden destinations: ${bad.length}`);
  return [...new Set(names)].join(",");
}

// ── pure helpers (exported for the selftest) ─────────────────────────────────
export function isValidDate(date) {
  if (typeof date !== "string" || !DATE_RE.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

export function basculeMode(env = process.env) {
  const m = String(env.MODE ?? "").trim() || "restore";
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

// A pod belongs to the Job instance `jobUid` (the one this run created) when its
// controller ownerReference or its controller-uid label carries that uid. A pod
// of an older instance of the same Job name (deleted, pods still terminating) is
// never read.
export function podOfJob(pod, jobUid) {
  if (!jobUid) return false;
  const owners = Array.isArray(pod?.metadata?.ownerReferences) ? pod.metadata.ownerReferences : [];
  if (owners.some((o) => o?.kind === "Job" && o?.uid === jobUid)) return true;
  const labels = pod?.metadata?.labels ?? {};
  return labels["batch.kubernetes.io/controller-uid"] === jobUid || labels["controller-uid"] === jobUid;
}

// Termination message of `container` in the newest pod of the Job instance
// `jobUid` (`kubectl get pods -l job-name=<job> -o json`, then filtered by uid),
// init containers included. No uid ⇒ null (never a guess).
export function pickTerminationMessage(podList, container, jobUid) {
  const items = (Array.isArray(podList?.items) ? [...podList.items] : []).filter((p) => podOfJob(p, jobUid));
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
