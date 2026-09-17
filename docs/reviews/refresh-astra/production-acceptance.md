# Astra low refresh: preproduction then production

Refs #703 and #697. Owner decision: 2026-09-17 04:40Z. The code lane prepares
the release; i-cond merges and the k8s lane executes the authorized rollout.

## Runtime contract

Primary: `openai / gpt-6-astra / low`, transported by `CodexRuntimeClient`.
Fallback: `gemini / gemini-3.8-flash / low`, transported by Cloud Code.
`@sentropic/llm-mesh-refresh` remains exactly 0.19.2. Its installed
`dist/codex.js:53` removes `max_output_tokens`; the HTTP-boundary unit test
asserts omission even when the graph extraction requests 32768 tokens.
The Gemini limit remains 32768. `REFRESH_MAXIMUM_ATTEMPTS` must equal 1:
Graphify may retry validation failures with larger route budgets.

`REFRESH_TIMEOUT_MS=900000` is a separate deadline for each model attempt.
The Job deadline is 2100 seconds, leaving room for both model windows plus
acquisition/publication. A large multi-chunk document can still reach the Job
deadline; completed chunks resume durably in a later cycle.

Transport errors, quota/429, 5xx, no active account, timeout and empty text
trigger fallback. JSON, profile and provenance refusals stop without fallback.
Fallback sticks to the remaining chunks of that document. After three distinct
documents fall back for quota/429 consecutively, later documents skip Astra.
A wholly successful primary document resets that count; successful intermediate
chunks do not. The circuit resets next cycle; partial documents restore fallback
from durable receipts. Current acquisition selects one
PDF per city cycle; use two distinct cycles for two-document acceptance.

`state.json` contains both models and forced mode in `identity.modelPolicy`.
`documentModels[docSha][]` retains each chunk attempt's `modelUsed`, status,
latency, `failureReason` and/or `fallbackReason`. A mixed document therefore
retains both models. Completed chunks resume without duplicate generation.
Returned provider/model/status are checked before recording completion; a
returned identity mismatch stops with `modelUsed: null`. The deadline is enforced
and integrity/status refusals carry `terminalFailure: true` across restarts,
so a later cycle cannot reinterpret them as transport fallback. The deadline is enforced
even for an uncooperative client. Late responses cannot validate or overwrite the
selected output file, which only the policy writes after success.
Logs emit the same safe metadata as `refresh-pv: model receipt`; no provider
messages, prompts, credentials or account material are logged.

## Keyring and principal prerequisites

Use the existing Secret keys `REFRESH_PRINCIPAL_REF` and
`REFRESH_OWNER_SCOPE_REF` in `radar-refresh-runtime` for both transports.
Measured installed mesh 0.19.2 `dist/service/local-account-transport-service.js`
lines 334–358 filter route accounts by owner scope and expose each account's
target/transport separately. A principal is the caller identity, not a single
provider credential. No fallback-specific Secret keys are needed when both
accounts are enrolled under this owner. Do not copy an unrelated owner's account.

The k8s lane must enroll Codex under the same owner as the existing Cloud Code
account in `/keyring/runtime` on `radar-refresh-keyring`. Bootstrap copies only
when `.key` is absent: replacing `radar-refresh-keyring-bootstrap` alone does
not enroll Codex in an already initialized PVC. Preserve the writable runtime
keyring and its refreshed credentials. Never include keyring bytes in receipts.

## Preproduction acceptance (k8s lane)

1. Verify the OVH preprod cluster/namespace, runtime Secret key names, both
   enrolled transports, writable PVC and 1536Mi workload limit. The code lane's
   `~/.kube/radar-immobilier-preprod-cert-ro.kubeconfig` is read-only.
2. Merge the green PR through i-cond. Wait for CD preprod; record the release
   SHA and immutable API digest. Render verification must show only PV active,
   the six model variables and matching init/runtime image digests.
3. Through the k8s lane's Make target, create a uniquely named one-off Job from
   `radar-refresh-pv`. Respect the keyring `flock` and avoid the 05:17 UTC run.
   Select public PDFs with unused input identities or record durable skips.
4. Record per-document model receipts, JSON/profile/provenance acceptance,
   six completed durable stages, PG projection, duration and Job outcome.
   Primary acceptance requires an actual `gpt-6-astra / low` call.
5. Create a second one-off Job with `REFRESH_FORCE_FALLBACK=1` set on that Job
   only. Keep its own receipt: Gemini low, reason `forced`, zero Astra calls.
   The changed policy identity prevents reuse of the primary extraction.
6. Require both checks before production. A quality refusal is a failed
   acceptance, never a reason to silently rerun through another model.

## Production promotion (k8s lane and i-cond)

1. With owner GO in the k8s lane, verify/create production runtime and bootstrap
   Secrets, the writable `radar-refresh-keyring` PVC, both account enrollments,
   dedicated S3 credentials and 768Mi workload headroom. Check the actual OVH
   production context; historical Scaleway inventory is not production proof.
2. Set GitHub variable `REFRESH_CRONJOB_PROD_ENABLED=true` after prerequisites.
   Create the release `v*` tag on the accepted merged commit. Approve the
   `production` environment gate if required. `build-push-images.yml`'s
   `promote-prod` job deploys the overlay using the release's exact API digest.
3. Verify PV is active, legacy scrape/projection remain suspended, the six
   model values are low-effort Astra/Gemini, and both container images match.
4. Run the authorized one-off acceptance, then inspect the next scheduled Job.
   Retain state keys, safe receipts, accepted/refused counts and durations.

## Rollback and quota watch

Rollback criteria: wrong release/model, exposed secret, repeated failed Jobs,
loss of provenance/quality enforcement, canonical/PG divergence, or inability
to use Gemini after an Astra transport failure. K8s first suspends the PV job
and handles any active Job deliberately. Restore the previous accepted CronJob
digest and policy together (old Gemini code does not know these fallback vars).
`rollback.yml` accepts `environment`, `failed_ref`, `reason` and rolls back
Deployments only: it does **not** undo CronJobs, published S3 graphs or PG data.
Use the stored canonical backup/application receipt for an owner-approved data
recovery if publication occurred; never presume image rollback restores data.

Benchmark quota observation supplied by owner: 79% of the Codex week consumed
at 2026-09-17 04:15Z; reset 2026-09-22T13:12Z. Refresh this measurement before
promotion and monitor quota/429 receipts daily. Expect Gemini fallback while
Codex is unavailable, with the document circuit after three consecutive quota
switches in a multi-document cycle. Alert on fallback failure or quality refusal;
fallback's measured benchmark acceptance was 85/100, not Astra's 100/100.
