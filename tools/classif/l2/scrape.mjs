#!/usr/bin/env node
// make classif-l2-scrape ENV=preprod — complement step (plan §B-L2, no LLM): for dev items flagged
// "missing-information" by ≥ 1 annotator in pass 1, fetch the public source document of the anchor
// (its sourceUrl in the graph) with Node fetch, honest user agent, robots.txt honoured, ≥ 2 s between
// requests. The pages that best match the item are kept as an excerpt. Every record is traced in
// scrape-manifest.jsonl (item, source, URL, fetch time, HTTP status, content type, sha256, paths).
// Complements feed the dev-truth passes only (reconciliation), never the evaluated prompts; any
// excerpt hitting a fingerprint list of the evaluation set is refused.
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { Buffer } from 'node:buffer';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchNodes } from '../lib/db.mjs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, classifHome, privateDir } from '../lib/paths.mjs';
import { loadFingerprints } from '../lib/draw.mjs';
import { scanFile } from '../guard/sandbox-build.mjs';
import { words } from '../lib/fingerprint.mjs';
import { ANNOTATORS, loadDevItems, readPass } from './run.mjs';

export const USER_AGENT = 'radar-immobilier/0.x (+https://github.com/rhanka/radar-immobilier)';
const MAX_EXCERPT = 6000;

export function sourceUrlOf(node) {
  const p = node?.props?.properties ?? {};
  const refs = [...(node?.props?.refs ?? []), ...(p.refs ?? [])];
  return p.sourceUrl ?? refs.find((r) => r?.sourceUrl)?.sourceUrl ?? null;
}

const robotsCache = new Map();
async function allowedByRobots(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.host)) {
    let rules = [];
    try {
      const r = await fetch(`${u.protocol}//${u.host}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        let applies = false;
        for (const line of (await r.text()).split('\n')) {
          const [k, ...v] = line.split(':');
          const key = k.trim().toLowerCase();
          const val = v.join(':').trim();
          if (key === 'user-agent') applies = val === '*' || /radar-immobilier/i.test(val);
          else if (applies && key === 'disallow' && val) rules.push(val);
        }
      }
    } catch { rules = []; }
    robotsCache.set(u.host, rules);
  }
  return !robotsCache.get(u.host).some((pref) => u.pathname.startsWith(pref));
}

/** Pages of the fetched document that best match the item text (token overlap), capped. */
export function bestExcerpt(text, itemInput) {
  const target = new Set(words(itemInput).filter((w) => w.length > 3 || /\d/.test(w)));
  const pages = text.split('\f').map((t, i) => ({ i, t, score: new Set(words(t).filter((w) => target.has(w))).size }));
  const top = pages.sort((a, b) => b.score - a.score).slice(0, 2).filter((p) => p.score > 0).sort((a, b) => a.i - b.i);
  return top.map((p) => `[page ${p.i + 1}]\n${p.t.trim()}`).join('\n\n').slice(0, MAX_EXCERPT);
}

export async function main() {
  const home = classifHome();
  const items = new Map(loadDevItems(home).map((i) => [i.itemId, i]));
  const pass1 = readPass(home, 1);
  const flagged = new Set();
  for (const a of ANNOTATORS) for (const an of pass1.get(a).values()) if (an.valid && an.ambiguous && an.cause === 'missing-information') flagged.add(an.itemId);
  const dir = privateDir(path.join(home, 'l2', 'external'));
  const manifest = path.join(home, 'l2', 'scrape-manifest.jsonl');
  if (existsSync(manifest)) { process.stdout.write(`[scrape] ${manifest} exists: complement step already done, skipped\n`); return { skipped: true }; }
  writeFileSync(manifest, '', { mode: 0o600 });
  const guard = loadFingerprints(home);
  const sigIds = [...flagged].filter((id) => items.get(id).kind === 'signal');
  const nodes = new Map(fetchNodes(sigIds.map((id) => items.get(id).anchor.id)).map((n) => [n.id, n]));
  const stats = {};
  const rec = (r) => { stats[r.status] = (stats[r.status] ?? 0) + 1; appendFileSync(manifest, `${JSON.stringify(r)}\n`); };
  for (const id of [...flagged].sort()) {
    const it = items.get(id);
    const base = { itemId: id, anchorId: it.anchor.id, source: 'source-document' };
    if (it.kind === 'pv') { rec({ ...base, status: 'no-target', note: 'full PV text already in the item' }); continue; }
    const url = sourceUrlOf(nodes.get(it.anchor.id));
    if (!url || !/^https?:\/\//.test(url)) { rec({ ...base, status: 'no-target', note: 'no public sourceUrl on the anchor' }); continue; }
    if (!(await allowedByRobots(url))) { rec({ ...base, url, status: 'robots-disallowed' }); continue; }
    const fetchedAt = new Date().toISOString();
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
    } catch (e) {
      rec({ ...base, url, fetchedAt, status: 'fetch-error', note: String(e.message).slice(0, 120) });
      await sleep(2000);
      continue;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    const digest = sha256(buf);
    const ext = /pdf/i.test(contentType) || /\.pdf($|\?)/i.test(url) ? 'pdf' : /html/i.test(contentType) ? 'html' : 'bin';
    const stored = path.join(dir, `${digest}.${ext}`);
    if (!existsSync(stored)) writeFileSync(stored, buf, { mode: 0o600 });
    let text = '';
    if (ext === 'pdf') { const t = spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', stored, '-'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }); text = t.status === 0 ? t.stdout : ''; }
    else if (ext === 'html') text = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ');
    const record = { ...base, url, fetchedAt, httpStatus: res.status, contentType, sha256: digest, storedPath: path.relative(home, stored) };
    if (!res.ok || !text.trim()) { rec({ ...record, status: res.ok ? 'no-text' : 'http-error' }); await sleep(2000); continue; }
    const excerpt = bestExcerpt(text, it.input);
    if (!excerpt) { rec({ ...record, status: 'no-matching-page' }); await sleep(2000); continue; }
    const hits = guard ? scanFile(guard, excerpt) : null;
    if (hits && Object.values(hits).some((h) => h > 0)) { rec({ ...record, status: 'refused-fingerprint', hits }); await sleep(2000); continue; }
    const excerptPath = path.join(dir, `${digest}.${sha256(id).slice(0, 8)}.excerpt.txt`);
    writeFileSync(excerptPath, excerpt, { mode: 0o600 });
    rec({ ...record, status: 'ok', excerptPath, excerptSha256: sha256(excerpt), excerptChars: excerpt.length });
    await sleep(2000);
  }
  const repoDir = path.join(CLASSIF_DIR, 'l2', 'manifests');
  mkdirSync(repoDir, { recursive: true });
  // Repository copy: paths relative to $CLASSIF_HOME (no absolute home path).
  writeFileSync(path.join(repoDir, 'scrape-manifest.jsonl'), readFileSync(manifest, 'utf8').split(`${home}/`).join(''));
  const summary = { flagged: flagged.size, byStatus: stats };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'scrape.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-scrape: ${err.stack}\n`); process.exit(1); });
}
