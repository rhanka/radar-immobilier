# Exact M1 development contract

This retained software snapshot is for immo host implementation and synthetic
qualification. It is not an authorized operational delivery or an M2/M3 runtime.

- Producer: `rhanka/sentropic`, commit `7b8e5daf022cc58819dfdfae43cd89a703a82f96`.
- Source: unmodified Git archive of `packages/comments`.
- Source SHA-256: `dd7656275b56ac8903103e44295b6f2c5b2173890d7e49a530ab2c3f5766eb98`.
- Archive: `sentropic-comments-0.3.0.tgz`, built in Node 24 with TypeScript 5.4.5.
- Archive SHA-256: `16fb88cee3869b810a7b3215e0807fbc2445e458501cc6153510af8cedff3f0c`.
- `build-lock.json` freezes compiler and package dependencies for reconstruction.
- Runtime installation uses the immo lockfile and the exact local archive.

Canonical storage and `createCanonicalCommentsRouter` remain cluster-mesh module
deliverables. The legacy `/hono` router in this archive is not used by immo.
No source types or algorithms are maintained by immo. A changed shared contract
requires a distinct archive, qualification and receipt; never overwrite this one.
