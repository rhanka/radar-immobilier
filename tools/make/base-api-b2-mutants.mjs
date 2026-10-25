// Exact, independently discriminated destination regressions.
import assert from 'node:assert/strict';
export const lotRoot = 'src/services/facets/lots/';
export function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Mutation anchor must occur once: ${before}`);
  return source.replace(before, after);
}
const mutation = (id, file, testFile, test, change) => ({ id, file: lotRoot + file + '.ts',
  testFile: lotRoot + testFile + '-db.test.ts', test, change });
export const mutants = [
  mutation('opening', 'lot-city', 'lot-opening',
    'should return no business state, history or receipt once closed', source =>
      source.replaceAll('requireOpenLotDestination', 'requireLotDestination')),
  mutation('receipt-single', 'lot-writer', 'lot-opening-authority',
    'should reject closed and revoked single replays after the original command', source => {
      const start = source.indexOf('    const destination = await requireOpenLotDestination');
      const end = source.indexOf('    await tx.execute', start);
      assert.ok(start > 0 && end > start);
      const guard = source.slice(start, end);
      return replaceOnce(source.replace(guard, ''), '    await lotTargetLock', guard + '    await lotTargetLock');
    }),
  mutation('receipt-batch', 'lot-batch', 'lot-opening-authority',
    'should reject closed and revoked batch replays after the original command', source => {
      const start = source.indexOf('    const destination = await requireOpenLotDestination');
      const end = source.indexOf('    await tx.execute', start);
      assert.ok(start > 0 && end > start);
      const guard = source.slice(start, end);
      return replaceOnce(source.replace(guard, ''), '    const ordered =', guard + '    const ordered =');
    }),
  mutation('fingerprint', 'lot-writer', 'lot-opening-replay',
    'should conflict on stale heads and same-UUID content changes', source =>
      replaceOnce(source, '\n      || resolved.fingerprint !== command.displayed_version.fingerprint', '')),
  mutation('atomicity', 'lot-batch', 'lot-batch',
    'should roll back an appended item when a later reason is invalid', source => {
      source = 'import { randomUUID } from "node:crypto";\n'
        + 'import { writeLotFacet } from "./lot-writer.js";\n' + source;
      return replaceOnce(source, '  const key = batch.command_key.toLowerCase();',
        `  for (const item of batch.items) {
    await writeLotFacet(db, sub, workspaceId, scope, { ...item,
      contract_version: "lot-facets-v1", command_key: randomUUID(), mode: batch.mode });
  }
  const key = batch.command_key.toLowerCase();`);
    }),
  mutation('public-readback', 'lot-city', 'lot-cutover-readback',
    'should read back internally while public city reads stay closed', source => {
      source = 'import { readLotCutoverReadback } from "./lot-cutover-readback.js";\n' + source;
      source = replaceOnce(source, 'citySlug: string,', 'citySlug: string, options: { readback?: boolean } = {},');
      return replaceOnce(source, '  return db.transaction',
        '  if (options.readback) return readLotCutoverReadback(db, sub, workspaceId, mode, citySlug);\n  return db.transaction');
    }),
  mutation('false-empty', 'lot-cutover-gate', 'lot-cutover-empty',
    'should keep unresolved-only, conflicted and unqualified histories closed', source =>
      replaceOnce(source, 'gate.ready.length === 0 && report.rows.length > 0', 'false')),
  ...['epoch', 'coverage', 'roster'].map(prerequisite => mutation('empty-' + prerequisite,
    'lot-cutover-gate', 'lot-cutover-empty-prerequisites',
    'should reject empty activation without ' + prerequisite, source => {
      const anchor = {
        epoch: 'if (await scopedEpochFor(tx, workspaceId) !== SCOPED_EPOCH)',
        coverage: 'if (uncovered.length > 0)',
        roster: 'gate.reasons.push(...await cutoverRosterGaps(tx, workspaceId));',
      }[prerequisite];
      const replacement = prerequisite === 'roster'
        ? 'await cutoverRosterGaps(tx, workspaceId);' : 'if (false)';
      return replaceOnce(source, anchor, replacement);
    })),
];
