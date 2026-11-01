#!/usr/bin/env node
// make classif-l0-pvs ENV=preprod — 120 recent PVs without any linked signal (plan §B-L0.3).
// Candidates: Source nodes sourceKind pv/proces-verbal dated 2026-04-01..2026-06-30, with no edge
// to a Signal/DesignationEvent and a docSha cited by none. Excluded: exposed cities and documents.
// Seeded uniform draw (committed seed), ≤ 2 per city. Raw bytes read from the scraping bucket with
// s5cmd (read-only: ls + cp to $CLASSIF_HOME), sha256(raw) must equal docSha, text extracted locally
// (pdftotext for PDF). Credentials: SCRAPE_S3_* from the process environment, never printed.
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { selectJson } from '../lib/db.mjs';
import { sha256 } from '../lib/render.mjs';
import { baseCity } from '../lib/fingerprint.mjs';
import { classifHome, privateDir } from '../lib/paths.mjs';
import { MANIFEST_DIR, fingerprintHits, loadExclusions, loadSeed, requireFingerprints, seededOrder } from '../lib/draw.mjs';

const TARGET = 120;
const PER_CITY = 2;
const WINDOW = ['2026-04-01', '2026-06-30'];

export const CANDIDATE_SQL = `with pv as (select id, city_slug, props->'properties'->>'date' d, props->'properties'->>'docSha' sha,
    props->'properties'->>'format' fmt, props->'properties'->>'sourceKind' kind
    from graph_nodes where type='Source' and props->'properties'->>'sourceKind' in ('pv','proces-verbal')),
  cited as (select distinct coalesce(props->'properties'->>'docSha', props->>'docSha') sha from graph_nodes where type in ('Signal','DesignationEvent')
    union select distinct r->>'docSha' from graph_nodes g, jsonb_array_elements(coalesce(g.props->'refs','[]'::jsonb)) r where g.type in ('Signal','DesignationEvent')),
  linked as (select distinct e.src_id id from graph_edges e join graph_nodes n on n.id=e.dst_id and n.type in ('Signal','DesignationEvent')
    union select distinct e.dst_id from graph_edges e join graph_nodes n on n.id=e.src_id and n.type in ('Signal','DesignationEvent'))
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'citySlug', city_slug, 'date', d, 'docSha', sha, 'format', fmt, 'kind', kind) order by id), '[]'::jsonb)
  from pv where d between '${WINDOW[0]}' and '${WINDOW[1]}' and sha is not null
    and sha not in (select sha from cited where sha is not null) and id not in (select id from linked)`;

function s3Env() {
  const need = ['SCRAPE_S3_ACCESS_KEY', 'SCRAPE_S3_SECRET_KEY', 'SCRAPE_S3_BUCKET', 'SCRAPE_S3_ENDPOINT'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`S3 read credentials missing from the environment: ${missing.join(', ')}`);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, AWS_ACCESS_KEY_ID: process.env.SCRAPE_S3_ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: process.env.SCRAPE_S3_SECRET_KEY, AWS_REGION: process.env.SCRAPE_S3_REGION ?? 'fr-par' };
  return { env, bucket: process.env.SCRAPE_S3_BUCKET, endpoint: process.env.SCRAPE_S3_ENDPOINT };
}

function s5(s3, args) {
  // Only read verbs are ever passed (ls, cp from s3:// to a local path).
  if (!['ls', 'cp'].includes(args[0]) || (args[0] === 'cp' && !String(args.at(-2)).startsWith('s3://'))) throw new Error('s5cmd: read-only verbs only');
  return spawnSync('s5cmd', ['--endpoint-url', s3.endpoint, ...args], { env: s3.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function extractText(file, ext) {
  if (ext === 'pdf') {
    const r = spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : '';
  }
  const raw = readFileSync(file, 'utf8');
  return ext === 'html' || ext === 'htm' ? raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ') : raw;
}

const normaliseText = (t) => t.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export async function main(argv = process.argv.slice(2)) {
  const seedArg = argv[argv.indexOf('--seed') + 1] || undefined;
  const seed = loadSeed('pvs', argv.includes('--seed') ? seedArg : undefined);
  const home = classifHome();
  const excl = loadExclusions(home);
  const fp = requireFingerprints(home);
  const s3 = s3Env();
  const rawDir = privateDir(path.join(home, 'l0', 'pv-raw'));
  const outFile = path.join(home, 'l0', 'pv-items.jsonl');
  if (existsSync(outFile)) throw new Error(`${outFile} exists; delete it to redraw`);

  const candidates = selectJson(CANDIDATE_SQL);
  const kept = candidates.filter((c) => !excl.cities.has(baseCity(c.citySlug)) && !excl.docShas.has(c.docSha));
  const ordered = seededOrder(seed, kept);
  const perCity = new Map();
  const items = [];
  const losses = {};
  const loss = (why) => { losses[why] = (losses[why] ?? 0) + 1; };
  for (const c of ordered) {
    if (items.length >= TARGET) break;
    if ((perCity.get(c.citySlug) ?? 0) >= PER_CITY) { loss('city-cap'); continue; }
    const ls = s5(s3, ['ls', `s3://${s3.bucket}/raw/proces-verbaux-${c.citySlug}/cas/${c.docSha}.*`]);
    const key = ls.status === 0 ? ls.stdout.split('\n').map((l) => l.trim().split(/\s+/).pop()).find((k) => k && k.startsWith(c.docSha)) : null;
    if (!key) { loss('raw-not-found'); continue; }
    const ext = key.split('.').pop().toLowerCase();
    const local = path.join(rawDir, key);
    if (!existsSync(local)) {
      const cp = s5(s3, ['cp', `s3://${s3.bucket}/raw/proces-verbaux-${c.citySlug}/cas/${key}`, local]);
      if (cp.status !== 0) { loss('raw-fetch-failed'); continue; }
    }
    const raw = readFileSync(local);
    if (sha256(raw) !== c.docSha) { loss('sha256-mismatch'); continue; }
    const text = normaliseText(extractText(local, ext));
    if (text.length < 500) { loss('no-text-layer'); continue; }
    const input = `Municipalité : ${c.citySlug}\nDocument : procès-verbal du ${c.date} (source ${c.id})\n\n${text}`;
    if (fingerprintHits(fp, input, [c.citySlug])) { loss('fingerprint-hit'); continue; }
    perCity.set(c.citySlug, (perCity.get(c.citySlug) ?? 0) + 1);
    items.push({ itemId: `dev-pv-${c.docSha.slice(0, 12)}`, kind: 'pv', anchor: { type: 'Source', id: c.id, citySlug: c.citySlug, date: c.date, docSha: c.docSha },
      rawKey: `raw/proces-verbaux-${c.citySlug}/cas/${key}`, rawSha256: c.docSha, textSha256: sha256(text), textChars: text.length, input, inputSha256: sha256(input) });
  }
  if (items.length < TARGET) throw new Error(`only ${items.length}/${TARGET} PVs after losses ${JSON.stringify(losses)}`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  const body = `${items.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(outFile, body, { flag: 'wx', mode: 0o600 });
  const manifest = {
    lot: 'L0', kind: 'pv-draw', createdAt: new Date().toISOString(), seed, seedsFile: 'tools/classif/l0/seeds.json',
    window: WINDOW, querySha256: sha256(CANDIDATE_SQL), candidates: candidates.length, afterExclusions: kept.length,
    exclusions: { source: excl.source, cities: excl.cities.size, docShas: excl.docShas.size }, perCityCap: PER_CITY,
    losses, drawn: items.length, cities: perCity.size, itemsFileSha256: sha256(body),
    items: items.map((i) => ({ itemId: i.itemId, ...i.anchor, rawKey: i.rawKey, textSha256: i.textSha256, textChars: i.textChars, inputSha256: i.inputSha256 })),
  };
  mkdirSync(MANIFEST_DIR, { recursive: true });
  writeFileSync(path.join(MANIFEST_DIR, 'pv-draw-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  const { items: _omit, ...summary } = manifest;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l0', 'pvs.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l0-pvs: ${err.message}\n`); process.exit(1); });
}
