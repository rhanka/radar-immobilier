// Restricted reader for the checked-in register layout; no runtime dependency.
export const validDate = (value) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

const scalar = (value) => {
  const text = value?.trim().replace(/^(["'])(.*)\1$/, "$2");
  return text && !["null", "~"].includes(text) ? text : undefined;
};

export function parseRegister(text) {
  if (!/^schema_version: 1$/m.test(text) || !/^exceptions:\s*$/m.test(text)) {
    throw new Error("unrecognized vulnerability register layout");
  }
  const rows = [];
  const ids = new Set();
  for (const block of text.split(/^ {2}- id: */m).slice(1)) {
    const row = { id: scalar(block.split("\n")[0]) };
    const fields = new Set();
    for (const line of block.split("\n").slice(1)) {
      const match = line.match(/^ {4}([a-z_]+): *(.*)$/);
      if (!match) {
        if (/^\s*-\s/.test(line)) throw new Error("malformed register row");
        continue;
      }
      const [, key, value] = match;
      if (fields.has(key)) throw new Error(`duplicate register field: ${key}`);
      fields.add(key);
      row[key] = scalar(value);
    }
    if (!row.id || ids.has(row.id) || !["accepted", "proposed", "resolved"].includes(row.status)) {
      throw new Error("invalid register row identity or status");
    }
    ids.add(row.id);
    const affected = row.affected?.match(/^\{\s*identifier: (.+), version: (.+)\s*\}$/);
    row.identifier = scalar(affected?.[1]);
    row.version = scalar(affected?.[2]);
    delete row.affected;
    rows.push(row);
  }
  if (!rows.length) throw new Error("register has no readable rows");
  return rows;
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
