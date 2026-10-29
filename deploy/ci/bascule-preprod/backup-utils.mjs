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
