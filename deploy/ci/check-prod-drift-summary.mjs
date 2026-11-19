#!/usr/bin/env node
import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PINNED_API_RE = /^ghcr\.io\/rhanka\/radar-api@sha256:[0-9a-f]{64}$/;
const REFRESH_CRONS = ['radar-refresh-pv', 'radar-refresh-pending-watchdog'];
const BACKUP_CRONS = ['radar-backup-daily', 'radar-backup-freshness', 'radar-db-backup-prod'];

const splitYamlDocs = (raw) => raw.split(/^---\s*$/m).map((d) => d.trim()).filter(Boolean);
const die = (msg) => { console.error(`FAIL ${msg}`); process.exit(1); };

function extractRenderedApiRefs(yamlText) {
  const refs = [];
  for (const m of yamlText.matchAll(/\bimage:\s*["']?([^"'\s#]+)["']?/g)) {
    if (m[1].includes('radar-api')) refs.push({ field: 'image', value: m[1] });
  }
  for (const m of yamlText.matchAll(/name:\s*BACKUP_IMAGE\s*,\s*value:\s*["']?([^"'\s}]+)["']?/g)) {
    refs.push({ field: 'env.BACKUP_IMAGE', value: m[1] });
  }
  for (const m of yamlText.matchAll(/name:\s*BACKUP_IMAGE\s*\n\s*value:\s*["']?([^"'\s#]+)["']?/g)) {
    refs.push({ field: 'env.BACKUP_IMAGE', value: m[1] });
  }
  return refs;
}

function cmdValidateRender(args) {
  const [wantKind, wantName, filePath] = args;
  if (!wantKind || !wantName || !filePath || !fs.existsSync(filePath)) die('validate-render requires <kind> <name> <file>');
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) die(`empty rendered manifest for ${wantKind}/${wantName}`);
  const docs = splitYamlDocs(raw).map((d) => {
    const kind = (/^kind:\s*["']?([A-Za-z0-9_]+)["']?/m.exec(d) || [])[1] || '';
    const meta = (/^metadata:\n((?:[ \t]+.*\n?)*)/m.exec(d) || [])[1] || '';
    const name = (/^ {2}name:\s*["']?([^"'\s#]+)["']?/m.exec(meta) || [])[1] || '';
    return { kind, name, text: d };
  });
  for (const d of docs) {
    if (/^(Secret|SealedSecret|Deployment)$/.test(d.kind)) {
      die(`forbidden kind '${d.kind}' in rendered scope for ${wantKind}/${wantName}`);
    }
  }
  const matches = docs.filter((d) => d.kind === wantKind && d.name === wantName);
  if (matches.length !== 1) die(`expected 1 ${wantKind}/${wantName} doc in ${filePath}, got ${matches.length}`);
  for (const ref of extractRenderedApiRefs(matches[0].text)) {
    if (!PINNED_API_RE.test(ref.value)) die(`${wantKind}/${wantName} ${ref.field} unpinned: '${ref.value}'`);
  }
  console.log(`validate-render OK: ${wantKind}/${wantName}`);
}

function cmdSummarizeDiff(args) {
  const [label, diffFile] = args;
  if (!label || !diffFile || !fs.existsSync(diffFile)) die('summarize-diff requires <label> <diffFile>');
  const lines = fs.readFileSync(diffFile, 'utf8').split('\n');
  const stack = [];
  const findings = new Map();
  for (const line of lines) {
    if (/^(---|\+\+\+|@@|diff )/.test(line) || line === '') {
      if (line.startsWith('@@')) stack.length = 0;
      continue;
    }
    const prefix = line[0];
    if (prefix !== ' ' && prefix !== '-' && prefix !== '+') continue;
    const content = line.slice(1);
    const trimmed = content.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = content.search(/\S/);
    const clean = trimmed.startsWith('- ') ? trimmed.slice(2) : trimmed;
    const kv = /^([A-Za-z0-9_./-]+):(?:\s*(.*))?$/.exec(clean);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const inConfigMapData = stack.length >= 2 && stack[0].key === 'data' && indent > stack[1].indent;
    if (kv && !inConfigMapData) stack.push({ indent, key: kv[1] });
    if (prefix === '-' || prefix === '+') {
      const field = stack.map((x) => x.key).join('.') || '<root>';
      const snippet = trimmed.length > 96 ? `${trimmed.slice(0, 93)}...` : trimmed;
      if (!findings.has(field)) findings.set(field, []);
      const arr = findings.get(field);
      if (arr.length < 4) arr.push(`${prefix}${snippet}`);
    }
  }
  if (findings.size === 0) {
    console.log(`DRIFT|${label}|<unparsed-diff>|see kubectl diff output`);
    return;
  }
  for (const [field, samples] of findings.entries()) {
    console.log(`DRIFT|${label}|${field}|${samples.join(' ; ')}`);
  }
}

function collectLiveImages(cjJson) {
  const podSpec = cjJson?.spec?.jobTemplate?.spec?.template?.spec || {};
  const out = [];
  for (const [group, list] of [['initContainers', podSpec.initContainers || []], ['containers', podSpec.containers || []]]) {
    for (const c of list) {
      if (String(c.image || '').includes('radar-api')) {
        out.push({ field: `spec.jobTemplate.spec.template.spec.${group}[${c.name}].image`, value: c.image });
      }
      for (const e of c.env || []) {
        if (e.name === 'BACKUP_IMAGE') {
          out.push({ field: `spec.jobTemplate.spec.template.spec.${group}[${c.name}].env.BACKUP_IMAGE`, value: e.value || '' });
        }
      }
    }
  }
  return out;
}

function cmdVerifyImages(args) {
  const [servedFile, expectedApiImage, liveDir, renderedDir] = args;
  if (!servedFile || !liveDir || !renderedDir) die('verify-images requires <servedJson> <expectedApiOrEmpty> <liveDir> <renderedDir>');
  const deploy = JSON.parse(fs.readFileSync(servedFile, 'utf8'));
  const served = deploy?.spec?.template?.spec?.containers?.[0]?.image || '';
  if (!PINNED_API_RE.test(served)) {
    console.log(`DRIFT|Deployment/radar-api|spec.template.spec.containers[0].image|not pinned digest: '${served}'`);
    process.exit(1);
  }
  if (expectedApiImage && served !== expectedApiImage) {
    console.log(`DRIFT|Deployment/radar-api|spec.template.spec.containers[0].image|live='${served}' expected='${expectedApiImage}'`);
    process.exit(1);
  }
  console.log(`INFO served deploy/radar-api digest = ${served}`);
  const issues = [];
  for (const cj of REFRESH_CRONS) {
    const live = JSON.parse(fs.readFileSync(path.join(liveDir, `${cj}.json`), 'utf8'));
    const imgs = collectLiveImages(live);
    if (imgs.length === 0) issues.push(`DRIFT|CronJob/${cj}|spec.jobTemplate|no radar-api container found`);
    for (const item of imgs) {
      if (item.value !== served) issues.push(`DRIFT|CronJob/${cj}|${item.field}|live='${item.value}' served='${served}'`);
    }
  }
  const backupDigests = new Set();
  for (const cj of BACKUP_CRONS) {
    const renderedText = fs.readFileSync(path.join(renderedDir, `${cj}.yaml`), 'utf8');
    const wantRefs = extractRenderedApiRefs(renderedText);
    const wantImg = wantRefs[0]?.value || '';
    if (!PINNED_API_RE.test(wantImg) || wantRefs.some((r) => r.value !== wantImg)) {
      issues.push(`DRIFT|CronJob/${cj}|manifest.images|unpinned or inconsistent manifest radar-api digest`);
    }
    backupDigests.add(wantImg);
    const live = JSON.parse(fs.readFileSync(path.join(liveDir, `${cj}.json`), 'utf8'));
    for (const item of collectLiveImages(live)) {
      if (!PINNED_API_RE.test(item.value) || item.value !== wantImg) {
        issues.push(`DRIFT|CronJob/${cj}|${item.field}|live='${item.value}' manifest='${wantImg}'`);
      }
    }
  }
  if (backupDigests.size !== 1) issues.push(`DRIFT|CronJob/backup-set|image|mismatched pinned digests across backup CronJobs`);
  const [pinnedBackup] = [...backupDigests];
  const syncNote = pinnedBackup === served ? 'matches served deploy/radar-api' : `differs from served deploy/radar-api (${served.slice(-12)})`;
  console.log(`INFO pinned backup CronJobs digest = ${pinnedBackup} (${syncNote})`);
  for (const i of issues) console.log(i);
  if (issues.length) process.exit(1);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'validate-render') cmdValidateRender(rest);
else if (cmd === 'summarize-diff') cmdSummarizeDiff(rest);
else if (cmd === 'verify-images') cmdVerifyImages(rest);
else die(`unknown subcommand '${cmd || ''}'`);
