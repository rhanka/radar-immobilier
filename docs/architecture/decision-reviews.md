# Decision dossier review records

Status: Codex completed; Opus unavailable due to the native account's weekly
limit. **Not consensus, not owner approval.** No retry through a different account.

- Codex pass: `h2a run` via MCP, `immo-decision-codex-d1`, runtime-attested
  `gpt-6-astra`, high effort; read-only inline D1 dossier and continuation audit.
- Opus pass: `h2a run` via MCP, `immo-decision-opus-d1`, native `opus` alias,
  requested effort high; same packet, no access to the Codex response. Launch
  succeeded but execution exited 1: weekly limit; **no Opus review produced**.
- No renderer implementation, new proposal scene or live cluster was independently
  tested by those text-only reviews. [Codex's actual findings](decision-review-codex.md)
  are preserved, not replaced by this reconciliation.

| Codex finding | Reconciliation in D2 | Remaining gap |
| --- | --- | --- |
| H1: production/shared-consumer inventory too late | G0 covers every affected consumer; G5 only verified preprod-exclusive resources | Actual inventory |
| H2: credential continuity lacks a gate | G1b refresh/restart/recovery + exclusive credential writer before durable operation | Operated identity contract and tests |
| H3: recovery consistency undefined | Coordinated write fence; graph hash, SQL checkpoint and evidence set; intervening-write policy required | Owner RPO/RTO and restore rehearsal |
| M4: SCW storage/images not covered by MinIO gate | Executable dependency inventory/replacement and rollback-image checks added; TEM excluded | Complete inventory and migration evidence |
| M5: A's comparative advantage unproven | A remains provisional; compare all options against identical acceptance boundaries | Current work/effort and urgency evidence |
| M6: selection versus presentation ambiguity | D2 explicitly requests framing review, not option selection or approval | Owner decision remains separate |

**Self-audit:** FACT/JUDGMENT and sources, symmetric advantages, strongest
counter-case, overturn condition, pre-mortem, presenter/owner interest and no
fabricated acceptance are present. Coverage gaps remain explicit. Independent
Opus pass is missing, so the dossier stays **INCOMPLETE**. The Codex verdict was
"Suitable for presentation as INCOMPLETE; insufficient for an execution decision."

The earlier owner-requested Gemini review **did complete via h2a run agy**,
requested `gemini-3.8-flash-high`, effort high, against architecture `2ab8da2b`.
It found ten issues (NEEDS CHANGES). [Raw findings](gemini-review/response-findings.md)
and [individual reconciliation](gemini-review/review-inline.md) remain available.
It is not a review of D1 or an attestation that the production cluster was inspected.

Track's read-only AWAITED query returned no rows for the root workspace at main
`09703678`. This branch forbids `.track` writes; no decision ID, comprehension
attestation or owner acceptance has been minted. Registration with the existing
Track single writer remains a handoff, not an implicit scope expansion.
