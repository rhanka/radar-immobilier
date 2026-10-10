# Reference set C (sealed)

Reference table built from the client's triage workbook (121 signals, 80 documents, 51 cities,
survey of 2026-09-21). The repository is public, so the content is committed **encrypted only**.

Version of 2026-10-10 (final state, supersedes the converged state of 2026-10-06 carried by PR #831): final tags
with their provenance, verdict derived by rule R′ v1.1 in the retained configuration (with R-a and R-k, without R-d′),
evaluated rows and rows set aside (non-converged object that changes the verdict), cause class of each gap (e, b, a1, a2,
ap) with its follow-up, indicator y, D17 variant in separate columns. Columns taken from the Triage tab carry the native
header of Triage row 5. A concordance script checks the 121 rows against the final pass and the adopted figures.
Previous sealed versions: commit history of this folder.

## Files

| Sealed file | Content | SHA-256 of plaintext |
|---|---|---|
| `reference-c.xlsx.sealed` | Original 7 workbook tabs + "Référence C" (121 rows, 62 columns; A–T with the native Triage headers) + "Référence C — légende" (column, source, definition) + "Référence C — classes" (cause classes and follow-ups) | `2e4ca30c2468b8a6fd3afaa76215de826faae3f9fd30d821647f1aa9a78a2e62` |
| `reference-c.csv.sealed` | "Référence C" tab, UTF-8 with BOM | `189cecee842b5be178f17ecdee7ad77dfbe84362c716a8d08318d57b32968673` |
| `reference-c-legende.csv.sealed` | Legend: column, source, definition | `e45e518dfdcff5218d2bc22c9746717803122dfdf08353cf952c7430994401fa` |
| `README.md.sealed` | Columns, classes, figures, removed columns, input hashes, statuses | `666959b17dc3135d1d97203d828f8604624075ec3006849833257620fc74168b` |

## Key

- Variable `REFERENCE_C_KEY` (base64, 32 bytes) in the repo-root `.env` (git-ignored, mode 600).
- Created 2026-10-05. Holder: owner. Rotate on any change of holder: unseal, generate a new key, reseal, commit.
- Without the key the files are unreadable; keep a copy of the key outside this machine.

## Unseal / reseal

```sh
node scripts/reference-seal.mjs unseal docs/spec/reports/reference-c/*.sealed --out <private-dir>
# reseal: outputs are never overwritten, delete the old sealed files first
rm docs/spec/reports/reference-c/*.sealed
node scripts/reference-seal.mjs seal <private-dir>/reference-c.xlsx <private-dir>/reference-c.csv <private-dir>/reference-c-legende.csv <private-dir>/README.md --out docs/spec/reports/reference-c
```

The script prints the SHA-256 of each plaintext; compare with the table above.
Outputs are created exclusively: an existing file or symlink at a target path is refused.
Unseal writes mode-600 files into `<private-dir>`, created in mode 700; an existing
`<private-dir>` with wider permissions is refused. The key lookup uses the repository that
contains the script, whatever the current directory.
Never commit the plaintext files. Format: `REFC1` | IV (12 bytes) | GCM tag (16 bytes) | AES-256-GCM ciphertext.
