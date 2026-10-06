# Review dossier — sent-tech-design-system PR #157 (TimeRangePicker customExtra + onOpenChange)

Stored here because radar-immobilier PR #823 consumes it. Legs ran in the DS worktree (.reviews/pr-157).

status: completed
round: 2
round-1 (target 54457e4c): astra NO-GO, sol NO-GO
  F1 (blocking, both legs): Angular — projected radio's native change bubbled to the host and reached the consumer's (change) binding before Apply.
  astra-2 (non-blocking): React onOpenChange ran after focus management, unlike Svelte/Vue.
  sol-F2 (non-blocking, pre-existing on main): Angular has no Escape/outside dismissal or focus trap.
fix: 349f80ba (wrapper stops change propagation + mounted TestBed consumer test; React notification effect moved first + test)
round-2 (target 349f80ba): astra GO, sol GO-with-nits (only the pre-existing Angular lifecycle gap, accepted out of scope)
consensus-verdict: GO-with-nits
post-review: 8c3e21a2 restores dataviz-* manifests (CI licensing/provenance check), lockfile only.

visual-proof: screenshot-docs-demo-popover.png — DS docs demo, Custom tab with « Base de date »; « Base appliquée » goes document → acquisition only after Appliquer.
