# Gemini medium refresh acceptance — 2026-09-16

## Runtime and measured local cycle

Implementation SHA: `d77f6132c4ce9cca30268adf507ee1061b86b2b7`.
The CronJob imports `@sentropic/llm-mesh-refresh`, previously 0.19.0;
both its adapter and encrypted keyring now resolve to 0.19.2.
The ordinary `@sentropic/llm-mesh` dependency remains unchanged at 0.19.2.
An HTTP-boundary regression test proves that the account catalogue resolves
`gemini-3.8-flash` + medium to `gemini-3.8-flash-tiered` with
`thinkingLevel: MEDIUM`, and rejects an account offering only low.

The output ceiling is 32768 tokens, matching the Gemini campaign ceiling;
4096 risks truncating a complete municipal PV. Maximum attempts remains one.
No dependency on pending PR #695 / mesh 0.19.3 was needed for the successful
cycle. Its MAX_TOKENS-to-length correction remains outside this change.

Local real-provider acceptance: **1/1 documents accepted**, one Gemini call,
2026-09-16 02:13:04.611Z–02:13:47.279Z. See [receipt-v2.json](receipt-v2.json).
The original public Waterloo PDF was downloaded and its fixture SHA verified.
The actual `runPvRefresh` pipeline used Poppler, the current v9 profile,
Gemini, isolated MinIO and PostgreSQL, with a fresh empty canonical baseline.
All six durable stages completed; 11 nodes were projected: 2 Bylaw,
6 DesignationEvent, 1 Source and 2 Zone. The expected bylaw 26-956-2 and
resolution 26.08.22.1 were found together. **No explicit Signal node was
produced**; this is document/profile/provenance acceptance, not a UI Signal
acceptance or a Kubernetes scheduled-run proof.

The test container was capped at 768Mi, Node heap 512Mi. Completion proves
this document fits; it does not establish a peak-RSS bound for larger PDFs.
The source keyring was read-only; a test-only AES-GCM reader avoided the
package's chmod-on-read, and refreshed account material lived only in memory.
No source keyring mutation or credentials copied into artifacts.

Commands from the existing lane (ENV last):

```sh
make -f .remote/mep-703.mk e2e ENV=test-mep-703
make test-api SCOPE='src/services/graph/refresh-mesh.test.ts src/services/graph/refresh-state.test.ts' API_PORT=8873 UI_PORT=5373 MAILDEV_UI_PORT=1173 ENV=test-mep-703
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=test-mep-703
make typecheck API_PORT=8873 UI_PORT=5373 MAILDEV_UI_PORT=1173 ENV=test-mep-703
make lint API_PORT=8873 UI_PORT=5373 MAILDEV_UI_PORT=1173 ENV=test-mep-703
```

The `.remote` acceptance harness and inspection scripts are local evidence,
not production code. Mocked integration tests remain separate from this receipt.
After review, commit `8edf8c7f` additionally binds Gemini catalogue discovery to
the run's abort signal. All 101 refresh unit/integration tests, typecheck and lint
pass after that fix. The live receipt predates this cancellation-only correction;
it is not relabelled as a live run of the later commit.

## Production promotion path and outstanding infrastructure

Merging triggers image build / preproduction deployment. Production requires
a `v*` tag, the `production` environment gate and repository/environment
variable `REFRESH_CRONJOB_PROD_ENABLED=true`. The repository variable was
absent when inspected; environment-level override is unverified. The existing
`build-push-images.yml` promote-prod job then applies this overlay, pinned to
the **same API digest** as the release. No manual apply is inherently needed.
Only `radar-refresh-pv` is active; legacy scrape/projection remain suspended.

If k8s chooses manual application, its owner must give GO **in that lane's
session** after prerequisite checks. Prepared commands, NOT executed here:

```sh
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk render-prod IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:<accepted-release-digest> RENDER_OUT=<private-render-path> ENV=prod
# Run through the k8s lane's Make target, after checking the OVH context:
kubectl --kubeconfig <authorized-OVH-prod-kubeconfig> -n radar-immobilier apply -f <private-render-path>
```

Measured access boundaries:

- Current context `poc-979c11ad-9f84-4847-a334-c42a5e797976` is Scaleway.
  Prod quota reports memory 0/3Gi and PVCs 2/2, not the presumed 768Mi free.
  Only the two legacy suspended CronJobs exist. Missing resource names:
  `radar-refresh-runtime`, `radar-refresh-keyring-bootstrap`,
  `radar-refresh-keyring` PVC, `radar-scrape-s3-credentials`.
  Do not mistake these observations for the active OVH production state.
- `~/.kube/ovh.conf` reaches the expected OVH API but is a geo deployer:
  Immo secrets, quotas, PVCs and CronJobs are Forbidden.
- `~/.kube/radar-immobilier-preprod-cert-ro.kubeconfig` reads preprod CronJobs:
  PV active, legacy jobs suspended, image `4e3a4db`. It cannot create Jobs,
  inspect Secrets or PVCs. A preprod Job-capable kubeconfig is missing.
- `Run one-shot job` currently targets production only, with no refresh option;
  it was not dispatched. Last inspected CD run 34997388199 succeeded at
  `4e3a4db8f71fe4824bf9aa9f166d1d47b95211c4`.

K8s lane must verify the named runtime/bootstrap secrets, their required key
names, an enrolled Gemini account's entitlement, writable keyring PVC capacity,
dedicated S3 credentials and 768Mi headroom on **OVH production**. Only names
may appear in receipts. No cluster production mutations were performed here.

This PR supersedes #682: its causal-only activation and PVC inclusion were
reused; divergent history and unnecessary legacy scrape resource bumps were not.
