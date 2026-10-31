import { test } from 'node:test';
import assert from 'node:assert/strict';
import { krippendorffAlpha, majority, stopDecision } from '../l2/agreement.mjs';
import { buildPrompt, itemValidity, locateQuote, parseAnswers, toExtraction } from '../l2/annotation.mjs';
import { compareCodebook } from '../l1/profile.mjs';
import { bestExcerpt, sourceUrlOf } from '../l2/scrape.mjs';
import { vibeConfig } from '../lib/vibe-home.mjs';
import { makeLots } from '../l2/run.mjs';

const near = (a, b, e = 1e-4) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test('Krippendorff alpha (nominal, missing values) and majority', () => {
  near(krippendorffAlpha([['a', 'a'], ['b', 'b'], ['a', 'b']]), 1 - 2 / 3.6);
  assert.equal(krippendorffAlpha([['a', 'a', 'a'], ['b', 'b', null]]), 1);
  assert.equal(krippendorffAlpha([['a', null, null]]), null);
  assert.deepEqual(majority(['x', 'x', null]), { value: 'x', count: 2, of: 2 });
  assert.equal(majority(['x', 'y', 'z']), null);
  assert.equal(majority(['x', null, null]), null);
});

test('stop rule: thresholds, changed share, cap', () => {
  assert.ok(stopDecision({ alphaVerdict: 0.7, alphaCode: 0.68, verdictUnanimity: 0.8, changedShare: null, pass: 1 }).stop);
  assert.ok(!stopDecision({ alphaVerdict: 0.7, alphaCode: 0.6, verdictUnanimity: 0.8, changedShare: null, pass: 1 }).stop);
  assert.ok(stopDecision({ alphaVerdict: 0.5, alphaCode: 0.5, verdictUnanimity: 0.5, changedShare: 0.01, pass: 2 }).stop);
  assert.ok(stopDecision({ alphaVerdict: 0.5, alphaCode: 0.5, verdictUnanimity: 0.5, changedShare: 0.2, pass: 4 }).stop);
});

test('codebook comparison detects missing, unexpected and duplicates', () => {
  const a = [{ code: 'P-DENSITE', verdict: 'pertinent' }];
  assert.ok(compareCodebook(a, a).equal);
  assert.ok(!compareCodebook(a, [{ code: 'P-DENSITE', verdict: 'a_surveiller' }]).equal);
  assert.ok(!compareCodebook(a, [...a, ...a]).equal);
});

const codes = new Map([['S-PLANIFIE', 'a_surveiller'], ['P-DENSITE', 'pertinent']]);
const items = [
  { itemId: 'dev-sig-a', kind: 'signal', anchor: { type: 'DesignationEvent', id: 'event-x-a', citySlug: 'ville-b' }, input: 'Avis de motion du règlement 1-2 afin de permettre six logements.' },
  { itemId: 'dev-pv-b', kind: 'pv', anchor: { type: 'Source', id: 'source-x-b', citySlug: 'ville-a' }, input: 'page un\fpage deux : adoption du règlement 3-4 afin d’augmenter la densité.' },
];

test('quote location gives the page after form feeds and tolerates typography', () => {
  assert.deepEqual(locateQuote(items[1].input, "adoption du règlement 3-4 afin d'augmenter"), { found: true, page: 2 });
  assert.equal(locateQuote(items[0].input, 'texte absent du document source').found, false);
});

test('compact answers become an Engram extraction with the four profile relations', () => {
  const pairs = parseAnswers('```json\n{"annotations":[{"item_id":"dev-sig-a","code":"S-PLANIFIE","ambiguous":false,"ambiguity_cause":null,"quote":"afin de permettre six logements","reason":"r"}]}\n```', items);
  assert.equal(pairs[1].answer, null);
  const ex = toExtraction({ annotator: 'x', pass: 1, guideVersion: 'G0', pairs, codes });
  assert.deepEqual(ex.edges.map((e) => e.relation).sort(), ['cites', 'has_verdict', 'justified_by', 'targets']);
  assert.ok(ex.nodes.every((n) => n.id && n.label && n.file_type && n.source_file));
  const reg = ex.nodes.find((n) => n.node_type === 'ReasonCode');
  assert.equal(reg.registry_record_id, 'S-PLANIFIE');
  const v = itemValidity(ex, { valid: true, issues: [] }, pairs, codes);
  assert.deepEqual(v.map((x) => x.valid), [true, false]);
  const bad = parseAnswers('{"annotations":[{"item_id":"dev-sig-a","code":"P-NOPE","quote":"x"}]}', items);
  assert.deepEqual(itemValidity(toExtraction({ annotator: 'x', pass: 1, guideVersion: 'G0', pairs: bad, codes }), { issues: [] }, bad, codes)[0].issues, ['unknown_registry_record_ref']);
});

test('prompt carries the Engram profile prompt, the pack and every item; reconcile adds context', () => {
  const pack = { criteria: 'C', definitions: 'D', guide: 'G', guideVersion: 'G0' };
  const p = buildPrompt({ profilePrompt: '# Engram Ontology Dataprep Extraction Prompt', pack, items });
  assert.ok(p.startsWith('# Engram Ontology Dataprep Extraction Prompt'));
  assert.ok(p.includes('item_id: dev-sig-a') && p.includes('item_id: dev-pv-b'));
  const r = buildPrompt({ profilePrompt: 'E', pack, items: [items[0]], mode: 'reconcile', context: new Map([['dev-sig-a', 'CTX-A']]) });
  assert.ok(r.includes('## Reconciliation') && r.includes('CTX-A'));
});

test('lots: signals grouped by city in tens, one PV per lot', () => {
  const many = Array.from({ length: 23 }, (_, i) => ({ itemId: `s${String(i).padStart(2, '0')}`, kind: 'signal', anchor: { citySlug: `c${i % 3}` } }));
  const lots = makeLots([...many, { itemId: 'p1', kind: 'pv', anchor: {} }]);
  assert.deepEqual(lots.map((l) => l.items.length), [10, 10, 3, 1]);
  assert.equal(lots[3].lotId, 'p-p1');
});

test('scrape helpers: source URL lookup and best-matching pages', () => {
  assert.equal(sourceUrlOf({ props: { refs: [{ sourceUrl: 'https://x.invalid/a.pdf' }] } }), 'https://x.invalid/a.pdf');
  assert.equal(sourceUrlOf({ props: {} }), null);
  const ex = bestExcerpt('rien\fle règlement 1234-5 permet six logements\fautre chose', 'règlement 1234-5 logements');
  assert.ok(ex.startsWith('[page 2]'));
});

test('per-effort vibe config drops MCP servers and sets the thinking level', () => {
  const base = 'active_model = "x"\n[[providers]]\nname = "mistral"\n\n[[mcp_servers]]\nname = "h2a"\n';
  const c = vibeConfig(base, 'low');
  assert.ok(!c.includes('mcp_servers'));
  assert.ok(c.includes('active_model = ""'));
  assert.equal((c.match(/thinking = "low"/g) ?? []).length, 2);
});
