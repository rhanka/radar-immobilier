# Reference set C (sealed)

Reference table built from the client's triage workbook (121 signals, 80 documents, 51 cities,
survey of 2026-09-21). The repository is public, so the content is committed **encrypted only**.

Version of 2026-10-06 (converged state): tags converged by three AI annotators (unanimous after up to three
reconciliation rounds, one tag left non-converged and flagged), verdict derived by the frozen rule R′ v1, gap causes
recomputed (rule questions, missing data, judgement disagreements, non-converged; no residual tooling-error class), one
source quotation corrected (line 85). Previous sealed version: commit history of this folder.

## Files

| Sealed file | Content | SHA-256 of plaintext |
|---|---|---|
| `reference-c.xlsx.sealed` | Original 7 workbook tabs + "Référence C" (121 rows, 54 columns, short headers) + "Référence C — légende" (column, author, full definition) + class definitions | `1ab758da29ed2dcd0def6cdbe1e9c215efa9e00263feb813c2a504dcf4130c7d` |
| `reference-c.csv.sealed` | "Référence C" tab, UTF-8 with BOM | `385272e0daca7137cf579e8bca4f2ddeac1c7444dcc1961bfae947174c9e7be2` |
| `reference-c-legende.csv.sealed` | Legend: short column name, author, full definition | `9010669042cf489850b6f9aef8b6cac104a94cc8a6cb51d1879899538002b413` |
| `README.md.sealed` | Column definitions, method, counts, verified links | `e1b5e0a3402df9130e60a91e182f7a8b61598cebc2227f2af7e3300a99455b4a` |

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
