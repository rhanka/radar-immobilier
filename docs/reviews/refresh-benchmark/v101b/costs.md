# v101b cost snapshot

Generated: 2026-09-17T01:32:25.452Z. Every schema-v2 attempt receipt present under `campaign/` and `codex-replay/campaign/` is counted; retries are not discarded.

Selected Gemini plan: **ai-pro**. Selected ChatGPT plan: **pro-20x**.
The owner must provide both actual tiers; Gemini also needs a measured or estimated weekly token reserve.

## Per-arm costs

Output is billable output: visible output plus separately reported thinking tokens. Token columns are total / per document.

| Arm | Receipts (usage) | Docs usage / attempted / accepted | Input total / doc | Visible output total / doc | Thinking | Billable output | API USD | Subscription USD | Simulated USD | API / 1,000 docs | Subscription / 1,000 docs | Simulated / 1,000 docs | API / benchmark cycle |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| astra-high | 112 (11) | 11 / 100 / 11 | 79,869 / 7,261 | 76,489 / 6,954 | 0 | 76,489 | $4.62 | N-A | $4.62 | $420.29 | N-A | $420.29 | $42.03 |
| astra-low | 200 (100) | 100 / 100 / 100 | 1,511,249 / 15,112 | 512,229 / 5,122 | 0 | 512,229 | $40.72 | N-A | $40.72 | $407.24 | N-A | $407.24 | $40.72 |
| astra-medium | 200 (99) | 99 / 100 / 99 | 1,504,435 / 15,196 | 627,618 / 6,340 | 0 | 627,618 | $46.43 | N-A | $46.43 | $468.94 | N-A | $468.94 | $46.89 |
| astra-xhigh | 103 (2) | 2 / 100 / 2 | 14,209 / 7,105 | 17,476 / 8,738 | 0 | 17,476 | $1.02 | N-A | $1.02 | $507.94 | N-A | $507.94 | $50.79 |
| gemini-high | 100 (100) | 100 / 100 / 53 | 1,646,755 / 16,468 | 718,689 / 7,187 | 1,947,086 | 2,665,775 | $11.23 | N-A | $11.23 | $112.32 | N-A | $112.32 | $11.23 |
| gemini-low | 100 (100) | 100 / 100 / 85 | 1,646,755 / 16,468 | 674,257 / 6,743 | 0 | 674,257 | $3.76 | N-A | $3.76 | $37.64 | N-A | $37.64 | $3.76 |
| gemini-medium | 100 (100) | 100 / 100 / 79 | 1,646,755 / 16,468 | 636,023 / 6,360 | 470,930 | 1,106,953 | $5.39 | N-A | $5.39 | $53.86 | N-A | $53.86 | $5.39 |
| gpt41 | 100 (97) | 97 / 100 / 64 | 1,488,852 / 15,349 | 285,589 / 2,944 | 0 | 285,589 | $5.26 | N-A | $5.26 | $54.25 | N-A | $54.25 | $5.43 |
| luna-high | 200 (87) | 87 / 100 / 43 | 1,213,911 / 13,953 | 1,242,547 / 14,282 | 0 | 1,242,547 | $1.73 | N-A | $1.73 | $19.93 | N-A | $19.93 | $1.99 |
| luna-low | 200 (98) | 98 / 100 / 39 | 1,485,731 / 15,161 | 527,283 / 5,380 | 0 | 527,283 | $0.9299 | N-A | $0.9299 | $9.49 | N-A | $9.49 | $0.9489 |
| luna-medium | 200 (98) | 98 / 100 / 51 | 1,486,766 / 15,171 | 709,419 / 7,239 | 0 | 709,419 | $1.15 | N-A | $1.15 | $11.72 | N-A | $11.72 | $1.17 |
| luna-xhigh | 148 (32) | 32 / 100 / 22 | 274,471 / 8,577 | 591,060 / 18,471 | 0 | 591,060 | $0.7642 | N-A | $0.7642 | $23.88 | N-A | $23.88 | $2.39 |
| mistral-small4 | 100 (96) | 96 / 100 / 40 | 1,598,919 / 16,655 | 400,095 / 4,168 | 0 | 400,095 | $0.4799 | N-A | $0.4799 | $5.00 | N-A | $5.00 | $0.4999 |
| opus5-high | 180 (100) | 100 / 100 / 63 | 2,496,910 / 24,969 | 2,089,305 / 20,893 | 0 | 2,089,305 | $64.72 | N-A | $64.72 | $647.17 | N-A | $647.17 | $64.72 |
| opus5-low | 180 (100) | 100 / 100 / 74 | 2,496,910 / 24,969 | 1,090,871 / 10,909 | 0 | 1,090,871 | $39.76 | N-A | $39.76 | $397.56 | N-A | $397.56 | $39.76 |
| opus5-off | 127 (100) | 100 / 100 / 68 | 2,496,910 / 24,969 | 2,103,477 / 21,035 | 0 | 2,103,477 | $65.07 | N-A | $65.07 | $650.71 | N-A | $650.71 | $65.07 |
| sol-high | 194 (80) | 80 / 100 / 76 | 1,109,489 / 13,869 | 1,147,660 / 14,346 | 0 | 1,147,660 | $27.39 | N-A | $27.39 | $342.39 | N-A | $342.39 | $34.24 |
| sol-low | 193 (78) | 78 / 100 / 70 | 1,106,987 / 14,192 | 511,985 / 6,564 | 0 | 511,985 | $14.67 | N-A | $14.67 | $188.05 | N-A | $188.05 | $18.80 |
| sol-medium | 202 (100) | 100 / 100 / 94 | 1,511,249 / 15,112 | 1,040,498 / 10,405 | 0 | 1,040,498 | $26.85 | N-A | $26.85 | $268.55 | N-A | $268.55 | $26.85 |
| sol-xhigh | 164 (60) | 60 / 100 / 60 | 636,900 / 10,615 | 1,257,183 / 20,953 | 0 | 1,257,183 | $27.69 | N-A | $27.69 | $461.52 | N-A | $461.52 | $46.15 |
| sonnet46-cloud-high | 21 (0) | 0 / 15 / 0 | 0 / 0 | 0 / 0 | 0 | 0 | $0.0000 | N-A | $0.0000 | N-A | N-A | N-A | N-A |
| sonnet46-cloud-low | 35 (14) | 14 / 29 / 14 | 121,952 / 8,711 | 113,572 / 8,112 | 0 | 113,572 | $2.07 | N-A | $2.07 | $147.82 | N-A | $147.82 | $14.78 |
| sonnet46-cloud-off | 61 (46) | 46 / 56 / 32 | 526,599 / 11,448 | 431,329 / 9,377 | 0 | 431,329 | $8.05 | N-A | $8.05 | $174.99 | N-A | $174.99 | $17.50 |
| sonnet5-high | 140 (100) | 100 / 100 / 70 | 2,496,910 / 24,969 | 1,795,947 / 17,959 | 0 | 1,795,947 | $22.95 | N-A | $22.95 | $229.53 | N-A | $229.53 | $22.95 |
| sonnet5-low | 140 (100) | 100 / 100 / 58 | 2,496,910 / 24,969 | 614,966 / 6,150 | 0 | 614,966 | $11.14 | N-A | $11.14 | $111.43 | N-A | $111.43 | $11.14 |
| sonnet5-off | 148 (99) | 99 / 100 / 62 | 2,461,352 / 24,862 | 1,791,894 / 18,100 | 0 | 1,791,894 | $22.84 | N-A | $22.84 | $230.72 | N-A | $230.72 | $23.07 |

The benchmark-cycle projection uses the frozen manifest's 100 documents. Production refresh cycle = **source-gap**: the CronJobs define schedules but no stable document count per run.

## Siège vs token

Une capacité n'est publiée que pour une fenêtre attestée de 7 jours. `scenario` est le ratio indirect quota compte/tokens campagne; il suppose un quota linéaire en tokens et une pondération Sol/Luna identique, toutes deux non vérifiées.

| Arm | Statut | Rendement accepté | Docs / 10% | Docs / semaine | Docs / mois | Tokens / semaine | API / doc | API / résultat accepté |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| gemini-low | measured | 85.0% | 343.0 | 3,430.1 | 14,863.7 | 74,344,881 | $0.0376 | $0.0443 |
| luna-high | N-A (no-quota-delta) | 43.0% | N-A | N-A | N-A | N-A | $0.0199 | $0.0463 |
| sol-medium | N-A (no-quota-delta) | 94.0% | N-A | N-A | N-A | N-A | $0.2685 | $0.2857 |
| sonnet46-cloud-off | N-A (transport-mismatch) | 57.1% | N-A | N-A | N-A | N-A | $0.1750 | $0.3062 |

Quand le palier observé 1x/5x/20x est source-gap, chaque ligne est conditionnelle: elle suppose que ce palier est celui du siège observé, sans extrapolation de multiplicateur. Avec `basePlan` renseigné, les autres lignes sont mises à l'échelle. Les seuils économiques ne dépendent que du prix mensuel et du coût API mesuré.

| Arm | Palier | Base capacité | USD/mois | Docs/semaine | Docs/mois | Siège/doc | Seuil strict siège < API | Atteignable/siège | Sièges pour 1 000 docs/mois | Siège / 1 000 | API / 1 000 |
|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|
| gemini-low | gemini/ai-pro | scaled-from-base-plan | $19.99 | 3,430.1 | 14,863.7 | $0.0013 | 532 | oui | 1 | $19.99 | $37.64 |
| gemini-low | gemini/ai-ultra-5x | scaled-from-base-plan | $99.99 | 17,150.4 | 74,318.4 | $0.0013 | 2,657 | oui | 1 | $99.99 | $37.64 |
| gemini-low | gemini/ai-ultra-20x | scaled-from-base-plan | $199.99 | 68,601.6 | 297,273.5 | $0.0007 | 5,314 | oui | 1 | $199.99 | $37.64 |
| luna-high | chatgpt/plus | N-A | $20.00 | N-A | N-A | N-A | 1,004 | N-A | N-A | N-A | $19.93 |
| luna-high | chatgpt/pro-5x | N-A | $100.00 | N-A | N-A | N-A | 5,018 | N-A | N-A | N-A | $19.93 |
| luna-high | chatgpt/pro-20x | N-A | $200.00 | N-A | N-A | N-A | 10,036 | N-A | N-A | N-A | $19.93 |
| sol-medium | chatgpt/plus | N-A | $20.00 | N-A | N-A | N-A | 75 | N-A | N-A | N-A | $268.55 |
| sol-medium | chatgpt/pro-5x | N-A | $100.00 | N-A | N-A | N-A | 373 | N-A | N-A | N-A | $268.55 |
| sol-medium | chatgpt/pro-20x | N-A | $200.00 | N-A | N-A | N-A | 745 | N-A | N-A | N-A | $268.55 |
| sonnet46-cloud-off | claude/pro | N-A | $20.00 | N-A | N-A | N-A | 115 | N-A | N-A | N-A | $174.99 |
| sonnet46-cloud-off | claude/max-5x | N-A | $100.00 | N-A | N-A | N-A | 572 | N-A | N-A | N-A | $174.99 |
| sonnet46-cloud-off | claude/max-20x | N-A | $200.00 | N-A | N-A | N-A | 1,143 | N-A | N-A | N-A | $174.99 |

Cycle de production: **N-A (source-gap)**. Le manifeste de 100 documents est un cycle benchmark, pas un volume de refresh. Pour un cycle de `N` documents, le coût API est `N × API/doc`; le coût siège requiert d'abord une capacité mensuelle attestée.

## Modes

- `api`: measured input × input rate + (visible output + thinking) × output rate.
- `subscription`: monthly plan price ÷ monthly token reserve, uniquement avec un override hebdomadaire explicite; les limites 5 h ne sont jamais extrapolées en semaine.
- `simulated`: measured input/output token shares × the same model's API rates, producing a blended USD/M token rate. It is algebraically equal to API cost and is kept explicit for scenario work.

## Hard-coded rate cards

| Model | Input USD/M | Output USD/M | As of | Valid until | Source |
|---|---:|---:|---|---|---|
| gemini-3.8-flash | 0.75 | 3.75 | 2026-09-16 | 2026-12-31 | [official pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash) |
| claude-sonnet-5 | 2 | 10 | 2026-09-16 | — | [official pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| claude-opus-5 | 5 | 25 | 2026-09-16 | — | [official pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| claude-sonnet-4.6 | 3 | 15 | 2026-09-16 | — | [official pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| gpt-4.1 | 2 | 8 | 2026-09-16 | — | [official pricing](https://developers.openai.com/api/docs/pricing) |
| mistral-small-4 | 0.15 | 0.6 | 2026-09-16 | — | [official pricing](https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03) |
| gpt-5.6-sol | 4 | 20 | 2026-09-16 | 2026-11-21 | [official pricing](https://developers.openai.com/api/docs/pricing) |
| gpt-5.6-terra | 2 | 12 | 2026-09-16 | — | [official pricing](https://developers.openai.com/api/docs/pricing) |
| gpt-5.6-luna | 0.2 | 1.2 | 2026-09-16 | — | [official pricing](https://developers.openai.com/api/docs/pricing) |
| gpt-6-astra | 10 | 50 | 2026-09-16 | — | [official pricing](https://developers.openai.com/api/docs/pricing) |

Gemini output pricing includes thinking tokens; its cache-read rate is $0.075/M through 2026-12-31. `gpt-6-astra` batch/flex is $5/M input and $25/M output.

Official verification changed two supplied assumptions: `gpt-5.6-sol` is currently promotional $4/$20, not $5/$30; Mistral Small 4 is $0.15/$0.60, not $0.20/$0.40.

## Subscription plan catalog

| Provider | Plan | USD/month | As of | Source |
|---|---|---:|---|---|
| chatgpt | plus | 20 | 2026-09-16 | [official plan page](https://developers.openai.com/codex/pricing) |
| chatgpt | pro-5x | 100 | 2026-09-16 | [official plan page](https://developers.openai.com/codex/pricing) |
| chatgpt | pro-20x | 200 | 2026-09-16 | [official plan page](https://developers.openai.com/codex/pricing) |
| gemini | ai-pro | 19.99 | 2026-09-16 | [official plan page](https://gemini.google/subscriptions/) |
| gemini | ai-ultra-5x | 99.99 | 2026-09-16 | [official plan page](https://gemini.google/subscriptions/) |
| gemini | ai-ultra-20x | 199.99 | 2026-09-16 | [official plan page](https://gemini.google/subscriptions/) |
| claude | pro | 20 | 2026-09-16 | [official plan page](https://www.anthropic.com/pricing) |
| claude | max-5x | 100 | 2026-09-16 | [official plan page](https://www.anthropic.com/pricing) |
| claude | max-20x | 200 | 2026-09-16 | [official plan page](https://www.anthropic.com/pricing) |

The official Codex page publishes estimated local-message ranges per five-hour period. They are not weekly capacities. Pro 5x and Pro 20x multiply the Plus bounds:

| Model | Plus messages/5h | Pro 5x | Pro 20x |
|---|---:|---:|---:|
| gpt-6-astra | 5–45 | 25–225 | 100–900 |
| gpt-5.6-sol | 10–100 | 50–500 | 200–2,000 |
| gpt-5.6-terra | 25–200 | 125–1,000 | 500–4,000 |
| gpt-5.6-luna | 250–2,000 | 1,250–10,000 | 5,000–40,000 |

Google publishes the listed USD prices and relative 1x/5x/20x tiers, but no token-denominated weekly reserve. Checkout price and taxes remain region-dependent.

## Receipt-cost regression

No-intercept two-variable regression: `actual.costUsd × 1M = inputTokens × a + billableOutputTokens × b`.

| Model | Samples | Input USD/M | Output USD/M | Hard-coded input/output |
|---|---:|---:|---:|---|
| claude-opus-5 | 300 | 5.000000 | 25.000000 | 5 / 25 |
| claude-sonnet-5 | 299 | 2.000000 | 10.000000 | 2 / 10 |
| gpt-4.1 | 97 | 2.000000 | 8.000000 | 2 / 8 |
| mistral-small-4 | 96 | 0.150000 | 0.600000 | 0.15 / 0.6 |

## Observables de quota

- Codex/ChatGPT: `wham/usage` expose le pourcentage, la durée et le reset de la fenêtre. La capacité Sol/Luna ci-dessus est un scénario par ratio avec les reçus de campagne, pas une mesure marginale par bras.
- Google Cloud Code: `agy /usage` expose directement les pourcentages hebdomadaire et 5 h pour Gemini Flash/Pro. Une observation `controlled-burn` avec fenêtre 10 080 min est donc une capacité hebdomadaire mesurée; les reçus restent la source des documents et tokens.
- Claude Code OAuth: `/usage` expose les fenêtres 5 h et 7 j, mais `sonnet46-cloud-off` utilise Google Cloud Code. Une projection Claude Pro/Max pour ce bras serait un changement de transport; elle reste N-A.

Burn réel: voir `burn/seat-observations.json` pour les pourcentages et les bornes UTC allowlistés; aucun identifiant de session ni secret n'est conservé. Les capacités Codex sans delta de compteur sont N-A, non extrapolées.
