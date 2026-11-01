// Tolerant JSONL helpers: a kill mid-append must never poison resume (plan §B-L2).
// Writers repair a truncated tail before appending; readers skip blank and unparsable
// lines (including a truncated last line) instead of throwing.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Parsed records of a JSONL text: blank and unparsable lines are skipped. */
export function parseJsonlTolerant(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* truncated or corrupt line: skipped */ }
  }
  return out;
}

/** Parsed records of a JSONL file: missing file reads as no records. */
export function readJsonlRecords(file) {
  if (!existsSync(file)) return [];
  return parseJsonlTolerant(readFileSync(file, 'utf8'));
}

/**
 * Drops a truncated last line: when the final non-empty line does not parse as JSON,
 * the file is cut back to the previous newline (a partial record must never be
 * concatenated with the next append). A missing trailing newline on a complete last
 * record is completed instead.
 */
export function repairTruncatedJsonl(file) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf8');
  if (!raw) return;
  if (raw.endsWith('\n')) {
    const idx = raw.slice(0, -1).lastIndexOf('\n');
    const last = idx === -1 ? raw.slice(0, -1) : raw.slice(idx + 1, -1);
    if (!last.trim()) return;
    try { JSON.parse(last); } catch { writeFileSync(file, idx === -1 ? '' : `${raw.slice(0, idx + 1)}`); }
    return;
  }
  const idx = raw.lastIndexOf('\n');
  const last = idx === -1 ? raw : raw.slice(idx + 1);
  if (!last.trim()) { writeFileSync(file, idx === -1 ? '' : `${raw.slice(0, idx + 1)}`); return; }
  try { JSON.parse(last); writeFileSync(file, `${raw}\n`); }
  catch { writeFileSync(file, idx === -1 ? '' : `${raw.slice(0, idx + 1)}`); }
}

/** Append one JSONL record, repairing a truncated tail first so resume stays readable. */
export function appendJsonlRecord(file, record, { mode } = {}) {
  repairTruncatedJsonl(file);
  if (!existsSync(file) && mode !== undefined) writeFileSync(file, '', { mode });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}
