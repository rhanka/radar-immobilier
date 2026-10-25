// Second-pass review witnesses run through protected PostgreSQL resume paths.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const lotReader = 'src/services/facets/lots/lot-cutover-readback.ts';
const personalReader = 'src/services/facets/activation-readback.ts';
function block(source, start, end) {
  const text = readFileSync(source, 'utf8');
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'bounded source block');
  return text.slice(from, to);
}
export default [
  { id: 'stream-identity-6k', source: lotReader,
    testFile: 'src/services/facets/lots/lot-cutover-identity-db.test.ts',
    titles: ['should refuse permuted head references between two lots',
      'should refuse a stream renamed to another lot'],
    edits: [
      [block(lotReader, '      if (stream.workspaceId.toLowerCase()',
        '      if (event.scope === "personal"'), ''],
      ['citySlug: stream.citySlug, canonicalId: stream.nodeId',
        'citySlug: event.citySlug, canonicalId: event.nodeId'],
      ...['selection', 'archive', 'pipeline', 'market'].map(facet =>
        [`stream.facet === "${facet}"`, `event.facet === "${facet}"`]),
    ] },
  { id: 'chain-integrity-6h', source: personalReader,
    testFile: 'src/services/facets/base-api-activation-persistence-db.test.ts',
    titles: ['should reject a dangling chain link at constant cardinality',
      'should reject a link into another workspace',
      'should reject a nonreciprocal same-stream chain',
      'should reject a stream with two terminals',
      'should reject a disconnected chain with one terminal'],
    edits: [[block(personalReader, '    // Full chain verification',
      '    return { streams: streams.length'), '']] },
  { id: 'd5-values-6k', source: 'src/services/facets/lots/lot-cutover-safety.ts',
    testFile: 'src/services/facets/lots/lot-cutover-d5-adapter-db.test.ts',
    title: 'should refuse a head carrying the losing values at resume',
    edits: [['checkCutoverReadbackCoverage(parsed.map((target) => target.key), observed, expected);',
      'void observed;']] },
];
