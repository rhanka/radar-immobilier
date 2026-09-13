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
- Click a subflow or use its selector. Breadcrumbs return to its parent. Open scopes
  are actual SvelteFlow `parentId` groups, not raster/SVG zoom simulations.
- Select `PP-DB`, `PP-GRAPH`, etc. to zoom to it and cross-link to the same identity
  in another diagram. External relationships retain original source/target IDs.
- Mermaid source is retained, with every node/edge/subgraph covered by tests.
  Dashed edges and bidirectional arrows keep their semantics.
- Notes are local, hash-scoped **drafts**, exportable as JSON. No signing, Track,
  approval, deployment or other application mutation is exposed.
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

```sh
make -f docs/architecture/focus/Makefile browser ENV=test-architecture
```

`browser` requires the isolated Chromium debugger on loopback port 9238. It visits
all 18 scenes, tests shared-DB navigation, full-screen/Escape, local notes, source
dialogs, desktop/mobile overflow and file-based offline use with network blocked.
No API/UI/DB application stack or data volume is started or modified.

Geometry checks prevent node overlap, out-of-parent bounds and routes through
unrelated nodes. **Zero edge/label/arrow overlap is not certified**; dense views
offer zoom and exact relationship details. This is not a live-data certification.
The generated HTML, build output and screenshots are ignored by Git. The old
FocusSnapshot/Mermaid prototype remains at `/architecture.html` for historical
comparison; it is superseded and is not the owner-requested decision surface.
