# Backup restoration primitives and reporting

The executable orchestration is now the [sequential cutover controller](../../cutover/README.md).
Use `make -f deploy/cutover/operator.mk run RELEASE=<release.json> ENV=preprod`.
The scheduled workflow uses that engine with the deployed release and a null data hook.

This directory retains the versioned backup resolver/hash/document-copy library,
its Job templates, named Secret synchronization, production backup definitions,
and cross-tenant served-reference/reporting helpers. It contains no independent
restore, quiesce, unquiesce, API-only reopening or live-dump chain controller.

`backup.selftest.mjs` exercises versioned S3 boundaries, backup pin validation,
document restoration and inter-tenant artifacts offline. Run it through the
standalone `test` target. Credential rotation remains documented in `CRED_CYCLE.md`.
The dated migration/incident capture documents are historical records.
