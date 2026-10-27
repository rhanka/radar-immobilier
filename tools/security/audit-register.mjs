import { parseDocument } from "yaml";

export const validDate = (value) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const fields = ["id", "advisory", "cve", "scanner", "scanner_input", "component", "finding_kind", "affected",
  "embedded_path", "severity", "severity_source", "rationale", "finding_ref", "owner", "status", "resolved_on",
  "resolution_ref", "accepted_by", "accepted_on", "review_by", "expires", "removal_plan"];
function checkKeys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`unrecognized ${label} structure`);
  }
}

export function parseRegister(text) {
  // YAML is already installed through radar-domain; do not substitute a text reader.
  const document = parseDocument(text, { version: "1.2", strict: true, uniqueKeys: true });
  if (document.errors.length || document.warnings.length) {
    throw new Error(`invalid vulnerability register YAML: ${[...document.errors, ...document.warnings].map((error) => error.message).join("; ")}`);
  }
  const register = document.toJS({ maxAliasCount: 0 });
  checkKeys(register, ["schema_version", "exceptions"], "vulnerability register");
  if (register.schema_version !== 1 || !Array.isArray(register.exceptions)) {
    throw new Error("unrecognized vulnerability register layout");
  }
  const ids = new Set();
  return register.exceptions.map((entry) => {
    checkKeys(entry, fields, "exception");
    checkKeys(entry.affected, ["identifier", "version"], "affected package");
    const { affected, ...metadata } = entry;
    const row = { ...metadata, identifier: affected.identifier, version: affected.version };
    if (!row.id || ids.has(row.id) || !["accepted", "proposed", "resolved"].includes(row.status)) {
      throw new Error("invalid register row identity or status");
    }
    ids.add(row.id);
    const errors = rowErrors(row);
    if (errors.length) throw new Error(`invalid exception ${row.id}: ${errors.join("; ")}`);
    return row;
  });
}

function rowErrors(row) {
  const errors = [];
  for (const key of ["id", "advisory", "identifier", "version", "embedded_path", "component", "scanner",
    "scanner_input", "finding_kind", "severity", "severity_source", "owner", "status", "rationale", "finding_ref", "review_by",
    ...(row.status === "accepted" ? ["accepted_by", "accepted_on", "expires"] : [])]) {
    if (!nonEmpty(row[key])) errors.push(`missing or invalid ${key}: expected non-empty text`);
  }
  for (const key of ["cve", "resolution_ref", "accepted_by"]) {
    if (row[key] != null && !nonEmpty(row[key])) errors.push(`invalid ${key}: expected non-empty text`);
  }
  if (!["accepted", "proposed", "resolved"].includes(row.status)) errors.push("invalid status");
  if (!["direct-advisory", "metavulnerability"].includes(row.finding_kind)) errors.push("invalid finding_kind");
  if (!["info", "low", "medium", "moderate", "high", "critical"].includes(row.severity)) errors.push("invalid severity");
  if (!nonEmpty(row.finding_ref) || !/^\.security\/findings\/[^\s]+\.md$/.test(row.finding_ref)) errors.push("invalid finding_ref");
  if (!object(row.removal_plan) || Object.keys(row.removal_plan).some((key) => !["target", "action"].includes(key)) ||
    !nonEmpty(row.removal_plan.target) || !nonEmpty(row.removal_plan.action)) errors.push("invalid removal_plan");
  if (row.status === "resolved" && (!validDate(row.resolved_on) || !nonEmpty(row.resolution_ref))) {
    errors.push("resolved exception requires resolved_on and resolution_ref");
  }
  if (row.status === "accepted" && (row.scanner !== "npm-audit" || row.scanner_input !== "package-lock.json" || row.component !== "root npm workspace")) {
    errors.push("exception must target npm-audit, root package-lock.json and root npm workspace");
  }
  if (!/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(row.advisory || "")) errors.push("invalid advisory");
  for (const key of ["accepted_on", "review_by", "expires", "resolved_on"]) {
    if (row[key] != null && !validDate(row[key])) errors.push(`malformed ${key}: ${String(row[key])}`);
  }
  if (!errors.length && row.status === "accepted" && (row.accepted_on > row.review_by || row.accepted_on > row.expires)) {
    errors.push("accepted_on is after review_by or expires");
  }
  return errors;
}

export function checkException(row, now) {
  const errors = rowErrors(row);
  if (row.status === "accepted" && row.accepted_on > now) {
    errors.push("acceptance date is in the future");
  }
  if (errors.length) return { state: "malformed", errors };
  if (row.status !== "accepted") return { state: "ignored" };
  if (now > row.review_by || now > row.expires) return { state: "expired" };
  return { state: "valid" };
}
