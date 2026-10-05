# Reference set C (sealed)

Reference table built from the client's triage workbook (121 signals, 80 documents, 51 cities,
survey of 2026-09-21). The repository is public, so the content is committed **encrypted only**.

## Files

| Sealed file | Content | SHA-256 of plaintext |
|---|---|---|
| `reference-c.xlsx.sealed` | Original 7 workbook tabs + "Référence C" (121 rows, 54 columns, short headers) + "Référence C — légende" (column, author, full definition) + class definitions | `4a81b4d744a8dd76f768f401cc9d2b3b675abb65159f651b4d4b6ef585956afb` |
| `reference-c.csv.sealed` | "Référence C" tab, UTF-8 with BOM | `f47ec61f0c14ad38e844732871ad5edaf0e1cc9bbda7e70b334ed91770703d07` |
| `reference-c-legende.csv.sealed` | Legend: short column name, author, full definition | `37d2244a5645bb80396c58534782cf2dab0fa820b6af593124789589d20f6644` |
| `README.md.sealed` | Column definitions, method, counts, verified links | `3b34c5bc8f78f9cd512a805e88e79c45c405c7a19101685bc65b3eae1290c599` |

## Key

- Variable `REFERENCE_C_KEY` (base64, 32 bytes) in the repo-root `.env` (git-ignored, mode 600).
- Created 2026-10-05. Holder: owner. Rotate on any change of holder: unseal, generate a new key, reseal, commit.
- Without the key the files are unreadable; keep a copy of the key outside this machine.

## Unseal / reseal

```sh
node scripts/reference-seal.mjs unseal docs/spec/reports/reference-c/*.sealed --out <private-dir>
node scripts/reference-seal.mjs seal <private-dir>/reference-c.xlsx <private-dir>/reference-c.csv <private-dir>/reference-c-legende.csv <private-dir>/README.md --out docs/spec/reports/reference-c
```

The script prints the SHA-256 of each plaintext; compare with the table above.
Never commit the plaintext files. Format: `REFC1` | IV (12 bytes) | GCM tag (16 bytes) | AES-256-GCM ciphertext.
