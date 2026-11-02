# Artifact parity P0-C switchovers

Contract: `converged-r2.md` §2.5 items 1–6, whole §2.6, P0-A/P0-C acceptance.
P0-D's management UI and full nine-tool Claude/browser journey are the following conductor qualification.
This branch performs no deployment. Merging keeps `immo-artifacts.p0b.v1`, nonmandatory CAS, envelope 1.

## Deployment configurations

| Configuration on both API and MCP instances | Policy | Envelope | Tools |
| --- | --- | --- | --- |
| No new variables | `radar-c4-r2` | 1 | Seven P0b tools |
| `ARTIFACTS_PROFILE_REVISION=immo-artifacts.cas.v2` | `radar-c4-r3-artifacts-cas` | 1 | Seven tools; no part1 |
| `ARTIFACTS_PROFILE_REVISION=immo-artifacts.v2`, `ARTIFACTS_INPUTS_QUALIFIED=true`, `ARTIFACTS_RESULTS_QUALIFIED=true` | Same strict policy | 2 | Nine tools; qualified part1 |

The qualification variables are trusted deployment assertions. Set them for normal client traffic only after
the conductor accepts both switchovers, including the Claude evidence below. Use the restricted qualification
cohort/candidate binding to collect that evidence first; keep normal traffic on the qualified v1 binding.
Missing qualifications, unknown revisions, mismatched app/profile digests or inconsistent JSON assembly fail startup.
Profiles are captured at process/binding construction. Changing deployment configuration means creating/replacing
instances, never changing the projection of an admitted request or an existing MCP connection mid-response.
Keep an independently routed CAS/envelope-1 binding for existing connections during the results transition.

Apply `0029_artifacts_parity` through the normal migration journal before starting 0.2.6 instances.
It adds metadata and nullable release lineage without assigning historical authors or modification dates.
It does **not** migrate policy or enable tools. Fresh scopes initialize to the configured policy;
existing rows are never changed by `ON CONFLICT DO NOTHING`. Existing scopes require the explicit policy migration.

## All writers of the storage scope

| Entry point | Authority / status |
| --- | --- |
| Cookie HTTP `control-route.ts` → `control-route-startup.ts` | Shared `createArtifactControl` → `composeArtifactHost` → provider coordinator; publish/revert/delete CAS checked there. |
| MCP `artifact-binding.ts` → `registry/artifact-provider.ts` | Same host app/coordinator and transaction-bound host policy; explicit write scope; no caller-owned identity. |
| UI | No artifact publication client or direct artifact database writer exists; any control API client uses the cookie route above. Confirmation approval only updates the confirmation port. |
| Jobs / worker / administrative scripts | No artifact content, pointer, lifecycle or ACL writer exists outside the shared host. Preparation cleanup only sweeps provider intents/refs through its guarded cleanup ports. |
| Legacy restore/fork/promote/renew/upload routes | Unselected by every P0 profile; HTTP returns capability_unavailable and MCP never selects their handlers. |
| Published H5 business writes | `published-write-authority.ts` locks/revalidates the same policy and release; it mutates business data, not artifact content/pointers/ACL. Its policy constant follows the configured profile. |
| Policy administration | `migrateArtifactCasPolicy` is the sole forward activation migration. Exclusive UPDATE waits for shared policy locks, uses transaction-local lock_timeout, is replayable, and never restores r2. |

The policy participant reads the row `FOR SHARE` and checks the instance's expected revision in the coordinator
transaction. An old instance, or an old request resuming after the migration, cannot commit even with an old catalogue.
No path fills a strict omission from null or the current head. A dedicated historic P0b deletion decoder verifies
the old confirmation-bound hash only when a matching success receipt already exists; it can replay, never finalize.
Unchanged historic commands retain codec v1 and command identity. Incomplete historic results remain unknown.

## One operator command per switchover

First stage the schema and new code, warm candidate instances with admission closed, and prepare the conductor's
deployment adapter. No deployment credentials, cluster commands or environment files are embedded in these targets.
They run a disposable Node container, expose no ports, and always tear it down with `down -v --remove-orphans`.

Provide these variables from the operator's existing authenticated environment, never an environment file:

- `P0C_SCOPE`, `P0C_DATABASE_URL`: exact shared scope and a connection allowed to migrate its policy and read quota evidence.
- `P0C_COOKIE`, `P0C_MCP_TOKEN`: approved qualification principal, identical IdP subject for HTTP and MCP.
- `P0C_OLD_HTTP_BASE`: authenticated private endpoint of an actual old P0b instance, retained only for the input-switch proof.
- `P0C_V1_HTTP_BASE`, `P0C_V2_HTTP_BASE`: full control bases, normally under `https://preprod.immo.sent-tech.ca/api/v1/artifacts/control`, routed to the independently configured bindings.
- `P0C_MCP_URL`: the MCP URL of the binding under qualification; refresh/reconnect Claude's catalogue to that binding.
- `P0C_APPLY_HOOK`: absolute path of the reviewed adapter (`tools/make/p0c-apply-hook.sh`), mounted read-only at `/p0c-apply` in the container.
- `P0C_KUBECONFIG`: absolute path of an explicit preprod kubeconfig file (readable, never `~/.kube/config`), mounted read-only at `/kubeconfig` in the container. The hook refuses `~/.kube/config` (including via symlink or non-canonical path) and any namespace other than `radar-immobilier-preprod`.
- `KUBECTL_BIN` (optional, defaults to `command -v kubectl`): host kubectl binary, mounted read-only at `/usr/local/bin/kubectl` in the container. The container image carries node but no kubectl.
- `ARTIFACTS_INPUTS_QUALIFIED`, `ARTIFACTS_RESULTS_QUALIFIED`: set both to `true` in the operator environment only for the results switchover; leave them unset otherwise (the hook forwards them to the candidates only when set, unsets them explicitly when absent, and never defaults them to `true`).

The hook receives `<inputs|results> <prepare|open|close>`. `prepare` closes old public admission and selects/waits for
the staged configuration from the table. `open` opens the selected strict binding (the input target migrates the
policy row immediately before this call). `close` closes write admission after **any** failed apply/proof. It must
never restore r2, delete receipts or reopen a permissive route. For input qualification, preserve private probe
access to the real old instance. For results, preserve the CAS/envelope-1 binding and migrate only qualified
connections to the v2 binding.

## Deployment adapter `tools/make/p0c-apply-hook.sh`

The repository supplies one reviewed adapter (bash, no Python): pass its absolute path as `P0C_APPLY_HOOK`.
It uses exactly `kubectl --kubeconfig "$P0C_KUBECONFIG" -n radar-immobilier-preprod` for every call.
`P0C_KUBECONFIG` is required, `~/.kube/config` is refused, and any namespace other than
`radar-immobilier-preprod` is refused (prod is never touched). The env names set are exactly those the
code reads (`packages/artifacts-host/src/p0b-profile.ts:8-22`, shared by `radar-api` and `radar-immo-mcp`
via `packages/immo-mcp/src/registry/artifact-profile.ts:8`): `ARTIFACTS_PROFILE_REVISION`, and for the
results phase only `ARTIFACTS_INPUTS_QUALIFIED` / `ARTIFACTS_RESULTS_QUALIFIED`, forwarded solely from the
caller's own environment, never defaulted to `true`. Profiles are captured at process/binding construction,
so every env change is followed by `rollout status --timeout=300s`, and `open` verifies the served
`/profile` descriptor over HTTP with node (the disposable container always has node, no curl dependency).

Dry run first (prints every kubectl command and profile check, executes nothing):

```sh
P0C_DRY_RUN=1 P0C_KUBECONFIG=/path/to/preprod.kubeconfig \
  tools/make/p0c-apply-hook.sh results prepare
```

`inputs prepare` sets `ARTIFACTS_PROFILE_REVISION=immo-artifacts.cas.v2` on `radar-immo-mcp` and `radar-api`
and unsets both qualification vars, then waits for the rollout. `inputs open` re-checks the rollout and
verifies `P0C_V1_HTTP_BASE/profile` serves `cas.v2` strict envelope 1. `inputs close` unsets the revision
(back to the `p0b` default) and the qualification vars, then waits for the rollout.

Results keep the v1 binding alive on the live Deployments/Services while `-v2` candidates
(`radar-immo-mcp-v2`, `radar-api-v2` Deployments + Services) serve the qualification traffic. `results
prepare` labels the live pod templates `p0c-candidate=live`, waits for that rollout, narrows the live
Service selectors to labeled pods, applies the candidate Services (selecting `p0c-candidate=v2`), clones
the live Deployments into the candidates as JSON (renamed, labeled in selector and template,
server-assigned fields and `last-applied-configuration` stripped, component labels asserted),
sets `ARTIFACTS_PROFILE_REVISION=immo-artifacts.v2` plus the caller-passed attestations
on the candidates (and `RADAR_API_BASE_URL=http://radar-api-v2:3000` on the MCP candidate so the v2 stack
is isolated), then waits for the candidate rollouts. `results open` verifies `P0C_V2_HTTP_BASE/profile`
serves `immo-artifacts.v2` strict envelope 2 **and** `P0C_V1_HTTP_BASE/profile` still serves `cas.v2`
envelope 1. `results close` deletes the four candidate objects, removes `p0c-candidate` from the live
Service selectors (explicit null merge patch), re-asserts `cas.v2` on live only if either live
Deployment drifted, waits for the live rollout, and re-verifies the v1
profile. `results prepare` is idempotent and safe to re-run after any CD run. Close never unsets the live revision, never touches `host_policy`, never deletes receipts or
data, and never touches `PREPROD_CD_ENABLED` / `BASCULE_SCHEDULE_ENABLED` or the bascule workflows.

The conductor must route `P0C_V2_HTTP_BASE` to the `radar-api-v2:3000` Service and the qualification
`P0C_MCP_URL` to the `radar-immo-mcp-v2:8848` Service (operator-owned ingress, outside this adapter),
and must delete the `-v2` candidates after the results qualification migrates traffic to the v2 binding.

Decision record (v1 binding preserved during results): an in-place results switch cannot satisfy
converged-r2 §2.6 — `packages/immo-mcp/scripts/p0c-switch.ts:77-80` requires the v1 HTTP base to still
serve `cas.v2` while the v2 base serves `immo-artifacts.v2`, and §2.6 requires existing connections to
keep their v1 projection until migrated. The candidate mechanism above is the smallest one that passes
that proof: same scope/policy row and data, separate Deployments/Services, component labels preserved
so the postgres/traefik NetworkPolicies (`deploy/k8s/70-networkpolicy.yaml`,
`deploy/k8s/71-mcp-account-networkpolicy.yaml`) keep matching, with only the additive `p0c-candidate`
label distinguishing the bindings.

CD persistence: a later preprod CD rollout does not silently drop the hook's env. `deploy/ci/reconcile-preprod.sh`
reconciles `radar-api` server-side (field-manager `cd-preprod`): entries the manifest omits but another
manager (`kubectl set env`) owns — such as `ARTIFACTS_PROFILE_REVISION` — are preserved, not deleted.
`radar-immo-mcp`'s spec is not reconciled at all (only its ConfigMap plus an annotation roll), and the
`set image` steps (`build-push-images.yml`, deploy-preprod job) patch only the image. The candidates are
invisible to the CD entirely.
A CD rollback (`kubectl rollout undo`, armed only on deployment-health failure) restores the N-1 pod
template verbatim, which drops a hook-set `ARTIFACTS_PROFILE_REVISION` that the N-1 revision never
carried; likewise a CD run inside the results window updates the live images without updating the
`-v2` candidates. Exact conductor check after any CD run that touches preprod — rollback included —
before collecting qualification evidence:

```sh
kubectl --kubeconfig "$P0C_KUBECONFIG" -n radar-immobilier-preprod get deploy/radar-api deploy/radar-immo-mcp \
  -o 'jsonpath={range .items[*]}{.metadata.name}={.spec.template.spec.containers[*].env[?(@.name=="ARTIFACTS_PROFILE_REVISION")].value}{"\n"}{end}'
```

`ARTIFACTS_PROFILE_REVISION` must still hold the active revision (`cas.v2` on live after inputs,
`v2` on the candidates after results). If it does not, re-run the hook's `prepare` for the active
phase (`results prepare` re-clones the candidates from the current live manifests, so it also
reconverges candidate images after a CD image bump, and is safe to re-run at any time). If a future
CD change starts reconciling the `radar-immo-mcp` spec, move the revision into the preprod overlay
at that point (today the overlay carries no `ARTIFACTS_*` keys, so nothing declarative would
override them either way).

```sh
export P0C_APPLY_HOOK="$PWD/tools/make/p0c-apply-hook.sh"
export P0C_KUBECONFIG=/path/to/preprod.kubeconfig  # explicit file, never ~/.kube/config
# Optional: export KUBECTL_BIN=/path/to/kubectl  (defaults to `command -v kubectl`)
make -f tools/mcp-p0c-activate.mk preprod-switch-inputs ENV=preprod
# Accept scripted + real Claude input evidence; then qualify the restricted v2 candidate.
export ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true
make -f tools/mcp-p0c-activate.mk preprod-switch-results ENV=preprod
```

Each command creates an unchanged v1 publication before applying the switch and checks its receipt afterwards:
same release and no extra publication quota. Input activation additionally probes the actual old instance for a
403 on a new write. Results activation verifies the surviving v1 binding still advertises CAS/envelope 1.
Both check the active descriptor/catalogue, exact HTTP 428 and MCP precondition code/message/details/isError,
guide descriptor/placement and first publication with explicit null after a current-release read.
Qualification pages stay in the scope as evidence; normal human-confirmed deletion can remove them later.
Failure exits nonzero and calls the adapter's close action. Never roll policy back; correct the strict configuration.

## Acceptance evidence and remaining human qualification

Automated PostgreSQL proofs run on a fresh migrated store and a simulated historic v1 receipt copy. They cover
an old instance, a request suspended across the switch, shared/exclusive policy-lock ordering, replay across both
switches, incomplete receipts, exact omission refusal in both envelopes, explicit null after read, CAS races,
metadata/ACL-preserving revert, retained/purged releases, ambiguous edits, and a real committed transaction whose
COMMIT acknowledgement is lost. The latter reconciles with the identical key, one release and one quota charge.
Unit coverage also freezes an in-flight v1 projection while a new binding selects v2 and corrupts the independent
manifest to prove startup refusal. MCP tests use both the binding and the real JSON-RPC transport.

The conductor still must supply real Claude conversations: an already-open conversation resuming an existing
page after catalogue refresh; Claude exploiting a concurrent conflict's details to reconcile edits; and Claude
reconciling `commitState:unknown` with the **same key and unchanged command**. Machine tests cannot sign those
proofs. Do not activate part1 for normal traffic until both qualifications are accepted. Then run P0-D's nine-tool
journey, source budget, stable/pinned isolation, reader revocation and DS management UI acceptance before claiming full P0.

```sh
make -f tools/mcp-p0b.mk integrity ENV=test-mcp-p0c
make -f tools/mcp-p0b.mk verify ENV=test-mcp-p0c
make -f tools/mcp-p0b.mk integration ENV=test-mcp-p0c
make -f tools/mcp-p0b.mk test-api ENV=test-mcp-p0c
make -f tools/mcp-p0b.mk down-api ENV=test-mcp-p0c
make -f tools/mcp-p0b.mk down ENV=test-mcp-p0c
```

`test-api` runs the full API unit + integration command of Quality gates, with migrated PostgreSQL/PostGIS and MinIO.
The npm cache is a container-local scratch directory; no home npm cache or environment file is read.
