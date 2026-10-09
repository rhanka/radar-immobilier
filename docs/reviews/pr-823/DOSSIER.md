# Review dossier — PR #823 (« Base de date » in the picker's « Personnalisé » tab)

review-author:
  host: claude
  model: claude-opus-5-5
target-ref: fix/date-basis-in-custom-tab@6af5a86231a80a3f3153a9959a0f053ed3e894a8 (diff origin/main...6af5a862)

status: completed
round: 1
legs:
  - path: docs/reviews/pr-823/leg-astra.md
    lens: behavioural-correctness-and-contract-preservation
    status: completed
    verdict: GO
  - path: docs/reviews/pr-823/leg-sol.md
    lens: reproduction-dependency-readiness-and-accessibility
    status: completed
    verdict: NO-GO (merge readiness only)
consensus-verdict: GO on behaviour; NOT merge-ready until the DS release is published

findings:
  sol F1 (blocking for merge, expected while DRAFT): @sentropic/design-system-svelte 0.35.1 is not on npm; lockfile still at 0.34.71; CI install fails. Fix = publish DS 0.35.1 (sent-tech-design-system PR #157), regenerate lockfile via Make, green CI.
  sol F2 (non-blocking, doc): override rationale listed only part of chat-ui's DS imports. Fixed in the PR description (no code change).

visual-proof: docs/reviews/pr-823/screenshot-custom-tab-local.png — local dev stack (ENV=test-date-basis-custom-tab, DS 0.35.1 tarball in the test volume only), headless chromium, session mocked in the browser (authDisabled). Rail: no « Base de date »; picker « Personnalisé » tab: « Base de date » above Début / Fin. After « Appliquer »: URL filter.dateBasis=acquisition&filter.dateFrom=…&filter.dateTo=…, trigger shows the custom range.

observed-deviation: h2a_run unavailable; legs launched with codex exec directly (seat, no API key).
