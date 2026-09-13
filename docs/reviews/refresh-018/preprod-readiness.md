# Preproduction activation readiness — read-only observation

Observed 2026-09-13 around 15:38 UTC. No cluster object or credential was changed.

## Correct read principal

`~/.kube/ovh.conf` currently authenticates as `system:serviceaccount:geo:ci-deployer`;
its denial for Immo workloads was a principal/scope mismatch, not evidence of a
missing deployment. The existing `~/.kube/radar-immobilier-preprod-cert-ro.kubeconfig`
authenticates as `system:serviceaccount:radar-immobilier-preprod:cert-ro`.
Both configurations target the same OVH BHS5 API endpoint, verified from their
server fields only. Neither kubeconfig nor the current context was modified.

The Immo read principal can read deployments and CronJobs. It cannot list PVCs
or cluster storage classes. Production access was not inferred from these reads.

## Observed workloads

| Workload | Observed state |
| --- | --- |
| `radar-api` | One ready replica; `ghcr.io/rhanka/radar-api:8e18f01` |
| `radar-immo-mcp` | One ready replica; same API image |
| `radar-ui` | One ready replica; `ghcr.io/rhanka/radar-ui:8e18f01` |
| `radar-refresh-scrape` | Unsuspended; `17 3 * * *`; last successful time `2026-09-13T06:13:54Z`; API image `8e18f01` |
| `radar-refresh-projection` | Unsuspended; `30 4 * * *`; last successful time `2026-09-11T04:30:13Z`; API image `8e18f01` |
| `radar-consistency-snapshot` | Suspended; `45 4 * * *`; no last-success value; API tag `latest` |

These are the existing workloads, not the new Graphify 0.18 implementation.
Their success timestamps do not establish fresh typed-Signal/PDF delivery.

## Accepted non-blocking limitation

The installed refresh mesh remains 0.19.0. If its provider stream terminates abruptly, the refresh
fails closed with no accepted extraction or publication; the next bounded invocation or scheduled
cycle resumes from hash-checked durable state. In-process retry normalization, mesh 0.19.1 and a
Graphify patch are explicitly outside T1 and are not preproduction activation gates. Graphify stays
at 0.18.0. The retained incident evidence is in `upstream-llm-mesh-blocker.md`.

## Still required before activation

- Complete the reviewed consumer code and isolated tests, then image qualification.
- Verify/provision the dedicated persistent keyring and cross-pod lock contract
  through the infrastructure owner; PVC/storage-class reads remain unavailable.
- Verify workload enrollment, egress, model access and real token rotation without
  publishing credential values. No provider call was performed in this audit.
- Retire independent projection scheduling at cutover, then prove the causal
  scheduled PV-to-Signal run and exact original-PDF evidence.
- Establish production-specific bindings and permissions separately.
