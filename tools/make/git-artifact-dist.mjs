// Pre-flight of a built artifact dist against the server publication
// ceilings (G0 v3 §4.1): 255 files, 16 MiB per file, 64 MiB per release.
// Overflow is `dist_over_limits` and nothing is uploaded. Also computes the
// candidate manifest digest (§4.3). Pure Node, no dependency.
//
// CLI: node git-artifact-dist.mjs <distDir> [entry]
// Prints a JSON summary; exit 1 on any violation.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LIMITS = Object.freeze({
  maxFiles: 255,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});

function walk(root, rel, out, violations) {
  for (const name of readdirSync(join(root, rel)).sort()) {
    const path = rel === '' ? name : `${rel}/${name}`;
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) walk(root, path, out, violations);
    else if (stat.isFile()) out.push({ path, bytes: stat.size });
    else violations.push(`non-regular entry ${path}`);
  }
}

/**
 * Candidate manifest digest, DRAFT canonical form: sha256 over the sorted
 * lines `<path>\t<bytes>\t<sha256>\n`. The authoritative canonicalization is
 * the sentropic artifacts manifest (0.2.19, CG6); align before activation.
 */
export function manifestDigest(files) {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(f => `${f.path}\t${f.bytes}\t${f.sha256}\n`)
    .join('');
  return `sha256:${createHash('sha256').update(lines).digest('hex')}`;
}

export function scanDist(dir, { entry = 'index.html', limits = LIMITS } = {}) {
  const files = [];
  const violations = [];
  walk(dir, '', files, violations);
  for (const f of files) f.sha256 = createHash('sha256').update(readFileSync(join(dir, f.path))).digest('hex');
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const largest = files.reduce((m, f) => (f.bytes > (m?.bytes ?? -1) ? f : m), null);
  if (files.length > limits.maxFiles) violations.push(`file count ${files.length} > ${limits.maxFiles}`);
  for (const f of files) if (f.bytes > limits.maxFileBytes) violations.push(`file ${f.path} ${f.bytes} B > ${limits.maxFileBytes} B`);
  if (totalBytes > limits.maxTotalBytes) violations.push(`total ${totalBytes} B > ${limits.maxTotalBytes} B`);
  if (entry && !files.some(f => f.path === entry)) violations.push(`entry ${entry} missing`);
  return {
    fileCount: files.length,
    totalBytes,
    largestFile: largest ? { path: largest.path, bytes: largest.bytes } : null,
    candidateDigest: manifestDigest(files),
    limits,
    code: violations.length === 0 ? null : 'dist_over_limits',
    violations,
    files,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, entry = 'index.html'] = process.argv.slice(2);
  if (!dir) { console.error('usage: git-artifact-dist.mjs <distDir> [entry]'); process.exit(2); }
  const summary = scanDist(dir, { entry });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.violations.length === 0 ? 0 : 1);
}
