# Lane Plan — ARTEFACTS A6 (H5 reader and API connector)

Branch: `feat/artefacts-mcp-a6` — worktree `tmp/artefacts-mcp-a6`.
Baseline: plan-commit `1d4adc1014ec24e02f7e1966edadae56291a9cb1`, descending from `9a81508704b8ee247e3d402f9cbf15d458edfe2a`.
Environments: `test-artefacts-mcp-a6`, `e2e-artefacts-mcp-a6`.
Ports: API `18946`, UI `15946`, Maildev UI `11946` (`unverified`; internal networks only).

Authority: `plan/ARTEFACTS-BRANCH_feat_artefacts-mcp.md`, approved
`.lanes/conductor/tmp/861c/proposition-artefacts.md`, review
`.lanes/conductor/tmp/revues/astra-relecture-execution-artefacts-v2.md`
(CT-1 to CT-9 copied verbatim into the master plan Orchestration Mode).
Defaults: read-only first proof, technical example only (D1/D2).

## Owned scope

`api/src/artifacts/` reader modules, `content-app.ts` dispatch seam,
colocated `*.test.ts`, `api/tests/integration/artifacts-reader-*.spec.ts`,
`api/tests/e2e/artifacts-reader*.spec.ts`, `tools/h5-artifacts.mk`,
`tools/h5-artifacts.playwright.config.ts`, `api/src/artifacts/content-reader-server.ts`,
reader fixture under `api/tests/fixtures/`, `shared/` deltas,
`RAPPORT-MUSE-ARTEFACTS-A6.md`. Sol verifies and commits.

## Forbidden

Edit `artifacts-host`, manifests/lockfiles, SQL/journal,
`api/src/{app,index,config}.ts`, `routes/auth.ts`, master plan.
No Python, no `.env` reads, no push/deploy, no `.track` writes.
No invented production domain or certificate.

## Lots and commit slices (each <= 150 lines for Sol)

- [x] docs(artifacts): lane plan A6 (this file).
- [ ] feat(artifacts): bind preview init to the browser.
- [ ] feat(artifacts): consume preview tickets atomically.
- [ ] feat(artifacts): issue isolated reader sessions.
- [ ] feat(artifacts): bind reader grants to releases.
- [ ] feat(artifacts): activate approved preview releases.
- [ ] feat(artifacts): serve authorized artifact content.
- [ ] feat(artifacts): add named API read operations.
- [ ] feat(artifacts): bind API calls to verified readers.
- [ ] feat(artifacts): renew and revoke reader grants.
- [ ] test(artifacts): cover content isolation and denials.
- [ ] test(artifacts): qualify readers in a real browser.
- [ ] docs(artifacts): add the minimal connected example.

## Acceptance (expected, Sol-measured)

- Browser-bound init; ticket single-use <= 60 s; separate `__Host-` cookies.
- Grants bound to issuer/audience/tier/host/artifact/release/reader/session/profile/policy/expiry; 55 s grant, cutoff <= 60 s proven.
- Renewal rereads approval/ACL/policy; outage closes access at expiry incl. streams; old tabs gain no newer profile.
- Named versioned operations only; rights = profile ∩ reader ∩ API checks; public Geo + protected signals on synthetic data with two readers; closed capability fails locally.
- Isolation, `private, no-store`, service-worker refusal, embed unavailable, no publisher/MCP credential exposure.
- Vitest excludes `tests/e2e/artifacts-reader*.spec.ts`; Playwright selects the same files; runner proves collection separation, full API suite, nonzero H5 execution, image entrypoint modes, deny -> reader -> deny routing.

## Integration receipts

- [x] Consumed Vitest exclusion e61810325adf064af88012981e622d1a9c464aec via merge f6edd1b6efdb7992078fd03dad1f9eb1ff2b8363 before browser commits.
- [ ] Consume A1 authority/store and reader-auth/image commits; no lease held here.
- [ ] D1/D2 remain open with read-only and technical-example defaults.
- [x] Local profile seam prepared; A1 authority binding remains pending.
- [x] Origin validation now uses the authority-owned origin.
- [x] In-process single-use tickets require an independent browser binding; durable store pending.
- [x] AEAD envelope modules prepared and locally tested.
- [x] Separate host-only page cookie modules prepared and locally tested.
- [x] Signed grant verification requires bounded expiry and matching subject.
- [x] Local activation registry prepared; provider activation binding pending.
- [x] Named operation schemas prepared; receiving API integration remains pending.
- [x] Reader context checks current release, policy and reader rights.
- [x] Renewal checks current release and fails closed during authority outage.
- [x] Isolation headers prohibit workers and preserve deny responses.
- [x] Technical example source prepared; browser behavior remains unverified.
- [x] Operation inputs reject undeclared authority or URL fields.
- [x] Normalized operation responses reject publisher substitution.
- [x] Serving requires current authority; synthetic operation data removed from runtime path.
- [x] Synthetic operation ports isolated in an explicit module-test fixture.
- [x] Authorized content unit controls cover two local fixture identities.
- [x] Eight reproduced preview/content defects now have behavioral regressions.
- [x] Optional content gate delegation preserves ordinary API denial.
- [x] Reader init, ticket and release integration module cases prepared.
- [x] Operation integration module cases use synthetic ports, not receiving API proof.
- [x] Standalone reader listener prepared; production authority/store binding pending.
- [x] Dedicated runner refuses integrated acceptance without the image/API binding.
- [x] Collection and isolated module mutation proof runners prepared.
- [x] Image smoke records image/source identity and excludes all environment file content.
- [x] Shared patch proposals pass git apply checks; no shared file was edited.
- [x] Integration handoff identifies missing authority/store/receiving API and image receipts.
- [x] Review correction: require full 128-bit GCM authentication tags.
- [x] Credential budget controls measured 303-byte cookies and 725-byte grants on two fixtures.
- [x] Review correction: recheck grant/session expiry and revocation after authority and API waits.
- [x] Review correction: hash-authorize only the technical example bootstrap script in CSP.
- [x] Review correction: image delta preserves denial isolation code; script globals are explicit.
- [x] Review corrections: committed build context, accurate smoke labels and observable cleanup failures.
- [x] Standalone Git helper audits subjects, sizes and browser snapshots, then reconstructs the bundle.
- [x] Committed both browser fixtures after the integrator exclusion; Chromium reproduced four positive-case failures before fixture corrections.
- [x] Prepared explicit fixture ports, exact-host secure cookies and a separate source-browser runner; final-image/API acceptance remains open.
- [x] Same-HEAD Astra reviews identified renewal expiry/revocation after waits; both regressions reproduced, then 13 scoped controls passed after correction.
