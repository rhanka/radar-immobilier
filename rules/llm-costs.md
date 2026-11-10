# LLM accounts and costs (owner decisions 2026-11-09)

## Accounts: held by the cluster mesh, not by immo
- Detection LLM accounts (all owner subscription seats: Gemini/Cloud Code, ChatGPT/Codex, both Claude seats, Muse, Vibe) are held, refreshed and re-authorized by Sentropic `llm-mesh` in the cluster mesh, permanently.
- Immo participates as a **device** of the sentropic LLM mesh (cluster mesh); the mesh maintains the accounts and key refresh is sentropic's responsibility. Immo calls the mesh routing and holds no account, no keyring and no import procedure of its own.
- The PVC keyring and the `keyring-import` Job are transitional; they are removed once the mesh exposure is live in prod.

## Detection routing: subscription seats only
- Detection (prod + stock) runs on the Gemini subscription seats. The owner doubled his Gemini Ultra subscription for this capacity.
- The preferred alternative model is **Muse Wonder** (« je ne veux pas d'opus, je veux muse wonder »), through the Muse subscription transport enrolled in the sentropic LLM mesh (OAuth).
- Opus is rejected for detection (insufficient recall; see the v11 reference below).
- On seat quota, reauth or outage: wait and retry on a seat. There is no switch to a pay-per-token key.

## No pay-per-token fallback
- The paid Gemini API key (pay-per-token fallback) is **abandoned**: « on va pas partir sur 100 $, c'est beaucoup trop, laisse tomber ».
- No pay-per-token fallback is provisioned, for Gemini or any other provider. No passage in this repo presents one as active or planned.
- **Rule:** any pay-per-token use requires, before any provisioning or use, a prior estimate of the maximum monthly cost and an owner warning. Spend above that estimate requires an explicit owner decision. If the owner ever approves such a use, it carries a provider-side budget cap and alert, and its spend is reported separately (see Mandatory checks).

## Cost and recall reference: benchmark v11 dossier
The single cost/recall reference is the v11 benchmark dossier merged by #1052: `docs/reports/benchmark-v11-2026-11-09.md` (with its HTML/PDF renderings of the same date). Every number below is taken from that dossier only; no number is taken from memory. Tariffs behind the API equivalents are marked `unverified` in the dossier (secondary sources, §6); the Argon seat cost is measured by burn `/usage` at the Google AI Ultra 20x tier (199.99 USD/month, variant 5x in the dossier), and the Muse Wonder seat cost is `missing source` in the dossier (counter shared with other sessions of the account, not attributable).

| Model (seat) | Accepted /100 | P | R | F1 strict | Seat USD/doc | API equivalent USD/doc |
|---|---|---|---|---|---|---|
| Gemini Argon low (`gemini-4-argon-low`, AGY / Gemini Ultra) | 88 | 0.330 | 0.429 | 0.373 | 0.00801 | 0.2074 |
| Muse Wonder low (`muse-wonder-1.0`, Muse seat) | 90 | 0.361 | 0.333 | 0.346 | missing source | 0.2731 |
| Opus 5.5 medium (seat, rejected for detection) | 93 | 0.328 | 0.311 | 0.319 | 0.0151 | 0.4999 |
| Opus 5.5 low (seat, rejected for detection) | 90 | 0.325 | 0.217 | 0.260 | 0.0128 | 0.4239 |

Reading from the dossier: Muse Wonder low recall (0.333) is above every Opus 5.5 seat arm (medium 0.311, low 0.217), which grounds the Opus rejection; the current CP combo remains first in F1 (0.507, R 0.533) and no single model equals it. The dossier protocol itself ran seats only, with no API key and no switch to a key on quota.

## Mandatory checks
- **No pay-per-token without prior estimate and owner warning:** before any pay-per-token provisioning or use, produce an estimate of the maximum monthly cost, warn the owner with it, and obtain an explicit owner decision. No estimate and no warning means no use.
- **Monthly:** the monthly cost report lists subscription seats separately from infrastructure. Any pay-per-token spend, if ever approved under the rule above, is listed separately from seats and infrastructure.
- **Reference updates:** update the cost/recall table above only from a merged benchmark dossier. Do not carry numbers from memory, chat or unmerged lanes into this file.
