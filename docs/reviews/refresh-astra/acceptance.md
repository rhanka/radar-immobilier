# Local acceptance and rollout boundary

The local acceptance uses two public PDFs: Waterloo 2026-08-18 municipal
minutes and Saint-Polycarpe 2026-01-19 agenda, selected before execution.
Their public URLs and SHA-256 values are retained in the JSON receipts.
The first comes from the #711 oracle; the second is the first document in
the frozen v101 corpus, not selected by model outcome.

The test harness runs the real `runPvRefresh`, Poppler, v9 profile/provenance,
MinIO and PostgreSQL. Its read-only keyring reader uses the existing AES-GCM
format without chmod, copying or writing the source keyring. Account updates
remain in process memory. Only active account counts and same-owner agreement
are emitted. One Codex account and one Cloud Code account were available.

Initial primary receipt at `7bf2d17f`: 2/2 accepted, Astra low, 144601ms and
122984ms. This predates exact-route and subsequent review hardening; it is
not relabelled as a final-commit proof.

Initial forced fallback: Gemini low generated and passed profile/provenance
for both documents (42003ms, 13660ms; zero Astra calls). Publication/projection
acceptance was 0/2: the local harness reset S3 baselines but retained earlier
Astra PG graphs, so the existing regression guard stopped projection. This
was a test-isolation error; no product guard was weakened. Corrected campaigns
use separate initially empty test databases and S3 buckets for primary and
forced fallback.

Corrected real campaigns: [primary receipt](receipt-primary.json) **2/2**,
Astra low, 171776ms and 123815ms; [forced receipt](receipt-fallback.json)
**2/2**, Gemini low, 25018ms and 10707ms, zero Astra calls. All six durable
stages completed for each document, including S3 publication and PG projection.
These are document/profile/provenance proofs, not a municipal-opportunity F1
benchmark or Kubernetes scheduling proof. Each receipt names the actual code
commit at launch; later terminal-refusal and resumed-counter hardening are
covered by regression tests, not relabelled as extra live calls.

Verification commands use `ENV=test-astra-703`, no host service ports, with
API/UI/Maildev reserved as 8893/5393/1193. `make typecheck` and `make lint`
reuse the test Compose volumes through `COMPOSE_RUN_API_NODEPS`; they run the
same workspace scripts as their standard targets. Harness CLI checks are
advisory scope/branch checks, not substitutes for actual test execution.

Read-only preprod observation on 2026-09-17: image `3cf4f69`, PV active,
legacy scrape/projection suspended. The cert-ro identity cannot create Jobs
or read Secrets/PVCs. GitHub repository variable `REFRESH_CRONJOB_PROD_ENABLED`
was absent. Production resources remain unverified by this code lane; k8s
must complete the runbook's prerequisites and sequential acceptance.
