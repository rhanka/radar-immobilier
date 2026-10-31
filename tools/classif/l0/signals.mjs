#!/usr/bin/env node
// make classif-l0-signals ENV=preprod [DRY_RUN=1] — dev signal draw (plan §B-L0.2).
// Pool: Signal ∪ DesignationEvent citing at least one document (docSha), outside the exposed
// cities, nodes, documents and bylaw numbers of guard/exclusions.json. Strata: B′ pass state
// computed by the repository code (lib/bprime.mjs), 192 / 96 / 96 for pass 1 / 2 / 3; inside each
// pass, proportional allocation over (étape group × node type); seeded order; ≤ 4 per city;
// ≥ 100 cities. Region = distance band to Montréal (municipalities.qc.json) — [PROPOSAL], reported.
// The draw is refused until exclusions.json exists; DRY_RUN prints strata counts only.
import path from 'node:path';
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { renderItem, nodeBylaws, nodeDocShas, sha256 } from '../lib/render.mjs';
import { baseCity } from '../lib/fingerprint.mjs';
import { bprimeStates, fetchProjectionRows } from '../lib/bprime.mjs';
import { REPO, classifHome } from '../lib/paths.mjs';
import { MANIFEST_DIR, fingerprintHits, loadExclusions, loadFingerprints, loadSeed, regionBand, seededOrder } from '../lib/draw.mjs';

export const TARGETS = { pass1: 192, pass2: 96, pass3: 96 };
const PER_CITY = 4;
const MIN_CITIES = 100;
const INDIVIDUAL = new Set(['derogation', 'piia', 'ppcmoi']);

export function etapeGroup(row, state) {
  const p = row.props?.properties ?? {};
  const txt = `${row.category ?? ''} ${row.etapeAnnote ?? ''} ${p.kind ?? ''}`.toLowerCase();
  if (INDIVIDUAL.has(state?.instrument) || /usage[_ ]conditionnel|derogation|piia|ppcmoi/.test(txt)) return 'individual-authorisation';
  return 'regulatory-instrument';
}

/** Largest-remainder allocation of `total` over cells proportionally to their sizes. */
export function allocate(total, sizes) {
  const sum = Object.values(sizes).reduce((a, b) => a + b, 0);
  if (!sum) return {};
  const raw = Object.entries(sizes).map(([k, n]) => [k, (total * n) / sum]);
  const out = Object.fromEntries(raw.map(([k, v]) => [k, Math.min(Math.floor(v), sizes[k])]));
  let left = total - Object.values(out).reduce((a, b) => a + b, 0);
  for (const [k] of raw.sort((a, b) => (b[1] % 1) - (a[1] % 1))) {
    if (left <= 0) break;
    if (out[k] < sizes[k]) { out[k]++; left--; }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const dry = argv.includes('--dry-run');
  const seedArg = argv.includes('--seed') ? argv[argv.indexOf('--seed') + 1] || undefined : undefined;
  const seed = loadSeed('signals', seedArg);
  const home = classifHome();
  const excl = loadExclusions(home, { require: !dry });
  const fp = loadFingerprints(home);
  const muni = new Map(JSON.parse(readFileSync(path.join(REPO, 'packages/radar-sources/src/geo/municipalities.qc.json'), 'utf8')).map((m) => [m.slug, m]));

  const rows = [...new Map(fetchProjectionRows().map((r) => [r.id, r])).values()];
  const states = bprimeStates(rows);
  const reasons = {};
  const out = (why) => { reasons[why] = (reasons[why] ?? 0) + 1; return false; };
  const pool = rows.filter((r) => {
    const shas = nodeDocShas(r);
    if (!shas.length) return out('no-evidence');
    if (excl.cities.has(baseCity(r.citySlug))) return out('exposed-city');
    if (excl.nodeIds.has(r.id)) return out('exposed-node');
    if (shas.some((s) => excl.docShas.has(s))) return out('exposed-document');
    if (nodeBylaws(r).some((b) => excl.bylaws.has(b))) return out('exposed-bylaw-number');
    return true;
  }).map((r) => {
    const st = states.get(r.id);
    return { row: r, pass: st?.pass ?? 'pass3', group: etapeGroup(r, st), type: r.type, region: regionBand(muni.get(baseCity(r.citySlug))?.distanceToMtlKm), instrument: st?.instrument ?? null };
  });
  const cellOf = (x) => `${x.group}|${x.type}`;
  const strata = {};
  for (const x of pool) {
    const k = `${x.pass}|${cellOf(x)}|${x.region}`;
    strata[k] = (strata[k] ?? 0) + 1;
  }
  const head = { seed, exclusions: { source: excl.source, complete: excl.complete }, rows: rows.length, classified: states.size, excludedByReason: reasons, pool: pool.length,
    poolByPass: Object.fromEntries(Object.keys(TARGETS).map((p) => [p, pool.filter((x) => x.pass === p).length])), poolCities: new Set(pool.map((x) => baseCity(x.row.citySlug))).size };
  if (dry) {
    process.stdout.write(`${JSON.stringify({ dryRun: true, ...head, strata }, null, 2)}\n`);
    return head;
  }

  const outFile = path.join(home, 'l0', 'signal-items.jsonl');
  if (existsSync(outFile)) throw new Error(`${outFile} exists; delete it to redraw`);
  const perCity = new Map();
  const items = [];
  const losses = {};
  const allocation = {};
  for (const [pass, target] of Object.entries(TARGETS)) {
    const inPass = pool.filter((x) => x.pass === pass);
    const sizes = {};
    for (const x of inPass) sizes[cellOf(x)] = (sizes[cellOf(x)] ?? 0) + 1;
    allocation[pass] = allocate(target, sizes);
    for (const [cell, want] of Object.entries(allocation[pass])) {
      let got = 0;
      for (const x of seededOrder(seed, inPass.filter((y) => cellOf(y) === cell), (y) => y.row.id)) {
        if (got >= want) break;
        const city = baseCity(x.row.citySlug);
        if ((perCity.get(city) ?? 0) >= PER_CITY) { losses['city-cap'] = (losses['city-cap'] ?? 0) + 1; continue; }
        const input = renderItem(x.row.citySlug, [x.row]);
        if (fingerprintHits(fp, input, [x.row.citySlug])) { losses['fingerprint-hit'] = (losses['fingerprint-hit'] ?? 0) + 1; continue; }
        perCity.set(city, (perCity.get(city) ?? 0) + 1);
        got++;
        items.push({ itemId: `dev-sig-${sha256(x.row.id).slice(0, 12)}`, kind: 'signal', anchor: { type: x.type, id: x.row.id, citySlug: x.row.citySlug, docShas: nodeDocShas(x.row) },
          strata: { pass, group: x.group, region: x.region, instrument: x.instrument }, input, inputSha256: sha256(input) });
      }
      if (got < want) losses[`short:${pass}|${cell}`] = want - got;
    }
  }
  if (perCity.size < MIN_CITIES) throw new Error(`draw has ${perCity.size} cities (< ${MIN_CITIES})`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  const body = `${items.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(outFile, body, { flag: 'wx', mode: 0o600 });
  const count = (k) => items.reduce((m, i) => ({ ...m, [k(i)]: (m[k(i)] ?? 0) + 1 }), {});
  const manifest = {
    lot: 'L0', kind: 'signal-draw', createdAt: new Date().toISOString(), seedsFile: 'tools/classif/l0/seeds.json', ...head,
    targets: TARGETS, allocation, perCityCap: PER_CITY, losses, drawn: items.length, cities: perCity.size, itemsFileSha256: sha256(body),
    drawnBy: { pass: count((i) => i.strata.pass), group: count((i) => i.strata.group), type: count((i) => i.anchor.type), region: count((i) => i.strata.region) },
    items: items.map((i) => ({ itemId: i.itemId, ...i.anchor, ...i.strata, inputSha256: i.inputSha256 })),
  };
  mkdirSync(MANIFEST_DIR, { recursive: true });
  writeFileSync(path.join(MANIFEST_DIR, 'signal-draw-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  // dev-items.jsonl = signals + PVs (when the PV draw is done), with a combined manifest.
  const pvFile = path.join(home, 'l0', 'pv-items.jsonl');
  if (existsSync(pvFile)) {
    const dev = body + readFileSync(pvFile, 'utf8');
    writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), dev, { mode: 0o600 });
    const pvManifest = JSON.parse(readFileSync(path.join(MANIFEST_DIR, 'pv-draw-manifest.json'), 'utf8'));
    writeFileSync(path.join(MANIFEST_DIR, 'draw-manifest.json'), `${JSON.stringify({
      lot: 'L0', createdAt: new Date().toISOString(), devItems: dev.trim().split('\n').length, devItemsSha256: sha256(dev),
      signals: { drawn: items.length, itemsFileSha256: manifest.itemsFileSha256, manifest: 'signal-draw-manifest.json' },
      pvs: { drawn: pvManifest.drawn, itemsFileSha256: pvManifest.itemsFileSha256, manifest: 'pv-draw-manifest.json' },
    }, null, 1)}\n`);
  }
  const { items: _omit, ...summary } = manifest;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l0', 'signals.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l0-signals: ${err.message}\n`); process.exit(1); });
}
