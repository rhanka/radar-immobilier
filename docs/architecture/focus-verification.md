# Focus dossier verification — D6 — 2026-09-13

Documentation worktree: `docs/architecture-platform`.

| Check | Result | Boundary |
| --- | --- | --- |
| Token audit | PASS | Exact 2026-08-10 00:00−04 → 2026-09-14 00:00−04 window; Claude/Codex deduplicated |
| Static tests | 9/9 PASS | Mapping, nested bounds, exact edges, decisions JSON, provenance |
| Architecture views | 8/8 PASS | 232 leaf nodes, 232 edges, 39 nested subflows |
| Three-state entry | PASS | Default `target-1`; Avant → Transition effective → Après T2 → Après cible |
| Mermaid | 8/8 PASS | Strict sanitized SVG; all node/group labels retained; network blocked |
| Native SvelteFlow | PASS at 47 viewports | Every node/edge/`parentId` subflow simultaneous; no clipping |
| Service icons / provenance | 271/271 occurrences | Every leaf and parent maps to service plus repo/evidence |
| DOCS owner rule | PASS | Prod SCW 59,017 keys+hashes is exact canonical reference; surplus PP excluded |
| Browser | PASS | 1440×1100 + 390×844; offline Focus; zero external requests/runtime errors |
| Clipboard | PASS | D6 JSON read back; no option; exact fixed facts and amounts |
| Report PDF | PASS | A4, 5 pages, tagged, no JavaScript; required period/corpus/total text extracted |
| Report HTML | PASS | Static state strip plus effective and final Mermaid SVGs |
| Diff | PASS | `git diff --check` |

Replay:

```sh
make -f docs/architecture/focus/Makefile tokens test build browser clipboard report-check ENV=test-architecture
```

The effective transition claims only what is observed: Graphify 0.18.0 and Luna
high selection, a first Kubernetes failure before LLM on an HTML input, RAW OVH
parity/rebind, DOCS provisioning/inventory and committed copy tooling. It does
not claim a successful LLM run, DOCS copy/parity/rebind, completed production
migration or T3 start.

DOCS converges through manifest diff → exact production canonical set → guarded
selective copy → 59,017 keys/hash equality on OVH prod and preprod → recovery
proof → recoverable removal of all MinIO. The 144,193-object preprod population
is not a source of truth and its surplus is not migrated. SCW TEM remains.

Billing is fixed to August 10 through September 13 inclusive (35 days / 840 h).
One b3-8 at 0.082 CAD/h projects to 68.88 CAD; two/three-node platform costs are
excluded. The measured LLM allocation is 251.215438 CAD and the indicative sum
is 320.095438 CAD. The longer correct window is not forced downward against the
logs; uncertainty and prior-method reuse are explicit.
