# LLM accounts and paid-overflow costs (owner decision 2026-11-09)

## Accounts: held by the cluster mesh, not by immo
- Detection LLM accounts (all owner subscription seats: Gemini/Cloud Code, ChatGPT/Codex, both Claude seats, Muse, Vibe) are held, refreshed and re-authorized by Sentropic `llm-mesh` in the cluster mesh, permanently.
- Immo is a **device** of `llm-mesh`: it calls the mesh routing and holds no account, no keyring and no import procedure of its own.
- The PVC keyring and the `keyring-import` Job are transitional; they are removed once the mesh exposure is live in prod.

## Gemini paid fallback
- Seats (subscription OAuth tokens) are always used first.
- When no seat is available (quota, reauth, outage), detection overflows onto a **Gemini API key** (`gemini-3.8-flash`), billed per token. The OpenAI API key fallback was rejected on cost (about 15–20× more expensive for the same volume).
- The key carries a provider-side budget cap and alert.

## Costs to check on overflow
Reference volume (preprod, 2026-10-26 → 2026-11-09): 100–250 documents/day, 1,000–3,000 pages/day.
Prices (public list, USD per million tokens): $0.75 input / $3.75 output until 2026-12-31; $1.50 / $7.50 from 2027-01-01.
Assumption (unmeasured): ~1,500 input and ~600 output tokens per page, plus one verification pass of the same order.

| Scenario: 100 % of detection on the API key | 2026 rate | From 2027-01-01 |
|---|---|---|
| Low volume (1,000 pages/day) | ~80 USD/month | ~160 USD/month |
| High volume (3,000 pages/day), verification on | **~600 USD/month (max)** | **~1,200 USD/month (max)** |
| Catch-up of 11 days of backlog (one-off) | ~50–90 USD | ~100–180 USD |

## Mandatory checks
- **Overflow alert:** as soon as any document is processed on the API key, the conductor warns the owner with the spend to date and the projected monthly maximum from the table above.
- **Measure, then correct the table:** after the first overflow day, replace the token-per-page assumption with the measured value (provider usage report) and update this file.
- **Monthly:** the monthly cost report lists API-key spend separately from seats and infrastructure.
- **Ceiling:** spend above the monthly maximum of the table requires an explicit owner decision.
