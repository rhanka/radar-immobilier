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
- Frozen manifest: `contract-v1.json`, SHA-256 `e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0`.
- Producer freeze receipt: commit `2dabe25ce`, retained bytes SHA-256 `095e1d50f4c64ddc7254ca7e86f10582e4d1c2f153ec5173c79cb62818dc92cb`.
- Interface erratum SHA-256: `057d47922da4ffec6a99ecb0655be4d4dd623f771370cbc641983ddec20ba006`.

Immo acknowledges these exact development-contract bytes on 2026-10-12. The
source remains `7b8e5daf`; the freeze adds no source delta. Capacity values,
CommonMark/profile qualification, new capacity bounds and thread-history sizing
remain producer reserves, with no production defaults inferred from test fixtures.
The erratum scopes Sentropic's SPEC. Immo's own raw owner decision D4 still governs
its deleted notes and existing backups; no shared module decides those operations.

Canonical storage and `createCanonicalCommentsRouter` remain cluster-mesh module
deliverables. The legacy `/hono` router in this archive is not used by immo.
No source types or algorithms are maintained by immo. A changed shared contract
requires a distinct archive, qualification and receipt; never overwrite this one.
