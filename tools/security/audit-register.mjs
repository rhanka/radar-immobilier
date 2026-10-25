import { parseDocument } from "yaml";

export const validDate = (value) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
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
    return row;
  });
}

export function checkException(row, now) {
  if (row.status !== "accepted") return { state: "ignored" };
  const errors = [];
  for (const key of ["id", "advisory", "identifier", "version", "embedded_path", "component",
    "owner", "accepted_by", "accepted_on", "review_by"]) {
    if (!row[key]) errors.push(`missing ${key}`);
  }
  if (row.scanner !== "npm-audit" || row.scanner_input !== "package-lock.json" || row.component !== "root npm workspace") {
    errors.push("exception must target npm-audit, root package-lock.json and root npm workspace");
  }
  if (!/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(row.advisory || "")) errors.push("invalid advisory");
  for (const key of ["accepted_on", "review_by", "expires"]) {
    if (row[key] && !validDate(row[key])) errors.push(`malformed ${key}: ${row[key]}`);
  }
  if (!errors.length && (row.accepted_on > now || row.accepted_on > row.review_by)) {
    errors.push("acceptance date is in the future or after review_by");
  }
  if (errors.length) return { state: "malformed", errors };
  if (now > row.review_by || (row.expires && now > row.expires)) return { state: "expired" };
  return { state: "valid" };
}
