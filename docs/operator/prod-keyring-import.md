# Production Keyring Account Import (Operator Runbook)

Controlled operator path to import a single enrolled OAuth seat account
(`muse`, `codex`, or `cloud-code`) from the owner's local encrypted keyring into
the production `radar-refresh-keyring` PVC (`namespace: radar-immobilier`).

OAuth seat credentials cannot live in GitHub or flow through automated CI/CD.
This operator path is declared under `operatorPaths` in
`deploy/ci/prod-cd-paths.json` and audited in
`docs/operator/manual-operations-log.md`.

## Prerequisites

1. **Owner GO**: explicit Product Owner authorization for the target transport (`muse` / `muse-wonder-1.0` classification fallback, `codex`, or `cloud-code`).
2. **Matching owner keyring**: local `0700` directory (`KEYRING_SOURCE_DIR`) holding the encrypted account and the same master `.key` as the production PVC (`account-import.mjs` aborts before any write on `.key` mismatch).
3. **Immutable release digest**: `IMPORT_IMAGE_REF` pinned to the exact live `ghcr.io/rhanka/radar-api@sha256:<64-hex>` digest served in production.
4. **Scoped kubeconfig**: operator `KUBECONFIG` targeting `https://hlhedx.c1.bhs5.k8s.ovh.net` with a non-preprod context and namespace `radar-immobilier` (or unset). Never read or echo `KUBECONFIG` or any Secret contents.
5. **No refresh running**: `run-keyring-import-prod` refuses if any `radar-refresh-pv` pod (`app.kubernetes.io/instance=radar-refresh-pv`) is `Pending`, `Running`, or `Unknown` in `radar-immobilier`. Run between scheduled prod sweeps (`05:00`, `11:00`, `17:00`, `23:00` UTC).

## Step 1 — Pre-check owner keyring without reading secrets

Inspect public metadata only (provider, transport, `ownerScopeRef`, status):

```sh
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk keyring-summary \
  LOCAL_IMAGE=ghcr.io/rhanka/radar-api@sha256:<prod-digest> \
  KEYRING_SOURCE_DIR=<owner-keyring-dir> \
  ENV=prod
```

Confirm exactly one account exists for the target transport (e.g. `provider: "muse"`, `transport: "muse"`) matching production's `REFRESH_OWNER_SCOPE_REF`.

## Step 2 — Render the ephemeral import manifest (outside git, mode 0700)

Create an isolated `0700` temporary directory outside the repository and any
git work tree, then render the manifest targeting `namespace: radar-immobilier`:

```sh
RENDER_DIR="$(mktemp -d)"
chmod 700 "$RENDER_DIR"
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk import-keyring-account-prod \
  IMPORT_TRANSPORT=muse \
  IMPORT_IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:<prod-digest> \
  IMPORT_SOURCE_DIR=<owner-keyring-dir> \
  IMPORT_RENDER_OUT="$RENDER_DIR/import-muse-prod.yaml" \
  ENV=prod
```

`import-keyring-account-prod` verifies `0700` ownership, refuses symlinks or
existing files, pins the immutable image digest and `IMPORT_TRANSPORT`, and
verifies `namespace: radar-immobilier`.

## Step 3 — Execute the guarded production import

```sh
make -f deploy/k8s/refresh-cronjobs/refresh-018.mk run-keyring-import-prod \
  KUBECONFIG=<prod-kubeconfig-path> \
  IMPORT_RENDER_OUT="$RENDER_DIR/import-muse-prod.yaml" \
  PROD_CONFIRM=1 \
  ENV=prod
```

What `run-keyring-import-prod` enforces:

- `guard-prod`: checks `ENV=prod`, API server, non-preprod context, context
  namespace (`radar-immobilier` or unset), non-preprod caller identity
  (`auth whoami`), and live `namespace/radar-immobilier` +
  `serviceaccount/radar-app`.
- Refuses without `PROD_CONFIRM=1` or if the render is not targeted at
  `radar-immobilier`.
- Refuses if any `radar-refresh-pv` pod is active (`Pending`, `Running`,
  `Unknown`) in `radar-immobilier`.
- Uses `kubectl create -f` (never `apply`, avoiding `last-applied-configuration`
  carrying the Secret), scrubs `kubectl` stderr on create failure, waits for
  Job completion under `flock` + `0700`/`0600` (`find -L`) permission
  normalization, prints the pseudonymized JSON result, and **always** runs
  `cleanup-keyring-import-prod` on exit (deleting the remote Job, Secret, and
  ConfigMap, and shredding the local render file).

## Step 4 — Verification without reading secrets

1. Confirm the pseudonymized Job log emitted by Step 3:
   ```json
   {"status":"imported","transport":"muse","account":"acct-<10-hex>","replaced":[],"accounts":3}
   ```
2. Confirm zero residual import objects remain in `radar-immobilier`:
   ```sh
   kubectl --kubeconfig <prod-kubeconfig-path> -n radar-immobilier get \
     job/radar-refresh-keyring-account-import \
     secret/radar-refresh-keyring-account-import \
     configmap/radar-refresh-keyring-import-script \
     --ignore-not-found
   ```
   Expected output: empty.
3. Confirm the local render file is gone and remove the empty temp directory:
   ```sh
   rmdir "$RENDER_DIR"
   ```
4. Observe the next scheduled `radar-refresh-pv` cycle (logs or
   `refresh/018/sweep/latest.json`) to verify classification fallback resolves
   without `no-route`.

## Step 5 — Cleanup fallback and rollback

- **Interrupted run / leftover objects** (idempotent, shreds local render first,
  confirms prod identity before remote deletion):
  ```sh
  make -f deploy/k8s/refresh-cronjobs/refresh-018.mk cleanup-keyring-import-prod \
    KUBECONFIG=<prod-kubeconfig-path> \
    IMPORT_RENDER_OUT="$RENDER_DIR/import-muse-prod.yaml" \
    ENV=prod
  ```
- **Rollback of an imported account**: `account-import.mjs` only touches
  accounts of the imported `IMPORT_TRANSPORT` for the matching
  `REFRESH_OWNER_SCOPE_REF`; accounts of other transports (`codex`,
  `cloud-code`) remain byte-for-byte untouched. To replace a faulty account for
  the same transport, re-enroll a valid seat locally, verify with
  `keyring-summary`, and re-run Steps 2–3 (which atomically replaces the
  transport's entry in the runtime PVC). To disable Muse fallback entirely,
  revert the CronJob env via normal GitHub Actions CD (`refresh-cronjobs-prod`).

## Mandatory entry template for `docs/operator/manual-operations-log.md`

Append an entry on the same day after running Step 3:

```markdown
### YYYY-MM-DD — Production refresh keyring import (`<transport>`)

- **Who**: Cluster operator (`i-cond` session, tenant-admin kubeconfig).
- **When (UTC)**: `YYYY-MM-DDTHH:MM:SSZ`.
- **What**: Ephemeral `Job/radar-refresh-keyring-account-import`, `Secret/radar-refresh-keyring-account-import`, and `ConfigMap/radar-refresh-keyring-import-script` in namespace `radar-immobilier`, updating `PVC/radar-refresh-keyring` for transport `<transport>`.
- **Command**:
  ```sh
  make -f deploy/k8s/refresh-cronjobs/refresh-018.mk import-keyring-account-prod \
    IMPORT_TRANSPORT=<transport> IMPORT_IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:<digest> \
    IMPORT_SOURCE_DIR=<redacted> IMPORT_RENDER_OUT=<tmp>/import.yaml ENV=prod
  make -f deploy/k8s/refresh-cronjobs/refresh-018.mk run-keyring-import-prod \
    KUBECONFIG=<redacted> IMPORT_RENDER_OUT=<tmp>/import.yaml PROD_CONFIRM=1 ENV=prod
  ```
- **Diff summary**: Imported `<transport>` account (`acct-<10-hex>`, replaced `<count>`, total accounts `<N>`) into `PVC/radar-refresh-keyring` with no active `radar-refresh-pv` pod. Verified zero residual Job/Secret/ConfigMap objects post-cleanup; other transports untouched.
- **Owner GO (reference)**: Product Owner GO (`<directive/PR reference>`, `YYYY-MM-DD`).
- **Planned CD return**: N/A — OAuth seat credentials stay outside git/CD by policy (`operatorPaths` in `deploy/ci/prod-cd-paths.json`, runbook `docs/operator/prod-keyring-import.md`).
```
