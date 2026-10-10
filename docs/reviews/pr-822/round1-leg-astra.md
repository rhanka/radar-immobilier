status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: feat/reference-c-sealed@b9bbaee3ce9514d273408a58060b484e52638e0c
lens: security-and-secret-leakage

## Reasoning

### Scope and evidence boundaries

Reviewed `git diff origin/main...b9bbaee3`, with `origin/main` and the merge base both at `782d20c96c54e7035438aa6fdccdc4ccba82acf4`. Reviewed the complete `git log -p origin/main..b9bbaee3` and inventoried every branch-exclusive object with `git rev-list --objects` and `git cat-file --batch-check`.

The range contains two commits: `6d27b8ec4bb32115ea664580b5ae756407404d43` and `b9bbaee3ce9514d273408a58060b484e52638e0c`. Its ten unique file blobs are the sealing script, two public README versions, and seven sealed-file versions. There is no additional plaintext file that was committed and subsequently removed within this range. All three text blobs and both commit messages were inspected. No client rows, document contents, credentials, or literal encryption key were found there; the public README does disclose the aggregate metadata discussed below.

No `.env` was opened, no key material was searched for or printed, and nothing was decrypted. Other reviewers' artifacts were not read. Runtime probes used only committed ciphertext bytes or the committed filesystem statements with synthetic, non-client contents in an isolated container. No key-loading or cryptographic function was executed. This review does not attest the actual key's randomness, its file permissions, the validity of the stored authentication tags, or the claimed plaintext hashes.

### Every sealed blob, including superseded versions

Read every byte of all seven sealed blobs directly from Git objects. Each starts with the five ASCII bytes `REFC1`, followed by a 12-byte IV and a 16-byte tag field. Entropy below is empirical Shannon entropy over the ciphertext after the 33-byte envelope, in bits per byte.

| Commit | File | Blob prefix | Total bytes | Ciphertext entropy |
|---|---|---|---:|---:|
| `6d27b8ec` | `README.md.sealed` | `e2f115fe759b` | 18,320 | 7.990081 |
| `6d27b8ec` | `reference-c.csv.sealed` | `9106f26c08ae` | 1,003,497 | 7.999807 |
| `6d27b8ec` | `reference-c.xlsx.sealed` | `301e0b43a8c4` | 630,455 | 7.999691 |
| `b9bbaee3` | `README.md.sealed` | `ca5b4d2df7d2` | 18,320 | 7.988929 |
| `b9bbaee3` | `reference-c-legende.csv.sealed` | `dbf902bebbde` | 8,097 | 7.974247 |
| `b9bbaee3` | `reference-c.csv.sealed` | `aacffb55a645` | 987,914 | 7.999827 |
| `b9bbaee3` | `reference-c.xlsx.sealed` | `d9dd12dfcdb8` | 631,686 | 7.999684 |

All seven IVs are distinct, including across the two commits. Every complete, non-overlapping 4,096-byte ciphertext window has entropy at least 7.941645 bits/byte. The longest contiguous ASCII-printable/whitespace run across the payloads is 17 bytes. These measurements support encrypted binary contents and reveal no recognizable plaintext block; entropy alone cannot prove encryption or exclude every possible short disclosure. No observed IV reuse or plaintext dataset publication is supported by this branch history.

### Cryptographic construction and key handling

- `scripts/reference-seal.mjs:27` decodes base64 and line 28 rejects any decoded key length other than 32 bytes. The actual secret is outside the review scope.
- Lines 35–38 request a fresh cryptographic `randomBytes(12)` IV on every call, use `aes-256-gcm`, finalize encryption, and serialize the default full 16-byte authentication tag. The inspected format and IVs agree with this construction.
- Lines 42–47 check the magic, extract the IV/tag, call `setAuthTag`, and call `decipher.final()`. A wrong key or invalid authentication tag throws before `unseal` returns and before line 68 writes anything. Although `update` computes unauthenticated bytes internally, those bytes are not written or logged before authentication succeeds.
- The key is obtained from the process environment or the selected `.env`, never from a command-line key argument. The Git subprocess arguments are fixed. Logged values are plaintext SHA-256 digests and basenames; the explicit error messages contain the variable name or required length, not its value. There is no network transmission or key logging in the script.
- In this linked worktree, the exact Git discovery command returns `/home/antoinefa/src/radar-immobilier/.git`, so `dirname` selects the intended root checkout. It does not select this worktree's `.env`. Discovery nevertheless depends on the caller's Git context; see finding 2.
- The committed `.gitignore:19` contains `.env`. `git check-ignore --no-index -v .env` confirms that rule, and no `.env` file is tracked at the reviewed tip or introduced in the reviewed range. The README's assertion that the real file is mode 600 cannot be verified from committed bytes and was not treated as verified.

### Public metadata and plaintext hashes

The public README deliberately reveals a survey date, counts of signals/documents/cities, workbook dimensions/tab labels, and descriptions of the artifacts (`docs/spec/reports/reference-c/README.md:3`, lines 10–13). These are plaintext client-derived aggregate metadata, although not the client dataset's rows, city list, document links, or identifying records. Ciphertext sizes also reveal exact plaintext byte lengths because this format adds 33 bytes without padding.

The four public SHA-256 values are whole-file fingerprints, not per-record or per-field hashes. They do not expose the encryption key or provide a practical generic SHA-256 preimage attack. They do permit anyone with a candidate whole file to confirm an exact match without the key, and they reveal equality across versions: the published sealed README plaintext hash is unchanged between the two commits even though its ciphertext changes.

For the described multi-row workbook/CSV, these fingerprints are a reasonable non-blocking integrity tradeoff **if exact-file identification and the published aggregate metadata are acceptable disclosures**. It would be incorrect to equate ciphertext entropy with plaintext unpredictability: the smaller legend/method documents could have a more predictable candidate set. No enumerable candidate set or recoverable client content is demonstrated by the committed bytes, so this is not elevated to a speculative plaintext-recovery finding. If even exact-file membership/equality is confidential, keep plaintext digests inside an encrypted manifest and publish only ciphertext hashes. GCM already authenticates successfully unsealed contents.

The rotation instruction at README line 18 provides future key separation, not retrospective revocation: old ciphertext remains in public Git history and remains readable with its old key. Resealing cannot retract data already available to a previous holder. The README does not explicitly promise that stronger property, so no separate defect is asserted.

## Findings

### 1. Existing output files retain permissive modes, and symlink targets are followed

- **Severity:** blocking
- **File:line:** `scripts/reference-seal.mjs:68` (directory creation at line 58 contributes).
- **Evidence:** `writeFileSync(join(outDir, name), plain, { mode: 0o600 })` uses the default overwrite flag. The mode applies when creating a file; it does not restrict an existing inode's permissions. There is no exclusive creation, symlink rejection, permission correction, or requirement that the output directory be private. Line 58 creates directories with the process default mode.

  Reproduced using exactly the committed statements at lines 58 and 68, extracted from `git show b9bbaee3:scripts/reference-seal.mjs`, in Node v24.21.0 with umask 022. Only a synthetic fixture was written; no unseal operation ran:

  | Case | Observed result |
  |---|---|
  | Newly created output directory | Mode 0755 |
  | Absent output file | Created with mode 0600 |
  | Existing output file with mode 0644 | Replaced contents, retained mode 0644 |
  | Existing symlink to a mode-0644 file | Followed symlink, overwrote its target, retained target mode 0644 |

  Thus a normal existing export or a pre-positioned output symlink can receive authenticated client plaintext without the promised owner-only file protection. Other local users can read it when parent directories permit traversal. A truly private ancestor would mitigate the regular-file case, but the script neither creates nor validates that protection, and a symlink can point outside it. This is a demonstrated output-confidentiality defect, not evidence that the committed ciphertext has already leaked.
- **Fix:** Prefer refusing existing output paths with exclusive creation (`flag: 'wx', mode: 0o600`) and create or require an owner-only output directory. Exclusive creation also rejects an existing symlink. If overwrites are required, use an exclusively created mode-0600 temporary file in a verified private directory and a safe replacement operation instead of following/truncating the existing destination. Verify fresh-file, permissive-existing-file, and symlink cases; applying `chmod` only after writing would leave an exposure window.

### 2. Key-file discovery is bound to the caller's repository, not the script's repository

- **Severity:** non-blocking
- **File:line:** `scripts/reference-seal.mjs:19` (path construction at line 20).
- **Evidence:** `execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' })` supplies neither `cwd` nor a repository-binding `-C` argument. Git therefore discovers the caller's repository and honors inherited Git-location overrides. Invoking repository A's script by absolute path while the current directory is inside repository B computes B's common Git directory, then reads B's `.env`. If B supplies the same variable name, its 32-byte key is accepted for sealing; otherwise lookup fails. Independently, `dirname(commonDir)` is only the checkout root for the assumed `.git` layout, not an arbitrary separate Git directory.

  The normal documented invocation works in the supplied worktree, as verified above. There is no evidence that these committed artifacts were sealed with an unintended key, and a wrong key on unseal fails authentication. Those limits make this non-blocking, but the implementation does not guarantee the advertised repository binding outside that invocation context.
- **Fix:** Bind Git discovery to the repository containing the script, using its module location, and deliberately reject or neutralize conflicting Git-location overrides. Resolve the owning checkout from Git worktree metadata or reject unsupported separate-Git-directory layouts instead of silently treating any common-directory parent as the repository root. Verify path selection with two synthetic repositories and no real secret files.

## Verdict

**NO-GO.** Resolve finding 1 before merging this confidentiality-sensitive helper. The committed current and historical sealed blobs show the expected format, high entropy, and distinct IVs; no plaintext client records or encryption secret were demonstrated in the reviewed Git range. Finding 2 is a non-blocking repository-binding limitation, and the public fingerprints/metadata have the bounded disclosure properties described above.
