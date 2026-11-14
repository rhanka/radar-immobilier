import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJournal } from './check-migration-journal.mjs';

const baseline = JSON.parse(readFileSync('api/drizzle/meta/_journal.json', 'utf8'));
// The lane alone must fail until its owner-ordered dependencies are merged.
const prefix = baseline.entries.filter((entry) => Number(entry.tag.slice(0, 4)) < 47);
const complete = { entries: [...prefix,
  { idx: 46, tag: '0047_signal_class_feedback', when: 1793000000017 },
  { idx: 47, tag: '0048_signal_mcp_write', when: 1793000000018 },
  { idx: 48, tag: '0049_signal_metadata', when: 1793000000019 },
] };

test('accepts the complete ordered journal including immutable legacy entries', () => {
  assert.doesNotThrow(() => validateJournal(complete));
});
for (const number of [47, 48]) {
  test(`rejects missing migration ${number}`, () => {
    const entries = complete.entries.filter((entry) => Number(entry.tag.slice(0, 4)) !== number);
    assert.throws(() => validateJournal({ entries }), /Missing or unordered/);
  });
}
for (const when of [1793000000017, 1793000000018]) {
  test(`rejects a retrograde or equal timestamp ${when}`, () => {
    const entries = JSON.parse(JSON.stringify(complete.entries));
    entries.at(-1).when = when;
    assert.throws(() => validateJournal({ entries }), /Non-increasing/);
  });
}
test('rejects a newly introduced gap and duplicate journal index', () => {
  assert.throws(() => validateJournal({ entries: complete.entries.filter((entry) => entry.idx !== 44) }), /Missing or unordered/);
  const entries = JSON.parse(JSON.stringify(complete.entries));
  entries.at(-1).idx = 47;
  assert.throws(() => validateJournal({ entries }), /Missing or unordered/);
});
