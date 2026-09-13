# Local Focus decision dossier

The entry point is [decision-dossier.md](decision-dossier.md), with effective-state
evidence in [architecture.md](../architecture.md) and [storage-audit.md](storage-audit.md).
The owner-facing page uses the September 7 Sentropic decision-kit format: DS
AppShell/ThemeProvider, the **unchanged Focus ArchitectureNode**, Focus orthogonal
routing and **native SvelteFlow**, not a Mermaid SVG wrapped in an HTML card.

From the documentation worktree:

```sh
make -f docs/architecture/focus/Makefile test build ENV=test-architecture
make -f docs/architecture/Makefile serve ENV=docs-architecture
```

Open **http://127.0.0.1:5188/** or the generated **decision-focus.html** directly.
The HTML embeds JS, CSS, French presentation and complete source/review documents;
it works offline and does not require a Claude session, server or external CDN.

## Navigation and authority

- Eight decision sections; five graph views, including a separately labelled proposal.
- All components, edges and nested boxes are shown **simultaneously**. Every
  Mermaid subgraph maps to a native SvelteFlow `parentId` box with its original ID.
  Click a box or use its selector to zoom; no content is collapsed or replaced.
- Select `PP-DB`, `PP-GRAPH`, etc. to zoom to it and cross-link to the same identity
  in another diagram. External relationships retain original source/target IDs.
- Mermaid source is **rendered visually**, both beneath the SvelteFlow and in
  embedded source documents; exact code remains available. Five strict, sanitized
  SVGs are generated locally and embedded offline, with node/group parity checks.
- Every node/edge/subgraph is covered by tests; dashed and bidirectional semantics
  are preserved. Full-diagram fitting uses explicit absolute nested bounds.
- Section 4 uses the example's DS **Tile + Radio** pattern: A/B/C selection,
  comment, local persistence, **copy JSON** and download. The response includes
  all three options, selected ID, comment, general remarks and source hashes.
  Choices start empty and remain **drafts**, never approval/Track/deployment actions.
  Clipboard denial is explicit; the JSON remains keyboard-selectable/downloadable.
- Sources open in an accessible dialog; external evidence links require a click.
- The dossier remains **INCOMPLETE**: production inventory/recovery criteria and
  the independent Opus pass are missing. Codex findings and Opus quota failure
  are disclosed individually; Gemini's older review is not reused as D2 approval.

## Build and verification

Builds run in Docker, without host Node or installs. `KIT_ROOT` defaults to
`/home/antoinefa/src/sentropic/.tmp/focus-cluster-mesh-decision-kit`, mounted
**read-only** with its existing dependencies. Override it with that kit on another
workstation. The generated manifest records source hashes and component provenance.
This is a standalone Focus-format host, not the live Track dashboard or its transport.
Mermaid prerendering needs the isolated local Chromium debugger on port 9238 and
the existing pinned bundles in `vendor/` (available through the older `assets`
target). The browser renderer blocks HTTP(S); no remote rendering service is used.

```sh
make -f docs/architecture/focus/Makefile browser ENV=test-architecture
make -f docs/architecture/focus/Makefile clipboard ENV=test-architecture
```

`browser` verifies five complete diagrams at 18 viewport positions, visible nested
bounds, rendered Mermaid parity, shared-DB navigation, full-screen/Escape, choices,
comments, persistence, source dialogs, clipboard failure, responsive and offline use.
`clipboard` checks actual clipboard read-back in a fresh browser context, then
restores its previous contents and disposes only that test context.
No API/UI/DB application stack or data volume is started or modified.

Geometry checks prevent node overlap, out-of-parent bounds and routes through
unrelated nodes. **Zero edge/label/arrow overlap is not certified**; dense views
offer zoom and exact relationship details. This is not a live-data certification.
The generated HTML, build output and screenshots are ignored by Git. The old
FocusSnapshot/Mermaid prototype remains at `/architecture.html` for historical
comparison; it is superseded and is not the owner-requested decision surface.
