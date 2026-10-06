status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: feat/timerangepicker-custom-extra@54457e4c1203e0f5d919fb16fe6991db2294e37f
lens: api-design-and-cross-framework-parity

## Reasoning

Reviewed independently, without reading other reviewers' artifacts. Read `gh pr view 157` and the target diff `git diff origin/main...54457e4c`. HEAD is `54457e4c1203e0f5d919fb16fe6991db2294e37f`; the comparison merge base is `0ce2c48fd7a664d325f27aad6b4b9bcfc59bde2b`.

- **API scope:** The additions are small and optional: a framework-native content extension plus an open-state notification. They leave the `TimeRange` representation and consumer ownership of extra state intact. React removes both new props before spreading DOM attributes; Vue declares `openChange` as an emitted event.
- **Placement and absence:** All four implementations place the extension inside Custom, above From/To and before Cancel/Apply. Svelte, React and Vue omit the wrapper when the extension is not supplied. Angular deliberately retains an empty projection wrapper and hides it with `:empty { display: none; }`; this is a structural difference, with no demonstrated visible regression when unused. The three global stylesheets have matching additions. Existing calendar/layout differences are outside this change.
- **Transitions and Apply:** The new notifications do not fire on mount. Svelte/React track the last reported state, Vue watches changes without `immediate`, and Angular guards repeated open/close calls. The Apply paths still commit unconditionally for a valid draft, including an unchanged absolute range. The supplied regression tests pass. Callback ordering relative to focus differs, as detailed in finding 2.
- **Docs:** The two API rows and framework-specific binding names match the implementations: Svelte snippet, React node, Vue `#customExtra` / `@open-change`, Angular projection / `(openChange)`. The React radio example uses the real `RadioGroup.onChange(value)` API. I mounted a virtual Svelte fixture containing the actual demo's state/handlers and markup, with local component imports: editing remained staged, Cancel/Escape/outside click preserved the applied basis, reopening reseeded the draft, and Apply committed a changed basis with an unchanged range. This validates the demo's behavior, not a full docs build. The Angular usage exposes finding 1.
- **Versions:** Component manifests and lockfile agree on Svelte 0.35.1 and React/Vue/Angular 0.37.1. Docs dependencies and dataviz adapter pins agree with the lockfile. Angular was already 0.37.1 on `origin/main`. The actual publish workflows use separate `svelte-v*`, `react-v*`, `vue-v*`, and `angular-v*` tags; there is no reason to synchronize these package versions or bump Angular again for this pending release.

Verification performed:

- Svelte: `npx vitest run src/lib/TimeRangePicker.test.ts` — 54/54 passed.
- React: `npx vitest run src/TimeRangePicker.test.tsx` — 54/54 passed.
- Vue: `npx vitest run src/TimeRangePicker.test.ts` — 54/54 passed.
- Angular: `npm test` — build succeeded, 421/421 tests passed.
- `git diff --check origin/main...54457e4c` — passed.
- Additional mounted probes were injected through a Vite transform in memory, without editing source/test files. They reproduced both findings below. A mounted Angular consumer verified placement, close/reopen projection, draft reseeding, and unchanged-range Apply; comparing native-event containment on/off isolated finding 1. The extracted live-docs probe passed.

The existing Angular customExtra test checks the compiled projection selector and exercises bare class instances. It does not exercise a consumer template's `(change)` binding, which is why the full supplied suite misses the blocking issue. I did not rerun the unrelated full Svelte suite or claim its known workspace-import failures were resolved.

## Findings

### 1. Projected Angular radio changes reach the range callback before Apply

- **Severity:** blocking
- **File:line:** `packages/components-angular/src/TimeRangePicker.ts:118` (new projection wrapper); affected documented usage: `apps/docs/src/routes/components/time-range-picker/+page.svelte:85`.
- **Evidence:** A mounted Angular consumer using the real DS `RadioGroup` reproduces this with the documented shape:

  ```html
  <st-time-range-picker [value]="range" locale="en-US"
    (openChange)="opened($event)" (change)="changed($event)">
    <div slot="customExtra">
      <st-radio-group legend="Date basis" name="basis"
        [options]="options" [value]="draft"
        (valueChange)="draft = $event"></st-radio-group>
    </div>
  </st-time-range-picker>
  ```

  Start with a valid absolute range and the document basis. Open Custom and click the acquisition radio. Before Apply, `changed` has already received one native `Event` with `type === "change"`, rather than a `TimeRange`. Angular's host `(change)` binding receives the radio's bubbling DOM event in addition to subscribing to the component output. The newly added wrapper does not contain that event.

  The asserted sequence after edit → Cancel → reopen → edit → Apply was `[native change, native change, absolute TimeRange]`; the required sequence is `[absolute TimeRange]`. No mount notification occurred, and open notifications were correctly `[true, false, true, false]`. This is a leak into the consumer binding, not a claim that `TimeRangePicker.change.emit` explicitly emitted the DOM event.

  Consequently the documented `onRangeChange(next)` handler assigns a DOM event to `range` before Apply. A consumer that records only absolute changes still receives an invalid callback payload. This violates both the staged contract and framework parity for the stated radio-group use case.
- **Fix:** Contain native `change` bubbling at the new projection wrapper, for example `(change)="$event.stopPropagation()"`, while retaining the existing `change` output for committed ranges. An in-memory consumer probe adding that containment to the projected wrapper produced no callbacks during either radio edit and exactly one absolute callback on Apply. Add a mounted consumer-template regression using a radio/DS RadioGroup; subscribing to a bare instance's EventEmitter cannot catch this failure.

### 2. Open-state callbacks have different ordering relative to focus restoration

- **Severity:** non-blocking
- **File:line:** `packages/components-react/src/TimeRangePicker.tsx:266`; compare `packages/components-svelte/src/lib/TimeRangePicker.svelte:267` and `packages/components-vue/src/TimeRangePicker.ts:336`.
- **Evidence:** React runs the new notification effect after its focus-management effect, which restores focus synchronously at line 258. Svelte notifies before the separate effect schedules restoration through `tick`; Vue emits before scheduling restoration through `nextTick`.

  Mounted reproduction: focus the trigger, open, focus Cancel, and cancel with an `onOpenChange(false)` handler that focuses an external destination button. Flush the framework's pending updates.

  | Observation | React | Svelte | Vue |
  | --- | --- | --- | --- |
  | Trigger focused inside the close callback | Yes | No | No |
  | Final focus after the callback focuses the destination | Destination | Trigger | Trigger |

  The same callback therefore preserves consumer-directed focus in React and has it overwritten in Svelte/Vue. Opening also differs: the callback sees focus already moved inside in React, but still on the trigger in Svelte/Vue. These results were asserted against the mounted implementations. This does not prevent the documented draft-only callback from working, so it is not independently a merge blocker. Angular's pre-existing absence of equivalent focus restoration is not attributed to this PR.
- **Fix:** Choose and document one notification order relative to focus management, align the new callbacks to it, and add the same focus-order assertion across the implementations with focus restoration. Moving React's notification before its focus effect would match the current Svelte/Vue order; alternatively, consistently notify after restoration if consumer-directed focus should win.

## Verdict

**NO-GO.** Finding 1 breaks the principal Apply-only draft contract for an Angular consumer using the documented radio-group extension. Resolve it and verify through a mounted consumer before merging. Finding 2 is a demonstrated, non-blocking parity issue.

Only this review artifact was edited by this reviewer. No commit, push, tag, merge, or publication was performed.
