v12 Sonnet comparable : direct 0/5 acceptés · Cloud Code 0/5 acceptés · Gemini LOW v9 3/5 acceptés F1 macro 0,558 · F1 Sonnet `N-A` faute de sortie acceptée

# Campagne T1 v12 — Sonnet comparable, deux transports

## Résultat

À gel identique à v9 (produit `f96356e9`, profil
`b1d3989bc826e0691fb644b0b2857099f2c957a44f054bf0b3746adc526dab3f`, mêmes cinq
PDF, même prompt), `claude-sonnet-4-6` n'obtient **aucune sortie acceptée**, ni
par le transport direct Anthropic (0/5) ni par le transport Cloud Code (0/5). La
référence Gemini LOW v9 reste à 3/5 acceptés et F1 macro 0,558.

Les dix appels modèle ont reçu HTTP 200 : le transport n'est pas la cause des
refus. Les dix sorties franchissent la normalisation et le contrat d'extraction
(10/10), puis s'arrêtent aux couches métier — profil pour cinq d'entre elles,
provenance pour les cinq autres. Aucun P/R/F1 n'est donc calculable pour Sonnet :
le scoreur n'évalue que les sorties acceptées, et il n'y en a aucune.

Un seul incident transport est survenu : Saint-Barthélemy direct, tentative 1,
`ETIMEDOUT` après 3 528 138 ms sans réponse. Le contrat autorise une relance
après échec transport (`maxAttempts=2`, `retryOnlyAfter=transport_failure`); la
tentative 2 a reçu HTTP 200 en 126 363 ms et c'est elle qui est comptée. Aucune
relance de qualité n'a été faite.

## Comparaison par PDF

Accepté et couches sont lus après requalification hors ligne des reçus v2, dans
l'état exact où v9 a été mesuré (`post-profile-injection-offline`), pour que les
trois bras soient comparés au même traitement.

| PDF | Bras | HTTP | Latence | Tokens in / out | Brut | Norm. | Extr. | Profil | Prov. | Accepté | Refus exact | P / R / F1 |
| --- | --- | ---: | ---: | ---: | :-: | :-: | :-: | :-: | :-: | :-: | --- | ---: |
| Lac-des-Seize-Îles | Gemini LOW v9 | 200 | 13 844 ms | 6 811 / 4 920 | non | oui | oui | oui | oui | **oui** | — | 1,000 / 0,250 / 0,400 |
| Lac-des-Seize-Îles | Sonnet direct | 200 | 51 999 ms | 7 508 / 5 524 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×3 (`nodes[1].citations[0]`, `edges[0]`, `edges[5]`) + `entity_citation_excerpt_too_long` ×2 (`evidence[0..1]`) | `N-A` |
| Lac-des-Seize-Îles | Sonnet Cloud Code | 200 | 51 508 ms | 7 508 / 6 051 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×8 + `entity_citation_excerpt_too_long` ×1 (`evidence[2]`) | `N-A` |
| Saint-Étienne-de-Bolton | Gemini LOW v9 | 200 | 25 959 ms | 19 346 / 9 488 | non | oui | oui | oui | oui | **oui** | — | 0,800 / 0,235 / 0,364 |
| Saint-Étienne-de-Bolton | Sonnet direct | 200 | 243 237 ms | 21 661 / 25 611 | non | oui | oui | non | `N-A` | non | `unknown_status` ×10 (`nodes[1]`, `nodes[3]`, `nodes[5]`, …) | `N-A` |
| Saint-Étienne-de-Bolton | Sonnet Cloud Code | 200 | 223 620 ms | 21 661 / 25 102 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×29 + `entity_citation_excerpt_too_long` ×4 | `N-A` |
| Valcourt | Gemini LOW v9 | 200 | 25 533 ms | 7 263 / 9 449 | non | oui | oui | oui | oui | **oui** | — | 1,000 / 0,833 / 0,909 |
| Valcourt | Sonnet direct | 200 | 74 792 ms | 7 846 / 8 026 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×4 (`nodes[5]`, `edges[5]`, `edges[11]`, …) | `N-A` |
| Valcourt | Sonnet Cloud Code | 200 | 77 173 ms | 7 846 / 9 200 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×5 (mêmes ancres) | `N-A` |
| Saint-Barthélemy | Gemini LOW v9 | 200 | 47 135 ms | 14 493 / 14 000 | non | oui | oui | non | `N-A` | non | `missing_evidence_ref` (`nodes[10]`, `nodes[11]`, `edges[6]`) | `N-A` |
| Saint-Barthélemy | Sonnet direct (tent. 2) | 200 | 126 363 ms | 16 532 / 12 686 | non | oui | oui | non | `N-A` | non | `unknown_status` ×1 (`nodes[2]`) | `N-A` |
| Saint-Barthélemy | Sonnet Cloud Code | 200 | 128 647 ms | 16 532 / 13 968 | non | oui | oui | non | `N-A` | non | `unknown_status` ×2 + `missing_evidence_ref` (`edges[9]`) | `N-A` |
| Waterloo | Gemini LOW v9 | 200 | 41 042 ms | 19 017 / 12 218 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` (`nodes[3].citations[1]`, `nodes[4].citations[1]`) | `N-A` |
| Waterloo | Sonnet direct | 200 | 189 868 ms | 21 677 / 18 822 | non | oui | oui | non | `N-A` | non | `unknown_status` ×2 + `missing_evidence_ref` (`edges[25]`) | `N-A` |
| Waterloo | Sonnet Cloud Code | 200 | 171 483 ms | 21 677 / 18 269 | non | oui | oui | non | `N-A` | non | `unknown_status` ×2 + `incompatible_source_type` (`edges[10]`) | `N-A` |

Saint-Barthélemy direct tentative 1 : `ETIMEDOUT`, aucun HTTP, aucune sortie,
3 528 138 ms. Elle est hors des agrégats de latence ci-dessous et conservée dans
`campaign-direct/saint-barthelemy-2026-09-08--sonnet-direct.receipt.json`.

## Agrégats

| Agrégat | Gemini LOW v9 | Sonnet direct v12 | Sonnet Cloud Code v12 |
| --- | ---: | ---: | ---: |
| Acceptés | 3/5 | 0/5 | 0/5 |
| Couches brut → accepté | 0/5 · 5/5 · 5/5 · 4/5 · 3/5 · 3/5 | 0/5 · 5/5 · 5/5 · 2/5 · 0/5 · 0/5 | 0/5 · 5/5 · 5/5 · 3/5 · 0/5 · 0/5 |
| Macro P / R / F1 (acceptés) | 0,933 / 0,440 / **0,558** | `N-A` | `N-A` |
| Micro P / R / F1 (27 unités) | 0,909 / 0,370 / 0,526 | `N-A` | `N-A` |
| Latence moyenne | 30 703 ms | 137 252 ms | 130 486 ms |
| Latence p95 observée | 47 135 ms | 243 237 ms | 223 620 ms |
| Tokens entrée / sortie | 66 930 / 50 075 | 75 224 / 70 669 | 75 224 / 72 590 |
| Coût unitaire | `N-A` | `N-A` | `N-A` |

Ordre des couches : brut, normalisé, extraction, profil, provenance, accepté;
chaque fraction compte les PDF qui franchissent la couche sur les cinq gelés,
comme dans le rapport v9. La provenance n'est évaluée que sur les sorties ayant
franchi le profil : les deux sorties Sonnet direct et les trois sorties Cloud
Code qui l'atteignent y échouent toutes.

**Coût.** Le dépôt ne porte aucun tarif Anthropic par token. Les seuls tarifs
présents (`docs/reports/architecture-monthly/token-audit.mjs`,
`docs/reports/couts-*.md`) sont des forfaits au siège — 200 USD/mois, USD→CAD
1,37, marge 1,15 — qui n'ont pas de dénominateur en tokens. Le coût unitaire des
trois bras est donc `N-A` : source manquante, non estimé.

## Ce que les refus disent

Les deux transports Sonnet échouent sur deux familles de causes, et non sur une
seule :

- **`unknown_status`** (Saint-Étienne, Saint-Barthélemy, Waterloo en direct;
  Saint-Barthélemy et Waterloo en Cloud Code). C'est exactement l'ambiguïté déjà
  documentée en v9 §`unknown_status` : le profil décrit les valeurs métier
  (`en_vigueur`, `actif`, `projet`) dans des descriptions textuelles de
  propriétés, tandis que le validateur compare `status` à la liste générique de
  durcissement (`candidate`, `attached`, `needs_review`, …). Sonnet écrit la
  valeur métier; le validateur la refuse. Gemini LOW écrit la valeur générique.
  L'écart est donc au moins en partie un écart de contrat, pas seulement un
  écart de modèle.
- **`ungrounded_pdf_excerpt`** (Lac et Valcourt dans les deux transports;
  Saint-Étienne en Cloud Code). Les extraits ne se retrouvent pas mot pour mot
  dans la page citée. Gemini subit le même refus sur Waterloo v9.
- `entity_citation_excerpt_too_long`, `missing_evidence_ref` et
  `incompatible_source_type` apparaissent en complément, jamais seuls.

En ligne, avant requalification, les dix reçus portent aussi
`missing_citation_source_file` sur toutes les entités : Sonnet n'émet pas le
champ `source_file` dans les citations. L'injection d'identité hors ligne — la
même que celle appliquée à Gemini v9 — le neutralise, et il n'entre donc pas
dans le décompte d'acceptation ci-dessus. Il reste une différence de forme
mesurée entre Sonnet et Gemini sur le chemin en ligne.

## Écart de gel assumé : plafond de sortie

Le gel v12 fixe `maxOutputTokens` à 65 536. Le transport direct l'a bien utilisé.
Le transport Cloud Code **refuse** cette valeur : les sondes `v12/probes/`
mesurent 32 768 → 200, 64 000 → 200, 64 001 → 400 et 65 536 → 400, et les cinq
refus HTTP 400 à 65 536 sont conservés dans `v12/refused-cap-65536/`. Le bras
Cloud Code tourne donc à 64 000, seule valeur admise sous le plafond gelé.

Cet écart de 1 536 tokens n'a bloqué aucune sortie : les cinq réponses Cloud Code
se terminent par `STOP`, jamais par `MAX_TOKENS`, et la plus longue consomme
25 102 tokens de sortie, soit 39 % du plafond appliqué. Le delta entre les deux
bras Sonnet reste attribuable au transport, pas à une troncature.

## Bundle aveugle

`v12/blind-bundle.json` est gelé, SHA-256
`15794e4e8f11e1c1f02c4c5efa6493b4931af979e4acba17bada19a43f9d9d33`, avec
`v12/blind-map.json` et `v12/judge-prompt.md`. Aucun juge n'a été lancé.

Le bundle ne contient que **3 entrées**, toutes sous l'alias unique
`system-f6971d095d8a` (Gemini v9), parce que le bundle n'admet que des sorties
acceptées et que Sonnet n'en produit aucune. `coverage[].comparable` vaut `false`
sur les cinq documents : **aucun classement entre systèmes n'est calculable** sur
ce bundle. Le prompt de juge l'énonce et impose `winner: "tie"` et
`confidence: "low"`. Le bundle est livré comme artefact de traçabilité, pas
comme base de comparaison.

## Gel et SHA

Le manifeste, le gel de prompt et l'oracle sont copiés de v9; seul le champ
`campaign` change dans les deux premiers. Le delta mesuré face à v9 est donc le
modèle et le transport, pas le contexte.

- Manifeste : `cb71acdf05972773514d3e3b2c0009194a45f8948ac8fdd6545d83d89ab73e0e`.
- Prompt : `871eae77c17216bf95221b889ca623d248d7f97c250cf5ab533e7e91d65f0d64`.
- Oracle : `4d50a26c869283199c58dcb75cf4055bccb39f988a9c700c026ddd0a1ef87130`
  (identique à v9).
- Comparaison directe :
  `f2689fb699e0c6b8f1980eb3c8e22183d2c9cdba3554af2c053b087f5d059268`.
- Comparaison Cloud Code :
  `dbecd2d000ae0c0e865d64135971cd02c023a44cc4101429bbe2de02f2d933aa`.
- Bundle aveugle :
  `15794e4e8f11e1c1f02c4c5efa6493b4931af979e4acba17bada19a43f9d9d33`.
- Ping direct : HTTP 200, 4 903 ms. Ping Cloud Code : HTTP 200, 1 873 ms.

Gates : `test-v12` 25/25, dix reçus v2 requalifiés hors ligne sans écart
d'acceptation, score 5/5 cas sur chaque bras, bundle gelé.
`grep -rlE 'sk-ant-[A-Za-z0-9]' docs/reviews/refresh-benchmark/v12` retourne 0
fichier. Aucun acte produit ni merge n'a été effectué.

## Portée et limites

Mesuré : HTTP, latence, tokens, couches de validation, refus exacts et
acceptation des trois bras sur les cinq PDF gelés, plafond Cloud Code, et
équivalence de traitement hors ligne avec v9.

Non couvert : qualité sémantique de Sonnet — elle n'est pas mesurable tant
qu'aucune sortie n'est acceptée; coût unitaire par token (source manquante);
variance, puisque chaque bras n'a qu'une observation par PDF; comportement de
Sonnet après clarification du contrat `status`, qui est la première hypothèse à
tester avant de conclure quoi que ce soit sur le modèle lui-même.
