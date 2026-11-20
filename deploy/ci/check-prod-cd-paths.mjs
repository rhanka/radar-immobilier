#!/usr/bin/env node
import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function walkYamlFiles(dir, root) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkYamlFiles(full, root));
      continue;
    }
    if (!/\.(ya?ml)$/.test(entry.name)) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    out.push({ full, rel, isSymlink: entry.isSymbolicLink() });
  }
  return out;
}

export function validateProdCdPaths(root) {
  const registryPath = path.join(root, 'deploy/ci/prod-cd-paths.json');
  const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const errors = [];

  const nonProd = new Set(reg.nonProdFiles || []);
  const preprodFiles = new Set(reg.preprodFiles || []);
  const preprodPrefixes = reg.preprodPrefixes || [];
  const cdMap = new Map();
  const operatorMap = new Map();
  const exemptMap = new Map();
  const wfCache = new Map();
  const epCache = new Map();

  const seenAll = new Set();
  const track = (p, section) => {
    if (seenAll.has(p)) errors.push(`Duplicate manifest declaration across sections: ${p} (${section})`);
    seenAll.add(p);
    if (!fs.existsSync(path.join(root, p))) errors.push(`Stale registry path (${section}): ${p} does not exist`);
  };

  for (const p of nonProd) track(p, 'nonProdFiles');
  for (const p of preprodFiles) track(p, 'preprodFiles');

  for (const entry of reg.cdPaths || []) {
    track(entry.path, 'cdPaths');
    cdMap.set(entry.path, entry);
    if (!Array.isArray(entry.objects) || entry.objects.length === 0) {
      errors.push(`cdPaths entry '${entry.path}' must list target Kubernetes objects`);
    }
    if (!entry.workflow || !/^\.github\/workflows\/.*\.ya?ml$/.test(entry.workflow)) {
      errors.push(`cdPaths entry '${entry.path}' has invalid workflow path '${entry.workflow || ''}'`);
      continue;
    }
    const wfFull = path.join(root, entry.workflow);
    if (!fs.existsSync(wfFull)) {
      errors.push(`cdPaths entry '${entry.path}' references missing workflow '${entry.workflow}'`);
      continue;
    }
    if (!wfCache.has(entry.workflow)) wfCache.set(entry.workflow, fs.readFileSync(wfFull, 'utf8'));
    const wfText = wfCache.get(entry.workflow);
    if (!entry.workflowRef || !wfText.includes(entry.workflowRef)) {
      errors.push(`cdPaths entry '${entry.path}': workflowRef '${entry.workflowRef || ''}' not found in ${entry.workflow}`);
    }
  }

  for (const entry of reg.operatorPaths || []) {
    track(entry.path, 'operatorPaths');
    operatorMap.set(entry.path, entry);
    if (!Array.isArray(entry.objects) || entry.objects.length === 0) {
      errors.push(`operatorPaths entry '${entry.path}' must list target Kubernetes objects`);
    }
    if (!entry.reason || !String(entry.reason).trim()) {
      errors.push(`operatorPaths entry '${entry.path}' requires a reason`);
    }
    if (!entry.doc || !fs.existsSync(path.join(root, entry.doc))) {
      errors.push(`operatorPaths entry '${entry.path}' references missing doc '${entry.doc || ''}'`);
    }
    if (!entry.entrypoint || !fs.existsSync(path.join(root, entry.entrypoint))) {
      errors.push(`operatorPaths entry '${entry.path}' references missing entrypoint '${entry.entrypoint || ''}'`);
      continue;
    }
    if (!epCache.has(entry.entrypoint)) epCache.set(entry.entrypoint, fs.readFileSync(path.join(root, entry.entrypoint), 'utf8'));
    const epText = epCache.get(entry.entrypoint);
    if (!entry.entrypointRef || !epText.includes(entry.entrypointRef)) {
      errors.push(`operatorPaths entry '${entry.path}': entrypointRef '${entry.entrypointRef || ''}' not found in ${entry.entrypoint}`);
    }
  }

  for (const entry of reg.legacyExempt || []) {
    track(entry.path, 'legacyExempt');
    exemptMap.set(entry.path, entry);
    if (!entry.reason || !String(entry.reason).trim()) errors.push(`legacyExempt '${entry.path}' requires a reason`);
    if (!entry.doc || !fs.existsSync(path.join(root, entry.doc))) {
      errors.push(`legacyExempt '${entry.path}' references missing doc '${entry.doc || ''}'`);
    }
  }

  const deployRoot = fs.realpathSync(path.join(root, 'deploy'));
  const files = walkYamlFiles(path.join(root, 'deploy'), root);
  for (const f of files) {
    if (f.isSymlink) {
      const target = fs.realpathSync(f.full);
      if (!target.startsWith(`${deployRoot}/`)) errors.push(`Symlink escapes deploy/: ${f.rel}`);
      continue;
    }
    const inPreprod = preprodFiles.has(f.rel) || preprodPrefixes.some((pfx) => f.rel.startsWith(pfx));
    if (nonProd.has(f.rel) || inPreprod || cdMap.has(f.rel) || operatorMap.has(f.rel) || exemptMap.has(f.rel)) continue;
    errors.push(
      `Undeclared production manifest '${f.rel}': add a GitHub Actions CD workflow (cdPaths) or a documented operator path (operatorPaths) in deploy/ci/prod-cd-paths.json`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    counts: { cd: cdMap.size, operator: operatorMap.size, legacyExempt: exemptMap.size, totalScanned: files.length },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = path.resolve(process.argv[2] || '.');
  const res = validateProdCdPaths(root);
  if (!res.ok) {
    for (const e of res.errors) console.error(`ERROR: ${e}`);
    process.exit(1);
  }
  console.log(`prod-cd-paths guard OK: ${res.counts.cd} CD-mapped, ${res.counts.operator} operatorPaths, ${res.counts.legacyExempt} documented legacyExempt (${res.counts.totalScanned} YAML files checked)`);
}
