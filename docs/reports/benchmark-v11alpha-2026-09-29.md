# Benchmark d'extraction PV — v11alpha (résultats intermédiaires)

- **Date** : 2026-09-29
- **Statut** : **v11alpha — intermédiaire**. Ce document ajoute au benchmark v10 (`benchmark-v101b-2026-09-17.md`) les nouveaux bras **Opus 5.5** et **Muse 1.3**, et rescore les sorties v10 disponibles sur l'oracle corrigé à 676 unités (#725). La méthodologie, le corpus, le prompt gelé, l'analyse et les coûts détaillés restent ceux du v10 ; seuls les tableaux ci-dessous sont nouveaux. Les graphiques, le HTML et le PDF v11 ne sont pas produits à ce stade.
- **Cartes** : #782 (mise à jour du benchmark), #697 (finaliser le benchmark), #725 (oracle).

## 1. Protocole des nouveaux bras

- Corpus : les 100 documents du manifeste v101b (sha256 PDF vérifiés), mêmes prompts gelés (sha256 identiques au v10), même validation (profil v9, provenance) et même notation (score oracle v3, strict), sur l'**oracle 676** (43 non résolus neutres).
- **Sièges uniquement, aucune clé d'API** (règle owner) :
  - **Opus 5.5** (`claude-opus-5-5`) : Claude Code CLI en headless (`claude -p`, `--effort`, `--system-prompt-file`), abonnement Claude Max 20x, lancé sans `ANTHROPIC_API_KEY`. La CLI ajoute son propre contexte autour du prompt gelé : l'écart avec un appel API brut (transport v10 d'Opus 5) n'est **pas mesuré**.
  - **Muse 1.3** (`muse-spark-1.3`, pas la variante `-contributor`) : CLI `muse exec --provider meta`, abonnement Muse. L'effort `ultra` est rabattu sur `xhigh` par le fournisseur ; `none` est refusé.
- Concurrence 1 par bras, bras en parallèle. Reprise sur quota de siège (attente, jamais de bascule vers une clé).

## 2. Classement global sur 100 documents

Sièges uniquement (Opus 5.5 via `claude -p` sans clé API ; Muse 1.3 via CLI `muse`). Oracle 676 (#725), notation v10. ᵃ = valeur du rapport v10 (oracle 674 ; sorties locales incomplètes ou absentes).

| # | Modèle · effort | Acceptés /100 | P | R | **F1 strict** |
|---|---|---|---|---|---|
| 1 | **CP actuel** (astra-medium → gemini low) | 99 | 0,484 | 0,533 | **0,507** |
| 2 | CP-low (astra-low → gemini low) | 100 | 0,479 | 0,491 | 0,485 |
| 3 | Astra medium | 99 | 0,371 | 0,534 | 0,438 |
| 4 | Astra low | 100 | 0,373 | 0,491 | 0,424 |
| 5 | Sol medium ᵃ | 94 | 0,444 | 0,398 | 0,420 |
| 6 | Sol low ᵃ | 90 | 0,465 | 0,358 | 0,404 |
| 7 | C2 ᵃ | 100 | 0,456 | 0,358 | 0,401 |
| 8 | C3 ᵃ | 100 | 0,461 | 0,353 | 0,400 |
| 9 | Sol xhigh | 85 | 0,308 | 0,488 | 0,378 |
| 10 | Gemini low | 85 | 0,475 | 0,300 | 0,368 |
| 11 | Sol high | 82 | 0,377 | 0,337 | 0,356 |
| 12 | **Opus 5.5 medium (siège)** | 93 | 0,328 | 0,311 | **0,319** |
| 12 | Opus 5 low (API) ᵃ | 74 | 0,350 | 0,292 | 0,319 |
| 14 | Gemini medium | 79 | 0,449 | 0,223 | 0,298 |
| 15 | Opus 5 off (API) ᵃ | 68 | 0,314 | 0,258 | 0,283 |
| 16 | Opus 5 high (API) ᵃ | 63 | 0,318 | 0,251 | 0,280 |
| 17 | Astra high | 68 | 0,289 | 0,260 | 0,274 |
| 18 | Astra xhigh | 65 | 0,252 | 0,297 | 0,273 |
| 19 | **Muse 1.3 medium (siège)** | 80 | 0,355 | 0,207 | **0,262** |
| 20 | **Opus 5.5 low (siège)** | 90 | 0,325 | 0,217 | 0,260 |
| 21 | **Muse 1.3 xhigh (siège)** | 93 | 0,302 | 0,225 | 0,258 |
| 22 | Luna medium | 51 | 0,454 | 0,175 | 0,252 |
| 23 | Luna high | 43 | 0,371 | 0,185 | 0,247 |
| 24 | Sonnet 5 high ᵃ | 70 | 0,330 | 0,193 | 0,243 |
| 25 | Sonnet 5 off ᵃ | 62 | 0,333 | 0,185 | 0,238 |
| 26 | **Muse 1.3 low (siège)** | 77 | 0,347 | 0,170 | 0,228 |
| 27 | Gemini high | 53 | 0,386 | 0,141 | 0,206 |
| 28 | **Muse 1.3 high (siège)** | 80 | 0,297 | 0,155 | 0,204 |
| 29 | Sonnet 5 low ᵃ | 58 | 0,393 | 0,136 | 0,203 |
| 30 | Luna xhigh ᵃ | 47 | 0,240 | 0,147 | 0,182 |
| 31 | Luna low | 39 | 0,448 | 0,109 | 0,176 |
| 32 | **Muse 1.3 minimal (siège)** | 50 | 0,385 | 0,102 | 0,161 |
| 33 | Sonnet 4.6 off (Cloud Code) | 32 | 0,307 | 0,096 | 0,146 |
| 34 | Sonnet 4.6 low (Cloud Code) | 14 | 0,453 | 0,058 | 0,102 |
| 35 | Muse 1.3 max (coupé à 8 docs) | 8 | 0,606 | 0,030 | 0,056 |
| 36 | GPT-4.1 off | 64 | 0,048 | 0,013 | 0,021 |
| 37 | Mistral Small 4 off | 40 | 0,227 | 0,007 | 0,014 |
| 38 | Sonnet 4.6 high (Cloud Code) | 0 | N-A | 0,000 | 0,000 |



## 3. Détail des nouveaux bras (100 documents)

| Bras | Tentés | Acceptés | Échecs (J · V · T) | F1 net 4 doc | p50 s | p90 s | Sortie moy. (jetons) | Équiv. API USD/doc | USD siège/doc |
|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 low | 100 | 90 | 0 · 6 · 4 | 0,143 | 49 | 97 | 6 188 | 0,4239 | 0,01282 |
| Opus 5.5 medium | 100 | 93 | 0 · 3 · 4 | 0,388 | 75 | 150 | 10 269 | 0,4999 | 0,01512 |
| Muse 1.3 minimal | 100 | 50 | 18 · 32 · 0 | 0,167 | 27 | 45 | N-A | 0,0279 ¹ | N-A ² |
| Muse 1.3 low | 100 | 77 | 3 · 20 · 0 | 0,386 | 35 | 61 | N-A | 0,0284 ¹ | N-A ² |
| Muse 1.3 medium | 100 | 80 | 2 · 18 · 0 | 0,515 | 63 | 102 | N-A | 0,0305 ¹ | N-A ² |
| Muse 1.3 high | 100 | 80 | 10 · 10 · 0 | 0,415 | 76 | 147 | N-A | 0,0310 ¹ | N-A ² |
| Muse 1.3 xhigh | 100 | 93 | 3 · 4 · 0 | 0,241 | 107 | 157 | N-A | 0,0343 ¹ | N-A ² |
| Muse 1.3 max | 11 | 8 | coupé (délais au premier jeton, quota) | N-A | 281 | 325 | N-A | N-A | N-A ² |

J = JSON invalide ; V = profil v9 refusé ; T = transport / réponse vide.
¹ Équivalent estimé depuis la taille des entrées/sorties (la CLI Muse n'expose pas les jetons) et un tarif Meta issu de sources secondaires : `unverified`.
² Coût siège Muse non mesuré (pas de mesure de consommation de l'abonnement) : `missing source`.
Coût siège Opus : méthode v10 (`C_siège = C_API × f`, f Claude Max 20x = 0,030248 mesuré le 2026-09-17), tarif API Opus 5.5 4/20 USD par million de jetons (platform.claude.com).

## 4. Lecture

- Le **combo actuel CP** (Astra medium puis vérification Gemini low) reste premier (F1 0,507) ; aucun modèle seul ne l'égale.
- **Opus 5.5 medium** (0,319) égale Opus 5 low du v10 (API), à 19 points du combo, principalement par manque de rappel.
- **Muse 1.3** plafonne à 0,262 (medium) ; monter l'effort ne l'améliore pas. Beaucoup de sorties refusées au profil v9 aux efforts bas (minimal : 50/100 acceptées).
- Sur les 31 premiers documents, Muse medium semblait au niveau du combo (0,510) : ce sous-ensemble était plus facile (tous les bras v10 y gagnent 2 à 11 points) et n'était pas représentatif.

## 5. Reste à faire pour la v11

- Opus 5.5 off / high / xhigh : passages partiels (77 / 69 / 53 documents), gelés, non classés.
- Muse 1.3 max : coupé à 8 documents (décision owner).
- Mesurer l'effet du transport `claude -p` vs API brute sur Opus (même prompt, même effort).
- Coût siège Muse ; graphiques, HTML et PDF v11 ; relecture du texte d'analyse.
