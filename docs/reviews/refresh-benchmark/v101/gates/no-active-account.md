# `no_active_account` diagnosis

## Finding

No session variable, DBUS socket, `XDG_RUNTIME_DIR`, `HOME`, or encrypted-file
key variable was missing from the v101 runtime. The benchmark constructs
`EncryptedFileKeyring("/run/benchmark-keyring")` explicitly, while the Make
target bind-mounts `/home/antoinefa/.sentropic/llm-mesh-keyring` and copies it,
including its 32-byte `.key`, into that writable path before Node starts.

The observed Cloud Code failure was a token-refresh transition. The first
failing acquisition caused llm-mesh to mark the in-memory account
`reauth_required` and report `no_active_account`; every later acquisition in
the same long-lived container then failed before a generation request. The
underlying OAuth response was not retained by the v101 receipt schema, so its
HTTP-level reason cannot be recovered from the artifacts. A fresh copy of the
same encrypted keyring refreshes successfully now.

## Reproduction without model requests

On 2026-09-15, facade `listAccounts` calls against a temporary writable copy
of the encrypted keyring returned the same two active accounts in both cases:

- interactive shell: one `codex`, one `cloud-code`;
- sanitized unit-like environment (`env -i`, only `HOME` and `PATH`): one
  `codex`, one `cloud-code`.

A facade `acquire` against the already-expired Cloud Code credential also
refreshed successfully in both environments, producing a new expiry without
calling a model. The negative control with an unrelated keyring path did not
discover an account. This excludes the proposed DBUS/session-environment
mechanism for this runner.

## Receipt chronology

- `radar-v101-campaign.service` started at 2026-09-15 15:20:57 -04:00;
  `radar-v101-codex.service` started at 15:34:54 -04:00.
- After the first unit start, accepted receipts include 43 Gemini, 51 Sonnet 5,
  24 Luna, 56 GPT-4.1, and 13 Mistral results. They therefore do not predate
  the systemd transition.
- All six Cloud Code arms switched to `no_active_account` together around
  `2026-09-15T21:08:26Z`, with `wire: null`, which matches acquisition-time
  rejection after the account lifecycle transition.
- Current Codex and direct-Anthropic receipts do not contain
  `no_active_account`; their dominant recorded error is
  `UND_ERR_CONNECT_TIMEOUT`. They remain invalid for synthesis and are replayed
  in v101b, but they are a separate failure signature.

## Replay consequence

The v101b process is launched from the interactive shell as requested, and its
provider gate requires three non-`no_active_account` outcomes per provider.
The gate records the observable outcome instead of assuming environment
inheritance fixed the historical refresh failure.
