status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: feat/reference-c-sealed@c8c87912ab03e9885e88a3601081ca7b2df844f2
lens: correctness-and-does-it-reproduce

## Reasoning

**GO-with-nits.** The blocking plaintext-output defect is fixed, and the documented
unseal/delete/reseal sequence works with synthetic data. One additional, non-blocking
Git-discovery environment case survives the F2 fix (N1 below).

Reviewed exactly `git diff origin/main...c8c87912`, six files, at HEAD
`c8c87912ab03e9885e88a3601081ca7b2df844f2`. Also inspected
`git diff b9bbaee3 c8c87912`: only the script and public README change in that fix.
This is an independent leg; no other current-round reviewer reports were read.

Execution used Node v24.21.0 and Git 2.54.0 in a disposable container, with umask 022.
All synthetic inputs, randomly generated 32-byte keys, synthetic `.env` files and
synthetic Git repositories lived under `./.review-tmp` (mounted as `/review`).
The project Makefile was not executed: it includes `.env`. Instead, a temporary
Makefile with no such include ran the isolated container. The real `.env` was never
read or mounted. No committed ciphertext was decrypted. Git worktrees were created
with `--orphan`, without making any commits, and no repository changes were staged,
committed or pushed.

The 328-byte dummy fixture round-tripped byte-for-byte. An independent SHA-256
calculation matched both printed hashes. Independent decryption of **only the
reviewer's own** sealed fixture confirmed `REFC1 | IV 12 | tag 16 | ciphertext`,
with exactly 33 bytes of overhead. Empty plaintext also round-tripped. The script
uses Node built-ins for encryption and file handling, plus Git for `.env` discovery;
it requires no Python runtime or third-party Node package.

Authentication completes before `writeFileSync`. Wrong keys, modified tags,
modified ciphertext and eight truncations produced no failed-file plaintext.
`lstatSync` detects dangling links, preflight checks all output targets, and `wx`
enforces exclusive final-file creation. Existing-target refusal left all batch
outputs untouched. A batch is not transactional for a later authentication error:
an earlier fully authenticated file remains, while the failing file is absent.
That is not a fragment of unauthenticated plaintext or a regression in this fix.

For an ordinary main checkout, absolute `--git-common-dir` yields `<repo>/.git`;
for a linked worktree it yields the same shared Git directory. Thus
`dirname(commonDir)/.env` selects the main checkout's `.env` in both supported
layouts. This was reproduced with three different synthetic keys in the main,
caller and linked directories. Explicit `REFERENCE_C_KEY` takes precedence.
The original cwd and `GIT_DIR`/`GIT_WORK_TREE` counterexamples now pass; the retained
`GIT_CEILING_DIRECTORIES` variable can still stop discovery before the repository.

The README lists exactly the four sealed files in the target diff. Their public
headers and sizes are consistent with this format. Each table hash is a distinct
64-character lowercase SHA-256 string, and the script demonstrably prints
**plaintext** hashes with the `.sealed` suffix removed when unsealing. The actual
client plaintext hashes, workbook contents, row counts and claims about its links
cannot be authenticated without prohibited decryption; this review does not claim
to have verified them. Rotation was tested by replacing a synthetic main `.env`
key, deleting old synthetic `.sealed` files, resealing, and recovering the same four
plaintext files with the new key. The old key subsequently failed authentication.

## Previous findings

| ID | Status | Explicit verification and evidence |
|---|---|---|
| F1 (blocking) | **fixed** | `scripts/reference-seal.mjs:70` uses `lstatSync`; lines 111–113 refuse all existing targets before writing; line 122 uses `flag: 'wx'` for both modes and `mode: 0o600` for unseal. A mode-0666 existing plaintext file retained its sentinel bytes and permissions after exit 1. Existing and dangling target symlinks were refused in both modes; victim bytes/modes and link identities stayed unchanged, and dangling victims were not created. Batch refusal at the second target wrote no first output. Lines 81–89 create unseal directories with 0700 and reject existing 0755 directories with an explicit `chmod 700` message. Runtime checks confirmed new parent directories at 0700 and plaintext files at 0600. README lines 25–27 document deleting old sealed outputs; the four-file sequence and rotation passed. |
| F2 (non-blocking) | **partially fixed** | Lines 19 and 35–38 bind Git's cwd to the script directory. Line 34 removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR` and `GIT_INDEX_FILE`. Main-checkout and linked-worktree discovery both selected the main synthetic key when called from a different repository with a different `.env` and all four hostile overrides. Those original cases are fixed. However, an inherited `GIT_CEILING_DIRECTORIES` equal to the script's checkout root still makes the Git subprocess exit 128 and the script exit 1 despite a valid root `.env`; reproduced in both synthetic checkout layouts. N1 documents this residual failure and its control experiment. |
| F3 (non-blocking) | **fixed** | Lines 95–98 reject `files.length === 0`, print usage and exit 2 before directory preparation (106–107) or key loading (116). Both `seal --out x` and `unseal --out x` were tested with the key unset and with an invalid key. All four executions exited 2, emitted only usage, and did not create `x`. |

## Reproduction log

The following commands were executed through the temporary Makefile. Only its
test container was started; no application service or dev environment was used.

```sh
rtk make -f .review-tmp/Makefile prepare runtime-image ENV=test-pr822-sol
rtk make -f .review-tmp/Makefile review ENV=test-pr822-sol
rtk make -f .review-tmp/Makefile review-extra ENV=test-pr822-sol
rtk make -f .review-tmp/Makefile refute-ceiling ENV=test-pr822-sol
```

The image used `FROM node:24-alpine` and `RUN apk add --no-cache git`. Its review
command mounted only `.review-tmp` read/write and
`docs/spec/reports/reference-c` read-only, ran as the invoking user's UID/GID,
and used `--network none`. The read-only dataset mount was used exclusively to
inspect its first 33 bytes and file sizes, never as unseal input. The separate
refutation container did not mount the dataset at all.

The Node runner generated its keys with `randomBytes(32).toString('base64')`.
The dummy payload was constructed as follows, so its hash is reproducible:

```js
Buffer.concat([
  Buffer.from('Synthetic reviewer fixture, no client data.\nUTF-8: Référence jetable.\n'),
  Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
]);
```

```text
Runtime: Node v24.21.0; Git git version 2.54.0; umask 022
Dummy: 328 bytes
SHA-256: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41
Sealed fixture: 361 bytes = 5 magic + 12 IV + 16 tag + 328 ciphertext
Sealed fixture SHA-256: 4869fe71f55b84eafd08d9587705e307e057066c6cd3d9d8d4775d9b2047040d
New private directory / plaintext modes: 700 / 600
Baseline verification groups: 19/19 verified; 62 subprocesses
```

One reviewer-harness metadata assertion initially used `map(basename)`, which
incorrectly passed the array index as a suffix argument. The callback was corrected
and that metadata check rerun independently; this was not a target-script failure.
The two sealed-fixture hashes above differ, confirming that the printed hash is
not a ciphertext hash.

In the logs below, `<throwaway:A>`, `<throwaway:B>` and `<throwaway:C>` identify
different randomly generated base64 keys, not literal shell arguments. Synthetic
`.env` files initially contained key A in `synthetic-main`, key B in
`synthetic-caller` and key C in `synthetic-linked`. The rotation case changed only
the main synthetic `.env` to key B. Keys and client data are not printed. CLI exit
codes are reported directly; repetitive JavaScript stack frames are omitted, while
the diagnostic text and error codes are retained.

### Round-trip, plaintext SHA-256, format and private modes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/sealed
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### Round-trip, plaintext SHA-256, format and private modes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/roundtrip-private
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### Spaces, empty plaintext, --out before inputs and alternate cwd

```text
cwd: /review/other cwd
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs seal --out '/review/sealed with spaces' '/review/fixtures/file with spaces.txt' /review/fixtures/empty.bin
exit: 0
stdout: ee149551f064c776f2a46077b34081eeb43d9ddf523b615258bd22d4247618b2  file with spaces.txt
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  empty.bin
stderr: (empty)
```

### Spaces, empty plaintext, --out before inputs and alternate cwd

```text
cwd: /review/other cwd
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal '/review/sealed with spaces/file with spaces.txt.sealed' '/review/sealed with spaces/empty.bin.sealed' --out '/review/private with spaces'
exit: 0
stdout: ee149551f064c776f2a46077b34081eeb43d9ddf523b615258bd22d4247618b2  file with spaces.txt
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  empty.bin
stderr: (empty)
```

### Wrong key: authentication fails without a plaintext file

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:B> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/wrong-key
exit: 1
stdout: (empty)
stderr: Error: Unsupported state or unable to authenticate data
```

### Truncated files: no plaintext at 0, 4, 5, 16, 17, 32, 33 and length-1 bytes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/truncated-0.sealed --out /review/truncated-out-0
exit: 1
stdout: (empty)
stderr: Error: not a REFC1 file
```

### Truncated files: no plaintext at 0, 4, 5, 16, 17, 32, 33 and length-1 bytes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/truncated-4.sealed --out /review/truncated-out-4
exit: 1
stdout: (empty)
stderr: Error: not a REFC1 file
```

### Truncated files: no plaintext at 0, 4, 5, 16, 17, 32, 33 and length-1 bytes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/truncated-5.sealed --out /review/truncated-out-5
exit: 1
stdout: (empty)
stderr: TypeError: Invalid initialization vector
  code: 'ERR_CRYPTO_INVALID_IV'
```

### Truncated files: no plaintext at 0, 4, 5, 16, 17, 32, 33 and length-1 bytes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/truncated-16.sealed --out /review/truncated-out-16
exit: 1
stdout: (empty)
stderr: TypeError: Invalid authentication tag length: 0
  code: 'ERR_CRYPTO_INVALID_AUTH_TAG'
```

### Truncated files: no plaintext at 0, 4, 5, 16, 17, 32, 33 and length-1 bytes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/truncated-17.sealed --out /review/truncated-out-17
exit: 1
stdout: (empty)
stderr: TypeError: Invalid authentication tag length: 0
  code: 'ERR_CRYPTO_INVALID_AUTH_TAG'
```

### Truncated files: no plaintext at 0, 4, 5, 16, 17, 32, 33 and length-1 bytes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/truncated-32.sealed --out /review/truncated-out-32
exit: 1
stdout: (empty)
stderr: Error: Unsupported state or unable to authenticate data
```

### Truncated files: no plaintext at 0, 4, 5, 16, 17, 32, 33 and length-1 bytes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/truncated-33.sealed --out /review/truncated-out-33
exit: 1
stdout: (empty)
stderr: Error: Unsupported state or unable to authenticate data
```

### Truncated files: no plaintext at 0, 4, 5, 16, 17, 32, 33 and length-1 bytes

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/truncated-360.sealed --out /review/truncated-out-360
exit: 1
stdout: (empty)
stderr: Error: Unsupported state or unable to authenticate data
```

### Bad magic, modified tag and modified ciphertext: no plaintext

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/bad-magic.sealed --out /review/bad-magic-out
exit: 1
stdout: (empty)
stderr: Error: not a REFC1 file
```

### Bad magic, modified tag and modified ciphertext: no plaintext

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/bad-tag.sealed --out /review/bad-tag-out
exit: 1
stdout: (empty)
stderr: Error: Unsupported state or unable to authenticate data
```

### Bad magic, modified tag and modified ciphertext: no plaintext

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/fixtures/bad-body.sealed --out /review/bad-body-out
exit: 1
stdout: (empty)
stderr: Error: Unsupported state or unable to authenticate data
```

### Missing --out, missing output value, invalid mode: usage and exit 2

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:invalid-length> node /review/reference-seal.mjs seal /review/fixtures/dummy.bin
exit: 2
stdout: (empty)
stderr: usage: reference-seal.mjs seal|unseal <files>... --out <dir>
```

### Missing --out, missing output value, invalid mode: usage and exit 2

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:invalid-length> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed
exit: 2
stdout: (empty)
stderr: usage: reference-seal.mjs seal|unseal <files>... --out <dir>
```

### Missing --out, missing output value, invalid mode: usage and exit 2

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:invalid-length> node /review/reference-seal.mjs seal /review/fixtures/dummy.bin --out
exit: 2
stdout: (empty)
stderr: usage: reference-seal.mjs seal|unseal <files>... --out <dir>
```

### Missing --out, missing output value, invalid mode: usage and exit 2

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:invalid-length> node /review/reference-seal.mjs invalid /review/fixtures/dummy.bin --out /review/invalid-mode-out
exit: 2
stdout: (empty)
stderr: usage: reference-seal.mjs seal|unseal <files>... --out <dir>
```

### F3: zero inputs fails before directory creation or key lookup

```text
cwd: /review
env -u REFERENCE_C_KEY node /review/reference-seal.mjs seal --out /review/zero-input-seal-missing-key
exit: 2
stdout: (empty)
stderr: usage: reference-seal.mjs seal|unseal <files>... --out <dir>
```

### F3: zero inputs fails before directory creation or key lookup

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:invalid-length> node /review/reference-seal.mjs seal --out /review/zero-input-seal-bad-key
exit: 2
stdout: (empty)
stderr: usage: reference-seal.mjs seal|unseal <files>... --out <dir>
```

### F3: zero inputs fails before directory creation or key lookup

```text
cwd: /review
env -u REFERENCE_C_KEY node /review/reference-seal.mjs unseal --out /review/zero-input-unseal-missing-key
exit: 2
stdout: (empty)
stderr: usage: reference-seal.mjs seal|unseal <files>... --out <dir>
```

### F3: zero inputs fails before directory creation or key lookup

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:invalid-length> node /review/reference-seal.mjs unseal --out /review/zero-input-unseal-bad-key
exit: 2
stdout: (empty)
stderr: usage: reference-seal.mjs seal|unseal <files>... --out <dir>
```

### Nonexistent input file and wrong key lengths: nonzero, empty output

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs seal /review/fixtures/does-not-exist --out /review/missing-file-out
exit: 1
stdout: (empty)
stderr: Error: ENOENT: no such file or directory, open '/review/fixtures/does-not-exist'
  code: 'ENOENT',
```

### Nonexistent input file and wrong key lengths: nonzero, empty output

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:invalid-length> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/wrong-length-16
exit: 1
stdout: (empty)
stderr: Error: REFERENCE_C_KEY must decode to 32 bytes
```

### Nonexistent input file and wrong key lengths: nonzero, empty output

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:invalid-length> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/wrong-length-31
exit: 1
stdout: (empty)
stderr: Error: REFERENCE_C_KEY must decode to 32 bytes
```

### Nonexistent input file and wrong key lengths: nonzero, empty output

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:invalid-length> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/wrong-length-33
exit: 1
stdout: (empty)
stderr: Error: REFERENCE_C_KEY must decode to 32 bytes
```

### F1: existing permissive file refused and preserved

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/existing-file
exit: 1
stdout: (empty)
stderr: reference-seal: refusing to overwrite existing output (delete it first): /review/existing-file/dummy.bin
```

### F1: existing and dangling target symlinks refused for seal and unseal

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/symlink-seal-existing
exit: 1
stdout: (empty)
stderr: reference-seal: refusing to overwrite existing output (delete it first): /review/symlink-seal-existing/dummy.bin.sealed
```

### F1: existing and dangling target symlinks refused for seal and unseal

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/symlink-seal-dangling
exit: 1
stdout: (empty)
stderr: reference-seal: refusing to overwrite existing output (delete it first): /review/symlink-seal-dangling/dummy.bin.sealed
```

### F1: existing and dangling target symlinks refused for seal and unseal

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/symlink-unseal-existing
exit: 1
stdout: (empty)
stderr: reference-seal: refusing to overwrite existing output (delete it first): /review/symlink-unseal-existing/dummy.bin
```

### F1: existing and dangling target symlinks refused for seal and unseal

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/symlink-unseal-dangling
exit: 1
stdout: (empty)
stderr: reference-seal: refusing to overwrite existing output (delete it first): /review/symlink-unseal-dangling/dummy.bin
```

### F1: preflight refusal prevents partial batch output

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs seal /review/fixtures/dummy.bin '/review/fixtures/file with spaces.txt' --out /review/two-sealed
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
ee149551f064c776f2a46077b34081eeb43d9ddf523b615258bd22d4247618b2  file with spaces.txt
stderr: (empty)
```

### F1: preflight refusal prevents partial batch output

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs seal /review/fixtures/dummy.bin '/review/fixtures/file with spaces.txt' --out /review/batch-refusal-seal
exit: 1
stdout: (empty)
stderr: reference-seal: refusing to overwrite existing output (delete it first): /review/batch-refusal-seal/file with spaces.txt.sealed
```

### F1: preflight refusal prevents partial batch output

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/two-sealed/dummy.bin.sealed '/review/two-sealed/file with spaces.txt.sealed' --out /review/batch-refusal-unseal
exit: 1
stdout: (empty)
stderr: reference-seal: refusing to overwrite existing output (delete it first): /review/batch-refusal-unseal/file with spaces.txt
```

### F1: 0755 output directory refused; chmod 0700 retry succeeds

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/wide-output
exit: 1
stdout: (empty)
stderr: reference-seal: --out /review/wide-output has mode 755; unseal requires a private directory (chmod 700 /review/wide-output, or use a new path)
```

### F1: 0755 output directory refused; chmod 0700 retry succeeds

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/wide-output
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### F1: 0755 output directory refused; chmod 0700 retry succeeds

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/sealed/dummy.bin.sealed --out /review/new-private-parents/one/two
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### Duplicate output basenames rejected before creating directory

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs seal /review/fixtures/dummy.bin /review/fixtures/duplicate/dummy.bin --out /review/duplicate-output
exit: 1
stdout: (empty)
stderr: reference-seal: two inputs map to the same output name
```

### Set up synthetic main and caller repositories, no commits

```text
cwd: /review/synthetic-main
env -u REFERENCE_C_KEY git init -q -b main
exit: 0
stdout: (empty)
stderr: (empty)
```

### Set up synthetic main and caller repositories, no commits

```text
cwd: /review/synthetic-caller
env -u REFERENCE_C_KEY git init -q -b main
exit: 0
stdout: (empty)
stderr: (empty)
```

### Set up synthetic main and caller repositories, no commits

```text
cwd: /review/synthetic-main
env -u REFERENCE_C_KEY git worktree add --orphan -b review-linked /review/synthetic-linked
exit: 0
stdout: (empty)
stderr: Preparing worktree (new branch 'review-linked')
```

### F2: main-checkout .env bound to script repo across cwd and hostile Git overrides

```text
cwd: /review/synthetic-caller
env -u REFERENCE_C_KEY node /review/synthetic-main/scripts/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/main-discovery-0
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### F2: main-checkout .env bound to script repo across cwd and hostile Git overrides

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/main-discovery-0/dummy.bin.sealed --out /review/main-discovery-plain-0
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### F2: main-checkout .env bound to script repo across cwd and hostile Git overrides

```text
cwd: /review/synthetic-caller
env -u REFERENCE_C_KEY node /review/synthetic-main/scripts/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/main-discovery-1
extra environment: {"GIT_DIR":"/review/synthetic-caller/.git","GIT_WORK_TREE":"/review/synthetic-caller"}
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### F2: main-checkout .env bound to script repo across cwd and hostile Git overrides

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/main-discovery-1/dummy.bin.sealed --out /review/main-discovery-plain-1
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### F2: main-checkout .env bound to script repo across cwd and hostile Git overrides

```text
cwd: /review/synthetic-caller
env -u REFERENCE_C_KEY node /review/synthetic-main/scripts/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/main-discovery-2
extra environment: {"GIT_DIR":"/review/synthetic-caller/.git","GIT_WORK_TREE":"/review/synthetic-caller","GIT_COMMON_DIR":"/review/synthetic-caller/.git","GIT_INDEX_FILE":"/review/synthetic-caller/.git/index"}
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### F2: main-checkout .env bound to script repo across cwd and hostile Git overrides

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/main-discovery-2/dummy.bin.sealed --out /review/main-discovery-plain-2
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### F2: linked worktree resolves shared main .env, ignores linked and caller .env

```text
cwd: /review/synthetic-linked/scripts
env -u REFERENCE_C_KEY git rev-parse --path-format=absolute --git-common-dir
exit: 0
stdout: /review/synthetic-main/.git
stderr: (empty)
```

### F2: linked worktree resolves shared main .env, ignores linked and caller .env

```text
cwd: /review/synthetic-caller
env -u REFERENCE_C_KEY node /review/synthetic-linked/scripts/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/linked-discovery
extra environment: {"GIT_DIR":"/review/synthetic-caller/.git","GIT_WORK_TREE":"/review/synthetic-caller","GIT_COMMON_DIR":"/review/synthetic-caller/.git","GIT_INDEX_FILE":"/review/synthetic-caller/.git/index"}
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### F2: linked worktree resolves shared main .env, ignores linked and caller .env

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/linked-discovery/dummy.bin.sealed --out /review/linked-discovery-plain
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### Environment key overrides synthetic .env; missing key has explicit diagnostic

```text
cwd: /review/synthetic-caller
REFERENCE_C_KEY=<throwaway:B> node /review/synthetic-main/scripts/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/env-overrides-dotenv
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### Environment key overrides synthetic .env; missing key has explicit diagnostic

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:B> node /review/reference-seal.mjs unseal /review/env-overrides-dotenv/dummy.bin.sealed --out /review/env-overrides-plain
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

### Environment key overrides synthetic .env; missing key has explicit diagnostic

```text
cwd: /review
env -u REFERENCE_C_KEY node /review/synthetic-main/scripts/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/missing-key-out
exit: 1
stdout: (empty)
stderr: Error: REFERENCE_C_KEY not found (environment or repo-root .env)
```

### README four-file glob, no-overwrite reseal, delete sequence and key rotation

```text
cwd: /review/synthetic-main
env -u REFERENCE_C_KEY node /review/synthetic-main/scripts/reference-seal.mjs seal /review/synthetic-main/source/reference-c.xlsx /review/synthetic-main/source/reference-c.csv /review/synthetic-main/source/reference-c-legende.csv /review/synthetic-main/source/README.md --out /review/synthetic-main/docs/spec/reports/reference-c
exit: 0
stdout: 3a25a928f8d3104f6aa2b165dbbe6409741ff660c6e7ad720651b0170a8bd2c2  reference-c.xlsx
7436f990f72960b8bc90896eaae074327843a64f926c7086eed6428e56cf4cbe  reference-c.csv
0d6c4c8f31c72e3bf0da59d737802d31ce5063a1b2da096c305c52077fb24e0b  reference-c-legende.csv
c157769ce22fd3282e1104653cd1c7dc50268e454079ed8c4169c172678f72f9  README.md
stderr: (empty)
```

### README four-file glob, no-overwrite reseal, delete sequence and key rotation

```text
cwd: /review/synthetic-main
env -u REFERENCE_C_KEY sh -c 'node scripts/reference-seal.mjs unseal docs/spec/reports/reference-c/*.sealed --out private-dir'
exit: 0
stdout: c157769ce22fd3282e1104653cd1c7dc50268e454079ed8c4169c172678f72f9  README.md
0d6c4c8f31c72e3bf0da59d737802d31ce5063a1b2da096c305c52077fb24e0b  reference-c-legende.csv
7436f990f72960b8bc90896eaae074327843a64f926c7086eed6428e56cf4cbe  reference-c.csv
3a25a928f8d3104f6aa2b165dbbe6409741ff660c6e7ad720651b0170a8bd2c2  reference-c.xlsx
stderr: (empty)
```

### README four-file glob, no-overwrite reseal, delete sequence and key rotation

```text
cwd: /review/synthetic-main
env -u REFERENCE_C_KEY sh -c 'node scripts/reference-seal.mjs seal private-dir/reference-c.xlsx private-dir/reference-c.csv private-dir/reference-c-legende.csv private-dir/README.md --out docs/spec/reports/reference-c'
exit: 1
stdout: (empty)
stderr: reference-seal: refusing to overwrite existing output (delete it first): /review/synthetic-main/docs/spec/reports/reference-c/reference-c.xlsx.sealed, /review/synthetic-main/docs/spec/reports/reference-c/reference-c.csv.sealed, /review/synthetic-main/docs/spec/reports/reference-c/reference-c-legende.csv.sealed, /review/synthetic-main/docs/spec/reports/reference-c/README.md.sealed
```

### README four-file glob, no-overwrite reseal, delete sequence and key rotation

```text
cwd: /review/synthetic-main
env -u REFERENCE_C_KEY sh -c 'rm docs/spec/reports/reference-c/*.sealed'
exit: 0
stdout: (empty)
stderr: (empty)
```

### README four-file glob, no-overwrite reseal, delete sequence and key rotation

```text
cwd: /review/synthetic-main
env -u REFERENCE_C_KEY sh -c 'node scripts/reference-seal.mjs seal private-dir/reference-c.xlsx private-dir/reference-c.csv private-dir/reference-c-legende.csv private-dir/README.md --out docs/spec/reports/reference-c'
exit: 0
stdout: 3a25a928f8d3104f6aa2b165dbbe6409741ff660c6e7ad720651b0170a8bd2c2  reference-c.xlsx
7436f990f72960b8bc90896eaae074327843a64f926c7086eed6428e56cf4cbe  reference-c.csv
0d6c4c8f31c72e3bf0da59d737802d31ce5063a1b2da096c305c52077fb24e0b  reference-c-legende.csv
c157769ce22fd3282e1104653cd1c7dc50268e454079ed8c4169c172678f72f9  README.md
stderr: (empty)
```

### README four-file glob, no-overwrite reseal, delete sequence and key rotation

```text
cwd: /review/synthetic-main
env -u REFERENCE_C_KEY sh -c 'node scripts/reference-seal.mjs unseal docs/spec/reports/reference-c/*.sealed --out rotated-private'
exit: 0
stdout: c157769ce22fd3282e1104653cd1c7dc50268e454079ed8c4169c172678f72f9  README.md
0d6c4c8f31c72e3bf0da59d737802d31ce5063a1b2da096c305c52077fb24e0b  reference-c-legende.csv
7436f990f72960b8bc90896eaae074327843a64f926c7086eed6428e56cf4cbe  reference-c.csv
3a25a928f8d3104f6aa2b165dbbe6409741ff660c6e7ad720651b0170a8bd2c2  reference-c.xlsx
stderr: (empty)
```

### README four-file glob, no-overwrite reseal, delete sequence and key rotation

```text
cwd: /review
REFERENCE_C_KEY=<throwaway:A> node /review/reference-seal.mjs unseal /review/synthetic-main/docs/spec/reports/reference-c/reference-c.xlsx.sealed --out /review/rotation-old-key
exit: 1
stdout: (empty)
stderr: Error: Unsupported state or unable to authenticate data
```

### Committed metadata, without decryption

Compared the README's four table entries against the four `.sealed` paths from
`git diff --name-only origin/main...c8c87912`. Node `openSync`/`readSync` read only
33 bytes per committed file; `statSync` supplied these sizes:

```text
README.md.sealed:                 18320 bytes, magic REFC1
reference-c-legende.csv.sealed:    8097 bytes, magic REFC1
reference-c.csv.sealed:          987914 bytes, magic REFC1
reference-c.xlsx.sealed:         631686 bytes, magic REFC1
README sealed-file names == target diff sealed-file names: true
README plaintext hashes: 4 distinct lowercase hexadecimal strings of length 64
```

### Additional batch-authentication check

Two further synthetic files (`first` and `second`) were sealed with another
throwaway key. Byte 17 of the second sealed file was flipped to corrupt its tag.

```text
node /review/reference-seal.mjs unseal /review/extra-batch-sealed/first.sealed /review/extra-batch-sealed/second.sealed --out /review/extra-batch-out
REFERENCE_C_KEY: the extra throwaway key
exit: 1
stdout: 20c8873ac914b0ecc5ace17bc850b7763bed7e089a0c12185baddad87b5e2682  first
stderr: Error: Unsupported state or unable to authenticate data
first: present, exact authenticated synthetic plaintext
second: absent
```

### Residual Git-ceiling counterexample and refutation

```text
cwd: /review/synthetic-main
environment: {"GIT_CEILING_DIRECTORIES":"/review/synthetic-main"}
REFERENCE_C_KEY: unset
git rev-parse --path-format=absolute --git-common-dir
exit: 0
stdout: /review/synthetic-main/.git
stderr: (empty)
```

```text
cwd: /review/synthetic-caller
environment: {"GIT_CEILING_DIRECTORIES":"/review/synthetic-main"}
REFERENCE_C_KEY: unset
node /review/synthetic-main/scripts/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/ceiling-counterexample
exit: 1
stdout: (empty)
stderr: fatal: not a git repository (or any of the parent directories): .git
Error: Command failed: git rev-parse --path-format=absolute --git-common-dir
fatal: not a git repository (or any of the parent directories): .git
```

```text
cwd: /review/synthetic-caller
environment: {}
REFERENCE_C_KEY: unset
node /review/synthetic-main/scripts/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/ceiling-counterexample
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

```text
cwd: /review
environment: {"REFERENCE_C_KEY":"<synthetic main key>"}
REFERENCE_C_KEY: <synthetic main key>
node /review/reference-seal.mjs unseal /review/ceiling-counterexample/dummy.bin.sealed --out /review/ceiling-control-private
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

```text
cwd: /review/synthetic-caller
environment: {"GIT_CEILING_DIRECTORIES":"/review/synthetic-main"}
REFERENCE_C_KEY: unset
node /review/synthetic-main/scripts/reference-ceiling-fix.mjs seal /review/fixtures/dummy.bin --out /review/ceiling-fixed-main
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

```text
cwd: /review
environment: {"REFERENCE_C_KEY":"<synthetic main key>"}
REFERENCE_C_KEY: <synthetic main key>
node /review/reference-seal.mjs unseal /review/ceiling-fixed-main/dummy.bin.sealed --out /review/ceiling-fixed-main-private
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

```text
cwd: /review/synthetic-caller
environment: {"GIT_CEILING_DIRECTORIES":"/review/synthetic-linked"}
REFERENCE_C_KEY: unset
node /review/synthetic-linked/scripts/reference-ceiling-fix.mjs seal /review/fixtures/dummy.bin --out /review/ceiling-fixed-linked
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

```text
cwd: /review
environment: {"REFERENCE_C_KEY":"<synthetic main key>"}
REFERENCE_C_KEY: <synthetic main key>
node /review/reference-seal.mjs unseal /review/ceiling-fixed-linked/dummy.bin.sealed --out /review/ceiling-fixed-linked-private
exit: 0
stdout: ab23af8d4ff519f0d927d258d04b3eaa25e4bfcf945d5550af1a5a6d85e6fc41  dummy.bin
stderr: (empty)
```

```text
cwd: /review
env -u REFERENCE_C_KEY GIT_CEILING_DIRECTORIES=/review/synthetic-linked node /review/synthetic-linked/scripts/reference-seal.mjs seal /review/fixtures/dummy.bin --out /review/ceiling-unpatched-linked
exit: 1
stdout: (empty)
stderr: fatal: not a git repository (or any of the parent directories): .git
Error: Command failed: git rev-parse --path-format=absolute --git-common-dir
fatal: not a git repository (or any of the parent directories): .git
output directory: empty
```

An additional unmodified linked-worktree run with
`GIT_CEILING_DIRECTORIES=/review/synthetic-linked` and an unset
`REFERENCE_C_KEY` likewise exited 1, reported `fatal: not a git repository`, and
left `/review/ceiling-unpatched-linked` empty. In both layouts, adding **only**
`GIT_CEILING_DIRECTORIES` to the scrub list in a temporary script copy restored
successful sealing and recovery with the synthetic main key. The real script was
not changed.

### Cleanup and scope verification

```text
rtk make -f .review-tmp/Makefile cleanup ENV=test-pr822-sol
exit: 0 (removed the disposable image tag and the complete temporary directory)
rtk ls -ld .review-tmp
exit: 2; ls: cannot access '.review-tmp': No such file or directory
rtk git diff --exit-code HEAD
exit: 0; output: empty
rtk git status --short
?? docs/reviews/pr-822/
```

Only this requested review artifact was written outside the deleted temporary
directory. No other tracked file was modified.

## Findings

### N1 — Git discovery still inherits a location ceiling

- **Severity:** non-blocking.
- **File:line:** `scripts/reference-seal.mjs:34` (discovery at line 35).
- **Evidence:** with `REFERENCE_C_KEY` unset and a valid synthetic repo-root
  `.env`, `GIT_CEILING_DIRECTORIES=<script-checkout-root>` prevents the subprocess
  launched from `<script-checkout-root>/scripts` from searching that parent.
  `git rev-parse` succeeds when run at the repository root with the same ceiling,
  but the unmodified script exits 1 with `fatal: not a git repository`. Both main
  and linked synthetic checkouts reproduce it. Removing the inherited ceiling,
  without changing the key, input or script, makes the same main-checkout command
  succeed. A synthetic copy that scrubs just this additional variable succeeds in
  both layouts and its output unseals with the expected main key.
- **Impact:** `.env` fallback remains dependent on an ambient Git discovery
  setting, despite the fix's intended isolation. Supplying `REFERENCE_C_KEY`
  directly bypasses the failure. No wrong-key selection, overwrite or plaintext
  exposure was reproduced in this case.
- **Fix:** remove `GIT_CEILING_DIRECTORIES` from the child Git environment alongside
  the four already removed variables; cover that inherited setting in the
  synthetic main/linked-worktree checks.

No blocking finding survived the reproductions.

## Verdict

**GO-with-nits.** F1 and F3 are fixed. F2's originally reported cwd and
`GIT_DIR`/`GIT_WORK_TREE` cases are fixed, but the broader environment-isolation
claim remains partially satisfied because of N1. README commands, rotation,
plaintext hashing, output privacy and authentication-failure behavior passed the
synthetic reproductions. The actual client plaintext hashes remain unverified
under the explicit no-decryption constraint.
