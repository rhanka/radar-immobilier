import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPackage, checkTree } from './zod4-tree.mjs';

test('rejects affected physical Zod copies and forbidden providers', () => {
  for (const version of ['3.25.76', '4.6.5']) assert.throws(() => checkPackage('zod', version, 'nested'));
  for (const name of ['@sentropic/graphify', 'ollama-ai-provider']) assert.throws(() => checkPackage(name, '1.0.0', 'nested'));
  assert.throws(() => checkPackage('@ai-sdk/provider-utils', '2.2.8', 'nested'));
  checkPackage('zod', '4.6.7', 'nested');
});
test('rejects invalid, extraneous and missing peers even without a root problem', () => {
  for (const flag of ['invalid', 'extraneous', 'missing']) assert.throws(() =>
    checkTree({ dependencies: { a: { dependencies: { b: { [flag]: true } } } } }),
  );
  assert.throws(() => checkTree({ problems: ['invalid peer'] }));
  checkTree({ dependencies: { a: { version: '1.0.0' } } });
});
