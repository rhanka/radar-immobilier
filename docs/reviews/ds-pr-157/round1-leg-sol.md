status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: feat/timerangepicker-custom-extra@54457e4c1203e0f5d919fb16fe6991db2294e37f
lens: reproduction-and-edge-cases

## Reasoning

Reviewed PR [#157](https://github.com/rhanka/sent-tech-design-system/pull/157) independently, without consulting other reviewers. Target was exactly `git diff origin/main...54457e4c`; HEAD was `54457e4c1203e0f5d919fb16fe6991db2294e37f`. Read the PR description using `gh pr view`. The intended contract is consumer-owned extra draft state, reseeded on open and committed through the absolute range notification only on Apply.

The existing four TimeRangePicker files all pass. Additional actual consumer-host tests reproduce one blocking defect: Angular's projected controls can send native DOM `change` events to the consumer's `(change)` listener before Apply. This occurs with both a native radio and the design system's `st-radio-group`. The new projection wrapper has no event boundary. Angular subscribes the template listener to the component output and also listens for the native event of the same name on the host. The picker does not call its EventEmitter for this radio edit, but the consumer's range callback still runs with an `Event`. Following the documented `range = next` handler corrupts the controlled range and causes `RangeError: Invalid time value` on the next rendering pass. This directly defeats the stated consumer integration.

The remaining requested probes refuted several possible failures:

- **Svelte:** no notification for the initial closed state; one notification per settled open/close; controlled value updates while open preserve both edited From/To and consumer draft; replacing the callback does not notify or reseed; the next close uses the new callback. Notification reads are untracked, and the consumer fixture's state updates did not cause notification loops.
- **React:** the consumer draft contract works under the installed React StrictMode, with no duplicated open/close or Apply notifications. Controlled updates and callback replacement preserve draft state. Effect ordering is observable: first open produced `open true -> extra layout -> extra passive`; reopen produced `extra layout -> extra passive -> open true`. Thus notification is not a guarantee of running before child mount effects. The tested controlled consumer draft converged correctly on every reopen; no failure is inferred from that ordering alone.
- **Vue:** `watch(panelOpen)` notifications run after the synchronous click handler and before the settled next-tick result. They do not run initially or when just the listener/value changes. The consumer draft is reseeded by the settled render. Controlled range updates preserve edits while open.
- **Rapid toggles:** two synchronous trigger clicks while closed coalesce to no notification in Svelte, React (inside `act`), and Vue; a close/reopen pair while already open likewise coalesces. Separately settled transitions notify `[true, false]`. Angular notifies the synchronous pair `[true, false]` immediately. These are demonstrated timing differences, not a reproduced user-visible draft failure: the coalesced cases never settle into an intermediate rendered panel state.
- **Angular projection:** actual TestBed DOM rendering places the extra above From/To and actions. Custom -> Relative -> Custom and close -> reopen preserve/reproject the same radio DOM node. With no projected content, the host has zero child nodes, matches `:empty`, and computes `display: none`. Projection/draft-positive tests explicitly stop native `change` propagation in the consumer wrapper to isolate them from finding F1; the unguarded defect is tested separately.
- **Keyboard/focus:** Svelte, React, and Vue recognize focus inside the extra as inside the panel, wrap Tab/Shift+Tab at panel endpoints, close on Escape from the extra, and restore focus to the trigger. Enter in an extra text input does not Apply or notify a range change. Angular also does not Apply on that Enter, but lacks the dismissal/trapping lifecycle, as detailed in F2.
- **Styles and versions:** after normalizing indentation, all three hand-maintained stylesheets have exactly Svelte's new `display: flex`, `flex-direction: column`, and `gap: var(--st-spacing-2, 0.5rem)` declarations. Their additional `:empty { display: none; }` rule is consistent and hides Angular's empty host. Svelte 0.35.1, React 0.37.1, and Vue 0.37.1 agree across package manifests, docs pins, dataviz pins, and corresponding lockfile entries.

Runtime probes used jsdom, not a real browser. Tab endpoint trapping and DOM focus were exercised; native browser Tab traversal, browser-synthesized Enter clicks on buttons, and visual layout were not claimed as verified. Installed versions: Node v22.22.1, Vitest 4.1.11, jsdom 27.4.0, Svelte 5.55.7, React/React DOM 19.3.0, Vue 3.5.35, Angular 21.2.24. No Python, publishing, tags, commits, pushes, or merges were used.

## Reproduction log

Commands below use the requested RTK prefix. Test outputs are the result summaries and relevant diagnostic lines; routine per-test success lines are omitted.

### Target and PR

From the worktree root:

```sh
rtk git rev-parse HEAD
rtk git diff --stat origin/main...54457e4c
rtk gh pr view 157 --json number,title,body,headRefName,headRefOid,baseRefName,state,url
```

```text
HEAD: 54457e4c1203e0f5d919fb16fe6991db2294e37f
Diff: 20 files changed, 531 insertions(+), 24 deletions(-)
PR: feat(timerangepicker): customExtra slot in the Custom tab + onOpenChange (4 frameworks)
headRefName: feat/timerangepicker-custom-extra
baseRefName: main
state: OPEN
```

### Existing test files

| Working directory | Command | Output | Exit |
|---|---|---|---|
| `packages/components-svelte` | `rtk npx vitest run src/lib/TimeRangePicker.test.ts` | `Test Files 1 passed (1); Tests 54 passed (54); Duration 20.89s` | 0 |
| `packages/components-react` | `rtk npx vitest run src/TimeRangePicker.test.tsx` | `Test Files 1 passed (1); Tests 54 passed (54); Duration 3.22s` | 0 |
| `packages/components-vue` | `rtk npx vitest run src/TimeRangePicker.test.ts` | `Test Files 1 passed (1); Tests 54 passed (54); Duration 4.03s` | 0 |
| `packages/components-angular` | `rtk npm test` | Angular build succeeded; `Test Files 16 passed (16); Tests 421 passed (421); Duration 4.43s` | 0 |
| `packages/components-angular` | `rtk npx vitest run --config vitest.config.ts src/TimeRangePicker.test.ts --reporter=verbose` | `Test Files 1 passed (1); Tests 24 passed (24); Duration 613ms` | 0 |

Angular's npm command executes `npm run build && vitest run --config vitest.config.ts src`; its build also builds tokens/themes and CSS. It printed NG8107 warnings for `ConfigItemCard.ts` optional chains and NG8102 for `ContentSwitcher.ts` nullish coalescing. npm printed its `Unknown builtin/env config "globalignorefile"` warning. Neither caused a failing exit. No full Svelte suite was run, so no additional claim is made about the six known unrelated import failures.

### Consumer-host edge probes

Created temporary, untracked `__pr157_leg_sol` tests next to each component and a Svelte host fixture. Executed:

| Working directory | Command | Final output | Exit |
|---|---|---|---|
| `packages/components-svelte` | `rtk npx vitest run src/lib/__pr157_leg_sol.test.ts --reporter=verbose` | `Test Files 1 passed (1); Tests 5 passed (5); Duration 14.51s` | 0 |
| `packages/components-react` | `rtk npx vitest run src/__pr157_leg_sol.test.tsx --reporter=verbose` | `Test Files 1 passed (1); Tests 6 passed (6); Duration 2.04s` | 0 |
| `packages/components-vue` | `rtk npx vitest run src/__pr157_leg_sol.test.ts --reporter=verbose` | `Test Files 1 passed (1); Tests 4 passed (4); Duration 1.25s` | 0 |
| `packages/components-angular` | `rtk npx vitest run --config vitest.config.ts src/__pr157_leg_sol.test.ts --reporter=verbose` | `Test Files 1 failed (1); Tests 1 failed, 7 passed (8); Duration 1.62s` | 1 |

The single final Angular failure is the Apply-only contract assertion. Two passing Angular probes separately assert the demonstrated bad keyboard lifecycle and docs-rendering error; their passing status means the bad behavior was reproduced, not that those behaviors are correct.

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

ANGULAR projection cycles/staged events [true,false,true,false]
ANGULAR empty host {"nodes":0,"empty":true,"display":"none"}
ANGULAR synchronous rapid toggles [true,false]
ANGULAR keyboard/outside {"afterEscape":true,"tabPrevented":false,"focusAfterTab":true,"afterOutside":true,"events":[true]}
ANGULAR pre-Apply consumer (change) payloads [{"constructor":"Event","type":"change","target":"native","mode":null},{"constructor":"Event","type":"change","target":"ds-basis","mode":null}] draftBasis acquisition
ANGULAR runtime boundary guard {"basis":"acquisition","seen":[{"mode":"absolute","from":1704121200000,"to":1704213000000}]}
ANGULAR docs commit pattern {"valueType":"Event","error":"RangeError: Invalid time value"}

FAIL should keep native and DS RadioGroup changes out of the TimeRange (change) listener until Apply
AssertionError: expected [ Array(2) ] to deeply equal []
Expected: []
Received: [Event { isTrusted: true }, Event { isTrusted: true }]
```

Initial probe-authoring runs had harness errors: Svelte interpreted the host's `events` prop as a render option until props were nested under `props`; Angular's CSS read used a non-file `import.meta.url`, and a leftover `TestBed.get` call was unsupported. These were corrected before the final runs above. Angular's premature radio notification remained reproducible after those corrections. The first raw CSS string comparison differed only in indentation; declaration comparison below resolved it.

Probe source and the final Angular output are archived outside the worktree at `/tmp/pr-157-leg-sol-54457e4c-0tfSrV/`, in `svelte/`, `react/`, `vue/`, and `angular/`. To repeat locally, restore the corresponding files to their original untracked locations and run the commands above; remove them afterward:

```sh
rtk cp /tmp/pr-157-leg-sol-54457e4c-0tfSrV/svelte/__pr157_leg_sol.test.ts packages/components-svelte/src/lib/
rtk cp /tmp/pr-157-leg-sol-54457e4c-0tfSrV/svelte/__pr157_leg_sol_Host.svelte packages/components-svelte/src/lib/
rtk cp /tmp/pr-157-leg-sol-54457e4c-0tfSrV/react/__pr157_leg_sol.test.tsx packages/components-react/src/
rtk cp /tmp/pr-157-leg-sol-54457e4c-0tfSrV/vue/__pr157_leg_sol.test.ts packages/components-vue/src/
rtk cp /tmp/pr-157-leg-sol-54457e4c-0tfSrV/angular/__pr157_leg_sol.test.ts packages/components-angular/src/
```

These temporary files were removed from the worktree after the review. The archive is local temporary evidence, not a committed artifact. A compact independent reproduction of F1 is also included under Findings.

### CSS, version pins, and baseline comparison

From the worktree root, the archived Node script reads the component CSS declarations, the affected manifests/lockfile, and `git show origin/main:packages/components-angular/src/TimeRangePicker.ts`:

```sh
rtk node /tmp/pr-157-leg-sol-54457e4c-0tfSrV/check-css-versions.mjs
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
```

After removing the temporary tests:

```sh
rtk git diff --exit-code
rtk git status --short
```

```text
git diff: no tracked changes, exit 0
git status: ?? .reviews/
```

## Findings

### F1 — Projected radio changes reach Angular's range callback before Apply

**Severity:** blocking.

**File:line:** `packages/components-angular/src/TimeRangePicker.ts:118` (projection wrapper); consumer example at `apps/docs/src/routes/components/time-range-picker/+page.svelte:85` and range assignment at line 92.

**Evidence:** With `[value]="range" (change)="onRangeChange($event)"`, opening Custom and clicking either a projected native radio or `st-radio-group` calls `onRangeChange` with a native `Event` before any Apply click. The final probe observed two such calls, each with `type: "change"` and no `mode`. The DS group's own draft handler still sets `basis` to `acquisition`. Changing the listener to the documented `range = next` behavior makes `range` an `Event`; the next `fixture.detectChanges()` throws `RangeError: Invalid time value`. The picker output emitter itself need not fire: the native event bubbles through the new slot to the component host's same-named Angular event listener. Existing Angular tests subscribe to class EventEmitters and inspect projection metadata; they cannot detect this host-listener collision.

Minimal reproduction in an Angular TestBed host (standalone imports `TimeRangePicker` and `RadioGroup`, imported from the freshly built `dist`):

```html
<st-time-range-picker [value]="range" locale="en-US" (change)="seen.push($event)">
  <div slot="customExtra">
    <st-radio-group name="basis" [value]="draftBasis"
      [options]="[{label:'Document',value:'document'},{label:'Acquisition',value:'acquisition'}]"
      [onChange]="setDraftBasis">
    </st-radio-group>
  </div>
</st-time-range-picker>
```

Use a valid absolute range, `draftBasis = 'document'`, `seen = []`, and `setDraftBasis = v => draftBasis = v`. Create the host, `detectChanges()`, click `.st-timeRangePicker__trigger`, `detectChanges()`, then click `st-radio-group input[value="acquisition"]`. Before Apply, `seen.length === 1` and `seen[0] instanceof Event`, whereas the contract requires zero notifications. With `onRangeChange(next) { range = next; }`, the next rendering pass fails as above.

**Fix:** Stop native DOM `change` propagation at the Angular extra wrapper, for example `(change)="$event.stopPropagation()"` on `.st-timeRangePicker__customExtra`, while preserving the public `change` output. A runtime listener on that exact wrapper was tested: the DS radio still updates its draft, the range listener stays silent during editing, and Apply sends exactly one unchanged absolute `TimeRange`. Add a real TestBed host regression test using `(change)` and a projected `st-radio-group`; assert silent radio edits, silent Cancel, and one range notification on Apply. Owner: PR author or to be assigned. Bounded scope: Angular's projection event boundary and the DOM-host regression test; acceptance is that the documented consumer can edit its date basis without changing its committed range until Apply.

### F2 — Angular has no Escape/outside dismissal or focus trap

**Severity:** non-blocking; existing on `origin/main`, not introduced by this PR.

**File:line:** `packages/components-angular/src/TimeRangePicker.ts:89` (open panel rendering) and line 196 (new cross-framework slot contract documentation).

**Evidence:** In the actual rendered host, Escape from the projected extra leaves the dialog open and produces no close notification. Pointerdown on an outside button also leaves it open. Tab from Apply is not prevented and no endpoint focus wrap is performed. The recorded result is `afterEscape: true, afterOutside: true, tabPrevented: false, events: [true]`. Cancel then produces `[true, false]`. Inspection of `origin/main` confirms the Angular component already lacked keyboard/window/document listeners; the other three frameworks' new extra controls continue to participate in their existing traps and dismissal handlers.

**Fix:** As a separate Angular parity follow-up, implement the component's Escape, outside-pointerdown, Tab-trap, and focus-return lifecycle and route actual close paths through `close()` so `openChange(false)` remains exactly once. Verify with a rendered projected-control host. Alternatively, explicitly document the current Angular interaction limitation until that work is scheduled. Owner: to be assigned. This observation does not independently gate the new extension API because it predates the reviewed diff.

## Verdict

**NO-GO.** F1 is a reproduced violation of the Apply-only contract for the exact Angular date-basis radio use case and breaks the documented controlled consumer. The existing suites are green, but the consumer-host regression is red. Svelte, React, and Vue passed the requested DOM/lifecycle probes. Fix the Angular event boundary and verify the real consumer-host test before reconsidering the PR. Keep the PR unmerged and unpublished.
