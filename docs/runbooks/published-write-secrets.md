# Runbook — Published write secrets (preprod)

## 1. Purpose

Artifact pages served from preprod may prepare write intents (the approval
screen states "Cette page peut préparer des actions"). Two server-side
secrets arm that capability on the API:

- `PW_WRITE_GRANT_SECRET` — signs the short-lived write grants the approval
  screen redeems.
- `PW_CHALLENGE_SECRET` — binds the per-action challenge the user confirms
  in the application.

`PW_IDENTITY_TIER=preprod` (plain env value in the overlay) scopes both
secrets to the preprod identity tier. When either secret reference is absent,
the application stays up but the write capability stays closed (fail-closed).

## 2. Secret and keys

- Preprod k8s Secret: **`radar-published-write-preprod`**, namespace
  `radar-immobilier-preprod`, keys **`PW_WRITE_GRANT_SECRET`** and
  **`PW_CHALLENGE_SECRET`** (same names as the env vars that consume them).
- The overlay (`deploy/overlays/preprod/patch-artifacts-api-env.yaml`)
  references both keys with `secretKeyRef ... optional: true`, so a missing
  Secret never blocks the rollout — it only closes the capability.
- Secret values are never in git.

## 3. Generation (owner-run)

Generate two **distinct** values, at least 32 bytes of entropy each:

```bash
umask 077
openssl rand -hex 32  # -> PW_WRITE_GRANT_SECRET (32 bytes, 64 hex chars)
openssl rand -hex 32  # -> PW_CHALLENGE_SECRET (run again: MUST differ)
```

Create the Secret once (existing Secrets are retained, never regenerated in
place — see §5):

```bash
kubectl -n radar-immobilier-preprod create secret generic radar-published-write-preprod \
  --from-literal=PW_WRITE_GRANT_SECRET='<first value>' \
  --from-literal=PW_CHALLENGE_SECRET='<second value>'
```

Prefer `--from-file` with `0600` files from the secret manager over
`--from-literal` (shell history) where the operator setup allows it.

## 4. Local `.env` copy

The owner keeps a copy of each value in the local `.env` (owner-held, never
committed) under:

- `PREPROD_PW_WRITE_GRANT_SECRET` — copy of `PW_WRITE_GRANT_SECRET`.
- `PREPROD_PW_CHALLENGE_SECRET` — copy of `PW_CHALLENGE_SECRET`.

The `.env` copy is the restore source: if the cluster Secret is ever lost,
recreate it from these values (same key names, §3) so outstanding grants
keep verifying instead of being invalidated by fresh random values.

## 5. Rotation (90 days)

- Cycle: **90 days**, plus immediately on suspected compromise.
- Rotation invalidates outstanding grants and challenges (same single-key
  limitation as the reader/cursor secrets): coordinate it with a quiet
  window and restart the API right after replacing the Secret.
- Procedure (owner):
  1. Generate two fresh distinct values (§3).
  2. Replace the Secret values (`kubectl -n radar-immobilier-preprod
     create secret generic radar-published-write-preprod ... --dry-run=client
     -o yaml | kubectl apply -f -`, or delete + recreate).
  3. Update the `.env` copy (§4) to the same values.
  4. Roll the API (`kubectl -n radar-immobilier-preprod rollout restart
     deployment/radar-api`) so every replica loads the new secrets together.
  5. Run the verification (§6).
- The agent creates no Secret and rotates nothing: every step above is an
  explicit owner action.

## 6. Verification

After provisioning or rotation, open a preprod artifact page that carries a
write identity and confirm the approval screen shows:

> Cette page peut préparer des actions

That sentence proves the page resolved `PW_IDENTITY_TIER=preprod` and both
secrets. If it is missing while the overlay env is set, the Secret (or one
of its keys) is absent in `radar-immobilier-preprod` — the capability is
closed, not broken.
