// Resolve npm metavulnerabilities to advisory identities before exact matching.
import { checkException, validDate } from "./audit-register.mjs";
export { checkException, parseRegister } from "./audit-register.mjs";

const LEVELS = ["info", "low", "moderate", "high", "critical"];
const blocking = (severity) => ["high", "critical"].includes(severity);
const normPath = (path) => String(path ?? "").replace(/^\.\//, "").replace(/\/+$/, "");

export function collectFindings(audit, packages = {}) {
  const vulns = audit?.vulnerabilities;
  if (audit?.error || !vulns || typeof vulns !== "object" || Array.isArray(vulns)) {
    throw new Error("unrecognized npm audit format (want `vulnerabilities` without error)");
  }
  const advisories = (name, visited = new Set()) => {
    const entry = vulns[name];
    if (!entry || !LEVELS.includes(entry.severity) || !Array.isArray(entry.via) || !entry.via.length ||
      !Array.isArray(entry.nodes) || !entry.nodes.length) {
      throw new Error(`malformed npm audit entry or dependency chain: ${name}`);
    }
    // npm can report peer dependency cycles; inspect each reachable entry once.
    if (visited.has(name)) return [];
    visited.add(name);
    return entry.via.flatMap((via) => {
      if (typeof via === "string") return advisories(via, visited);
      const id = via?.url?.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}(?=$|[/?#])/i)?.[0];
      const severity = via?.severity || entry.severity;
      if (!id || !LEVELS.includes(severity)) throw new Error(`malformed npm advisory: ${name}`);
      return [{ advisory: id.toUpperCase(), severity }];
    });
  };
  const findings = [];
  for (const [name, entry] of Object.entries(vulns)) {
    if (entry?.name !== name) throw new Error(`mismatching audit package: ${name}`);
    const leaves = new Map(advisories(name).map((leaf) => [leaf.advisory, leaf]));
    if (!leaves.size) throw new Error(`npm audit dependency chain has no advisory: ${name}`);
    for (const node of entry.nodes) {
      if (typeof node !== "string" || !node.startsWith("node_modules/") && !node.startsWith("./node_modules/")) {
        throw new Error(`invalid audit node: ${name}`);
      }
      const path = normPath(node);
      for (const leaf of leaves.values()) {
        const severity = LEVELS[Math.min(LEVELS.indexOf(entry.severity), LEVELS.indexOf(leaf.severity))];
        findings.push({ ...leaf, severity, package: name, path, version: packages[path]?.version || "" });
      }
    }
  }
  return findings;
}

const sameIdentity = (row, finding) => row.advisory.toUpperCase() === finding.advisory &&
  row.identifier === finding.package && row.version === finding.version &&
  normPath(row.embedded_path) === finding.path;

export function evaluateAudit({ audit, packages = {}, registerRows = [], now }) {
  const day = now || new Date().toISOString().slice(0, 10);
  const result = { ok: false, day, error: null, blocking: 0, tolerated: 0,
    covered: [], uncovered: [], expired: [], malformed: [] };
  try {
    if (!validDate(day)) throw new Error("invalid audit date");
    const findings = collectFindings(audit, packages);
    const valid = [];
    const stale = [];
    for (const row of registerRows) {
      const checked = checkException(row, day);
      if (checked.state === "valid") valid.push(row);
      else if (checked.state === "malformed") result.malformed.push({ id: row.id, errors: checked.errors });
      else if (checked.state === "expired") {
        stale.push(row);
        result.expired.push({ id: row.id, advisory: row.advisory, owner: row.owner,
          component: row.component, path: row.embedded_path, review_by: row.review_by, expires: row.expires });
      }
    }
    for (const finding of findings) {
      if (!blocking(finding.severity)) { result.tolerated += 1; continue; }
      result.blocking += 1;
      if (valid.some((row) => sameIdentity(row, finding))) result.covered.push(finding);
      else if (!stale.some((row) => sameIdentity(row, finding))) result.uncovered.push(finding);
    }
    result.ok = !result.uncovered.length && !result.expired.length && !result.malformed.length;
  } catch (error) { result.error = error.message; }
  return result;
}
