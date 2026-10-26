# Provider tuple proposal (A1, integration writer only)

## Retained pin (no change in this lane)

- `packages/artifacts-host/package.json`: `@sentropic/artifacts` stays at
  `0.1.2`.
- No manifest or lockfile edit is proposed here. No competing lockfile is
  generated.

## Upgrade condition (all required before any tuple change)

1. Candidate archive received with version, integrity hash and provenance.
2. Actual exports verified against the r2 joints bound in
   `packages/artifacts-host/src/profile.ts` and `src/composition.ts`:
   `mcp-core.compileArtifactsProfile`, `server/commit-contract`,
   `server/outcome-contract`, `server/commit` factory,
   `testing.createArtifactCommitBarrier`,
   `server/object-intents` cleanup binding and the durable quota port.
3. `ARTIFACTS_PROVIDER_ACCEPTANCE=1` qualification green on the exact
   published tuple (no skipped required case counts as PASS).

## Then (writer executes)

- Bump the single pin to the qualified version, regenerate the lockfile
  through the standalone Make target with `ENV` last, and rerun the
  affected gates after integration.
- Record package bytes, provenance and the exact image/configuration
  receipts in the Sol report.

All tuple versions, publication state, CI and deployment receipts remain
unverified until executed or supplied.
