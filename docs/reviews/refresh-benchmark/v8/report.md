# Campagne T1 v8 — Gemini 3.8 Flash HIGH

## Résultat

À acceptation brute identique (3/5), HIGH n'améliore pas le rappel mesuré et
coûte beaucoup plus cher que LOW. Les cinq PDF ont reçu HTTP 200 et une fin SSE
`STOP`, sans 429, saturation ni retry. HIGH accepte Lac-des-Seize-Îles,
Valcourt et Waterloo; il refuse Saint-Étienne-de-Bolton et Saint-Barthélemy sur
`unknown_status`. Le F1 macro calculable est 0,200 contre 0,436 en v7, avec une
réserve : Waterloo a un oracle partiel et n'a donc ni précision ni F1.

Le contrôle Valcourt est accepté en 118 445 ms, contre 22 620 ms en v7. Son
usage est 7 263 tokens d'entrée, 13 756 de sortie visible et 27 768 de pensée,
soit 48 787 au total fournisseur. Son brut est JSON strict valide. Six requêtes
Gemini sur le maximum de sept ont été consommées. Sonnet est `N-A`, sa clé étant
absente de l'environnement du processus; aucun `.env*` n'a été lu.

## Comparaison PDF × effort

Notation couches : brut / normalisé / extraction / profil / provenance.
`N-A` signifie inconnu ou non calculable dans le contrat gelé.

| PDF | Effort | Accepté | Couches | Latence | Tokens entrée / sortie / pensée | P / R / F1 |
| --- | --- | --- | --- | ---: | ---: | --- |
| Lac-des-Seize-Îles | v7 LOW | oui | non/oui/oui/oui/oui | 14 352 ms | 6 811 / 4 731 / N-A | 1,000 / 0,250 / 0,400 |
| Lac-des-Seize-Îles | v8 HIGH | oui | oui/oui/oui/oui/oui | 40 221 ms | 6 811 / 6 592 / 8 411 | 1,000 / 0,250 / 0,400 |
| Saint-Étienne-de-Bolton | v7 LOW | oui | non/oui/oui/oui/oui | 31 902 ms | 19 346 / 10 875 / N-A | 0,000 / 0,000 / 0,000 |
| Saint-Étienne-de-Bolton | v8 HIGH | non | oui/oui/oui/non/N-A | 95 327 ms | 19 346 / 17 068 / 10 769 | N-A |
| Valcourt | v7 LOW | oui | non/oui/oui/oui/oui | 26 763 ms | 7 263 / 8 423 / N-A | 1,000 / 0,833 / 0,909 |
| Valcourt | v8 HIGH | oui | oui/oui/oui/oui/oui | 51 533 ms | 7 263 / 8 248 / 11 688 | 0,000 / 0,000 / 0,000 |
| Saint-Barthélemy | v7 LOW | non | non/oui/oui/non/N-A | 26 458 ms | 14 493 / 8 417 / N-A | N-A |
| Saint-Barthélemy | v8 HIGH | non | oui/oui/oui/non/N-A | 91 032 ms | 14 493 / 13 848 / 20 090 | N-A |
| Waterloo | v7 LOW | non | non/oui/oui/oui/non | 29 258 ms | 19 017 / 9 594 / N-A | N-A |
| Waterloo | v8 HIGH | oui | oui/oui/oui/oui/oui | 130 652 ms | 19 017 / 17 682 / 25 875 | N-A / 0,000 / N-A |

Les refus HIGH exacts sont `unknown_status` sur `nodes[14]`, valeur `actif`,
pour Saint-Étienne et sur `nodes[3]`, valeur `projet`, pour Saint-Barthélemy.
La requalification hors ligne des reçus v2 contre les bruts hashés n'a changé
aucune acceptation. Les 109 citations des trois sorties acceptées passent les
contrôles d'identité, de page physique et d'extrait.

## Agrégats

| Mesure campagne | v7 LOW | v8 HIGH | Delta HIGH |
| --- | ---: | ---: | ---: |
| Acceptation | 3/5 | 3/5 | 0 point |
| Latence cumulée | 128 733 ms | 408 765 ms | +217,5 % |
| Latence moyenne | 25 746,6 ms | 81 753,0 ms | ×3,18 |
| Latence p95 observée | 31 902 ms | 130 652 ms | ×4,10 |
| Tokens entrée | 66 930 | 66 930 | 0 % |
| Tokens sortie visible | 42 040 | 63 438 | +50,9 % |
| Tokens pensée déclarés | N-A | 76 833 | apparus sur 5/5 |
| Tokens fournisseur totaux | 108 970 | 207 201 | +90,1 % |
| Couches brut / normalisé / extraction | 0/5 · 5/5 · 5/5 | 5/5 · 5/5 · 5/5 | brut +5 |
| Couches profil / provenance / accepté | 4/5 · 3/5 · 3/5 | 3/5 · 3/5 · 3/5 | profil −1 |

Sur les sorties acceptées et rankables, v8 obtient en macro P=0,500,
R=0,125 et F1=0,200 (Lac et Valcourt), contre 0,667 / 0,361 / 0,436 sur
trois cas v7. En micro rankable, v8 a TP=1, FP=5, FN=9, soit P=0,167,
R=0,100 et F1=0,125, contre TP=6, FP=5, FN=21 et 0,545 / 0,222 / 0,316.
En incluant l'unité oracle partielle Waterloo, le rappel macro des trois
acceptés v8 est 0,083 et le rappel micro 1/11=0,091; précision et F1 globaux
restent `N-A` sur ce périmètre partiel.

## M1 provisoire

`gemini-3.8-flash-tiered` LOW demeure la M1 provisoire, sans promotion. HIGH
n'améliore pas le taux d'acceptation, remplace l'acceptation Saint-Étienne par
Waterloo, fait chuter Valcourt de F1 0,909 à 0,000, n'ajoute aucun rappel sur
Waterloo et multiplie la latence moyenne par 3,18 ainsi que les tokens totaux
par 1,90. Les améliorations mesurées de HIGH sont le JSON brut valide sur 5/5
et l'acceptation de Waterloo; elles ne compensent pas les régressions mesurées.

Réserves nommées : une seule exécution stochastique par couple; ensembles
acceptés différents entre LOW et HIGH; oracle Waterloo partiel; F1 macro HIGH
sur deux cas rankables seulement; deux refus profil HIGH; Sonnet `N-A`; aucun
jugement aveugle v8 lancé; jugements v7 en cours hors de ce dossier; aucun coût
monétaire ni quota causal mesuré. Ces résultats ne justifient aucun acte produit.

## Gel, SHA et chemins

Le seul delta expérimental v7 → v8 est `thinkingLevel=LOW` → `HIGH`; le modèle
wire reste `gemini-3.8-flash-tiered`. Profil, prompt, schémas, corpus, cap
65 536, timeout, retry transport, validateur, oracle et métriques sont inchangés.
Le test 15/15 retire uniquement `campaign` et `frozenAt` avant comparaison; il
compare les octets oracle directement.

- Produit : `f96356e90a76b14b32ef0e913a82eb5805a9a413`.
- Module profil : `b1d3989bc826e0691fb644b0b2857099f2c957a44f054bf0b3746adc526dab3f`.
- Manifeste : `c32a16c79154c10dceaaa67b37d245a3748276a3a7f7fba727152aa541858519`.
- Prompt/schémas : `9a167db24fa6cb147a8d9f8966e38df895322330a828bb89afdb926b3fd6da21`.
- Oracle : `4d50a26c869283199c58dcb75cf4055bccb39f988a9c700c026ddd0a1ef87130`.
- Comparaison : `8f30220780b3ea7522ba5d0fef57623f98b142bc309ed66c00006123ab86405f`.
- Bundle : `4b03bb5c35be899e4c3c3006978ddf6f932403a447be4e1409a36b12293a31ee`.
- Carte aveugle : `04ee19431cd828f4ae8fef8a3be6d096cf66980e7eb14c5fcdaf0909a26234ba`.

Chemins : `v8/control/`, `v8/campaign-real/`, `v8/comparison.json`,
`v8/blind-bundle.json`, `v8/blind-map.json`, `v8/judge-prompt.md` et ce rapport.
