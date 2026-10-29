await refsSuite();
await cliSuite();
console.log(`\nrestore-mode.selftest — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
