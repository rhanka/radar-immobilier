# Focus dossier verification — 2026-09-13

Documentation-only worktree: `docs/architecture-platform`.

| Check | Result | Boundary |
| --- | --- | --- |
| Docker build | PASS; portable HTML approximately 626 kB | Vite warns about a >500 kB bundle; intentionally one offline artifact |
| Mapping regression suite | 4/4 PASS | Five Mermaid graphs: 87 node occurrences, 103 edges, 13 subflows; repeated IDs are not new physical resources |
| Native scene navigation | 18/18 PASS in Chromium | Five root views + thirteen subflow views; actual `parentId` groups |
| Shared resource navigation | PASS | `PP-DB` retains identity when moving infrastructure → PV view; other store identities checked structurally |
| Geometry | PASS node separation, parent bounds, orthogonality and unrelated-node clearance | Edge/label/arrow overlap is **not** globally certified |
| Full-screen / Escape | PASS | Documentation canvas only |
| Source dialog and local notes | PASS | Embedded reviewer evidence; local draft saved/exportable, not an approval |
| Desktop / mobile | PASS at 1440×1100 and 390×844 | No page horizontal overflow; diagrams retain pan/zoom |
| Offline file navigation | PASS with HTTP(S) blocked | Zero external requests and zero runtime exceptions |
| Harness scope check | PASS C2 | No application or infrastructure implementation |
| Independent review | Codex D1 completed, six findings reconciled in D2 | Opus could not run due to weekly limit; no consensus or final independent reapproval |

Browser checks run on the isolated documentation Chromium session. Generated
screenshots are ignored files under `focus/`. They are not live application UAT.
The build manifest contains hashes for architecture, proposal, dossier, French
presentation, native Focus node/router and the complete embedded input set.

No Kubernetes mutation, object migration, database write, product package upgrade,
production action, root-checkout edit, merge or remote publication was performed.
The dossier remains **INCOMPLETE / presentation only**, independently of renderer
test success: runtime production evidence and owner/credential criteria still matter.
