# Feature: Cross-repository architecture map

## Objective
- [x] Document immo, geo and poc-k8s components, access and current processing boundaries.

## Scope / Guardrails
- [x] September 13 owner update: dossier accompanies execution; refresh first, MinIO second, one b3-8 third. Implementation stays in scoped implementation branches.
- [x] Documentation only; no deployment, data mutation or application changes.
- [x] Worktree: `tmp/architecture-platform`, branch `docs/architecture-platform`.
- [x] Commands through Make; environment argument last; no application stack started.
- [x] Root checkout and other repositories remain unchanged.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/architecture.md`
  - `docs/architecture/**`
  - `docs/reports/architecture-monthly/**`
  - `plan/ARCH-BRANCH_docs-architecture-platform.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.track/**`
  - Other branch plans; application, infrastructure and other repositories.
- **Conditional Paths**:
  - None.
- [x] ARCH-EX1 — owner-requested monthly architecture/cost companion under docs/reports/architecture-monthly; root report sources read-only, no root-checkout or original-report overwrite; rollback by reverting companion changes.

## Feedback Loop
- [x] Use current remote immo/geo references and newer poc-k8s local HEAD; record provenance.
- [x] Distinguish live reads, declared configuration and future work.
- [x] Record the live OVH refresh / committed MinIO grounding destination mismatch.
- [x] Use the installed h2a FocusSnapshot renderer; document preview has no Track writes.

## Orchestration Mode (AI-selected)
- [x] Single documentation branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Standalone local documentation preview; existing application UAT is unaffected.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Read rules, inventory sources and establish scope.**
- [x] **Lot 1 — Architecture diagrams and evidence register.**
- [x] **Lot 2 — Render with h2a Focus and open the local HTML page.**
- [x] **Lot 3 — Verify Mermaid rendering, links and documentation diff.**
  - [x] Scope check and static syntax checks pass; all four diagrams render in Chromium.
  - [x] Browser checks: zoom, full-screen, Escape, seven navigation links; no page overflow at 1440px/390px.
- [x] **Lot 4 — Owner feedback: PV ownership and refactoring baseline.**
  - [x] Compare September full-auto design and current Graphify CAS work, not only the June refresh study.
  - [x] Show all four stages inside Immo ownership, the direct deterministic PG feed and atomic canonical projection.
  - [x] Distinguish the deployed paths from E1–E5 target and Geo's geographic contribution.
  - [x] Regenerate Focus HTML; Chromium renders four diagrams with zoom/full-screen/Escape and no desktop/mobile page overflow.
- [ ] **Lot 5 — Reconcile infrastructure and processing resource identities.**
  - [x] Obtain the owner-requested independent Gemini 3.8 High review via h2a run agy; verdict NEEDS CHANGES at 2ab8da2b.
  - [x] Add environment-qualified store identities and the live Geo PDF reader to the infrastructure overview.
  - [x] Map each Immo DB and object-store role to environment-qualified shared identifiers in both diagrams.
  - [x] Verify reader/writer arrows against source and whitelisted deployment configuration.
  - [x] Reuse Geo bucket/API identities in diagram 3; distinguish shared PDF reads from preprod normalized products.
  - [x] Regenerate Focus; verify 16 shared resource identities and all four diagrams in Chromium.
  - [x] Confirm the resource check rejects baseline 73762926 and passes the corrected document.
  - [x] Reconcile all ten independent findings against main/runtime; reject unproven live-outage and restore-target claims.
- [ ] **Lot 6 — Owner feedback: effective storage and eradication status.**
  - [x] Re-fetch main, check migration PRs and re-audit whitelisted live preprod bindings; #670 remains draft, MinIO still configured for API.
  - [ ] Obtain OVH production read-only evidence; never substitute the legacy SCW cluster.
  - [x] Exclude unobserved legacy paths from operational diagrams and regenerate the native Focus companion.
  - [x] Remove unobserved SCW/grounding templates and unverified production storage from diagrams 1–2; keep live MinIO API bindings.
  - [x] Separate main-only templates in the register; record runtime success timestamps and Geo CAS prefix/environment boundaries.
  - [x] Fit complete diagrams on entry; PV view reduced from 4669×1067 to 1779×1555, with zoom/full-screen/Escape and no page overflow.
- [ ] **Lot 7 — Prepare the owner-requested implementation continuation.**
  - [x] Request existing i-cond, i-infra and Graphify conductor handoffs through h2a; no overlapping implementation dispatched.
  - [x] Read September 11 continuation briefs; correct the lowercase-feed/served-Signal boundary and document 3.4 post-projection processing.
  - [x] Record owner confirmation: retain SCW TEM until its replacement is validated.
  - [ ] Establish the exact current plan, upgrade contract, scope and deployment gates before opening implementation work.

## Merge / Close
- [ ] **Lot 8 — Replace the orientation prototype with a native Focus decision dossier.**
  - [x] Read the September 7 Sentropic decision-kit reference and owner-validated Focus dossier contract.
  - [x] Reconcile the newer in-process Graphify mesh proposal and current upstream PRs; relay the no-start gate to Graphify.
  - [x] Present eight decision sections, symmetric options, acceptance criteria and real reviewer findings; dossier explicitly incomplete.
  - [x] Draft D1 with three symmetric delivery sequences, G0–G6 gates and explicit unresolved recovery criteria.
  - [x] Add an explicitly proposed, Immo-owned in-process Graphify scene; no invented replacement API bucket.
  - [x] Map Mermaid identities and relationships to native SvelteFlow groups and navigable subflows.
  - [x] Add a fail-closed Mermaid adapter and source/hash manifest; independent text reviews launched via h2a.
  - [x] Implement native SvelteFlow subflows with parentId groups and the unchanged Sentropic Focus ArchitectureNode component.
  - [x] Add Focus dossier navigation, shared-resource cross-links, embedded evidence and local-only notes without approval controls.
  - [x] Verify the offline HTML, mapping coverage, navigation and local-only owner notes; record test boundaries.
  - [x] Add a Docker-only build reusing the Sentropic kit read-only; portable HTML embeds JS, CSS and evidence.
  - [x] Add mapping completeness, native parent bounds, resource identity and rejected-syntax regression tests.
  - [x] Preserve Codex's six actual findings; disclose Opus weekly-limit failure and keep the dossier incomplete.
  - [x] Reconcile all six findings in D2: shared-consumer inventory, credential continuity, recovery consistency and explicit SCW retirement gates.
  - [x] Add Chromium checks for all 18 scenes, cross-view DB navigation, local notes, evidence dialogs, mobile and offline use.
  - [x] Use the DS full-width container, French decision reading surface and automatic zoom on a selected shared resource.
  - [x] Reuse the Focus orthogonal router to prevent edges crossing unrelated components; keep unverified edge/label crossings explicit.
  - [x] Document build/replay instructions and hash-scope local notes to the complete embedded input set.
  - [x] Embed replay instructions and verification evidence too; leave unresolved execution decisions and production inventory open.
- [ ] Local documentation handoff; no production action or branch merge requested.
- [x] **Lot 9 — Owner correction: complete nested diagrams and Focus choices.**
  - [x] Diagnose the mismatch: sceneFor collapses each child group; Mermaid is shown as plain source only.
  - [x] Regression reproduced: infrastructure showed 8 native nodes instead of all 29 leaves and boxes; replace collapsed representation with complete recursive layout.
  - [x] Render every node/edge simultaneously with native nested parentId boxes; navigation only changes the viewport.
  - [x] Add strict, sanitized Mermaid prerendering with source hashes and node/group parity; embed the visual and exact code offline.
  - [x] Add the same DS Tile/Radio choice pattern as the Sentropic dossier, with comments, local drafts and copy/download JSON containing all options and provenance.
  - [x] Integrate choice cards into section 4 and render embedded source-document Mermaid blocks too; retain draft-only authority in D3.
  - [x] Extend browser regression checks to simultaneous counts, visual nesting, Mermaid SVG parity, radio choices, comments, persistence and clipboard failure reporting.
  - [x] Keep clipboard-denied JSON keyboard-selectable, hash option definitions and suppress raw source HTML while rendering the controlled Mermaid SVGs.
  - [x] Fit the full diagram from explicit absolute nested bounds; verify every box and component stays inside the initial viewport.
  - [x] Add real clipboard read-back in a fresh isolated browser context, preserving the previous clipboard content.
  - [x] Verify simultaneous completeness, nested bounds, Mermaid rendering and A/B/C comment/export behavior; real clipboard read-back passes.
- [x] **Lot 10 — Service icons, repository attribution and complete Mermaid text.**
  - [x] Reproduce missing labels: Mermaid 11 nodes used foreignObject despite the flowchart-only flag; global htmlLabels:false preserves SVG text without relaxing sanitization. Build and browser assertions now check every label, not just box counts.
  - [x] Add 19 original SVG pictograms, service labels and repo/role attribution to every native node and subflow. Preserve the Focus port contract and orthogonal router; expand bounds for complete labels.
  - [x] Verify all node/group/edge texts, 100 icon/repo occurrences, native nesting, card/header overflow, source dialogs, offline use and actual clipboard. 8/8 tests pass; PostgreSQL/MinIO/Mermaid screenshots visually inspected. No independent reapproval or implementation authority inferred.
- [x] **Lot 11 — Accompany the engaged transitions and monthly report.**
  - [x] Record the owner-fixed order, published Graphify 0.18.0, existing-plan mapping, diagram update contract and one-node-only billing basis.
  - [x] Replace the obsolete refresh-sequence response with neutral LLM-allocation methods and fixed owner decisions in draft JSON.
  - [x] Replace obsolete unasked sequence options with the explicit LLM-allocation question and the engaged plan.
  - [x] D4 records the owner execution direction and published release; former architecture alternatives are explicitly historical.
  - [x] Reconcile available monthly evidence, neutral LLM-allocation alternatives and explicit audit gaps without a final amount.
  - [x] Extend the Docker-only portable build and browser gate to the dated monthly rendering and hash manifest.
  - [x] Embed the dated Mermaid/SvelteFlow rendering into the monthly companion; retain post-period separation.
  - [x] Pin the dated rendering, architecture inputs and read-only monthly evidence in a reproducible SHA-256 manifest.
- [ ] **Lot 12 — D5 owner correction: architecture-first Focus dossier.**
  - [x] Add committed full-platform T1, T2 and T3 Mermaid states with stable resource identities and explicit stage cards.
    - [x] T1 full-platform source.
    - [x] T2 full-platform source.
    - [x] T3 full-platform source.
  - [x] Replace Option A with the actual T1 refresh sequence and preserve its acceptance boundaries.
  - [ ] Render every transition as complete native nested SvelteFlow and sanitized Mermaid; open on the final target.
  - [ ] Replace the allocation referendum with fixed invoice-tariff instructions, unresolved period evidence and D4 provenance.
  - [ ] Make target architecture and sequential transitions the primary Focus reading path; keep billing last.
  - [ ] Publish a current report-through-September-13 companion and supersede the older window without rewriting its sources.
  - [ ] Regenerate the current/dated portable HTML and evidence manifest with D5 hashes.
  - [ ] Pass static, build, browser, clipboard, scope and diff gates; record limitations without deployment claims.
