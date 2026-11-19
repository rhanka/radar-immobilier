# Classification models — comparative bench (jeux C, mode B, prompt v2)

Verdict Hydrogen low, en tête : **précision en hausse, rappel aveugle en baisse**.
Sur l'aveugle, Gemini 4 Hydrogen low manque 2 références P ∪ S (D4 échoué)
quand Astra low v2 n'en manque aucune. Il ne remplace pas Astra en primaire
sur ce critère. En repli, sa précision supérieure au baseline reste un atout.

Protocole figé : jeux C, mode B (réannotation), prompt v2
SHA-256 `34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50`,
252 unités par jeu (95 références affichées en mise au point, 94 en aveugle).
Aucune donnée par unité aveugle n'est publiée ; seuls les agrégats sortent.
La détection B (1passe) est conservée telle quelle ; seule la classification
est mesurée ici, comme dans la série de référence.

## Résultats

| Jeu | Modèle | Manqués P ∪ S | Rappel | Wilson 95 % | Précision | D4 | Invalides |
|---|---|---:|---:|---|---:|---|---:|
| Mise au point | Astra low v2 (baseline) | 0/95 | 100.00 % | [96.11 % ; 100.00 %] | 67.38 % | réussi | 0 |
| Mise au point | Gemini 4 Hydrogen low | 0/95 | 100.00 % | [96.11 % ; 100.00 %] | 70.90 % | réussi | 1 |
| Aveugle | Astra low v2 (baseline) | 0/94 | 100.00 % | [96.07 % ; 100.00 %] | 71.76 % | réussi | 0 |
| Aveugle | Gemini 4 Hydrogen low | 2/94 | 97.87 % | [92.57 % ; 99.41 %] | 76.67 % | échoué | 1 |
| Mise au point | Gemini 3.8 Flash low | missing source | — | — | — | — | — |
| Aveugle | Gemini 3.8 Flash low | missing source | — | — | — | — | — |

Aucun agrégat jeux C pour Gemini 3.8 Flash n'existe dans les rapports ni
dans les caches locaux : la comparaison Flash reste `missing source`.

## Exécution Hydrogen

- Transport : siège `agy` (`gemini-4-hydrogen-low`, identifiant vérifié dans
  `agy models` le 2026-11-19), concurrence 4, garde d'arrêt sur refus
  compte/quota (429 dans l'enveloppe d'erreur seulement).
- Appels : 504 mesurés (252 + 252), 502 en code 0, 2 échecs comptés
  invalides. Aucune relance selon la classe. Reprise par cache après un
  arrêt intempestif à 184/252 (voir journal privé).
- Durée murale totale : environ 21 minutes pour les deux jeux.
- Jetons : 9 604 776 au total (usage du siège). Coût estimé : `missing
  source` — aucun prix par jeton du siège agy n'est publié dans le dépôt.
- Prompt figé v2 vérifié par SHA-256 avant chaque appel (harnais `inputs.mjs`).

## Généralisation du harnais

`tools/classif/csets` accepte `BENCH_MODEL` (étiquette de route du catalogue
`tools/classif/run-seat.mjs`) et `BENCH_CONCURRENCY`. Défaut inchangé :
`astra-low`, concurrence 10, garde quota Codex à 90 %. Les routes
`gemini-4-hydrogen-low` et `gemini-4-neon-low` sont ajoutées au catalogue
(agy, même forme que Carbon). Pour un modèle non-Codex, la garde ne repose
plus sur la sonde `rate_limits` : arrêt sur refus explicite (429/quota dans
l'enveloppe d'erreur), reprise par cache.

## Astra 6.2 et Neon : planification, pas d'exécution

- Astra 6.2 low : aucun identifiant de catalogue « 6.2 » n'a été trouvé. Les
  sièges Codex exposent `gpt-6-astra` (low/medium/max), `agy models` ne
  liste aucun Astra. L'identifiant exact reste à confirmer par i-cond avant
  tout run ; rien n'a été inventé ni exécuté.
- Gemini 4 Neon low : identifiant vérifié (`gemini-4-neon-low` dans
  `agy models`), route ajoutée, non exécuté.
- Calendrier proposé, sans saturer : Neon low après relance d'i-cond
  (504 appels, environ 21 minutes à concurrence 4, même garde), puis Astra
  dès l'identifiant 6.2 confirmé (garde Codex 90 %, concurrence 10, sonde
  fraîche). Un modèle par session, jamais en parallèle avec un sweep de
  production.
