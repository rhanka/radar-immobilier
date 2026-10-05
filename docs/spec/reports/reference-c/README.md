# Reference set C (sealed)

Reference table built from the client's triage workbook (121 signals, 80 documents, 51 cities,
survey of 2026-09-21). The repository is public, so the content is committed **encrypted only**.

## Files

| Sealed file | Content | SHA-256 of plaintext |
|---|---|---|
| `reference-c.xlsx.sealed` | Original 7 workbook tabs + "Référence C" (121 rows, 20 client columns + 35 added columns) + class definitions | `88c46fe1edbda2c5a780ac53374fa3678adb1084db8fa983717d6877ea805d41` |
| `reference-c.csv.sealed` | "Référence C" tab, UTF-8 with BOM | `47634565fd6c7877c106e7800aabeb9e158e3810780a0cec1ea19848a14085ad` |
| `README.md.sealed` | Column definitions, method, counts, verified links | `3b34c5bc8f78f9cd512a805e88e79c45c405c7a19101685bc65b3eae1290c599` |

## Key

- Variable `REFERENCE_C_KEY` (base64, 32 bytes) in the repo-root `.env` (git-ignored, mode 600).
- Created 2026-10-05. Holder: owner. Rotate on any change of holder: unseal, generate a new key, reseal, commit.
- Without the key the files are unreadable; keep a copy of the key outside this machine.

## Unseal / reseal

```sh
node scripts/reference-seal.mjs unseal docs/spec/reports/reference-c/*.sealed --out <private-dir>
node scripts/reference-seal.mjs seal <private-dir>/reference-c.xlsx <private-dir>/reference-c.csv <private-dir>/README.md --out docs/spec/reports/reference-c
```

The script prints the SHA-256 of each plaintext; compare with the table above.
Never commit the plaintext files. Format: `REFC1` | IV (12 bytes) | GCM tag (16 bytes) | AES-256-GCM ciphertext.
