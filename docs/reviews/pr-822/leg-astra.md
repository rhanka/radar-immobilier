status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: feat/reference-c-sealed@c8c87912ab03e9885e88a3601081ca7b2df844f2
lens: security-and-secret-leakage

## Reasoning

### Scope and evidence boundaries

Reviewed `git diff origin/main...c8c87912`, the corrective diff `git diff b9bbaee3 c8c87912`, and the complete branch history `git log -p origin/main..c8c87912`. The base is `782d20c96c54e7035438aa6fdccdc4ccba82acf4`; the tip is `c8c87912ab03e9885e88a3601081ca7b2df844f2`. The target changes exactly the six specified files. The correction changes only the script and public README; it does not change any sealed blob.

The branch-exclusive range contains three commits: `6d27b8ec`, `b9bbaee3`, and `c8c87912`. An object inventory using `git rev-list --objects` and `git cat-file --batch-check` contains twelve unique file blobs: two script versions, three public README versions, and seven sealed-file versions. All text versions and commit messages were inspected; every byte of each sealed blob was measured directly from its Git object. No additional plaintext file was committed and subsequently deleted in this range. No client records, document contents, city list, credentials, or literal encryption key were observed in the text blobs. Public aggregate metadata is discussed below.

The real `.env` was never opened, searched, or mounted into the test container. No real key material was requested or printed, and no committed client ciphertext was decrypted. Current-round peer reviews were not read; the prior `round1-leg-astra.md` was read as permitted. Runtime checks used the exact committed script copied into an isolated Docker Compose container, fresh random throwaway keys, and synthetic files/repositories under `./.review-tmp/astra-round2`. Compose used `--env-file /dev/null`; an independent Makefile avoided the repository Makefile's environment loading. No real repository was mounted. Synthetic `.env` files contained only the generated test keys.

Thirty-six behavioral checks passed on Node `v24.21.0`, alongside one separately demonstrated residual key-discovery defect. The temporary fixtures and test infrastructure were removed after review. These checks do not establish the real key's randomness or permissions, authenticate the client ciphertext, or verify the advertised plaintext digests.

### Current and historical encrypted blobs

All seven unique sealed blobs start with `REFC1`, have a 12-byte IV and a 16-byte tag field, and contain high-entropy payloads. Entropy is empirical Shannon entropy over bytes after the 33-byte envelope, in bits per byte.

| First commit | File | Blob prefix | Total bytes | Payload entropy |
|---|---|---|---:|---:|
| `6d27b8ec` | `README.md.sealed` | `e2f115fe759b` | 18,320 | 7.990081 |
| `6d27b8ec` | `reference-c.csv.sealed` | `9106f26c08ae` | 1,003,497 | 7.999807 |
| `6d27b8ec` | `reference-c.xlsx.sealed` | `301e0b43a8c4` | 630,455 | 7.999691 |
| `b9bbaee3` | `README.md.sealed` | `ca5b4d2df7d2` | 18,320 | 7.988929 |
| `b9bbaee3` | `reference-c-legende.csv.sealed` | `dbf902bebbde` | 8,097 | 7.974247 |
| `b9bbaee3` | `reference-c.csv.sealed` | `aacffb55a645` | 987,914 | 7.999827 |
| `b9bbaee3` | `reference-c.xlsx.sealed` | `d9dd12dfcdb8` | 631,686 | 7.999684 |

The last four are the current blobs. All seven IVs are distinct, including historical versions. Every complete, non-overlapping 4,096-byte payload window has entropy at least 7.941645 bits/byte; the longest printable ASCII/whitespace run is 17 bytes. No plaintext dataset block or IV reuse was demonstrated. These observations support encrypted contents; entropy alone is not proof of encryption or authentication.

### Cryptography, secrets, and public disclosures

- `scripts/reference-seal.mjs:47` decodes base64 and line 48 requires exactly 32 key bytes. Invalid decoded lengths were rejected in synthetic tests. The process environment intentionally takes precedence over the fallback key file.
- Lines 55–58 obtain a new cryptographic `randomBytes(12)` IV for each encryption, use AES-256-GCM, finalize encryption, and serialize the full default 16-byte tag. Repeated encryption of the same dummy file produced different IVs.
- Lines 62–67 check the magic, set the authentication tag, and call `decipher.final()` before returning plaintext. The write at line 122 is reached only after authentication succeeds. A wrong dummy key, modifications to magic/IV/tag/body, and seven truncations of the dummy envelope all failed without producing a plaintext file.
- There is no key argument or key logging in the script, and no network operation. Git receives fixed arguments. Explicit errors identify the variable or required length, not its value. Successful stdout contains a plaintext digest and basename. Test stdout/stderr did not contain either throwaway key.
- The committed `.gitignore:19` ignores `.env`; `git check-ignore -v .env` confirmed the rule, and no `.env` is tracked at the target tip or introduced in this range. The README's claim about the actual secret file's mode cannot be verified from committed bytes and is not certified here.
- The public README exposes aggregate counts, a survey date, workbook dimensions/tab labels, and whole-file plaintext hashes (`docs/spec/reports/reference-c/README.md:3`, lines 10–13). These are client-derived metadata, but no individual client record or source-document contents appear there. Ciphertext sizes reveal exact plaintext lengths because the envelope adds 33 bytes without padding. Whole-file SHA-256 digests permit candidate-file confirmation and equality comparisons; they do not demonstrate recovery of the dataset or key. No practical enumerable candidate set is established by these committed bytes, so no speculative hash-recovery finding is raised.
- Resealing with a rotated key does not revoke access to old public Git versions from someone who retains the old key. The README does not promise retrospective revocation; no separate defect is asserted on that basis.

### Output permissions and race analysis

New nested unseal directories were 0700 and new plaintext files 0600 with umasks 000, 022, and 077. Existing directories with modes 0755, 0750, 0710, and 0707 were refused with the private-directory error. Both operations refused existing regular files, directories, live symlinks, and dangling symlinks. Existing contents and modes remained unchanged. Batch collisions were rejected before earlier outputs were written, and duplicate output names were rejected before directory creation.

A deterministic race test used a dummy ciphertext FIFO: the script passed destination preflight and began reading the FIFO, then the test inserted a destination symlink before supplying the ciphertext. The final `wx` write rejected it with exit 1 and the explicit overwrite-refusal message; the symlink's sentinel target remained unchanged. Thus protection is enforced at creation time, not merely by the earlier `lstatSync` check.

`preparePrivateDir` follows an output-directory symlink when inspecting permissions (`statSync`, line 85). It checks the resolved directory's group/other bits, while final files are still created exclusively with mode 0600. The code does not pin directory ancestors against concurrent replacement, but that observation alone does not demonstrate readable plaintext or a bypass of exclusive final-file creation on the tested POSIX filesystem. No additional confidentiality finding is claimed without such evidence.

## Previous findings

### F1 — fixed

The blocking existing-output and directory-permission defect is fixed.

- **Committed evidence:** `scripts/reference-seal.mjs:70` uses `lstatSync`, detecting dangling symlinks as existing paths. Lines 111–114 explicitly refuse every pre-existing target. Line 122 uses `flag: 'wx'` for both seal and unseal and mode 0600 for plaintext. Lines 81–90 create unseal directories with mode 0700 and clearly reject existing directories with group/other permission bits. `docs/spec/reports/reference-c/README.md:25` documents deleting old sealed files before resealing; lines 31–34 explain exclusive creation and private output directories.
- **Behavioral evidence:** both operations refused all four existing-target types without modifying targets; fresh outputs had the required permissions; permissive directories failed clearly; the post-preflight symlink race was blocked by `wx`.
- **Boundary:** no regression or remaining blocking output-confidentiality defect was demonstrated.

### F2 — partially fixed

**The two subcases expressly requested in the round-2 brief are fixed:** lookup is bound to the script's repository, independent of the caller's directory and the four inherited Git-location overrides. The broader separate-Git-directory limitation recorded in the full round-1 F2 remains; it is reproduced as finding S1 below.

- **Committed evidence for the fix:** line 19 derives `SCRIPT_DIR` from `import.meta.url`; line 34 removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, and `GIT_INDEX_FILE`; lines 35–39 run Git with `cwd: SCRIPT_DIR` and the sanitized environment.
- **Behavioral evidence for the fix:** a synthetic repository A's script selected A's dummy key when called from repository B, from outside any repository, and with all four overrides pointing to B. A synthetic linked-worktree layout also selected A's owning root key despite different dummy keys in the worktree and caller. Validation unsealed only the resulting synthetic ciphertext with A's known throwaway key. Read-only discovery in the supplied worktree returns `/home/antoinefa/src/radar-immobilier/.git`, whose parent is the intended root checkout; its `.env` was not read.
- **Remaining evidence:** line 40 still assumes the parent of every common Git directory is a checkout root. A real `git init --separate-git-dir` synthetic repository silently used the dummy key from the external Git-storage parent instead of its checkout. This was already called out in the full round-1 report; the correction does not introduce it.

### F3 — fixed

The empty-input success/side-effect defect is fixed.

- **Committed evidence:** `scripts/reference-seal.mjs:95` computes `files` before validation; lines 96–98 reject `files.length === 0`, print usage, and exit 2. Output-directory creation is later at lines 106–107 and key loading at line 116.
- **Behavioral evidence:** both `seal --out <new-path>` and `unseal --out <new-path>` exited 2 with usage, did not create the path, and never attempted Git/key discovery. The probes provided no key and a nonexistent `PATH`, so an attempted Git lookup would have produced a different error.

## Findings

### S1. External common Git directories still select an unrelated key file

- **Severity:** non-blocking
- **File:line:** `scripts/reference-seal.mjs:40` (discovery at lines 35–39; unconditional repository-binding statement at `docs/spec/reports/reference-c/README.md:33`).
- **Evidence:** `join(dirname(root), '.env')` treats the parent of `--git-common-dir` as the repository checkout. That holds for this repository's ordinary root/linked-worktree layout, but not for Git's supported separate-directory layout. Reproduction used only the committed script and synthetic files under the review scratch directory:

  1. Initialize checkout A with `git init --separate-git-dir=<storage>/repo.git <checkout-A>` and copy the committed script into A's `scripts/` directory.
  2. Put independently generated throwaway key A in `<checkout-A>/.env` and throwaway key B in `<storage>/.env`; leave `REFERENCE_C_KEY` unset for the script process.
  3. Seal a dummy text file through A's script. It exits 0.
  4. Unsealing that dummy output with key A fails authentication; unsealing with key B succeeds and restores the dummy text.

  Thus correct `cwd` and sanitized Git overrides do not guarantee the advertised root-key selection for this layout. Sealing can silently use a key belonging to an unrelated storage directory; without such a file, lookup fails instead. No evidence shows that the current committed client artifacts used the wrong key. The supplied worktree and ordinary/linked synthetic layouts pass, so this residual limitation is non-blocking. It predates `c8c87912` and was noted in round 1, rather than being a new regression.
- **Fix:** resolve and validate the owning checkout from Git metadata, or explicitly reject unsupported external-common-directory layouts before reading any fallback `.env`. Preserve the working linked-worktree behavior and add a synthetic separate-directory case that either selects checkout A's key or fails clearly before sealing.

## Verdict

**GO-with-nits.** F1 and F3 are fixed; F2's requested caller-directory and inherited-override fixes pass, with its previously identified separate-Git-directory limitation still outstanding as a non-blocking finding. No new regression, plaintext client-record publication, key disclosure, or IV reuse was demonstrated in the reviewed committed history. The full test and evidence boundaries above apply; this verdict does not authenticate or decrypt the client dataset.
