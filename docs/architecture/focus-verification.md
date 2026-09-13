# Focus dossier verification — D8 — 2026-09-13

Documentation worktree: `docs/architecture-preprod-transition`.

| Check | Result | Boundary |
| --- | --- | --- |
| Token audit | PASS | Exact 2026-08-10 00:00−04 → 2026-09-14 00:00−04 window; Claude/Codex deduplicated |
| Static tests | 9/9 PASS | Mapping, nested bounds, exact edges, decisions JSON, provenance |
| Architecture views | 2/2 PASS | 72 leaf nodes, 80 edges, 13 nested subflows |
| Two-state entry | PASS | Default `asis-1`; Architecture AVANT → Architecture APRÈS |
| Mermaid | 2/2 PASS | Strict sanitized SVG; all node/group labels retained; network blocked |
| Native SvelteFlow | PASS | Every node/edge/`parentId` subflow simultaneous; no clipping |
| Service icons / provenance | 85/85 mappings | Every leaf and parent maps to service plus repo/evidence |
| DOCS owner rule | PASS | Preprod exact parity at 59,017 objects / 12,534,514,457 B; production reference unchanged |
| Browser | PASS | 1440×1100 + 390×844; offline Focus; zero external requests/runtime errors |
| Clipboard | PASS | D8 JSON read back; exact fixed facts, draft options and amounts |
| Report PDF | PASS | 14 pages: 4 A4 + 10 A3 landscape native diagram pages |
| Report HTML | PASS | Monthly narrative plus complete BEFORE/AFTER native captures |
| Diff | PASS | `git diff --check` |

Replay:

```sh
make -f docs/architecture/focus/Makefile tokens test build browser clipboard report-check ENV=test-architecture
```

The effective transition claims only the supplied evidence: Graphify 0.18.0 and
Luna high selection, a first Kubernetes failure before LLM on an HTML input,
and accepted preproduction RAW/DOCS OVH. DOCS parity is 59,017 objects /
12,534,514,457 bytes, manifest `52646a7b…0425`, failed 0. MinIO workload,
Service, 40 Gi data PVC and six NetworkPolicies are removed; the migration PVC
is retained and API/MCP/UI are 1/1.

Production T2 is still in progress under its independent parity/recovery/rebind
and removal gates. T3 remains gated until production T2 completes and the
post-cleanup capacity/placement baseline is remeasured. SCW TEM remains.

Billing is fixed to August 10 through September 13 inclusive (35 days / 840 h).
One b3-8 at 0.082 CAD/h projects to 68.88 CAD; two/three-node platform costs are
excluded. The measured LLM allocation is 251.215438 CAD and the indicative sum
is 320.095438 CAD. The longer correct window is not forced downward against the
logs; uncertainty and prior-method reuse are explicit.
