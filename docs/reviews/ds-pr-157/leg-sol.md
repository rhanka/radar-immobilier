status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: feat/timerangepicker-custom-extra@349f80baf017b8d3854e6f3d8755385f5f915517
lens: reproduction-and-edge-cases
round: 2

## Reasoning

Independently reviewed PR [#157](https://github.com/rhanka/sent-tech-design-system/pull/157), targeting exactly `git diff origin/main...349f80ba`. Local HEAD and the PR head both resolve to `349f80baf017b8d3854e6f3d8755385f5f915517`, branch `feat/timerangepicker-custom-extra`. Read the PR description using `rtk gh pr view 157`, the full target diff, the corrective diff `54457e4c..349f80ba`, and the permitted round-1 reports. Did not consult another round-2 review.

The intended integration now works in the mounted consumer probes: extra controls edit consumer draft state, opening reseeds it, Cancel preserves the committed basis, and unchanged-range Apply emits one absolute range through which the consumer commits its draft. The existing tests pass in all four frameworks. The two claimed round-2 fixes withstand reproduction; no new blocking defect was reproduced.

Additional observations, with assertions against the mounted implementations:

- **Svelte effects:** the initially closed picker reports nothing. Controlled range changes while open preserve both edited From/To and the consumer's extra draft, without another open notification. Replacing the callback does not notify or reseed; the next transition invokes the replacement. Updating consumer draft in the open callback does not cause notification loops.
- **Rapid toggles:** Svelte and Vue coalesce two synchronous trigger clicks while closed into no notification and no rendered panel. A same-turn close/reopen while already open also produces no notification. React behaves the same for clicks batched inside `act`, including under StrictMode. Separately flushed open/close transitions report `[true, false]`. Angular reports synchronous transitions immediately as `[true, false]`. These timing differences did not reproduce a draft failure; the coalesced cases never render an intermediate panel state.
- **React effects / StrictMode:** no duplicate open, close, or Apply notifications occurred in the staged consumer. Notification now precedes the picker's own focus effect on both opening and closing. Child mount effects are a separate ordering boundary: first open recorded `open true -> extra layout -> extra passive`, while reopen recorded `extra layout -> extra passive -> open true`. This remains observable, but the controlled extra draft converged correctly on reopen; it is not evidence of a broken draft contract.
- **Vue watch timing:** notification occurs after the synchronous click and before the settled `nextTick` result. There is no initial notification. Listener replacement does not notify, and its replacement is used on the next transition. Controlled value updates do not reset in-progress range or extra edits.
- **Angular conditional projection:** actual TestBed rendering places the extra above both From/To and the action buttons. Custom -> Relative -> Custom and close -> reopen reproject the same radio DOM node. Tab changes preserve its draft; reopening reseeds it. A picker without projected content has a wrapper with zero child nodes, matches `:empty`, and computes `display: none` with the shipped rules. The new committed placement test's title mentions empty-host hiding but does not assert that case; the independent probe does.
- **Focus and keys:** Svelte, React, and Vue recognize focus inside the extra as inside the panel, permit ordinary interior Tab handling, wrap Tab/Shift+Tab at the panel endpoints, and close on Escape from the extra with focus returned to the trigger. Enter in an extra text input does not Apply or notify a range change in any framework. Angular's existing missing dismissal/trapping lifecycle is reproduced below.
- **CSS:** all three hand-maintained stylesheets add identical `display: flex`, `flex-direction: column`, and `gap: var(--st-spacing-2, 0.5rem)` declarations, matching the Svelte component after whitespace normalization. All three also add `:empty { display: none; }`; this hides Angular's always-created empty projection wrapper. Svelte conditionally creates its wrapper when a snippet is supplied.
- **Docs / versions:** the actual Svelte docs demo's extracted script and markup, mounted with the source picker and DS RadioGroup, preserve the applied basis on Cancel, reseed on reopen, and commit acquisition only on unchanged-range Apply. Svelte 0.35.1, React 0.37.1, and Vue 0.37.1 match their package manifests, docs and dataviz dependency pins, and all corresponding lockfile entries.

Runtime evidence is from jsdom, not a real browser. DOM focus, explicit key events, and the trap's endpoint handling were exercised; native browser Tab traversal, browser-synthesized Enter button activation, and visual layout were not verified. The docs probe exercises the extracted live demo, not the complete routed docs application. Installed versions: Node v22.22.1, Vitest 4.1.11, jsdom 27.4.0, Svelte 5.55.7, React/React DOM 19.3.0, Vue 3.5.35, Angular 21.2.24.

## Previous findings

### R1-F1 — Angular native radio change reaches the committed-range binding

**Status: fixed.** Source: `packages/components-angular/src/TimeRangePicker.ts:122`; regression: `packages/components-angular/src/TimeRangePicker.customExtra.test.ts:78`.

The new wrapper contains native `change` bubbling with `(change)="$event.stopPropagation()"`. The build-first Angular suite passes, including the real TestBed consumer regression. Independently rerunning the round-1 native-radio and DS RadioGroup reproductions against the newly built component now records **zero** pre-Apply `(change)` payloads. Consumer draft still becomes `acquisition`. Cancel emits no range, reopening reseeds `document`, and Apply emits exactly one unchanged absolute range while committing acquisition. The documented `range = next` consumer remains a valid TimeRange after a radio edit and renders without the previous `RangeError`.

The projection/draft probe no longer includes the round-1 consumer-side `stopPropagation` workaround. The component fix alone passes it. A separate composition probe demonstrates that native target listeners, ancestor listeners **inside** the projected content, DS `[onChange]`, and DS `(valueChange)` all still run. Native `input` still bubbles. Capture-phase `change` observers above the wrapper still receive the event. Bubbling `change` delegation above the wrapper is suppressed deliberately; consumers needing that DOM signal can handle it inside their projected subtree, or use capture. No breakage of the documented draft handlers or component outputs was reproduced.

### R1-astra-2 — React notification follows focus management

**Status: fixed.** Source: `packages/components-react/src/TimeRangePicker.tsx:243`; committed regression: `packages/components-react/src/TimeRangePicker.test.tsx:601`.

The notification effect now precedes the focus effect. The new React regression passes. Independent probes across React (under StrictMode), Svelte, and Vue confirm the same observations on both transitions: the opening callback sees the trigger focused; the closing callback runs before focus has returned to the trigger. A closing callback that focuses an external destination is subsequently followed by the picker's restoration to the trigger in all three frameworks. React's previous final-focus difference is gone. The child mount-effect ordering described above does not refute this fix: the finding concerned the picker's focus-management effect, not child effects.

### R1-sol-F2 — Angular lacks Escape/outside dismissal and focus trapping

**Status: not fixed; acceptable for this PR as pre-existing, non-blocking debt.** Source: `packages/components-angular/src/TimeRangePicker.ts:85`.

The mounted probe still observes Escape from the extra leaving the dialog open, an outside pointerdown leaving it open, and Tab from Apply receiving no endpoint wrap. Only the open notification `[true]` occurs until Cancel, which then reports false. `git show origin/main:packages/components-angular/src/TimeRangePicker.ts` confirms the existing implementation already lacks keyboard/window/document handlers; the reviewed diff adds none. The customExtra fix neither introduces nor worsens that gap. Addressing the Angular interaction lifecycle is a separate bounded parity change, so this finding does not gate the extension API.

## Reproduction log

Commands use the required RTK prefix. Outputs below retain result summaries and relevant probe observations; routine passing-test lines are omitted. Every listed test command exited 0.

### Target and PR

From the worktree root:

```sh
rtk proxy git rev-parse HEAD
rtk proxy git rev-parse --abbrev-ref HEAD
rtk git diff --stat origin/main...349f80ba
rtk git diff --stat 54457e4c 349f80ba
rtk gh pr view 157
rtk gh pr view 157 --json number,state,headRefName,headRefOid,baseRefName,url
```

```text
HEAD: 349f80baf017b8d3854e6f3d8755385f5f915517
branch: feat/timerangepicker-custom-extra
Target diff: 21 files changed, 660 insertions(+), 24 deletions(-)
Round-2 corrective diff: 4 files changed, 140 insertions(+), 11 deletions(-)
PR #157: OPEN; base main; head feat/timerangepicker-custom-extra
PR headRefOid: 349f80baf017b8d3854e6f3d8755385f5f915517
```

### Supplied TimeRangePicker tests

| Working directory | Command | Output |
| --- | --- | --- |
| `packages/components-svelte` | `rtk npx vitest run src/lib/TimeRangePicker.test.ts` | `Test Files 1 passed (1); Tests 54 passed (54); Duration 20.38s` |
| `packages/components-react` | `rtk npx vitest run src/TimeRangePicker.test.tsx` | `Test Files 1 passed (1); Tests 55 passed (55); Duration 2.88s` |
| `packages/components-vue` | `rtk npx vitest run src/TimeRangePicker.test.ts` | `Test Files 1 passed (1); Tests 54 passed (54); Duration 3.98s` |
| `packages/components-angular` | `rtk npm test` | Build succeeded; `Test Files 17 passed (17); Tests 423 passed (423); Duration 4.87s` |
| `packages/components-angular` | `rtk npx vitest run --config vitest.config.ts src/TimeRangePicker.test.ts src/TimeRangePicker.customExtra.test.ts --reporter=verbose` | `Test Files 2 passed (2); Tests 26 passed (26); Duration 1.26s` |

The focused Angular run confirms 24 picker/helper tests plus both mounted consumer regressions. Angular build output includes NG8107/NG8102 warnings in other components; npm warns about `globalignorefile`. These commands still exit 0. No full Svelte suite was run, so this review makes no claim about resolving the six known unrelated workspace-import failures. The PR description's 54 React / 421 Angular counts are from before the corrective tests; the current observed counts are 55 / 423.

### Independent edge probes

Reused the archived round-1 reproduction fixtures, inspected their source, removed the consumer-side Angular containment workaround, changed the old docs-corruption assertion to require preservation, and added cross-framework focus-order and Angular listener-composition checks. All probe files were temporary and untracked.

| Working directory | Command | Output |
| --- | --- | --- |
| `packages/components-svelte` | `rtk npx vitest run src/lib/__pr157_round2_sol.test.ts --reporter=verbose` | `Test Files 1 passed (1); Tests 6 passed (6); Duration 15.04s` |
| `packages/components-react` | `rtk npx vitest run src/__pr157_round2_sol.test.tsx --reporter=verbose` | `Test Files 1 passed (1); Tests 7 passed (7); Duration 2.14s` |
| `packages/components-vue` | `rtk npx vitest run src/__pr157_round2_sol.test.ts --reporter=verbose` | `Test Files 1 passed (1); Tests 5 passed (5); Duration 1.29s` |
| `packages/components-angular` | `rtk npx vitest run --config vitest.config.ts src/__pr157_round2_sol.test.ts --reporter=verbose` | `Test Files 1 passed (1); Tests 9 passed (9); Duration 1.77s` |
| `packages/components-svelte` | `rtk npx vitest run src/lib/__pr157_round2_sol_docs.test.ts --reporter=verbose` | `Test Files 1 passed (1); Tests 1 passed (1); Duration 15.91s` |

Relevant output:

```text
SVELTE staged close/Apply events [true,false,true,false,true,false,true,false]
REACT StrictMode staged events [true,false,true,false,true,false,true,false]
VUE staged events [true,false,true,false,true,false,true,false]
Each commits only [{"next":{"mode":"absolute","from":1704121200000,"to":1704213000000},"draft":"acquisition"}]

SVELTE rapid toggles [true,false]
REACT batched toggles [[true],[false]]
VUE watch same-tick/latest-handler [[true]] [[false]]
REACT first-open effect order ["open true","extra layout","extra passive"]
REACT reopen effect order ["extra layout","extra passive","open true"]
SVELTE / REACT / VUE focus order:
  { openingSawTrigger: true, closingSawTrigger: false, finalFocus: 'trigger' }

ANGULAR projection cycles/staged events [true,false,true,false]
  commits [{"next":{"mode":"absolute","from":1704121200000,"to":1704213000000},"draft":"acquisition"}]
ANGULAR empty host {"nodes":0,"empty":true,"display":"none"}
ANGULAR pre-Apply consumer (change) payloads [] draftBasis acquisition
ANGULAR docs commit pattern preserved {"mode":"absolute","from":1704121200000,"to":1704213000000}
ANGULAR containment composition:
  { atTarget: 1, inside: 2, hostBubbled: 0, hostCaptured: 2,
    inputBubbled: 2, valueChange: ['acquisition'] }
ANGULAR synchronous rapid toggles [true,false]
ANGULAR keyboard/outside:
  {"afterEscape":true,"tabPrevented":false,"focusAfterTab":true,"afterOutside":true,"events":[true]}

DOCS extracted live demo: Cancel/reopen reseeds; unchanged-range Apply commits acquisition.
```

The passing Angular keyboard/outside probe asserts the existing bad behavior; its green result does not mean Angular has a focus trap or Escape dismissal.

Probe sources and fixtures are retained at `/tmp/pr-157-leg-sol-r2-349f80ba/`, grouped by framework; `files.json` lists their original worktree paths. To repeat, copy the relevant framework files back to those untracked paths and run the commands above, then remove them. The Svelte probes need their corresponding Host/Docs fixtures. Angular requires the preceding build-first `npm test`.

### CSS, pins, baseline, and worktree preservation

From the worktree root:

```sh
rtk node /tmp/pr-157-leg-sol-r2-349f80ba/check-css-versions.mjs
rtk git diff --check origin/main...349f80ba
rtk proxy git diff --exit-code
rtk proxy git status --porcelain=v1 --untracked-files=normal
```

```text
Svelte declarations: ["display: flex","flex-direction: column","gap: var(--st-spacing-2, 0.5rem)"]
react: same declarations=true; :empty=["display: none"]
vue: same declarations=true; :empty=["display: none"]
angular: same declarations=true; :empty=["display: none"]
svelte: package=0.35.1, lock=0.35.1, docs=0.35.1, docs lock=0.35.1, dataviz=0.35.1, dataviz lock=0.35.1, all aligned=true
react: package=0.37.1, lock=0.37.1, docs=0.37.1, docs lock=0.37.1, dataviz=0.37.1, dataviz lock=0.37.1, all aligned=true
vue: package=0.37.1, lock=0.37.1, docs=0.37.1, docs lock=0.37.1, dataviz=0.37.1, dataviz lock=0.37.1, all aligned=true
Angular baseline: keyboard/window/document handlers present=false, projection present=false
diff --check: exit 0
worktree diff --exit-code: no tracked changes, exit 0
status after removing seven temporary probe files: ?? .reviews/
```

## Findings

No new blocking or non-blocking defect was demonstrated in the corrective diff. Both previously claimed fixes are verified in the dedicated section above.

### Carried R1-sol-F2 — Angular keyboard and focus parity

- **Severity:** non-blocking; pre-existing on `origin/main`, accepted outside this PR's scope.
- **File:line:** `packages/components-angular/src/TimeRangePicker.ts:85`.
- **Evidence:** Mounted projected-control reproduction records `afterEscape: true`, `afterOutside: true`, `tabPrevented: false`, and open notifications `[true]` until Cancel. The baseline source has no corresponding dismissal or focus-trap handlers. The new slot and containment fix preserve the existing behavior.
- **Fix:** Optional separate follow-up: implement Angular Escape/outside-pointer dismissal, endpoint Tab trapping, and focus restoration; route actual dismissal through `close()` so `openChange(false)` fires exactly once. Verify with a mounted consumer containing projected focusable controls. Owner: to be assigned. No follow-up item or implementation change was created by this review.

## Verdict

**GO-with-nits.** The blocking Angular pre-Apply event leak is fixed, the React notification/focus ordering issue is fixed, and the requested tests and edge probes pass. The remaining nit is Angular's demonstrated, pre-existing interaction gap, which is acceptable outside the scope of this extension API. No new merge blocker was reproduced.

This verdict is a review result only. PR #157 remains OPEN at the requested head. No publication, tag, push, commit, or merge was performed. Only this review artifact was edited persistently; temporary untracked probes were removed, and tracked implementation files remain unchanged.
