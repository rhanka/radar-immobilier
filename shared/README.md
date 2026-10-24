# Shared-file deltas for the ARTEFACTS Sol integrator (A6/H5)

A6 owns `api/src/artifacts/*`, `content-app.ts`, tests, `tools/h5-*` and the
fixture. The files below are SHARED: only the integrator edits them, subject
to CT-1 through CT-9 and the conductor-recorded lease. Do not edit shared
files from the lane.

## Application order (Sol commits)

1. Commit A6 source slices first (`feat(artifacts): ...` source + colocated
   tests). The shared hunks reference `content-serve.js` and
   `content-reader-server.ts`, which must exist at the merged HEAD.
2. Apply `vitest-exclusion.hunk.diff`, verify, and commit it. Only then
   commit `api/tests/e2e/artifacts-reader*.spec.ts` (Playwright): the
   exclusion must be in HEAD before browser specs enter any lane or
   integration snapshot.
3. Apply `Dockerfile.hunk.diff` + `docker-entrypoint.hunk.diff`, run
   `tools/h5-image-runtime-smoke.sh`, commit.
4. `app-mount.hunk.diff` supplies dependency injection only. Bind A1's real
   authority, durable ticket store and receiving API authentication before
   constructing the mount; secret references alone do not enable a reader.
   Run content/auth regression suites after the sole writer integrates it.
5. Return each committed SHA to the lane; the conductor records the receipt
   (input/receiving/result SHAs, file hashes, writer, tag/idx/when, SQL
   hash, immutable prefix, order, executed gates).

No migration is numbered here; no lockfile is touched. Ports
18946/15946/11946 and `test-*/e2e-*` ENVs stay internal. Production domain,
certificates and deployment remain with A7; default preprod stays on denial.

## Files

- `vitest-exclusion.hunk.diff` — `api/vitest.config.ts`: import
  `configDefaults`, add `exclude: [...configDefaults.exclude,
  "tests/e2e/artifacts-reader*.spec.ts"]`. Includes preserved.
- `Dockerfile.hunk.diff` — bundle `api/src/artifacts/content-reader-server.ts`
  via esbuild alongside the existing entrypoints.
- `docker-entrypoint.hunk.diff` — dispatch the explicit `content-reader`
  mode; keep `api`, independent `content-deny` and unknown-mode refusal.
- `app-mount.hunk.diff` — optional, already-bound reader behind `contentGate`.
  No production startup or receiving API authentication binding is supplied
  by this hunk. The previous draft inserted declarations inside an object
  literal; that invalid index hunk has been removed.
- `reader-auth.md` — reader-auth contract and verification checklist
  (no publisher/MCP credential reuse, no `radar_session` as page session,
  no Bearer [REDACTED] Geo).
- `technical-store.md` — runtime/configuration contract for A7 (required H5
  technical references only; denial Service keeps zero egress/credentials).
