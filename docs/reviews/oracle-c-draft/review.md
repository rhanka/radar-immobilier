# Adversarial review — Astra max and Opus 5.5 max (retained scope)

Two independent read-only reviews of this folder on 2026-10-04, same brief, neither reviewer seeing
the other's text:

| Reviewer | Route | Duration |
|---|---|---:|
| Astra max | `codex exec -m gpt-6-astra -c model_reasoning_effort=max -s read-only` (ChatGPT seat) | 11 min |
| Opus 5.5 max | `claude -p --model claude-opus-5-5 --effort max`, tools Read/Grep/Glob only (Claude seat) | 30 min |

The folder has since been reduced, by owner decision, to the split, the test-set protocol, the
baseline of today's filters and the extension plan. The reconciliation below keeps only the
findings that bear on that scope. Verbatim reviews are kept outside the repository.

| Finding (Astra / Opus) | Severity | Decision | Where |
|---|---|---|---|
| F01 / B1 — set freeze had no git anchor | blocker | Split script committed before any model call (`6d79793a`); set hashes committed (`cbc1185d`); both reviewers re-derived the same hashes. | README, split-balance |
| F07 / m3 — chi-square read as proof of balance on an optimised, clustered split; "coin flip" = next PRNG draw | major | p-values called descriptive; side choice described as it is; seed rule for future splits. | `04-split.mjs`, split-balance, protocol |
| F08 / m4 — 9 lines scored with a cited record missing | major | Declared (5 development / 4 test); inputs kept as frozen. | split-balance, results |
| — / M2 — B vs another system is like-for-like only on the same lines; the universe excludes what B rightly removed | major | Measurement level and selection bias stated first; recall measured inside the 121-line universe only. | results |
| F11 / M3 — intervals ignored clustering | major | Municipality-clustered bootstrap for every precision, recall and F1. | `08-filter-metrics.mjs`, `06-score.mjs` |
| F10 / M5 — method differs from oracle E (one annotator, no adjudication, no "non résolu"); the test set is not D10's 52-city test set | major | Stated as limits; a virgin test set (Steve's next 52 municipalities) is the target for reference figures. | results, protocol, extension plan |
| F03, F04 / M6 — seat-only and isolation asserted; deny-list scrub; auth mode not logged | major | Scrub widened (keys, auth tokens, routing and cloud variables); isolated HOME, auth-mode receipts and event logs listed as prerequisites for the next runs. | `lib/models.mjs`, README |
| F05 / m5 — "single run" not provable; retries not logged; dataset hash not checked | major | Runner checks the set against `SHA256SUMS`, logs attempts, refuses a second test run of a prompt, logs every test access. | `05-run.mjs`, `lib/testset.mjs` |
| F06, F14 — JSON written before all metrics; permissive verdict parsing | major / minor | JSON written last; exact enum; verdict recomputed from tags when present. | `06-score.mjs`, `lib/derive-verdict.mjs` |
| F12 / M8 — extension labels circular; anchoring; no inter-annotator κ; Steve may see C | major | Gold = pre-reveal human call; 100 % human labels for test; ≥ 50 double-annotated items; no C exposure before the next survey is frozen. | extension plan |
| F13 / M7 — partition and counts incoherent; single-proportion sizing | major | Permanent municipality registry; counts by provenance; paired McNemar sizing. | extension plan |
| m7 — French section: self-attested items marked FAIT | minor | Labels aligned. | dossier-section-fr |
| m8 — read-only enforced client-side; no `updated_at` | minor | Declared; read-only role or replica recommended for the next read. | results limits |
| m9 — names from public minutes sent to providers | minor | Redaction recommended before the next runs. | protocol |

Both reviewers asked for a test-set discipline that the owner then made binding; it is implemented
in `TEST-SET-PROTOCOL.md` (sealing, frozen-prompt gate, single run, audit log, role separation,
author sandbox).
