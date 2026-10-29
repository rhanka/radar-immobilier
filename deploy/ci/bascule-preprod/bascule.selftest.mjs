  for (const key of ["O_MIGRATE", "O_RESTORE", "O_DOCS"]) {
    ok(`unquiesce workflow forwards ${key}`, step.includes(`${key}:`));
  }
}

console.log(`\nbascule.selftest — ${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
