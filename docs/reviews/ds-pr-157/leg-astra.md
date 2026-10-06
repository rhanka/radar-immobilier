status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: feat/timerangepicker-custom-extra@349f80baf017b8d3854e6f3d8755385f5f915517
lens: api-design-and-cross-framework-parity
round: 2

## Reasoning

Reviewed PR [#157](https://github.com/rhanka/sent-tech-design-system/pull/157) independently for API design and cross-framework parity. Read the description with `rtk gh pr view 157`, the full target `git diff origin/main...349f80ba`, and the corrective diff `git diff 54457e4c 349f80ba`. HEAD and the remote PR head are `349f80baf017b8d3854e6f3d8755385f5f915517`; the comparison merge base is `0ce2c48fd7a664d325f27aad6b4b9bcfc59bde2b`. Consulted only the permitted round-1 reports, not another reviewer's round-2 work.

- **API scope and compatibility:** The additions are optional framework-native content and notification APIs. They do not change `TimeRange`, introduce picker-owned extra state, or require changes to existing consumers. React destructures both new props before spreading DOM attributes; Vue declares `openChange` in `emits`. The Angular event boundary applies only to newly projected extra content.
- **Placement and absence:** All four implementations place the extra inside Custom, above From/To and before Cancel/Apply. Svelte, React and Vue omit the wrapper when no extension is supplied. Angular retains a projection wrapper with zero child nodes and hides it through `.st-timeRangePicker__customExtra:empty { display: none; }`. This is a DOM difference, but no visible gap or behavioral regression was demonstrated. The three global stylesheets match Svelte's new flex/column/gap declarations. Existing calendar/layout differences are unchanged.
- **Transitions and commits:** Svelte and React track the last reported open state, Vue uses a non-immediate watcher, and Angular guards repeated open/close calls. Mount does not notify. Notifications describe transitions, not changes to the listener or the draft. Apply still commits any valid absolute draft without an equality shortcut, so a changed extra can be committed with an unchanged range. All four supplied unchanged-range assertions pass. Focus ordering is addressed explicitly below; this does not claim identical framework scheduling or notification before child mount effects.
- **Documentation:** The API rows at `apps/docs/src/routes/components/time-range-picker/+page.svelte:430` and `:441` match the implementations. The usage at `:64` uses the correct Svelte snippet and lowercase RadioGroup `onchange`, React `customExtra`/`onOpenChange` and RadioGroup `onChange`, Vue `#customExtra`/`@open-change` with the supported `value` prop, and Angular `[slot=customExtra]`/`(openChange)`/`(change)`. The abbreviated cross-framework commit pattern conveys consumer ownership; it is not a complete framework-specific state declaration. An in-memory Svelte fixture extracted the actual demo state, handlers and markup from this page, replacing only imports and fixing the locale to English. Mounted assertions confirmed silent draft edits; unchanged applied basis after Cancel, Escape and outside dismissal; reseeding on reopen; and committing acquisition on Apply without changing the trigger's range. The next reopen retains the applied acquisition basis.
- **Versions and release conventions:** Svelte 0.35.1 and React/Vue 0.37.1 match their component manifests, docs pins, dataviz adapter pins, and corresponding lockfile entries. Angular remains 0.37.1, which is already the version on `origin/main`; leaving that stated pending, unpublished version alone is appropriate. The actual publish workflows use `svelte-v*`, `react-v*`, `vue-v*`, and `angular-v*`, each checking its own package version. No synchronized cross-package version or extra Angular bump is required by those workflows. No registry publication was attempted or independently inferred from local tags.

Verification performed in this round:

| Working directory | Command | Result |
| --- | --- | --- |
| `packages/components-svelte` | `rtk npx vitest run src/lib/TimeRangePicker.test.ts` | 54/54 passed |
| `packages/components-react` | `rtk npx vitest run src/TimeRangePicker.test.tsx` | 55/55 passed |
| `packages/components-vue` | `rtk npx vitest run src/TimeRangePicker.test.ts` | 54/54 passed |
| `packages/components-angular` | `rtk npm test` | Build succeeded; 423/423 tests in 17 files passed, including the new mounted consumer file |
| Repository root | `rtk git diff --check origin/main...349f80ba` | Passed |

Six additional mounted assertions passed: one focus-order probe for each of Svelte/React/Vue, two Angular boundary/absence/dismissal probes, and the actual-docs-demo probe. These ran through `vitest/node`'s `startVitest` with a Vite transform appending tests in memory to the existing target test modules; the docs fixture was also virtual. No probe source/test files were written. Existing tests were filtered out during these additional runs. A read-only Node check also asserted manifest/lockfile/pin agreement and matching CSS declarations.

Verification used jsdom, not a real browser. The virtual docs fixture generated a missing-source sourcemap warning and passed; Angular printed non-failing existing template diagnostics. The unrelated full Svelte suite and a full docs build were not rerun, and their status is not claimed here.

## Previous findings

### R1-F1 — Angular native `change` reaches the committed-range binding: fixed

**Evidence:** `packages/components-angular/src/TimeRangePicker.ts:122` now stops native `change` propagation on the internal extra wrapper. The public `change` EventEmitter still emits from `commit`, and the Apply path at `:394` still commits before closing. The new mounted TestBed regression at `packages/components-angular/src/TimeRangePicker.customExtra.test.ts:78` uses the real `st-radio-group` and consumer `(change)` binding. It passes: editing does not notify the range consumer; Cancel preserves the applied basis; reopening reseeds; Apply commits acquisition and emits exactly one absolute value; open notifications are `[true, false, true, false]`.

An independent mounted consumer exercised both a native radio and the DS RadioGroup, with `(change)` delegation on the consumer's own `<div slot="customExtra">`. After both edits, the native target handler, delegated wrapper handler, RadioGroup `[onChange]` callback and `(valueChange)` subscription had all run, while the picker's consumer `(change)` listener remained silent and the controlled range remained equal to its original value. Apply then emitted exactly that original absolute range once and committed acquisition. This also avoids relying on the supplied mounted test's comparison against a range already assigned by its handler.

**Regression assessment:** The boundary uses `stopPropagation`, not `preventDefault` or `stopImmediatePropagation`. Consumer handlers on projected descendants and the consumer's own projected wrapper remain below the boundary and work. Component EventEmitter subscriptions also remain intact. Native bubble-phase delegation outside the picker will no longer observe extra-control `change` events; that is the intended containment required to protect the existing committed-range `(change)` API. No previously supported extra slot existed, and no regression of the documented consumer binding patterns was demonstrated. No further fix is required for R1-F1.

### R1-astra-2 — React notification/focus ordering: fixed

**Evidence:** `packages/components-react/src/TimeRangePicker.tsx:239` now declares the notification effect before the focus-management effect at `:257`. The new test at `packages/components-react/src/TimeRangePicker.test.tsx:601` passes and asserts that the opening callback sees the trigger still focused. This matches the notification before `tick()` focus work in Svelte (`packages/components-svelte/src/lib/TimeRangePicker.svelte:266`) and before `nextTick()` focus work in Vue (`packages/components-vue/src/TimeRangePicker.ts:336`).

Independently repeated the original close-focus reproduction in all three mounted implementations, including React StrictMode: focus the trigger, open, focus Cancel, then close with a callback that focuses an external destination button. In all three, mount was silent, the opening callback saw the trigger, the closing callback ran before trigger restoration, and final focus was the trigger after the callback's destination focus was overwritten by restoration. Notifications were exactly `[true, false]`. The demonstrated round-1 ordering discrepancy is resolved for both opening and closing. Angular's existing absence of equivalent focus management is covered separately below.

### R1-sol-F2 — Angular Escape/outside dismissal and focus trap: not fixed; acceptable out of scope

**Evidence:** The Angular template still renders its own panel at `packages/components-angular/src/TimeRangePicker.ts:89`; the component still has no keyboard/outside-pointer listener or focus-management implementation. Reading `origin/main:packages/components-angular/src/TimeRangePicker.ts` confirms that the same lifecycle was absent before this PR. An independent mounted probe at the reviewed head confirmed that Escape and outside pointerdown leave the panel open, and Tab from Apply is not prevented. This is not silently treated as parity with the other frameworks.

**Disposition:** Acceptable for this PR because it is pre-existing, was explicitly excluded from the round-2 fix, and does not prevent the new extra controls from staging until Apply or being discarded through Cancel. The new notification must report actual transitions; an interaction that does not close Angular's panel appropriately produces no close notification. The shared documentation's Escape/outside wording should not be read as proof that Angular supports those dismissal paths. Any Angular dismissal/trap/focus-return implementation, and clarification of that limitation, remains a separate follow-up rather than a condition for accepting this extension. No follow-up files or tracked work were created.

## Findings

No new actionable findings survived verification. R1-F1 and R1-astra-2 are fixed. The known, pre-existing Angular lifecycle limitation remains explicitly documented under Previous findings and is not a blocker for this PR.

## Verdict

**GO.** The Apply-only consumer draft contract is now preserved for the documented Angular integration, React's notification ordering matches Svelte/Vue, and no new defect was demonstrated in the reviewed diff.

This is an independent review-leg verdict, not a consensus or authorization to release. PR #157 remains OPEN with `mergedAt: null`. The only review artifact edited by this reviewer is `.reviews/pr-157/leg-astra.md`; other reviewers' concurrent files were left untouched. No Python, commit, push, tag, merge or publication was performed.
