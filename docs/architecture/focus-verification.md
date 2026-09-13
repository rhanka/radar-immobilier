# Focus dossier verification — D5 — 2026-09-13

Documentation-only worktree: `docs/architecture-platform`.

| Check | Result | Boundary |
| --- | --- | --- |
| Exact exit command | PASS | `make -f docs/architecture/focus/Makefile test build browser clipboard ENV=test-architecture` |
| Docker build | PASS; portable HTML approximately 1.54 MB | Vite warns about a >500 kB bundle; one offline artifact is intentional |
| Mapping / instructions / provenance | 9/9 PASS | Eight graphs: 215 node occurrences, 214 edges, 37 subflows; repeated IDs remain the same resources |
| Complete nested diagrams | 8/8 PASS at 45 viewport positions | All leaves, edges and original-ID `parentId` boxes remain simultaneous; navigation only changes the viewport |
| Default visual entry | PASS: `target-3` | Existant → T1 → T2 → T3 is selectable above the canvas; complete target is labelled **PROPOSED / NOT DEPLOYED** |
| Mermaid visual render | 8/8 PASS | Exact node/group/labelled-edge text; strict sanitized SVG; HTTP(S) blocked during prerender |
| Source parity | PASS | Four current-state and three transition-target source diagrams render in evidence dialogs; T1 detail remains a full eighth view |
| Service icons / repository attribution | 252/252 leaf/group occurrences PASS | Explicit service icon, repo role and evidence on every leaf and parent box; no target unknown-map fallback |
| Card readability | PASS | Text parity plus card/header width and height overflow checks in every view; dense overviews intentionally use pan/zoom |
| Stable resource navigation | PASS | `PP-DOCS-LEGACY` is distinct from the empty fallback; new OVH roles never reuse old MinIO IDs |
| Geometry | PASS node separation, parent bounds, orthogonality and unrelated-node clearance | Edge/label/arrow overlap is **not** globally certified |
| Full-screen / Escape | PASS | Documentation canvas only |
| Fixed instructions / JSON | PASS | T1 BLOCKED, benchmark scores `null`, T2 MIGRATE+RETAIN/no-copy and T3 NO-GO survive export; period start and amounts remain null |
| Actual clipboard | PASS in isolated context; previous clipboard restored | Read-back verifies D5, exact comment, prior null and current amount `null`; denial handling is also tested |
| Desktop / mobile | PASS at 1440×1100 and 390×844 | No page horizontal overflow; diagrams retain pan/zoom |
| Offline and served HTML | PASS | Latest dossier served at `http://127.0.0.1:5188/`; dated HTML renders offline; zero external requests/runtime exceptions |
| Dated evidence | PASS | The generated manifest pins final HTML and input hashes without making this embedded verification source self-referential |
| Scope allowlist | PASS through the repository Make helper | Only allowed architecture, Focus, monthly-report and own-plan paths differ from D4 baseline |
| Independent D5 review | Not performed here | Owner prohibited agent launches; conductor owns any post-build review, with no consensus implied |

The final sync test first caught unescaped Markdown backticks in the JavaScript
presentation. Its first browser pass then caught a fourth Mermaid label segment
that the three-field Focus card joined with a visible separator. The minimal fixes
removed the syntax hazard and kept transition cards to three source segments;
the same fail-closed syntax, exact-text, completeness and overflow gates now pass.
The post-82b3b7c5 sync also caught one assertion whose expected Fable BLOCK/commit
order differed from the presentation; correcting that exact order restored 9/9.

The requested period ends at `2026-09-14T00:00:00-04:00`, but its real preceding
invoice/report start and unified September 13 data-capture cutoff remain unverified.
15:38Z/15:39Z are prior timestamped checks; later transition evidence has no exact
UTC cutoff. No monetary or token value was added.
The one existing b3-8 rate is 0.082 CAD/h; period hours and amount remain unknown.
The 720 h / 59.04 CAD values are historical illustration only. LLM tokens were not
parsed and the previous actual invoice identity/tariffs remain evidence to obtain.

No Kubernetes mutation, object migration, database write, application implementation,
stack start, production action, root-checkout edit, Track write, agent launch, merge
or remote publication was performed. T1, T2 and T3 are architecture proposals, not
deployment claims. T1 remains blocked pending Fable re-review, the five-PDF
non-simulated benchmark, a real-provider Signal and K8s acceptance; no model, Cloud
Code enrollment or benchmark score exists. llm-mesh 0.19.0 remains the target with
fail-closed Job failure and next-cycle durable resume; 0.19.1 is not a gate. T2 checkpoint
work remains under construction and still lacks object copy, parity, recovery,
cutover and deletion. T3 remains NO-GO until T2, rightsizing, constraint reconciliation
and a verified two-node step precede any one-node test.
