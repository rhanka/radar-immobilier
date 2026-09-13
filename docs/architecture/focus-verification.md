# Focus dossier verification — 2026-09-13

Documentation-only worktree: `docs/architecture-platform`.

| Check | Result | Boundary |
| --- | --- | --- |
| Docker build | PASS; portable HTML approximately 1.02 MB | Vite warns about a >500 kB bundle; intentionally one offline artifact |
| Mapping / response / provenance regression suite | 8/8 PASS | Five Mermaid graphs: 87 node occurrences, 103 edges, 13 subflows; repeated IDs are not new physical resources |
| Complete nested diagrams | 5/5 PASS at 18 viewport positions | All leaves, edges and original-ID parentId boxes rendered simultaneously; navigation only zooms |
| Mermaid visual render | 5/5 PASS, including four diagrams in the embedded architecture source | Exact text checks for every node, group and labelled edge; strict SVG, source hashes, scripts/foreignObject removed; HTTP(S) blocked during prerender |
| Service icons / repository attribution | 100/100 leaf/group occurrences PASS | 19 original SVG pictograms; service + repo + role inside each box; explicit external/unassigned cases and shared-ID consistency |
| Card readability | PASS text parity and card/header overflow checks in every view | Visual inspection of PostgreSQL card, MinIO subflow and rendered Mermaid; dense overview still requires zoom |
| Shared resource navigation | PASS | `PP-DB` retains identity when moving infrastructure → PV view; other store identities checked structurally |
| Geometry | PASS node separation, parent bounds, orthogonality and unrelated-node clearance | Edge/label/arrow overlap is **not** globally certified |
| Full-screen / Escape | PASS | Documentation canvas only |
| Source dialog and local notes | PASS | Embedded reviewer evidence and rendered diagrams; local drafts, not approval |
| Option cards and JSON | PASS A/B/C selection, exact comment, all options, persistence, selection clearing | DS Tile/Radio pattern; no owner option preselected |
| Actual clipboard | PASS in isolated context, previous clipboard restored | Read-back verifies selected B, exact comment, three options and draft status; denial handling also tested |
| Desktop / mobile | PASS at 1440×1100 and 390×844 | No page horizontal overflow; diagrams retain pan/zoom |
| Offline file navigation | PASS with HTTP(S) blocked | Zero external requests and zero runtime exceptions |
| Harness scope check | PASS C2 | No application or infrastructure implementation |
| Independent review | Codex D1 completed, six findings reconciled in D2; D3 adds owner-requested presentation controls | Opus could not run due to weekly limit; no consensus or final independent reapproval |
| Service-presentation re-review | [Selection failed](focus-service-review.md), no leg dispatched | Exact author model/effort unavailable; local test success is not an independent verdict |

Browser checks run on the isolated documentation Chromium session. Generated
screenshots are ignored files under `focus/`. They are not live application UAT.
The build manifest contains hashes for architecture, proposal, dossier, French
presentation, option definitions, reference Focus node, reused native router,
local service renderer and embedded inputs.

The September 13 missing-label regression was reproduced before correction:
all 25 infrastructure leaf labels disappeared because Mermaid 11 emitted
`foreignObject` despite the flowchart-only setting, and sanitization removed it.
Setting **global** `htmlLabels:false` produces SVG text without relaxing the
sanitizer. Node-count-only checks could not detect that failure; exact text checks
now cover the built SVG and both final UI render paths. No Mermaid source label
was shortened to make the check pass.

No Kubernetes mutation, object migration, database write, product package upgrade,
production action, root-checkout edit, merge or remote publication was performed.
The dossier remains **INCOMPLETE / presentation only**, independently of renderer
test success: runtime production evidence and owner/credential criteria still matter.
