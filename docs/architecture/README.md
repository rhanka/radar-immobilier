# Local Focus architecture dossier — D8

The entry point is [decision-dossier.md](decision-dossier.md), with the preserved
BEFORE state in [architecture.md](../architecture.md), the complete AFTER target
in [transitions-target.md](transitions-target.md) and supporting transition facts
in the [storage audit](storage-audit.md).
The owner-facing page uses the September 7 Sentropic decision-kit format: DS
AppShell/ThemeProvider, Focus orthogonal routing and **native SvelteFlow**, not a
Mermaid SVG wrapped in an HTML card. The local service-node renderer extends the
reference presentation with icons/repo labels and preserves its exact port contract.

From the documentation worktree:

```sh
make -f docs/architecture/focus/Makefile tokens test build ENV=test-architecture
make -f docs/architecture/Makefile serve ENV=docs-architecture
```

Open **http://127.0.0.1:5188/**, generated **decision-focus.html**, or the committed
**architecture-before-after-2026-09-13.html** monthly copy directly.
The HTML embeds JS, CSS, French presentation and complete source/review documents;
it works offline and does not require a Claude session, server or external CDN.
The same build emits the dated interactive architecture HTML, report HTML/PDF,
token audit and D8 evidence manifest under `docs/reports/architecture-monthly/`.

## Navigation and authority

- Eight architecture-first sections and exactly two primary graph views:
  **Architecture AVANT → Architecture APRÈS**. Transition facts remain prose and
  gates, not a third graph. The default is BEFORE.
- All components, edges and nested boxes are shown **simultaneously**. Every
  Mermaid subgraph maps to a native SvelteFlow `parentId` box with its original ID.
  Click a box or use its selector to zoom; no content is collapsed or replaced.
- Select `PP-DB`, `PP-GRAPH`, etc. to zoom to it and cross-link to the same identity
  in another diagram. External relationships retain original source/target IDs.
- Mermaid source is **rendered visually**, both beneath the SvelteFlow and in
  embedded source documents; exact code remains available. Two strict, sanitized
  SVGs are generated locally and embedded offline, with exact node/group/edge text
  checks. Mermaid's global `htmlLabels:false` retains SVG text under sanitization.
- Every component and nested box has a blue service pictogram, a service name and
  a `repo:` label with its role. [Attribution evidence](service-provenance.md)
  distinguishes workload manifests, client configuration, external actors and
  unresolved ownership. These are generic symbols, not cloud-vendor logos.
- Every node/edge/subgraph is covered by tests; dashed and bidirectional semantics
  are preserved. Full-diagram fitting uses explicit absolute nested bounds.
- Section 6 asks three explicit questions before nine selectable Focus options,
  with one comment per question, local persistence, actual **copy JSON** and
  download. The LLM ratification question is non-critical and remains open unless
  selected; fixed architecture/storage decisions are exported unchanged.
  Clipboard denial is explicit; the JSON remains keyboard-selectable/downloadable.
- Sources open in an accessible dialog; external evidence links require a click.
- The D8 dossier records accepted preproduction T2 parity and MinIO removal. It
  remains **INCOMPLETE** for T1 acceptance, production T2 and T3. Rendering is
  not deployment.

## Build and verification

Builds run in Docker, without host Node or installs. `KIT_ROOT` defaults to
`/home/antoinefa/src/sentropic/.tmp/focus-cluster-mesh-decision-kit`, mounted
**read-only** with its existing dependencies. Override it with that kit on another
workstation. This absolute kit dependency is a disclosed portability gap. The
generated manifests record source hashes and component provenance.
This is a standalone Focus-format host, not the live Track dashboard or its transport.
Mermaid prerendering needs the isolated local Chromium debugger on port 9238 and
the existing pinned bundles in `vendor/` (available through the older `assets`
target). The browser renderer blocks HTTP(S); no remote rendering service is used.

```sh
make -f docs/architecture/focus/Makefile browser ENV=test-architecture
make -f docs/architecture/focus/Makefile clipboard ENV=test-architecture
make -f docs/architecture/focus/Makefile report-check ENV=test-architecture
```

`browser` verifies both complete diagrams at their root viewport, visible
nested bounds, every icon/repo label, card/header overflow, exact SvelteFlow/Mermaid
texts, before/after navigation, explicit questions/options, fixed decisions,
comments, actual JSON copy, responsive
and offline use.
`clipboard` checks actual clipboard read-back in a fresh browser context, then
restores its previous contents and disposes only that test context.
No API/UI/DB application stack or data volume is started or modified.

Geometry checks prevent node overlap, out-of-parent bounds and routes through
unrelated nodes. **Zero edge/label/arrow overlap is not certified**; dense views
offer zoom and exact relationship details. This is not a live-data certification.
The generated HTML, build output and screenshots are ignored by Git. The old
FocusSnapshot/Mermaid prototype remains at `/architecture.html` for historical
comparison; it is superseded and is not the owner-requested decision surface.
