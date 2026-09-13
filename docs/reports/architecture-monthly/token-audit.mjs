import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';

const reportDir = path.dirname(new URL(import.meta.url).pathname);
const generated = path.resolve(reportDir, '../../architecture/focus/.generated');
const start = Date.parse('2026-08-10T04:00:00Z');
const end = Date.parse('2026-09-14T04:00:00Z');
const groups = {
  immo: new Set(['radar-immobilier']),
  geo: new Set(['geo', 'geo-quebec']),
  platform: new Set(['sentropic', 'sent-tech', 'sent-tech-design-system', 'agent-stats', 'track', 'poc-k8s', 'h2a', 'harness', 'coordinate']),
};
const dimensions = ['global', ...Object.keys(groups)];
const zero = () => ({ newInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, total: 0 });
const emptyDaily = () => Object.fromEntries(dimensions.map(name => [name, {}]));
const add = (target, usage) => { for (const key of Object.keys(zero())) target[key] += usage[key] || 0; };
const bucket = (daily, name, day) => daily[name][day] || (daily[name][day] = zero());
const repoFromCwd = cwd => (cwd || '').match(/\/src\/([^/]+)/)?.[1]?.toLowerCase() || null;
const repoFromUrl = url => (url || '').match(/\/([^/]+?)(?:\.git)?\/?$/)?.[1]?.toLowerCase() || null;
const matchedGroups = (...repos) => Object.entries(groups).filter(([, set]) => repos.some(repo => set.has(repo))).map(([name]) => name);
const localDay = time => new Date(time - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);

function claudeUsage(usage = {}) {
  const result = { newInput: usage.input_tokens || 0, cachedInput: usage.cache_read_input_tokens || 0, cacheWrite: usage.cache_creation_input_tokens || 0, output: usage.output_tokens || 0 };
  result.total = result.newInput + result.cachedInput + result.cacheWrite + result.output;
  return result;
}
function maxUsage(a, b) {
  const result = { newInput: Math.max(a.newInput, b.newInput), cachedInput: Math.max(a.cachedInput, b.cachedInput), cacheWrite: Math.max(a.cacheWrite, b.cacheWrite), output: Math.max(a.output, b.output) };
  result.total = result.newInput + result.cachedInput + result.cacheWrite + result.output;
  return result;
}
function listClaudeFiles() {
  const root = '/home/antoinefa/.claude/projects';
  return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const directory = path.join(root, entry.name);
    return fs.readdirSync(directory).filter(name => name.endsWith('.jsonl')).map(name => path.join(directory, name));
  }).filter(file => fs.statSync(file).mtimeMs >= start);
}

async function claudeShard(shard, count) {
  const files = listClaudeFiles().filter((_, index) => index % count === shard);
  const daily = emptyDaily();
  const stats = { shard, count, files: files.length, bytes: 0, lines: 0, records: 0, uniqueMessages: 0, duplicates: 0, inconsistent: 0, malformed: 0 };
  for (const file of files) {
    stats.bytes += fs.statSync(file).size;
    const seen = new Map();
    const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    let lineNo = 0;
    for await (const line of lines) {
      lineNo += 1; stats.lines += 1;
      if (!line.includes('"type":"assistant"') || !line.includes('"usage"')) continue;
      let record;
      try { record = JSON.parse(line); } catch { stats.malformed += 1; continue; }
      const time = Date.parse(record.timestamp);
      if (record.type !== 'assistant' || !record.message?.usage || !(time >= start && time < end)) continue;
      const usage = claudeUsage(record.message.usage);
      const value = { day: localDay(time), usage, matched: matchedGroups(repoFromCwd(record.cwd)) };
      const id = record.message.id || record.uuid || `line:${lineNo}`;
      const prior = seen.get(id);
      stats.records += 1;
      if (!prior) seen.set(id, value);
      else { stats.duplicates += 1; if (JSON.stringify(prior.usage) !== JSON.stringify(usage)) { stats.inconsistent += 1; prior.usage = maxUsage(prior.usage, usage); } }
    }
    for (const value of seen.values()) {
      stats.uniqueMessages += 1; add(bucket(daily, 'global', value.day), value.usage);
      for (const name of value.matched) add(bucket(daily, name, value.day), value.usage);
    }
  }
  fs.mkdirSync(generated, { recursive: true });
  fs.writeFileSync(path.join(generated, `token-claude-${shard}-of-${count}.json`), JSON.stringify({ stats, daily }));
  console.log(JSON.stringify(stats));
}

async function codexAudit() {
  createRequire('/home/antoinefa/src/agent-stats/package.json');
  const core = await import('/home/antoinefa/src/agent-stats/packages/core/dist/index.js');
  const daily = emptyDaily(); const signatures = new Set();
  const stats = { sessions: 0, turns: 0, duplicates: 0 };
  for (const entry of core.indexCodexSessions({ since: new Date(start), until: new Date(end) })) {
    if (!fs.existsSync(entry.rolloutPath)) continue;
    stats.sessions += 1; let meta = { cwd: entry.cwd, repoUrl: entry.repoUrl };
    for await (const event of core.parseCodexRollout({ filePath: entry.rolloutPath, sessionId: entry.id, projectCwd: entry.cwd })) {
      if (event.kind === 'session_start') { meta = { cwd: event.projectCwd || meta.cwd, repoUrl: event.repoUrl || meta.repoUrl }; continue; }
      const time = Date.parse(event.ts);
      if (event.kind !== 'turn' || event.tool !== 'codex' || !(time >= start && time < end)) continue;
      const signature = JSON.stringify([event.sessionId, event.ts, event.usage]);
      stats.turns += 1;
      if (signatures.has(signature)) { stats.duplicates += 1; continue; }
      signatures.add(signature);
      const usage = { newInput: event.usage?.newInputTokens || 0, cachedInput: event.usage?.cachedInputTokens || 0, cacheWrite: 0, output: event.usage?.outputTokens || 0 };
      usage.total = usage.newInput + usage.cachedInput + usage.output;
      const day = localDay(time); add(bucket(daily, 'global', day), usage);
      for (const name of matchedGroups(repoFromCwd(meta.cwd || event.projectCwd), repoFromUrl(meta.repoUrl))) add(bucket(daily, name, day), usage);
    }
  }
  fs.mkdirSync(generated, { recursive: true });
  fs.writeFileSync(path.join(generated, 'token-codex.json'), JSON.stringify({ stats, daily }));
  console.log(JSON.stringify(stats));
}

const sum = daily => Object.values(daily).reduce((total, usage) => total + usage.total, 0);
const peak7 = daily => {
  const days = [];
  for (let date = new Date('2026-08-10T00:00:00Z'); date < new Date('2026-09-14T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 1)) days.push(date.toISOString().slice(0, 10));
  return days.reduce((best, day, index) => {
    const tokens = days.slice(index, index + 7).reduce((total, current) => total + (daily[current]?.total || 0), 0);
    return tokens > best.tokens ? { tokens, start: day, end: days[Math.min(index + 6, days.length - 1)] } : best;
  }, { tokens: 0, start: null, end: null });
};
function mergeDaily(target, source) { for (const name of dimensions) for (const [day, usage] of Object.entries(source[name])) add(bucket(target, name, day), usage); }

function combine(count) {
  const claude = emptyDaily(); const claudeStats = [];
  for (let shard = 0; shard < count; shard += 1) { const part = JSON.parse(fs.readFileSync(path.join(generated, `token-claude-${shard}-of-${count}.json`))); mergeDaily(claude, part.daily); claudeStats.push(part.stats); }
  const codexPart = JSON.parse(fs.readFileSync(path.join(generated, 'token-codex.json')));
  const historicalCapacity = { claude: { tokens: 15121217650, start: '2026-08-30', end: '2026-09-05' }, codex: { tokens: 32217805325, start: '2026-05-04', end: '2026-05-10' } };
  const currentPeaks = { claude: peak7(claude.global), codex: peak7(codexPart.daily.global) };
  const capacity = Object.fromEntries(['claude', 'codex'].map(provider => [provider, currentPeaks[provider].tokens > historicalCapacity[provider].tokens ? currentPeaks[provider] : historicalCapacity[provider]]));
  const seats = { claude: 2, codex: 1 }; const products = {};
  for (const product of ['immo', 'geo']) {
    const tokens = { claude: sum(claude[product]), codex: sum(codexPart.daily[product]) };
    const prorataUsd = Object.entries(tokens).reduce((total, [provider, value]) => total + value / (capacity[provider].tokens * 35 / 7) * (seats[provider] * 200 * 35 / 30), 0);
    products[product] = { tokens, prorataUsd, prorataCad: prorataUsd * 1.37, facturableCad: prorataUsd * 1.37 * 1.15 };
  }
  const output = { schema: 'immo-geo-token-allocation-audit/v1', generatedAt: new Date().toISOString(), period: { timezone: 'America/Toronto', startInclusive: '2026-08-10T00:00:00-04:00', endExclusive: '2026-09-14T00:00:00-04:00', days: 35 }, method: { dedupClaude: '(file,message.id), componentwise max on inconsistent duplicates', dedupCodex: '(sessionId,timestamp,usage) exact signature', dailyBucketing: 'America/Toronto fixed UTC-04 for this DST window', capacity: 'provider global seven-day peak; historical audited peak retained when larger', tariffs: { claudeSeats: 2, codexSeats: 1, seatUsdPerMonth: 200, usdCad: 1.37, llmMargin: 1.15 } }, capacity, currentWindowPeaks: currentPeaks, products, totals: { tokens: { claude: products.immo.tokens.claude + products.geo.tokens.claude, codex: products.immo.tokens.codex + products.geo.tokens.codex }, facturableCad: products.immo.facturableCad + products.geo.facturableCad }, scan: { claude: claudeStats.reduce((total, item) => { for (const key of ['files', 'bytes', 'lines', 'records', 'uniqueMessages', 'duplicates', 'inconsistent', 'malformed']) total[key] = (total[key] || 0) + item[key]; return total; }, {}), codex: codexPart.stats }, caveats: ['Allocation from local session logs; not a provider invoice line.', 'Historical provider capacity comes from the September 11 deduplicated audit; this run replaces it only if the refreshed-window peak is higher.', 'Only immo and geo are billable products; platform usage is excluded from product numerators.'] };
  fs.writeFileSync(path.join(reportDir, 'token-audit-2026-08-10_2026-09-13.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ capacity, products, totals: output.totals }, null, 2));
}

const [mode, first = '0', second = '6'] = process.argv.slice(2);
if (mode === 'claude') await claudeShard(Number(first), Number(second));
else if (mode === 'codex') await codexAudit();
else if (mode === 'combine') combine(Number(first));
else throw new Error('usage: token-audit.mjs claude <shard> <count> | codex | combine <count>');
