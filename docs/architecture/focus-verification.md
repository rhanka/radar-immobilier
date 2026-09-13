# Focus dossier verification — D5 — 2026-09-13

Documentation-only worktree: `docs/architecture-platform`.

| Check | Result | Boundary |
| --- | --- | --- |
| Exact exit command | PASS | `make -f docs/architecture/focus/Makefile test build browser clipboard ENV=test-architecture` |
| Docker build | PASS; portable HTML 1,492,597 bytes | Vite warns about a >500 kB bundle; one offline artifact is intentional |
| Mapping / instructions / provenance | 9/9 PASS | Eight graphs: 210 node occurrences, 208 edges, 37 subflows; repeated IDs remain the same resources |
| Complete nested diagrams | 8/8 PASS at 45 viewport positions | All leaves, edges and original-ID `parentId` boxes remain simultaneous; navigation only changes the viewport |
| Default visual entry | PASS: `target-3` | Existant → T1 → T2 → T3 is selectable above the canvas; complete target is labelled **PROPOSED / NOT DEPLOYED** |
| Mermaid visual render | 8/8 PASS | Exact node/group/labelled-edge text; strict sanitized SVG; HTTP(S) blocked during prerender |
| Source parity | PASS | Four current-state and three transition-target source diagrams render in evidence dialogs; T1 detail remains a full eighth view |
| Service icons / repository attribution | 247/247 leaf/group occurrences PASS | Explicit service icon, repo role and evidence on every leaf and parent box; no target unknown-map fallback |
| Card readability | PASS | Text parity plus card/header width and height overflow checks in every view; dense overviews intentionally use pan/zoom |
| Stable resource navigation | PASS | `PP-DB` retains identity across views; new OVH roles use `PP-RAW-OVH` / `PP-DOCS-OVH`, never old MinIO IDs |
| Geometry | PASS node separation, parent bounds, orthogonality and unrelated-node clearance | Edge/label/arrow overlap is **not** globally certified |
| Full-screen / Escape | PASS | Documentation canvas only |
| Fixed instructions / JSON | PASS | No DIRECT/USAGE/CAPACITY radio; D4 `option:null`, exact owner hashes/comment, unknown period and amounts survive export |
| Actual clipboard | PASS in isolated context; previous clipboard restored | Read-back verifies D5, exact comment, prior null and current amount `null`; denial handling is also tested |
| Desktop / mobile | PASS at 1440×1100 and 390×844 | No page horizontal overflow; diagrams retain pan/zoom |
| Offline and served HTML | PASS | Latest dossier served at `http://127.0.0.1:5188/`; dated HTML renders offline; zero external requests/runtime exceptions |
| Dated evidence | PASS | HTML SHA-256 `fa1d29ea38795712027ed30df3811c4f2001419576deb4cc32d74f448b3bfdbd`; artifact-input hash `67ebcb54916cb46503fdb516131a93f08bd88a33620b8cb3ba9313f20d740a15` |
| Scope allowlist | PASS through the repository Make helper | Only allowed architecture, Focus, monthly-report and own-plan paths differ from D4 baseline |
| Independent D5 review | Not performed here | Owner prohibited agent launches; conductor owns any post-build review, with no consensus implied |

The first D5 build reproduced a Mermaid entity mismatch for `>` and the first
browser pass reproduced a three-pixel T1 stage-header overflow. Entity-aware
exact-text comparison and a shared 112 px native subflow header allowance fixed
the causes without weakening completeness, sanitization or overflow checks.
CDP page readiness now retries only the protocol's destroyed-context race; all
content assertions remain fail-closed.

The requested period ends at `2026-09-14T00:00:00-04:00`, but its real preceding
invoice/report start and unified September 13 data-capture cutoff remain unverified.
The one existing b3-8 rate is 0.082 CAD/h; period hours and amount remain unknown.
The 720 h / 59.04 CAD values are historical illustration only. LLM tokens were not
parsed and the previous actual invoice identity/tariffs remain evidence to obtain.

No Kubernetes mutation, object migration, database write, application implementation,
stack start, production action, root-checkout edit, Track write, agent launch, merge
or remote publication was performed. T1, T2 and T3 are architecture proposals, not
deployment claims; production private bindings and single-node safety remain unverified.
