# v101b cost snapshot

Generated: 2026-09-17T04:29:27.445Z. Every schema-v2 attempt receipt present under `campaign/` and `codex-replay/campaign/` is counted; retries are not discarded.

Selected Gemini plan: **ai-pro**. Selected ChatGPT plan: **pro-20x**.
The owner must provide both actual tiers; Gemini also needs a measured or estimated weekly token reserve.

## Per-arm costs

Output is billable output: visible output plus separately reported thinking tokens. Token columns are total / per document.

| Arm | Receipts (usage) | Docs usage / attempted / accepted | Input total / doc | Visible output total / doc | Thinking | Billable output | API USD | Subscription USD | Simulated USD | API / 1,000 docs | Subscription / 1,000 docs | Simulated / 1,000 docs | API / benchmark cycle |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| astra-high | 173 (58) | 58 / 100 / 58 | 603,566 / 10,406 | 523,128 / 9,019 | 0 | 523,128 | $32.19 | N-A | $32.19 | $555.04 | N-A | $555.04 | $55.50 |
| astra-low | 200 (100) | 100 / 100 / 100 | 1,511,249 / 15,112 | 512,229 / 5,122 | 0 | 512,229 | $40.72 | N-A | $40.72 | $407.24 | N-A | $407.24 | $40.72 |
| astra-medium | 200 (99) | 99 / 100 / 99 | 1,504,435 / 15,196 | 627,618 / 6,340 | 0 | 627,618 | $46.43 | N-A | $46.43 | $468.94 | N-A | $468.94 | $46.89 |
| astra-xhigh | 123 (14) | 14 / 100 / 14 | 163,708 / 11,693 | 238,822 / 17,059 | 0 | 238,822 | $13.58 | N-A | $13.58 | $969.87 | N-A | $969.87 | $96.99 |
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
| sol-xhigh | 200 (90) | 90 / 100 / 85 | 1,297,014 / 14,411 | 2,214,618 / 24,607 | 0 | 2,214,618 | $49.48 | N-A | $49.48 | $549.78 | N-A | $549.78 | $54.98 |
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
| astra-high | measured | 58.0% | 272.4 | 2,723.6 | 11,802.1 | 52,907,425 | $0.5550 | $0.9570 |
| astra-low | measured | 100.0% | 261.5 | 2,614.7 | 11,330.3 | 52,907,425 | $0.4072 | $0.4072 |
| astra-medium | measured | 99.0% | 245.7 | 2,456.7 | 10,645.7 | 52,907,425 | $0.4689 | $0.4737 |
| astra-xhigh | measured | 14.0% | 184.0 | 1,840.1 | 7,973.9 | 52,907,425 | $0.9699 | $6.93 |
| gemini-low | measured | 85.0% | 320.3 | 3,203.1 | 13,880.2 | 74,344,881 | $0.0376 | $0.0443 |
| luna-high | measured | 43.0% | 187.4 | 1,873.8 | 8,119.9 | 52,907,425 | $0.0199 | $0.0463 |
| luna-low | measured | 39.0% | 257.6 | 2,575.7 | 11,161.4 | 52,907,425 | $0.0095 | $0.0243 |
| luna-medium | measured | 51.0% | 236.1 | 2,360.9 | 10,230.5 | 52,907,425 | $0.0117 | $0.0230 |
| luna-xhigh | measured | 22.0% | 195.6 | 1,956.1 | 8,476.3 | 52,907,425 | $0.0239 | $0.1085 |
| sol-high | measured | 76.0% | 187.5 | 1,875.2 | 8,125.8 | 52,907,425 | $0.3424 | $0.4505 |
| sol-low | measured | 70.0% | 254.9 | 2,549.0 | 11,045.7 | 52,907,425 | $0.1880 | $0.2686 |
| sol-medium | measured | 94.0% | 207.3 | 2,073.4 | 8,984.6 | 52,907,425 | $0.2685 | $0.2857 |
| sol-xhigh | measured | 85.0% | 135.6 | 1,356.0 | 5,875.9 | 52,907,425 | $0.5498 | $0.6468 |
| sonnet46-cloud-off | N-A (transport-mismatch) | 57.1% | N-A | N-A | N-A | N-A | $0.1750 | $0.3062 |

Quand le palier observé 1x/5x/20x est source-gap, chaque ligne est conditionnelle: elle suppose que ce palier est celui du siège observé, sans extrapolation de multiplicateur. Avec `basePlan` renseigné, les autres lignes sont mises à l'échelle. Les seuils économiques ne dépendent que du prix mensuel et du coût API mesuré.

| Arm | Palier | Base capacité | USD/mois | Docs/semaine | Docs/mois | Siège/doc | Seuil strict siège < API | Atteignable/siège | Sièges pour 1 000 docs/mois | Siège / 1 000 | API / 1 000 |
|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|
| astra-high | chatgpt/plus | scaled-from-base-plan | $20.00 | 136.2 | 590.1 | $0.0339 | 37 | oui | 2 | $40.00 | $555.04 |
| astra-high | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 680.9 | 2,950.5 | $0.0339 | 181 | oui | 1 | $100.00 | $555.04 |
| astra-high | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 2,723.6 | 11,802.1 | $0.0169 | 361 | oui | 1 | $200.00 | $555.04 |
| astra-low | chatgpt/plus | scaled-from-base-plan | $20.00 | 130.7 | 566.5 | $0.0353 | 50 | oui | 2 | $40.00 | $407.24 |
| astra-low | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 653.7 | 2,832.6 | $0.0353 | 246 | oui | 1 | $100.00 | $407.24 |
| astra-low | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 2,614.7 | 11,330.3 | $0.0177 | 492 | oui | 1 | $200.00 | $407.24 |
| astra-medium | chatgpt/plus | scaled-from-base-plan | $20.00 | 122.8 | 532.3 | $0.0376 | 43 | oui | 2 | $40.00 | $468.94 |
| astra-medium | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 614.2 | 2,661.4 | $0.0376 | 214 | oui | 1 | $100.00 | $468.94 |
| astra-medium | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 2,456.7 | 10,645.7 | $0.0188 | 427 | oui | 1 | $200.00 | $468.94 |
| astra-xhigh | chatgpt/plus | scaled-from-base-plan | $20.00 | 92.0 | 398.7 | $0.0502 | 21 | oui | 3 | $60.00 | $969.87 |
| astra-xhigh | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 460.0 | 1,993.5 | $0.0502 | 104 | oui | 1 | $100.00 | $969.87 |
| astra-xhigh | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 1,840.1 | 7,973.9 | $0.0251 | 207 | oui | 1 | $200.00 | $969.87 |
| gemini-low | gemini/ai-pro | scaled-from-base-plan | $19.99 | 3,203.1 | 13,880.2 | $0.0014 | 532 | oui | 1 | $19.99 | $37.64 |
| gemini-low | gemini/ai-ultra-5x | scaled-from-base-plan | $99.99 | 16,015.6 | 69,401.0 | $0.0014 | 2,657 | oui | 1 | $99.99 | $37.64 |
| gemini-low | gemini/ai-ultra-20x | scaled-from-base-plan | $199.99 | 64,062.5 | 277,604.0 | $0.0007 | 5,314 | oui | 1 | $199.99 | $37.64 |
| luna-high | chatgpt/plus | scaled-from-base-plan | $20.00 | 93.7 | 406.0 | $0.0493 | 1,004 | non | 3 | $60.00 | $19.93 |
| luna-high | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 468.5 | 2,030.0 | $0.0493 | 5,018 | non | 1 | $100.00 | $19.93 |
| luna-high | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 1,873.8 | 8,119.9 | $0.0246 | 10,036 | non | 1 | $200.00 | $19.93 |
| luna-low | chatgpt/plus | scaled-from-base-plan | $20.00 | 128.8 | 558.1 | $0.0358 | 2,108 | non | 2 | $40.00 | $9.49 |
| luna-low | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 643.9 | 2,790.3 | $0.0358 | 10,539 | non | 1 | $100.00 | $9.49 |
| luna-low | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 2,575.7 | 11,161.4 | $0.0179 | 21,078 | non | 1 | $200.00 | $9.49 |
| luna-medium | chatgpt/plus | scaled-from-base-plan | $20.00 | 118.0 | 511.5 | $0.0391 | 1,707 | non | 2 | $40.00 | $11.72 |
| luna-medium | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 590.2 | 2,557.6 | $0.0391 | 8,532 | non | 1 | $100.00 | $11.72 |
| luna-medium | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 2,360.9 | 10,230.5 | $0.0195 | 17,064 | non | 1 | $200.00 | $11.72 |
| luna-xhigh | chatgpt/plus | scaled-from-base-plan | $20.00 | 97.8 | 423.8 | $0.0472 | 838 | non | 3 | $60.00 | $23.88 |
| luna-xhigh | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 489.0 | 2,119.1 | $0.0472 | 4,188 | non | 1 | $100.00 | $23.88 |
| luna-xhigh | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 1,956.1 | 8,476.3 | $0.0236 | 8,376 | oui | 1 | $200.00 | $23.88 |
| sol-high | chatgpt/plus | scaled-from-base-plan | $20.00 | 93.8 | 406.3 | $0.0492 | 59 | oui | 3 | $60.00 | $342.39 |
| sol-high | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 468.8 | 2,031.5 | $0.0492 | 293 | oui | 1 | $100.00 | $342.39 |
| sol-high | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 1,875.2 | 8,125.8 | $0.0246 | 585 | oui | 1 | $200.00 | $342.39 |
| sol-low | chatgpt/plus | scaled-from-base-plan | $20.00 | 127.5 | 552.3 | $0.0362 | 107 | oui | 2 | $40.00 | $188.05 |
| sol-low | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 637.3 | 2,761.4 | $0.0362 | 532 | oui | 1 | $100.00 | $188.05 |
| sol-low | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 2,549.0 | 11,045.7 | $0.0181 | 1,064 | oui | 1 | $200.00 | $188.05 |
| sol-medium | chatgpt/plus | scaled-from-base-plan | $20.00 | 103.7 | 449.2 | $0.0445 | 75 | oui | 3 | $60.00 | $268.55 |
| sol-medium | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 518.3 | 2,246.2 | $0.0445 | 373 | oui | 1 | $100.00 | $268.55 |
| sol-medium | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 2,073.4 | 8,984.6 | $0.0223 | 745 | oui | 1 | $200.00 | $268.55 |
| sol-xhigh | chatgpt/plus | scaled-from-base-plan | $20.00 | 67.8 | 293.8 | $0.0681 | 37 | oui | 4 | $80.00 | $549.78 |
| sol-xhigh | chatgpt/pro-5x | scaled-from-base-plan | $100.00 | 339.0 | 1,469.0 | $0.0681 | 182 | oui | 1 | $100.00 | $549.78 |
| sol-xhigh | chatgpt/pro-20x | scaled-from-base-plan | $200.00 | 1,356.0 | 5,875.9 | $0.0340 | 364 | oui | 1 | $200.00 | $549.78 |
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
