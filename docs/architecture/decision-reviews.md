# Decision dossier review records

Status: independent reviews requested; **not consensus, not owner approval**.

- Codex pass: `h2a run` via MCP, `immo-decision-codex-d1`, native/default model,
  requested effort high; read-only inline D1 dossier and continuation audit.
- Opus pass: `h2a run` via MCP, `immo-decision-opus-d1`, native `opus` alias,
  requested effort high; same packet, no access to the Codex response.
- No renderer implementation, new proposal scene or live cluster was independently
  tested by those text-only reviews. Exact findings will be recorded separately.

The earlier owner-requested Gemini review **did complete via h2a run agy**,
requested `gemini-3.8-flash-high`, effort high, against architecture `2ab8da2b`.
It found ten issues (NEEDS CHANGES). [Raw findings](gemini-review/response-findings.md)
and [individual reconciliation](gemini-review/review-inline.md) remain available.
It is not a review of D1 or an attestation that the production cluster was inspected.

Track's read-only AWAITED query returned no rows for the root workspace at main
`09703678`. This branch forbids `.track` writes; no decision ID, comprehension
attestation or owner acceptance has been minted. Registration with the existing
Track single writer remains a handoff, not an implicit scope expansion.
