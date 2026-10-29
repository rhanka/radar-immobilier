const lateQ1 = await runCdpQualification(lateConfig, cases, cdpFixture(lateConfig, cases, 'network'));
assert.equal(lateQ1.passed, false); assert.equal(lateQ1.ownedTargetClosed, true);
assert.equal(lateQ1.checks.find(x => x.name === 'projection-revisions').failurePhase, 'fetch');
assert.ok(Date.parse(lateQ1.observedAt) > Date.parse(summary.lateReopenBy));
sequence.push('q1-late-failure');
console.log(JSON.stringify({ kind: 'fixture-only', passed: true, sequence, nativeFilter: true,
  ...results, lateQ1, lateReopenBy: summary.lateReopenBy }));
