# v101b preliminary report v2

Offline snapshot generated at `2026-09-16T21:11:23.249Z` after the six direct Anthropic
transport replays completed. Oracle v2 was rescored for every non-Codex arm. Codex rows are a
descriptive in-progress snapshot only and therefore carry `N-A` F1 values. No blind judge result is
included.

Oracle F1 is computed on accepted outputs and complete-oracle documents only; Waterloo remains
excluded because its oracle is partial by construction. `F1 × acceptance` is macro F1 multiplied by
`accepted / processed`. Latency uses the latest terminal receipt per document. Tokens are observed
totals. USD/doc is total metered cost divided by processed documents; subscription transports and
providers without a configured tariff are `N-A`. Failure columns are mutually descriptive layers on
the latest terminal receipts.

| Arm | Model | Effort | Status | Accepted/N | F1 v2 macro | F1 v2 micro | F1 × acceptance | p50 / p95 | Input / output tokens | USD/doc | Transport replays | Transport | 429 | JSON | Profile | Provenance | Budget |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gemini-low | Gemini 3.8 Flash | low | completed | 85/100 | 0.518 | 0.514 | 0.441 | 15.3 / 37.0 s | 1646755 / 674257 | N-A | 0 | 0 | 0 | 0 | 7 | 8 | 0 |
| gemini-medium | Gemini 3.8 Flash | medium | completed | 79/100 | 0.423 | 0.400 | 0.334 | 27.0 / 44.6 s | 1646755 / 636023 | N-A | 0 | 0 | 0 | 0 | 12 | 9 | 0 |
| gemini-high | Gemini 3.8 Flash | high | completed | 53/100 | 0.518 | 0.514 | 0.275 | 69.0 / 88.4 s | 1646755 / 718689 | N-A | 0 | 0 | 0 | 44 | 2 | 1 | 0 |
| luna-low | GPT-5.6 Luna | low | completed | 39/100 | N-A | N-A | N-A | 94.8 / 168.2 s | 1485731 / 527283 | N-A | 0 | 2 | 0 | 0 | 50 | 9 | 0 |
| luna-medium | GPT-5.6 Luna | medium | completed | 51/100 | N-A | N-A | N-A | 126.6 / 216.8 s | 1486766 / 709419 | N-A | 0 | 2 | 0 | 2 | 36 | 9 | 0 |
| luna-high | GPT-5.6 Luna | high | completed | 43/100 | N-A | N-A | N-A | 247.8 / 480.0 s | 1213911 / 1242547 | N-A | 0 | 13 | 0 | 1 | 33 | 10 | 0 |
| luna-xhigh | GPT-5.6 Luna | xhigh | partial / circuit | 22/44 | N-A | N-A | N-A | 289.2 / 718.8 s | 274471 / 591060 | N-A | 0 | 12 | 0 | 0 | 6 | 4 | 2 |
| gpt41 | GPT-4.1 | off | completed | 64/100 | 0.000 | 0.000 | 0.000 | 17.2 / 41.3 s | 1488852 / 285589 | 0.0526 | 0 | 3 | 0 | 0 | 16 | 17 | 0 |
| sonnet46-cloud-off | Claude Sonnet 4.6 | off | partial / circuit | 32/56 | N-A | N-A | N-A | 64.1 / 146.8 s | 526599 / 431329 | N-A | 0 | 10 | 0 | 0 | 10 | 4 | 0 |
| sonnet46-cloud-low | Claude Sonnet 4.6 | low | partial / circuit | 14/29 | N-A | N-A | N-A | 0.7 / 93.7 s | 121952 / 113572 | N-A | 0 | 15 | 1 | 0 | 0 | 0 | 0 |
| sonnet46-cloud-high | Claude Sonnet 4.6 | high | partial / circuit | 0/15 | N-A | N-A | N-A | 0.3 / 0.4 s | 0 / 0 | N-A | 0 | 15 | 0 | 0 | 0 | 0 | 0 |
| sonnet5-off | Claude Sonnet 5 | off | completed | 62/100 | 0.528 | 0.485 | 0.327 | 113.2 / 242.7 s | 2461352 / 1791894 | 0.2284 | 26 | 1 | 0 | 13 | 12 | 12 | 0 |
| sonnet5-low | Claude Sonnet 5 | low | completed | 58/100 | 0.512 | 0.421 | 0.297 | 38.0 / 71.2 s | 2496910 / 614966 | 0.1114 | 20 | 0 | 0 | 2 | 18 | 22 | 0 |
| sonnet5-high | Claude Sonnet 5 | high | completed | 70/100 | 0.396 | 0.351 | 0.277 | 121.4 / 249.4 s | 2496910 / 1795947 | 0.2295 | 20 | 0 | 0 | 13 | 8 | 9 | 0 |
| opus5-off | Claude Opus 5 | off | completed | 68/100 | 0.502 | 0.462 | 0.341 | 167.0 / 279.0 s | 2496910 / 2103477 | 0.6507 | 13 | 0 | 0 | 24 | 4 | 4 | 0 |
| opus5-low | Claude Opus 5 | low | completed | 74/100 | 0.386 | 0.378 | 0.286 | 79.3 / 157.0 s | 2496910 / 1090871 | 0.3976 | 40 | 0 | 0 | 2 | 14 | 10 | 0 |
| opus5-high | Claude Opus 5 | high | completed | 63/100 | 0.523 | 0.486 | 0.330 | 158.0 / 276.8 s | 2496910 / 2089305 | 0.6472 | 40 | 0 | 0 | 24 | 6 | 7 | 0 |
| sol-low | GPT-5.6 Sol | low | partial / circuit | 70/87 | N-A | N-A | N-A | 117.5 / 211.4 s | 1106987 / 511985 | N-A | 0 | 9 | 0 | 0 | 1 | 7 | 0 |
| sol-medium | GPT-5.6 Sol | medium | in progress | 67/70 | N-A | N-A | N-A | 164.4 / 293.3 s | 823782 / 658244 | N-A | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| sol-high | GPT-5.6 Sol | high | in progress | 51/55 | N-A | N-A | N-A | 218.2 / 411.3 s | 513618 / 644708 | N-A | 0 | 3 | 0 | 0 | 0 | 1 | 0 |
| sol-xhigh | GPT-5.6 Sol | xhigh | in progress | 2/3 | N-A | N-A | N-A | 191.5 / 480.0 s | 14209 / 18276 | N-A | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| astra-low | GPT-6 Astra | low | in progress | 3/3 | N-A | N-A | N-A | 138.8 / 205.9 s | 22148 / 13744 | N-A | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-medium | GPT-6 Astra | medium | in progress | 3/3 | N-A | N-A | N-A | 117.4 / 140.4 s | 22148 / 10923 | N-A | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-high | GPT-6 Astra | high | in progress | 2/3 | N-A | N-A | N-A | 192.8 / 480.0 s | 14209 / 11372 | N-A | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| astra-xhigh | GPT-6 Astra | xhigh | in progress | 2/3 | N-A | N-A | N-A | 320.3 / 480.0 s | 14209 / 17476 | N-A | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| mistral-small4 | Mistral Small 4 | off | completed | 40/100 | 0.250 | 0.286 | 0.100 | 15.9 / 63.0 s | 1598919 / 400095 | 0.0048 | 0 | 4 | 0 | 0 | 28 | 28 | 0 |

## Gemini low vs medium vs high

LOW has the highest acceptance rate (85/100), the lowest latency (15.3 s p50), and the highest
acceptance-adjusted F1 (0.441). HIGH has the same accepted-output macro and micro F1 as LOW
(0.518 / 0.514), but its 44 JSON failures reduce acceptance to 53/100 and adjusted F1 to 0.275.
MEDIUM is between them on acceptance and latency (79/100; 27.0 s p50), with lower accepted-output
F1 (0.423 / 0.400) and adjusted F1 0.334. These measurements do not revise the existing owner choice
of MEDIUM; they are inputs to the later final benchmark decision.

## Sonnet 5 / Opus 5 vs Gemini

Among accepted outputs, Sonnet 5 OFF has the highest macro F1 in this snapshot (0.528), followed by
Opus 5 HIGH (0.523) and Gemini LOW/HIGH (0.518). Acceptance changes the ordering: Gemini LOW leads
on adjusted F1 at 0.441. The strongest Anthropic adjusted values are Opus 5 OFF at 0.341, Opus 5
HIGH at 0.330, and Sonnet 5 OFF at 0.327.

Opus 5 LOW has the highest Anthropic acceptance rate (74/100), still below Gemini LOW (85/100), and
its macro F1 is 0.386. The fastest direct Anthropic arm is Sonnet 5 LOW at 38.0 s p50, compared with
15.3 s for Gemini LOW and 27.0 s for Gemini MEDIUM. Direct Anthropic metered costs range from
0.1114 USD/doc (Sonnet 5 LOW) to 0.6507 USD/doc (Opus 5 OFF); no configured Gemini tariff is
available, so no cross-provider cost ratio is reported.

## GPT-4.1 anomaly

The 0.000 F1 is not an identifier shift. Manifest document SHA-256 values match oracle `doc_sha`
values, and all five oracle documents have accepted GPT-4.1 outputs with PDF citations. Those
outputs contain 18 eligible Bylaw groups: 17 have no `stage`, `stade`, or `etape`; the remaining
group uses `1er_projet` but its excerpt does not contain the complete oracle anchor. Exact stage and
anchor gates therefore produce zero true positives.

The investigation did expose a separate scorer defect: contract-valid Bylaw stages
`projet/1er_projet/2e_projet` were compared directly with oracle stages
`projet_reglement/second_projet`. The scorer now canonicalizes those values identically for every
arm. GPT-4.1 remains at 0.000 after the corrected rescore, confirming that missing stage/anchor
content is the remaining cause.

## Transport replay and traceability

The opt-in replay targeted exactly 159 latest transport failures: Sonnet 5 OFF 26, LOW 20, HIGH 20;
Opus 5 OFF 13, LOW 40, HIGH 40. All 159 new receipts are terminal `completed`; no new transport
failure, attempt 4, or Anthropic 429 occurred. Acceptance moved from 52 to 62, 49 to 58, 63 to 70,
65 to 68, 48 to 74, and 49 to 63 respectively.

The initial inventory contained 756 Anthropic receipts and the final inventory 915. SHA-256 checks
of all 756 initial files passed after the replay; no receipt was modified or removed. The first 22
Sonnet 5 OFF `attempt-3` receipts retain `retry.previousAttempt: 1` because the producer still used
the historical hard-coded value during that first process. Their filenames and `attemptNumber` are
correct, and no metric reads this metadata. The producer was corrected before the other five arms;
the immutable receipts were not rewritten.

Source metrics are `oracle-v2-comparison.json` and `report-data.json`. The oracle comparison contains
the 14 non-Codex arms only. Codex generation remained active during this snapshot and was not
modified. Blind judges remain reserved for the final report.
