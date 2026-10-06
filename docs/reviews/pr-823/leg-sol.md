status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/date-basis-in-custom-tab@6af5a86231a80a3f3153a9959a0f053ed3e894a8
lens: reproduction-dependency-readiness-and-accessibility

## Reasoning

Independently reviewed `git diff origin/main...6af5a86231a80a3f3153a9959a0f053ed3e894a8` and read PR #823 with `gh pr view 823`. HEAD matches that SHA; the diff contains exactly the five assigned files. No other reviewer artifacts were consulted.

The implementation satisfies the placement and commit requirements with the supplied DS build. `SignauxRail.svelte:429` provides a real `customExtra` snippet containing the RadioGroup. The installed TimeRangePicker renders that snippet only in its Custom branch, after the calendars and before its From/To fields. There is no remaining RadioGroup in the closed rail. Selecting a radio changes `draftDateBasis`; opening reseeds that draft from the applied prop (`SignauxRail.svelte:97`). The callback at line 104 commits range and basis together and forces `document` for relative presets. The parent at `SignauxMapView.svelte:611` normalizes both values before route synchronization and its single `load()` call.

The 32 scoped tests actually render the DS component; they do not mock TimeRangePicker. In particular, `SignauxRail.test.ts:44` opens the picker, requires the accessible group, checks both `.st-timeRangePicker__customExtra` and `.st-timeRangePicker__custom` ancestry, and checks that the group precedes Début in DOM order. The tests at lines 57, 65, 79, 91 and 98 verify tab visibility, deferred application, cancellation/reseeding, restoration and relative fallback. Those are meaningful assertions of the new placement and behavior, rather than checks of a passed prop.

I inspected the published 0.34.71 TimeRangePicker source as a negative control. It contains neither `customExtra` nor `onOpenChange`, and proceeds directly from calendars to bounds. With that version, or with the snippet render removed, `dateBasisGroup()` would throw because no group is rendered; the placement and draft tests cannot pass. This conclusion is demonstrated by source and assertions, not by a second test run against 0.34.71. I did not replace the installed dependency. Removing only the open notification would also invalidate the cancellation/reseeding assertion: the acquisition draft would survive reopening.

The URL and API contracts remain unchanged. The diff is empty for `geo-filter-state.ts`, `signal-date-filter.ts` and `graph-signals-by-city-client.ts`. The router still writes `filter.dateBasis=acquisition`, accepts the legacy `scrap` spelling, and normalizes relative periods to document dates. The API client still sends `dateBasis=scrap`. The later UI run also passed the existing router, date-filter and by-city client suites. I did not make live API assertions against production or preproduction.

Dependency readiness is a real merge blocker, already acknowledged by the DRAFT. npm cannot currently resolve 0.35.1; the exact-head CI fails at `make install` with ETARGET, before reaching tests. The checked-in lockfile still declares UI `^0.34.71` and resolves DS 0.34.71. Local green results use the preinstalled tarball and therefore do not establish a reproducible fresh install of this commit.

The root override is justified by the inspected peer constraints: geo-ui-svelte 0.1.1 requires `^0.34.32`, and chat-ui 0.33.0 has an optional `^0.34.0` peer. Those ranges exclude 0.35.x; optional does not mean an installed peer can have any version. The actual imported components are:

| Consumer | DS imports in its installed published sources |
| --- | --- |
| geo-ui-svelte 0.1.1 | Card, Typography, Stack, Badge, Tag, Grid, EmptyState, Link |
| chat-ui 0.33.0 | Badge, EmptyState, Icon, OverflowMenu, SelectableList, SelectableRow, StatusDot, Tag, IconButton |

Neither imports GeoMap. I compared all 14 unique imported component files from the published DS 0.34.71 and 0.35.0 archives: every file is byte-identical. This directly supports compatibility with the 0.35.0 rename. Between published 0.35.0 and the supplied 0.35.1 tarball, 13 are identical; Icon adds theme token styling for stroke width/color while retaining its existing props and the 2.25 default fallback. That difference is not evidence of a breaking interface. The installed component files match the supplied tarball, and `npm ls` reports a single deduplicated DS 0.35.1 for both consumers. This verifies the prepared volume, not fresh registry resolution after publication. The PR description's exhaustive import list is incomplete for chat-ui; see F2.

Regenerating the lockfile after publication is the right plan. Before marking ready, merge/publish the DS prerequisite, regenerate and commit the registry-backed lockfile through Make in an authorized isolated environment, and verify a clean install, a single DS copy, and green CI using the published artifact. Publication alone does not repair the stale lockfile. No manifests or lockfile were changed during this review.

Accessibility is supported by native semantics and reproduced component behavior. The rendered group is a `fieldset` with a `legend` named “Base de date”, inside the dialog named “Période des signaux”. Both choices are labeled native `input[type=radio]`, enabled, with the same name and no negative tabindex. The DS focus trap queries all enabled inputs inside the panel, including the snippet descendants, on each Tab event. It handles Tab boundaries only; Arrow keys and Space remain native radio behavior. RadioGroup handles native change events, so keyboard selection reaches the same draft update callback as clicking.

Three additional JSDOM probes verified those semantics, that the trap does not intercept Tab from a radio in the middle of the panel, Tab/Shift+Tab wrapping, and focus restoration/draft discard on Escape and outside pointerdown. JSDOM does not perform browser-native Tab traversal or radio arrow-key default actions; these were not claimed as browser reproductions. Browser attempts failed in the local tooling, documented below. No accessibility defect in the introduced radio group was demonstrated; screen-reader output, native arrow-key traversal and visual focus appearance remain unverified in a real browser.

## Reproduction log

Commands ran in this worktree, with RTK prefixes. Runtime commands used Make and `ENV` last. Inspection targets supplied through `-f -` ran one-off containers against the existing test environment's volumes with no service dependencies. No new stack was started, and no install/down/clean operation was run on the supplied environment. Excerpts omit routine container apt setup and npm update notices.

### Target and PRs

```text
$ rtk git rev-parse HEAD origin/main 6af5a862
6af5a86231a80a3f3153a9959a0f053ed3e894a8
782d20c96c54e7035438aa6fdccdc4ccba82acf4
6af5a86231a80a3f3153a9959a0f053ed3e894a8

$ rtk git diff --name-only origin/main...6af5a862
package.json
ui/package.json
ui/src/lib/components/maps/SignauxMapView.svelte
ui/src/lib/components/maps/SignauxRail.svelte
ui/src/lib/components/maps/SignauxRail.test.ts

$ rtk gh pr view 823
OPEN, DRAFT; dependency section says DS ^0.35.1 is not published,
lockfile is deliberately unchanged, and must be regenerated after publication.

$ rtk gh pr view 157 --repo rhanka/sent-tech-design-system --json title,state,isDraft,headRefOid,body,files
state: OPEN; isDraft: false
headRefOid: 54457e4c1203e0f5d919fb16fe6991db2294e37f
title: feat(timerangepicker): customExtra slot in the Custom tab + onOpenChange (4 frameworks)
body: Not published; release is the owner's call.
```

### Requested scoped reproduction

```text
$ rtk make test-ui SCOPE=src/lib/components/maps/SignauxRail.test.ts ENV=test-date-basis-custom-tab
> radar-immobilier-ui@0.0.0 test
> vitest run src/lib/components/maps/SignauxRail.test.ts

 RUN  v3.2.7 /workspace/ui
 ✓ src/lib/components/maps/SignauxRail.test.ts (32 tests) 857ms

 Test Files  1 passed (1)
      Tests  32 passed (32)
   Start at  00:44:01
   Duration  16.25s (transform 10.13s, setup 0ms, collect 14.66s, tests 857ms, environment 379ms, prepare 99ms)
```

Exit code: 0.

### Installed sources and published-archive comparison

Read the installed package manifests and searched `node_modules/@sentropic/geo-ui-svelte/src` and `node_modules/@sentropic/chat-ui/dist` through a Make inspection target. An initial search incorrectly assumed geo-ui-svelte had a `dist` directory and exited 2 (`No such file or directory`); its manifest points to `src`, and the corrected search succeeded.

Downloaded public DS archives for comparison, without installing either:

```sh
rtk curl -fsS https://registry.npmjs.org/@sentropic/design-system-svelte/-/design-system-svelte-0.34.71.tgz -o tmp/ds/pr823-sol-ds-0.34.71.tgz
rtk curl -fsS https://registry.npmjs.org/@sentropic/design-system-svelte/-/design-system-svelte-0.35.0.tgz -o tmp/ds/pr823-sol-ds-0.35.0.tgz
rtk make -f Makefile -f - review-sol-compare ENV=test-date-basis-custom-tab <<'MAKE'
.PHONY: review-sol-compare
review-sol-compare:
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm --no-deps -T --entrypoint node api tmp/ds/pr823-sol-compare.cjs
MAKE
```

The ignored comparison script scans imports, reads the published archives, and compares their component bytes with the candidate archive and installed files. Output:

```text
geo-ui-svelte@0.1.1 peer: ^0.34.32
src/AttributionBar.svelte: Tag, Link, Typography
src/DatasetCard.svelte: Card, Typography, Stack, Badge, Tag
src/DatasetCatalog.svelte: Grid, EmptyState
chat-ui@0.33.0 peer: ^0.34.0 (optional)
dist/components/AgentsList.svelte: Badge, EmptyState, Icon, OverflowMenu, SelectableList, SelectableRow, StatusDot, Tag
dist/components/ChatSessionsBar.svelte: IconButton

Badge: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
Card: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
EmptyState: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
Grid: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
Icon: 0.34.71==0.35.0 true; 0.35.0==0.35.1 false; tarball==installed true
IconButton: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
Link: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
OverflowMenu: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
SelectableList: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
SelectableRow: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
Stack: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
StatusDot: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
Tag: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
Typography: 0.34.71==0.35.0 true; 0.35.0==0.35.1 true; tarball==installed true
TimeRangePicker.svelte: tarball==installed true
RadioGroup.svelte: tarball==installed true
Radio.svelte: tarball==installed true
MenuPopover.svelte: tarball==installed true
installed DS version: 0.35.1
```

Exit code: 0. The Icon difference was inspected with `rtk diff -u` between the two archive entries: additive theme styling and retained prop/default behavior as described above.

```sh
rtk make -f Makefile -f - review-sol-tree ENV=test-date-basis-custom-tab <<'MAKE'
.PHONY: review-sol-tree
review-sol-tree:
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm --no-deps -T --entrypoint npm api ls @sentropic/design-system-svelte --all
MAKE
```

```text
radar-immobilier-workspace@0.0.0 /workspace
`-- radar-immobilier-ui@0.0.0 -> ./ui
  +-- @sentropic/chat-ui@0.33.0
  | `-- @sentropic/design-system-svelte@0.35.1 deduped
  +-- @sentropic/design-system-svelte@0.35.1
  `-- @sentropic/geo-ui-svelte@0.1.1
    `-- @sentropic/design-system-svelte@0.35.1 deduped
```

Exit code: 0. Candidate archive SHA-256, from `rtk sha256sum`: `1f589fc3d688f160786a47b9327b2f2f25a57b9a81d87550c46db155c47d85b5`.

### Publication and exact-head CI

```sh
rtk make -f Makefile -f - review-sol-registry ENV=test-date-basis-custom-tab <<'MAKE'
.PHONY: review-sol-registry
review-sol-registry:
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm --no-deps -T --entrypoint npm api view @sentropic/design-system-svelte@0.35.1 version
MAKE
```

```text
npm error code E404
npm error 404 No match found for version 0.35.1
npm error 404 The requested resource '@sentropic/design-system-svelte@0.35.1' could not be found or you do not have permission to access it.
make: *** [...:3: review-sol-registry] Error 1
```

Make exit code: 2. The independent CI evidence removes ambiguity about the registry error:

```text
$ rtk gh pr view 823 --json isDraft,headRefOid,statusCheckRollup
isDraft: true
headRefOid: 6af5a86231a80a3f3153a9959a0f053ed3e894a8
Quality gates: FAILURE
Enforce repo policy: SUCCESS

$ rtk gh run view 37395264627 --job 112049614826 --log-failed | rtk rg 'ETARGET|notarget|Makefile:305|exit code 2|Run make install'
2026-10-06T00:42:35.5844031Z Run make install ENV=ci
2026-10-06T00:42:44.0243516Z npm error code ETARGET
2026-10-06T00:42:44.0244790Z npm error notarget No matching version found for @sentropic/design-system-svelte@^0.35.1.
2026-10-06T00:42:44.2727583Z make: *** [Makefile:305: install] Error 1
2026-10-06T00:42:44.2737298Z Process completed with exit code 2.
```

This is an observed `npm install` failure, not a locally reproduced `npm ci` failure. A clean `npm ci` was deliberately not run against the prepared volumes. Lockfile inspection shows DS version 0.34.71 at `package-lock.json:3047` and UI range `^0.34.71` at line 12403.

### Additional accessibility/dismissal probes

Created only ignored scratch files under `tmp/ds`: `pr823-sol-a11y.test.ts` and `pr823-sol-vitest.config.ts`. They import the real rail and DS and use role/label queries. The merged configuration concatenates the original include patterns, so this invocation also ran the existing UI suite rather than only the three probes:

```text
$ rtk make test-ui SCOPE='--config ../tmp/ds/pr823-sol-vitest.config.ts' ENV=test-date-basis-custom-tab
> vitest run --config ../tmp/ds/pr823-sol-vitest.config.ts
 RUN  v3.2.7 /workspace/ui
 ✓ ../tmp/ds/pr823-sol-a11y.test.ts (3 tests) 459ms
 ✓ src/lib/components/maps/SignauxRail.test.ts (32 tests) 996ms
 ✓ src/lib/router/geo-filter-state.test.ts (13 tests) 17ms
 ✓ src/lib/router/router.test.ts (11 tests) 2626ms
 ✓ src/lib/signals/signal-date-filter.test.ts (10 tests) 9ms
 ✓ src/lib/signals/graph-signals-by-city-client.test.ts (5 tests) 10ms
 Test Files  125 passed | 1 skipped (126)
      Tests  1644 passed | 10 todo (1654)
   Start at  00:49:36
   Duration  22.11s
```

Exit code: 0. The run emitted Svelte unused export/CSS warnings in SignauxSelPanel; no failing suite. It does not verify browser-native key default actions.

### Browser attempt limitations

The Playwright MCP call `browser_tabs({action: "new", url: "http://localhost:5391"})` failed during server initialization with `Timeout 30000ms exceeded` after connecting to its configured CDP endpoint. No successful browser observation resulted.

An ignored isolated HTML harness and `pr823-sol-browser.cjs` were then attempted through a Make target (`run --rm --no-deps -T --entrypoint node api tmp/ds/pr823-sol-browser.cjs`) using the existing test Obscura service, with non-UI network requests blocked. Initial CDP discovery advertised `ws://127.0.0.1:9222/devtools/browser`, causing ECONNREFUSED inside the API container. Using `ws://obscura:9222/devtools/browser` connected but the harness never rendered; a diagnostic fetch showed the local Vite server rejecting hostname `ui` with HTTP 403. The subsequent diagnostic logging attempt also encountered a null navigation response. The image has no installed Playwright Chromium executable, and Obscura reports `Browser: Obscura/0.1.0`, `V8-Version: N/A`. I stopped these attempts without changing Vite configuration or installing a browser. These tooling failures are not PR defects or evidence of a keyboard regression.

### Scope preservation

```text
$ rtk git diff --exit-code -- package.json ui/package.json package-lock.json ui/src/lib/components/maps/SignauxRail.svelte ui/src/lib/components/maps/SignauxRail.test.ts ui/src/lib/components/maps/SignauxMapView.svelte
(empty; exit 0)

$ rtk git diff origin/main...6af5a862 -- ui/src/lib/router/geo-filter-state.ts ui/src/lib/signals/graph-signals-by-city-client.ts ui/src/lib/signals/signal-date-filter.ts
(empty; exit 0)
```

No commit, push, production/preproduction access, or other tracked-file edit was performed.

## Findings

### F1 — Fresh installs cannot consume the required DS release yet

- **Severity:** blocking, for merging this exact commit; expected and correctly disclosed while DRAFT.
- **File:line:** `ui/package.json:22`; also `package.json:31`, `package-lock.json:3047` and `package-lock.json:12403`.
- **Evidence:** registry lookup returns no 0.35.1; exact-head CI run [37395264627](https://github.com/rhanka/radar-immobilier/actions/runs/37395264627/job/112049614826) fails installation with `No matching version found for ...@^0.35.1`. The lockfile still resolves 0.34.71, which lacks both required DS extension props. Local tests succeed only with the supplied preinstalled tarball.
- **Fix:** keep DRAFT until DS PR #157 is merged and the release containing both APIs is published. Then regenerate and commit the registry-backed lockfile through Make in an authorized isolated environment. Verify a clean install and single deduplicated DS copy, rerun the scoped tests using the published release, and obtain green CI. Do not merge with the present lockfile or rely on the test-volume tarball as release verification.

### F2 — The override rationale understates chat-ui's actual DS imports

- **Severity:** non-blocking; documentation accuracy, not a demonstrated incompatibility.
- **File:line:** `package.json:31` (the override justified in PR #823's Dependency section).
- **Evidence:** the description says the two packages “only import Card/Typography/Stack/Badge/Tag/Grid/EmptyState/Link”. Installed `chat-ui/dist/components/AgentsList.svelte:1` also imports Icon, OverflowMenu, SelectableList, SelectableRow and StatusDot; `ChatSessionsBar.svelte:2` imports IconButton. All are unchanged from published 0.34.71 to 0.35.0. Icon has an additional theme styling change in the supplied 0.35.1 build, with retained props/default fallback. No failure was demonstrated.
- **Fix:** correct the PR description's import list, or state precisely that neither package imports GeoMap and that the actually imported component sources were checked across 0.34.71 → 0.35.0. No code change is required by this observation.

## Verdict

**NO-GO** for merging `6af5a862` as it stands, because F1 is reproduced in exact-head CI and the lockfile is not ready. The scoped behavior/placement tests and additional accessibility probes pass with the supplied DS build. No further blocking implementation or radio-group accessibility defect was demonstrated. Reassess readiness after publication, lockfile regeneration and clean CI; F2 is a documentation nit.
