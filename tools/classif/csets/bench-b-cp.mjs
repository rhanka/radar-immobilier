import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { callSeat } from '../run-seat.mjs';
import { privateDir } from '../lib/paths.mjs';
import { appendJsonlRecord } from '../lib/jsonl.mjs';
import { wilson } from './metrics.mjs';

const FILTER_PROMPT_SHA256 = 'cf015e57c6e1cd1404efc7e22ddb014da0e4851aba9befea9ef39cae46094b68';
const TUNING_IDS_SHA256 = '60ca595a97187eaef736723bb5ff313efafa8a1ed08c80d5fe6b97d76a180505';
const BLIND_IDS_SHA256 = '61b8d4d544e4a00d02193f6b05b1d86fe467d90baa18cd52b821883b7b89620b';
const QUOTA_RE = /(\b429\b|\b401\b|\b403\b|rate.?limit|quota|overloaded|capacity|usage limit|individual quota|authentication|unauthori[sz]ed|token.*expired|not logged in)/i;
const sha256 = (x) => createHash('sha256').update(x).digest('hex');

const benchDir = process.env.BENCH_B_DIR || '/home/antoinefa/src/radar-immobilier/.claude/worktrees/agent-ae1c01a14a9859391/tools/bench-v11';
const sourceModel = process.env.CP_SOURCE_MODEL || 'astra-6.2-low';
const verifyModel = process.env.CP_VERIFY_MODEL || 'gemini-3.8-flash-low';
const sourceHome = process.env.CP_SOURCE_HOME || `/home/antoinefa/.local/share/radar-classif/bench-b-models/${sourceModel}`;
const cpHome = privateDir(process.env.CP_HOME || `/home/antoinefa/.local/share/radar-classif/bench-b-models/cp-${sourceModel}-${verifyModel}`);
const splitFile = process.env.BENCH_B_SPLIT_FILE || '/home/antoinefa/src/radar-immobilier/tmp/classif-1passe/tools/classif/1passe/split.json';
const outPath = process.env.CP_OUT || null;
const concurrency = Math.min(8, Math.max(1, Number(process.env.BENCH_CONCURRENCY ?? 4) || 4));

const decisionsDir = privateDir(`${cpHome}/decisions`);
const validatedDir = privateDir(`${cpHome}/validated`);
const callsLog = `${cpHome}/calls.jsonl`;

const { actsOf, filterUserMessage, applyDecisions } = await import(pathToFileURL(`${benchDir}/harness/precision-cascade.mjs`).href);
const { documentPages, parseJsonObject } = await import(pathToFileURL(`${benchDir}/harness/oracle-v3-lib.mjs`).href);

const filterMd = readFileSync(`${benchDir}/harness/cp-prompt-filtre.md`, 'utf8');
const match = filterMd.match(/<!-- PROMPT-FILTER-BEGIN -->\n([\s\S]*?)\n<!-- PROMPT-FILTER-END -->/u);
if (!match) throw new Error('PROMPT-FILTER block missing in cp-prompt-filtre.md');
const filterPrompt = match[1];
if (sha256(filterPrompt) !== FILTER_PROMPT_SHA256) throw new Error('Frozen CP filter prompt checksum mismatch');

// Cross-check exact parity with production REFRESH_VERIFICATION_PROMPT when present.
const prodPromptPath = '/home/antoinefa/src/radar-immobilier/tmp/ops-main/api/src/services/graph/refresh-verification-prompt.ts';
let prodPromptSha256 = null;
if (existsSync(prodPromptPath)) {
  const prodTs = readFileSync(prodPromptPath, 'utf8');
  const pm = prodTs.match(/export const REFRESH_VERIFICATION_PROMPT = `([\s\S]*?)`;/u);
  if (pm) {
    prodPromptSha256 = sha256(pm[1]);
    if (prodPromptSha256 !== FILTER_PROMPT_SHA256) throw new Error(`Prod verification prompt drift: ${prodPromptSha256}`);
  }
}

const manifest = JSON.parse(readFileSync(`${benchDir}/harness/manifest-v101b.json`, 'utf8'));
const split = JSON.parse(readFileSync(splitFile, 'utf8'));
if (sha256(`${split.tuning.join('\n')}\n`) !== TUNING_IDS_SHA256 || sha256(`${split.blind.join('\n')}\n`) !== BLIND_IDS_SHA256) {
  throw new Error('Frozen tuning/blind split checksum mismatch');
}

const queue = [...manifest.documents];
let stop = null;
let done = 0;
let skipped = 0;
let noSource = 0;
let noActs = 0;
let fallbackUnchanged = 0;
const started = new Date().toISOString();

async function oneDoc(doc) {
  const id = doc.id;
  const decisionFile = `${decisionsDir}/${id}.json`;
  const filteredFile = `${validatedDir}/low--${id}.output.json`;
  if (existsSync(decisionFile) && existsSync(filteredFile)) {
    skipped += 1;
    return;
  }
  const srcOutFile = `${sourceHome}/validated/low--${id}.output.json`;
  if (!existsSync(srcOutFile)) {
    noSource += 1;
    return;
  }
  const source = JSON.parse(readFileSync(srcOutFile, 'utf8'));
  const pages = documentPages(readFileSync(`${benchDir}/full/corpus/text/${id}.txt`, 'utf8'));
  const acts = actsOf(source);
  const base = {
    documentId: id,
    sourceModel,
    verifyModel,
    promptSha256: FILTER_PROMPT_SHA256,
    sourceOutputSha256: sha256(JSON.stringify(source)),
  };
  let decisions = [];
  let receipt = null;
  let verifierStatus = 'completed';

  if (acts.length === 0) {
    noActs += 1;
    verifierStatus = 'skipped-no-acts';
  } else {
    const userMsg = filterUserMessage(doc, pages, acts);
    const fullPrompt = `${filterPrompt}\n\n${userMsg}`;
    const inputSha256 = sha256(userMsg);
    let parsedOk = false;
    // Same policy as cp-prompt-filtre.md: retry once on invalid JSON / 0-token startup collision;
    // stop immediately on any 429/quota/auth refusal without caching.
    for (let attempt = 1; attempt <= 2 && !stop; attempt += 1) {
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), docId: id, model: verifyModel, attempt, intent: true, inputSha256 });
      const res = await callSeat(verifyModel, fullPrompt, { timeoutMs: 900_000 });
      appendJsonlRecord(callsLog, {
        at: new Date().toISOString(), docId: id, model: verifyModel, attempt, intent: false, inputSha256,
        code: res.code, latencyMs: res.latencyMs, usage: res.usage ?? null, toolEvents: res.toolEvents ?? 0,
        status: res.status ?? null, errorEnvelope: res.errorEnvelope || undefined,
      });
      const errText = `${res.errorEnvelope ?? ''} ${JSON.stringify(res.error ?? '')} ${res.stderrTail ?? ''}`;
      if (res.authError || res.binaryMissing || QUOTA_RE.test(errText)) {
        stop = 'account-or-quota-refusal';
        return;
      }
      receipt = {
        attempt, code: res.code, latencyMs: res.latencyMs, usage: res.usage ?? null,
        toolEvents: res.toolEvents ?? 0, inputSha256, status: res.status ?? null,
      };
      if (res.code === 0 && (res.toolEvents ?? 0) === 0 && typeof res.text === 'string' && res.text.trim()) {
        try {
          const parsed = parseJsonObject(res.text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
            parsedOk = true;
            break;
          }
        } catch { /* retry once per cp-prompt-filtre.md */ }
      }
    }
    if (stop) return;
    if (!parsedOk) {
      verifierStatus = 'failed-unchanged';
      fallbackUnchanged += 1;
      decisions = [];
    }
  }

  const { filtered, log: filterLog } = applyDecisions(source, acts, decisions, pages);
  writeFileSync(decisionFile, `${JSON.stringify({ ...base, verifierStatus, actsCount: acts.length, decisions, filter: filterLog, receipt }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(filteredFile, JSON.stringify(filtered), { mode: 0o600 });
  done += 1;
  if (done % 5 === 0 || done + skipped + noSource === manifest.documents.length) {
    console.log(JSON.stringify({ bench: 'B-CP', sourceModel, verifyModel, done, skipped, noSource, total: manifest.documents.length, lastDoc: id, acts: acts.length, removed: filterLog.removed.length, verifierStatus }));
  }
}

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (queue.length && !stop) {
    const doc = queue.shift();
    if (doc) await oneDoc(doc);
  }
}));

const status = {
  bench: 'B-CP', sourceModel, verifyModel, promptSha256: FILTER_PROMPT_SHA256, prodPromptSha256,
  started, ended: new Date().toISOString(), done, skipped, noSource, noActs, fallbackUnchanged,
  total: manifest.documents.length, stopped: stop, concurrency,
};
writeFileSync(`${cpHome}/status.json`, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
if (stop) {
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = 2;
} else {
  // Score strictly against oracle 676 with the exact frozen bench-v11 scorer.
  process.env.BENCH_DIR = benchDir;
  const { scoreSource } = await import(pathToFileURL(`${benchDir}/full/score-676.mjs`).href);
  const { aggregate } = await import(pathToFileURL(`${benchDir}/harness/score-oracle-v3.mjs`).href);
  const resolveDoc = async (documentId) => {
    const f = `${validatedDir}/low--${documentId}.output.json`;
    if (!existsSync(f)) return { state: 'refused_or_missing' };
    return { state: 'accepted', output: JSON.parse(readFileSync(f, 'utf8')) };
  };
  const scored = await scoreSource(`CP+ (${sourceModel} -> ${verifyModel})`, 'precision-cascade', resolveDoc);
  const enrich = (agg) => ({
    ...agg,
    support: agg.tp + agg.fn,
    missed: agg.fn,
    recallWilson95: wilson(agg.tp, agg.tp + agg.fn),
    precisionWilson95: wilson(agg.tp, agg.tp + agg.fp),
  });
  const halfMetrics = (name, ids) => {
    const set = new Set(ids);
    const sub = scored.cases.filter((c) => set.has(c.documentId));
    const acc = sub.filter((c) => c.accepted).length;
    return { half: name, docs: sub.length, accepted: acc, invalid: sub.length - acc, strict: enrich(aggregate(sub)) };
  };

  let actsJudged = 0; let actsRemoved = 0; let keptNoValidDecision = 0; let supportedUngrounded = 0; let unknownIds = 0;
  for (const doc of manifest.documents) {
    const f = `${decisionsDir}/${doc.id}.json`;
    if (!existsSync(f)) continue;
    const d = JSON.parse(readFileSync(f, 'utf8'));
    actsJudged += d.filter?.acts ?? 0;
    actsRemoved += d.filter?.removed?.length ?? 0;
    keptNoValidDecision += d.filter?.keptNoValidDecision ?? 0;
    supportedUngrounded += d.filter?.supportedUngrounded ?? 0;
    unknownIds += d.filter?.unknownIds?.length ?? 0;
  }

  const logRows = existsSync(callsLog) ? readFileSync(callsLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const resRows = logRows.filter((r) => r.intent === false);
  const intRows = logRows.filter((r) => r.intent === true);
  const wallSeconds = intRows.length && resRows.length ? (Date.parse(resRows.at(-1).at) - Date.parse(intRows[0].at)) / 1000 : null;
  const okLat = resRows.filter((r) => r.code === 0 && (r.toolEvents ?? 0) === 0).map((r) => r.latencyMs).sort((a, b) => a - b);
  const quantile = (arr, q) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(q * arr.length))] : null);
  const sumTok = (...keys) => resRows.reduce((s, r) => {
    for (const k of keys) if (typeof r.usage?.[k] === 'number') return s + r.usage[k];
    return s;
  }, 0);
  const totalTok = resRows.reduce((s, r) => {
    if (typeof r.usage?.total_tokens === 'number') return s + r.usage.total_tokens;
    return s + (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0);
  }, 0);

  const report = {
    bench: 'B-CP',
    protocol: 'bench-v11-oracle-676-precision-cascade',
    sourceModel,
    verifyModel,
    filterPromptSha256: FILTER_PROMPT_SHA256,
    prodPromptSha256,
    scoredAt: new Date().toISOString(),
    docs: manifest.documents.length,
    accepted: scored.accepted,
    invalid: manifest.documents.length - scored.accepted,
    cascade: { actsJudged, actsRemoved, keptNoValidDecision, supportedUngrounded, unknownIds, noActs, fallbackUnchanged },
    strict: enrich(scored.net),
    broad: enrich(scored.broad),
    stageTolerant: { ...enrich(scored.stageTolerant), addedMatches: scored.stageTolerant.addedMatches },
    soft: { ...enrich(scored.soft), addedMatches: scored.soft.addedMatches },
    f1n4: scored.human4.f1,
    halves: {
      tuning: halfMetrics('tuning', split.tuning),
      blind: halfMetrics('blind', split.blind),
    },
    verifierExecution: {
      callsLogged: resRows.length,
      codeZero: resRows.filter((r) => r.code === 0).length,
      toolEventsTotal: resRows.reduce((s, r) => s + (r.toolEvents ?? 0), 0),
      concurrency,
      wallSeconds,
      p50Seconds: okLat.length ? quantile(okLat, 0.5) / 1000 : null,
      p90Seconds: okLat.length ? quantile(okLat, 0.9) / 1000 : null,
      tokens: {
        input: sumTok('input_tokens'),
        output: sumTok('output_tokens'),
        thinking: sumTok('thinking_tokens', 'reasoning_output_tokens'),
        cached: sumTok('cache_read_tokens', 'cached_input_tokens'),
        total: totalTok,
      },
      costUsd: 'missing source',
    },
  };
  writeFileSync(`${cpHome}/aggregates.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (outPath) writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify(report, null, 2));
}
