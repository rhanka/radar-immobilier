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
- `P0C_APPLY_HOOK`: absolute executable deployment adapter supplied/reviewed by the conductor, mounted read-only.

The hook receives `<inputs|results> <prepare|open|close>`. `prepare` closes old public admission and selects/waits for
the staged configuration from the table. `open` opens the selected strict binding (the input target migrates the
policy row immediately before this call). `close` closes write admission after **any** failed apply/proof. It must
never restore r2, delete receipts or reopen a permissive route. For input qualification, preserve private probe
access to the real old instance. For results, preserve the CAS/envelope-1 binding and migrate only qualified
connections to the v2 binding. The repository intentionally supplies no default deployment adapter.

```sh
make -f tools/mcp-p0c-activate.mk preprod-switch-inputs ENV=preprod
# Accept scripted + real Claude input evidence; then qualify the restricted v2 candidate.
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
