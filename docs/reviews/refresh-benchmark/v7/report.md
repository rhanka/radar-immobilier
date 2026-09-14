# Benchmark T1 v7 — plafond commun 65 536

## Résultat

Le contrôle Valcourt est accepté, puis les cinq PDF ont tous été lancés sans
retry qualité. La campagne obtient 5/5 HTTP 200 et fins SSE `STOP`, sans 429 ni
saturation; 3/5 sorties franchissent toutes les couches. Saint-Barthélemy est
refusé au profil (`missing_evidence_ref`, `edges[10]`) et Waterloo à la
provenance (`ungrounded_pdf_excerpt` sur deux citations).

Six requêtes Gemini sur le plafond de sept ont été utilisées : un contrôle et
cinq cas. Sonnet est `N-A`, car la clé Anthropic est absente de l'environnement
du processus; aucun fichier `.env*` n'a été lu. Les jugements sont en attente :
le conductor lancera lui-même deux juges sur le bundle aveugle.

## Re-gel v7

Le seul changement de contrat v6 → v7 est `maxOutputTokens`, passé de 16 384 à
65 536 pour tous les modèles. Après retrait de `campaign`, `frozenAt` et du
plafond, les gels de prompt v6/v7 ont le même SHA canonique; les cinq hashes de
schéma et de prompt sont identiques. Profil `f96356e9`, module
`b1d3989bc826e0691fb644b0b2857099f2c957a44f054bf0b3746adc526dab3f`,
Gemini `gemini-3.8-flash-tiered` LOW, Graphify 0.18.0, llm-mesh 0.19.1 et
`maxAttempts=2` après échec transport seulement restent inchangés. L'oracle v7
est une copie byte-à-byte de v6.

Le contrôle Valcourt mesure HTTP 200, 22 620 ms, 7 263/8 337 tokens,
`STOP`, et toutes les couches acceptées. Son brut fait 18 695 caractères
Unicode, 18 830 octets et 450 sauts de ligne.

## Tableau PDF × modèle

Les couches sont `jsonValidRaw / normalisé / extraction / profil / provenance`.
Le JSON brut est entouré d'un fence dans les cinq réponses; la normalisation du
fence rend ensuite les cinq JSON valides.

| PDF | Modèle | HTTP | Latence | Tokens entrée/sortie | Fin SSE | Couches | Accepté | P / R / F1 |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| Lac-des-Seize-Îles | Gemini 3.8 Flash LOW | 200 | 14 352 ms | 6 811 / 4 731 | STOP | non/oui/oui/oui/oui | oui | 1,000 / 0,250 / 0,400 |
| Lac-des-Seize-Îles | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Saint-Étienne-de-Bolton | Gemini 3.8 Flash LOW | 200 | 31 902 ms | 19 346 / 10 875 | STOP | non/oui/oui/oui/oui | oui | 0,000 / 0,000 / 0,000 |
| Saint-Étienne-de-Bolton | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Valcourt | Gemini 3.8 Flash LOW | 200 | 26 763 ms | 7 263 / 8 423 | STOP | non/oui/oui/oui/oui | oui | 1,000 / 0,833 / 0,909 |
| Valcourt | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Saint-Barthélemy | Gemini 3.8 Flash LOW | 200 | 26 458 ms | 14 493 / 8 417 | STOP | non/oui/oui/non/N-A | non | N-A |
| Saint-Barthélemy | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Waterloo | Gemini 3.8 Flash LOW | 200 | 29 258 ms | 19 017 / 9 594 | STOP | non/oui/oui/oui/non | non | N-A |
| Waterloo | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A |

## Agrégats

- Latence campagne : 128 733 ms cumulés, 25 746,6 ms de moyenne, p95 31 902 ms.
- Usage campagne : 66 930 tokens d'entrée, 42 040 de sortie, 108 970 au total.
- Couches : brut 0/5, normalisé 5/5, extraction 5/5, profil 4/5,
  provenance 3/5, accepté 3/5.
- Qualité macro sur les trois cas acceptés : P=0,667, R=0,361, F1=0,436.
- Qualité micro sur 27 unités oracle des cas acceptés : TP=6, FP=5, FN=21,
  P=0,545, R=0,222, F1=0,316.
- Citations des cas acceptés : 88/88 identités exactes, pages physiques valides
  et extraits retrouvés.

## M1 provisoire

`gemini-3.8-flash-tiered` LOW est la M1 provisoire, sans promotion et sous
réserves nommées : seulement 3/5 PDF acceptés; un refus profil et un refus
provenance; F1 macro 0,436 avec F1 nul sur Saint-Étienne; Sonnet comparable
`N-A`; verdicts des deux juges en attente. Les juges peuvent départager la
qualité sur les trois cas acceptés, mais ne peuvent lever les deux refus.

## SHA et chemins

- Produit : `f96356e90a76b14b32ef0e913a82eb5805a9a413`; gel : `f73adc467e6c17911d2506eafa4652b625736017`;
  outillage : `69be8123acbfee24a5095046c686208976c8da71`; preuves :
  `cce116d630eab6a29a530ab072561f82e2c6ea39`.
- `manifest.json` : `9cb8c270a11e092f583eeea30f7467c8ae430e61fb3816c215445894bb435d53`.
- `prompt-freeze.json` : `f32e56355fb2e5f8e6d943204df37459ced1ce156a5d4a7db155947b07bc5f07`.
- `manual-oracle.json` : `4d50a26c869283199c58dcb75cf4055bccb39f988a9c700c026ddd0a1ef87130`.
- `comparison.json` : `76ee49f025a418e7ab42c82871e968db8acacd251cc2c108e8d661b3c965bb0c`.
- `blind-bundle.json` : `208dc0a8cd67c35e6b6a24701042d9457d15b41d94c180a7f8bf916fb4d17b5c`.
- `blind-map.json` : `c014425f7d877dc4b7c8a79a2748e59e527ff4be1c46e33bc96e4128f0083448`.
- Reçus et bruts : `control/` et `campaign-real/`; consigne juge :
  `judge-prompt.md`.
