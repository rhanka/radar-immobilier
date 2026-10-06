status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: feat/reference-c-sealed@b9bbaee3ce9514d273408a58060b484e52638e0c
lens: correctness-and-does-it-reproduce

## Reasoning

Reviewed exactly `git diff origin/main...b9bbaee3`, with HEAD confirmed as
`b9bbaee3ce9514d273408a58060b484e52638e0c` on `feat/reference-c-sealed`.
The diff contains the script, public README, and four sealed files. The tested
script and inspected reference directory had no differences from that commit.
This is an independent review leg; no other reviewers or their reports were consulted.

The documented seal and unseal commands work on dummy files with the same four
basenames and directory layout, including actual shell expansion of `*.sealed`.
An independent Node crypto decoder verified the generated dummy envelopes:
five ASCII magic bytes, a 12-byte IV, a 16-byte authentication tag, then
AES-256-GCM ciphertext, with exactly 33 bytes of overhead. Both CLI modes print
the independently computed SHA-256 of the plaintext, followed by two spaces and
the plaintext basename. Recovered bytes matched the input bytes for all four
fixtures, an additional filename containing spaces, and an empty file.

Wrong keys, modified tags, truncated ciphertext, truncated headers, bad magic,
and invalid key lengths exited non-zero. Authentication failures produced no
plaintext file; a pre-existing output sentinel was also preserved byte for
byte. This agrees with `scripts/reference-seal.mjs:47` and `:66`: `final()` must
succeed before `writeFileSync` receives any plaintext. Newly created plaintext
files had mode 0600. Error messages identify authentication, format, key-length,
or usage failure. Truncated headers expose Node crypto errors and stack traces,
without an input filename, rather than a dedicated REFC1 truncation message;
they still fail without writing plaintext.

Key resolution was checked by code reasoning and read-only Git metadata,
without invoking the real `.env` fallback. From both the main checkout and this
linked worktree, `git rev-parse --path-format=absolute --git-common-dir` returns
`/home/antoinefa/src/radar-immobilier/.git`. Applying the script's
`join(dirname(root), '.env')` therefore yields
`/home/antoinefa/src/radar-immobilier/.env` in both cases, not the worktree's own
directory or `.git/worktrees/reference-c`. The absolute-path option removes
relative-path ambiguity. This is correct for this repository's conventional
main checkout and linked worktrees when run within a checkout, as the README
commands assume. The environment variable takes precedence at lines 17–18.
The runtime container had no Git executable, yet all valid environment-key
operations succeeded, independently demonstrating that they skip the fallback.

The script uses Node built-ins and no Python or third-party Node packages.
Git is an external dependency only for the `.env` fallback. Tests used Node
v24.21.0 in an ephemeral container with no network, no published ports, and no
application services. A separate temporary Makefile was used because the
repository's main Makefile includes `.env`. The real `.env` was neither read
nor mounted into the container; all test keys were generated under
`./.review-tmp` and supplied through `REFERENCE_C_KEY`.

The public README lists exactly the four sealed files in the diff. Its four
published hashes are lowercase 64-digit hexadecimal strings, consistent with
the script's output convention. Only the committed files' first 33 bytes and
sizes were inspected; all have REFC1 magic and a complete header. None was
decrypted. Consequently, this review does **not** authenticate those four
committed payloads, verify their published plaintext hash values, workbook
contents, counts, or links, or verify the real key's presence or file mode.
The `.env` ignore rule was confirmed through `git check-ignore`, without
opening the file.

Rotation is workable: recover with the old key, generate and supply a new
32-byte key, and reseal the four recovered files. The reproduced rotation
preserved plaintext hashes, changed ciphertext, and rejected the old key
without writing plaintext. The new key must replace whichever key source is
being used; an exported `REFERENCE_C_KEY` takes precedence over `.env`.
The requested review did not commit or push anything.

## Reproduction log

Metadata commands and outputs:

```text
$ rtk git branch --show-current
feat/reference-c-sealed
$ rtk git rev-parse HEAD --git-common-dir --show-toplevel
b9bbaee3ce9514d273408a58060b484e52638e0c
/home/antoinefa/src/radar-immobilier/.git
/home/antoinefa/src/radar-immobilier/.worktrees/reference-c
$ rtk git rev-parse --path-format=absolute --git-common-dir
/home/antoinefa/src/radar-immobilier/.git
$ rtk git -C /home/antoinefa/src/radar-immobilier rev-parse --path-format=absolute --git-common-dir
/home/antoinefa/src/radar-immobilier/.git
$ rtk git diff --name-status origin/main...b9bbaee3
A docs/spec/reports/reference-c/README.md
A docs/spec/reports/reference-c/README.md.sealed
A docs/spec/reports/reference-c/reference-c-legende.csv.sealed
A docs/spec/reports/reference-c/reference-c.csv.sealed
A docs/spec/reports/reference-c/reference-c.xlsx.sealed
A scripts/reference-seal.mjs
$ rtk git diff --exit-code b9bbaee3 -- scripts/reference-seal.mjs docs/spec/reports/reference-c
[no output; exit 0]
$ rtk git check-ignore .env
.env
```

The temporary Makefile called Docker Compose directly, without including the
repository Makefile. Its runner used `node:24-bookworm-slim`, user `1000:1000`,
`network_mode: none`, a read-only container filesystem, and these mounts:
`.review-tmp` at `/review` (writable), the script at
`/subject/scripts/reference-seal.mjs` (read-only), and the reference directory
at `/committed` (read-only). The test copied the script into an isolated dummy
checkout at `/review/fixture-repo`; every CLI command below ran there.

```text
$ rtk make -f .review-tmp/Makefile inspect ENV=test-pr822
v24.21.0
ENOENT
[ENOENT is the Git executable probe; this runtime has no Git. Exit 0.]
```

Fixture bytes were constructed using Node only:

```js
const fixtures = {
  'reference-c.xlsx': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x0a]),
  'reference-c.csv': Buffer.from('\ufeffcity,signal\nDummy City,1\n'),
  'reference-c-legende.csv': Buffer.from('column,author,definition\nx,fixture,dummy\n'),
  'README.md': Buffer.from('# Dummy reference C\nReview fixture only.\n'),
  'file with spaces.txt': Buffer.from('Dummy payload with spaces.\n'),
  'empty.txt': Buffer.alloc(0),
};
```

`TEST_KEY`, `WRONG_KEY`, and `NEW_KEY` each denote a separately generated
`randomBytes(32).toString('base64')`. `SHORT_KEY` and `LONG_KEY` use 31 and 33
bytes respectively. They were saved only under `.review-tmp` with mode 0600;
their values were never printed. The harness supplied each value in the child
process environment. `$TEST_KEY` etc. below are readable representations of
those assignments, not the real reference key.

Malformed dummy inputs were derived from the generated
`reference-c.csv.sealed`: remove the final byte for `truncated-body`, retain
the first 20 bytes for `truncated-tag`, the first 10 for `truncated-iv`, and
the first 5 for `magic-only`; XOR byte 0 with 1 for `bad-magic`, or byte 17
with 1 for `bad-tag`. The existing-output test first wrote
`KEEP THIS FILE\n` to `sentinel/bad-tag`.

Execution and recorded outputs follow. Repeated stderr stack frames and
Compose container creation notices are omitted; error messages and codes are
verbatim. Byte comparisons, independent `createHash('sha256')` comparisons,
output directory listings, and the independent dummy-envelope decoder were
assertions in the Node harness.

```text
$ rtk make -f .review-tmp/Makefile review ENV=test-pr822
Node v24.21.0; 6 dummy fixtures; keys generated using randomBytes, never printed.

$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs seal private/reference-c.xlsx private/reference-c.csv private/reference-c-legende.csv private/README.md --out docs/spec/reports/reference-c
exit=0
81b3cdafce91cf3d2ccbf643646b76d8ffce16f458a23a3eab0e25529c5cdbe8  reference-c.xlsx
367eee95a7fc0d896cca29d5f16a95598a77069b487e7105b4c4e373e82bf4b1  reference-c.csv
0842f5e71714d7c5a8db4ae60629c253368acd394a2e7446abeaf87457251c2d  reference-c-legende.csv
46b03a65600c7217ac6130a38c71ffd801a0dca90c6a9d1d49439a4201eae99b  README.md
All dummy envelopes independently decode as REFC1 | IV 12 | tag 16 | ciphertext (33-byte overhead).

$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal docs/spec/reports/reference-c/*.sealed --out private-unsealed
exit=0
46b03a65600c7217ac6130a38c71ffd801a0dca90c6a9d1d49439a4201eae99b  README.md
0842f5e71714d7c5a8db4ae60629c253368acd394a2e7446abeaf87457251c2d  reference-c-legende.csv
367eee95a7fc0d896cca29d5f16a95598a77069b487e7105b4c4e373e82bf4b1  reference-c.csv
81b3cdafce91cf3d2ccbf643646b76d8ffce16f458a23a3eab0e25529c5cdbe8  reference-c.xlsx
SHA-256 and bytes match for 4 file(s).
All newly created dummy plaintext files have mode 0600.

$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs seal "private/file with spaces.txt" --out "sealed with spaces"
exit=0
ba7bc52d9087cba5dda7fc87f8204022414786a89cc04630cd7c242b64ad9c16  file with spaces.txt
$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal "sealed with spaces/file with spaces.txt.sealed" --out "unsealed with spaces"
exit=0
ba7bc52d9087cba5dda7fc87f8204022414786a89cc04630cd7c242b64ad9c16  file with spaces.txt
SHA-256 and bytes match for 1 file(s).

$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs seal private/empty.txt --out empty-sealed
exit=0
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  empty.txt
$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal empty-sealed/empty.txt.sealed --out empty-unsealed
exit=0
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  empty.txt
SHA-256 and bytes match for 1 file(s).

$ REFERENCE_C_KEY="$WRONG_KEY" node scripts/reference-seal.mjs unseal docs/spec/reports/reference-c/reference-c.csv.sealed --out wrong-key-out
exit=1
Error: Unsupported state or unable to authenticate data
No plaintext output exists after wrong-key authentication failure.

$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal bad/truncated-body.sealed --out truncated-body-out
exit=1
Error: Unsupported state or unable to authenticate data
No plaintext file was written.
$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal bad/truncated-tag.sealed --out truncated-tag-out
exit=1
TypeError: Invalid authentication tag length: 3
  code: 'ERR_CRYPTO_INVALID_AUTH_TAG'
No plaintext file was written.
$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal bad/truncated-iv.sealed --out truncated-iv-out
exit=1
TypeError: Invalid authentication tag length: 0
  code: 'ERR_CRYPTO_INVALID_AUTH_TAG'
No plaintext file was written.
$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal bad/magic-only.sealed --out magic-only-out
exit=1
TypeError: Invalid initialization vector
  code: 'ERR_CRYPTO_INVALID_IV'
No plaintext file was written.
$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal bad/bad-magic.sealed --out bad-magic-out
exit=1
Error: not a REFC1 file
No plaintext file was written.
$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal bad/bad-tag.sealed --out bad-tag-out
exit=1
Error: Unsupported state or unable to authenticate data
No plaintext file was written.

$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal bad/bad-tag.sealed --out sentinel
exit=1
Error: Unsupported state or unable to authenticate data
Existing output remains exactly KEEP THIS FILE\n.

$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs seal private/reference-c.csv
exit=2
usage: reference-seal.mjs seal|unseal <files>... --out <dir>
$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs seal private/reference-c.csv --out
exit=2
usage: reference-seal.mjs seal|unseal <files>... --out <dir>

$ REFERENCE_C_KEY="$SHORT_KEY" node scripts/reference-seal.mjs seal private/reference-c.csv --out wrong-length-SHORT_KEY
exit=1
Error: REFERENCE_C_KEY must decode to 32 bytes
$ REFERENCE_C_KEY="$LONG_KEY" node scripts/reference-seal.mjs seal private/reference-c.csv --out wrong-length-LONG_KEY
exit=1
Error: REFERENCE_C_KEY must decode to 32 bytes
[Both output directories contained no files.]

$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs seal --out no-input-out
exit=0
[No stdout or stderr; output directory exists and is empty.]

$ REFERENCE_C_KEY="$NEW_KEY" node scripts/reference-seal.mjs seal private-unsealed/reference-c.xlsx private-unsealed/reference-c.csv private-unsealed/reference-c-legende.csv private-unsealed/README.md --out rotated
exit=0
81b3cdafce91cf3d2ccbf643646b76d8ffce16f458a23a3eab0e25529c5cdbe8  reference-c.xlsx
367eee95a7fc0d896cca29d5f16a95598a77069b487e7105b4c4e373e82bf4b1  reference-c.csv
0842f5e71714d7c5a8db4ae60629c253368acd394a2e7446abeaf87457251c2d  reference-c-legende.csv
46b03a65600c7217ac6130a38c71ffd801a0dca90c6a9d1d49439a4201eae99b  README.md
$ REFERENCE_C_KEY="$NEW_KEY" node scripts/reference-seal.mjs unseal rotated/*.sealed --out rotated-unsealed
exit=0
46b03a65600c7217ac6130a38c71ffd801a0dca90c6a9d1d49439a4201eae99b  README.md
0842f5e71714d7c5a8db4ae60629c253368acd394a2e7446abeaf87457251c2d  reference-c-legende.csv
367eee95a7fc0d896cca29d5f16a95598a77069b487e7105b4c4e373e82bf4b1  reference-c.csv
81b3cdafce91cf3d2ccbf643646b76d8ffce16f458a23a3eab0e25529c5cdbe8  reference-c.xlsx
SHA-256 and bytes match for 4 file(s).
$ REFERENCE_C_KEY="$TEST_KEY" node scripts/reference-seal.mjs unseal rotated/reference-c.csv.sealed --out old-key-out
exit=1
Error: Unsupported state or unable to authenticate data
Rotation changes ciphertext, preserves plaintext hashes, rejects the old key, and writes no plaintext on failure.

README manifest: four files match; all four published hashes have the lowercase 64-hex format emitted by the script.
README.md.sealed: magic=REFC1; size=18320; complete 33-byte header
reference-c-legende.csv.sealed: magic=REFC1; size=8097; complete 33-byte header
reference-c.csv.sealed: magic=REFC1; size=987914; complete 33-byte header
reference-c.xlsx.sealed: magic=REFC1; size=631686; complete 33-byte header
Committed sealed files were inspected only for magic, header length, and size; never decrypted. No .env file was opened.
PASS: 22 CLI invocations; all assertions passed (including observed empty-input behavior).
[make exit 0]
```

The first harness run stopped on an incorrect reviewer assertion: I expected
the 10-byte truncated header to report an invalid IV, but Node accepts its
five-byte IV and then rejects the zero-byte tag. The observed error was
`TypeError: Invalid authentication tag length: 0`. I corrected only the
temporary harness expectation and added a five-byte magic-only fixture, which
does report `Invalid initialization vector`. The complete second run above
passed; no production code was changed.

The completed report was checked against the captured invocation records, then
all temporary keys, dummy plaintexts, ciphertexts, and harness files were deleted:

```text
$ rtk make -f .review-tmp/Makefile verify-artifact ENV=test-pr822
PASS: preserved header metadata, completed status, all four sections, 22 recorded CLI commands with matching statuses/stdout/error excerpts, balanced code fences, and verdict.
[exit 0]
$ rtk make -f .review-tmp/Makefile cleanup ENV=test-pr822
time="2026-10-05T19:39:21-04:00" level=warning msg="Warning: No resource found to remove for project \"radar-test-pr822\"."
[exit 0; the one-off containers had already been removed; .review-tmp deleted]
$ rtk test ! -e .review-tmp
[no output; exit 0]
$ rtk git diff --exit-code
[no output; exit 0]
$ rtk git diff --cached --exit-code
[no output; exit 0]
$ rtk git status --short
?? docs/reviews/pr-822/
```

The reviews directory was already untracked at review start. Only this leg's
report was edited; no tracked file was changed, staged, committed, or pushed.

## Findings

1. **Severity:** non-blocking. **File:line:** `scripts/reference-seal.mjs:57`.
   **Evidence:** With a valid throwaway key,
   `node scripts/reference-seal.mjs seal --out no-input-out` exited 0, emitted
   no hash or error, and created an empty output directory. The parser validates
   mode and `--out`, but accepts an empty `files` array and skips the loop.
   An omitted input therefore looks like a successful seal operation. The
   README's explicit four-file commands are unaffected.
   **Fix:** Reject `files.length === 0` with the existing usage message and
   exit 2 before creating the output directory or loading a key. Verify with
   the reproduced no-input command and retain the successful four-file case.

No blocking defect was reproduced within the assigned scope.

## Verdict

**GO-with-nits.** The documented operations, plaintext hashes, rotation, path
handling, and authenticated failure behavior reproduced with independent dummy
data. One non-blocking argument-validation defect remains. Actual client
payloads and published hash values remain unverified because they were not
decrypted.
