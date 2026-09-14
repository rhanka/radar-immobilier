# Campagne v15 — rejeu exact de v14

`[FAIT]` = mesuré, avec sa source dans ce dossier. `[JUGEMENT]` = appréciation.
`N-A` = non disponible ou non calculable.

## Ce que v15 est

[FAIT] v15 ne change **rien** : même commit de contrat `d93f5c93`, même module de
profil `776c7578…`, même corpus, même oracle gelé `4d50a26c…`, même plafond 64 000,
même modèle `gemini-3.8-flash-tiered` en effort LOW. Le gel est vérifié
mécaniquement par `make check-v15-replay`, qui compare les sept invariants du gel
et les empreintes de schéma et de prompt document par document :

~~~json
{"exactReplay":true,"reference":"v14","replay":"v15","documents":5,
 "maxOutputTokens":64000,"t1Commit":"d93f5c9358656536da8c90d91300fcb6076484a4",
 "profileModuleSha256":"776c757812abc66f7a456dec9774b1241bfb57c5ce6a5577157f5c2b6c5502eb"}
~~~

[FAIT] La seule différence entre les deux campagnes est **l'appel au modèle**.
v14 et v15 forment donc **deux observations par document**, ce qui manquait à toute
campagne antérieure sauf la paire v7 → v9.

## Résultat

[FAIT] **5 PV sur 5 acceptés**, comme v14. Aucune violation, aucune classe de refus.

| Agrégat | v14 | **v15** |
| --- | ---: | ---: |
| Acceptés | 5/5 | **5/5** |
| Couches brut · norm · extr · profil · prov · accepté | 0·5·5·5·5·5 /5 | **0·5·5·5·5·5 /5** |
| Classes de refus | aucune | **aucune** |
| Macro F1, oracle v1 | 0,282 | **0,468** |
| Macro F1, oracle v2 | 0,576 | **0,582** |
| Macro P / R, oracle v2 | 0,664 / 0,547 | **0,680 / 0,547** |
| Latence moyenne | 27 030 ms | **25 470 ms** |
| Latence maximale | 52 710 ms | **32 174 ms** |
| Tokens entrée / sortie | 70 080 / 42 920 | **70 080 / 39 225** |
| Extraits tronqués à 200 | 18 | **20** |
| Citations d'entités sous 20 points de code | 0 sur 103 | **0 sur 94** |
| Coût unitaire | `N-A` | `N-A` |

[FAIT] Les tokens d'entrée sont identiques au token près : 70 080 des deux côtés.
C'est la conséquence directe du gel identique.

## Par document

| Document | HTTP | fin | latence | tokens in/out | accepté | F1 v1 | F1 v2 | tp/gold (v2) |
| --- | ---: | :-: | ---: | ---: | :-: | ---: | ---: | :-: |
| Lac-des-Seize-Îles | 200 | `STOP` | 16 042 ms | 7 441 / 3 962 | oui | 0,400 | 0,750 | 3/4 |
| Saint-Étienne-de-Bolton | 200 | `STOP` | 32 174 ms | 19 976 / 8 601 | oui | 0,364 | 0,500 | 6/17 |
| Valcourt | 200 | `STOP` | 25 076 ms | 7 893 / 7 954 | oui | 0,909 | 0,769 | 5/6 |
| Saint-Barthélemy | 200 | `STOP` | 30 257 ms | 15 123 / 10 519 | oui | 0,200 | 0,308 | 2/8 |
| Waterloo | 200 | `STOP` | 23 803 ms | 19 647 / 8 189 | oui | `N-A` | `N-A` | 1/1 |

## Variance v14 ↔ v15 — le résultat principal

[FAIT] Sous l'**oracle v2**, la mesure est quasiment immobile entre les deux runs :

| Document | F1 v2, v14 | F1 v2, v15 | écart | unités appariées |
| --- | ---: | ---: | ---: | :-: |
| Lac-des-Seize-Îles | 0,750 | 0,750 | **0,000** | 3 → 3 |
| Saint-Étienne-de-Bolton | 0,500 | 0,500 | **0,000** | 6 → 6 |
| Valcourt | 0,769 | 0,769 | **0,000** | 5 → 5 |
| Saint-Barthélemy | 0,286 | 0,308 | **+0,022** | 2 → 2 |
| Waterloo | `N-A` | `N-A` | `N-A` | 1 → 1 |

[FAIT] **Le nombre d'unités appariées est identique sur les cinq documents.**
L'écart de 0,022 sur Saint-Barthélemy vient d'un faux positif de moins (4 contre 3),
pas d'une unité gagnée ou perdue.

[FAIT] Sous l'**oracle v1**, la même paire de runs bouge beaucoup plus :

| Document | F1 v1, v14 | F1 v1, v15 | écart |
| --- | ---: | ---: | ---: |
| Lac-des-Seize-Îles | 0,400 | 0,400 | 0,000 |
| Saint-Étienne-de-Bolton | 0,364 | 0,364 | 0,000 |
| Valcourt | 0,000 | 0,909 | **+0,909** |
| Saint-Barthélemy | 0,364 | 0,200 | **−0,164** |

[JUGEMENT] Le contraste est l'argument le plus net en faveur du réalignement :
**à sorties comparables, l'oracle v1 fait bouger Valcourt de 0,000 à 0,909 d'un run
à l'autre, l'oracle v2 ne bouge pas.** L'instabilité mesurée par v1 sur ce document
était une instabilité de convention d'ancre — la présence ou non de la numérotation
de point en tête d'extrait — et non une instabilité du modèle.

[FAIT] Pour mémoire, le rejeu à gel identique v7 → v9 (contrat v5) déplaçait le F1
de **+0,364** sur un document sur trois. Ici, sous l'oracle v2, l'écart maximal est
de **0,022** sur quatre documents.

[FAIT] **Deux observations par cellule ne permettent pas d'estimer une variance
statistique ni une probabilité d'acceptation.** Elles permettent de dire que le
résultat n'est pas un coup de chance sur un tirage, pas de borner le risque.

## Limites

[FAIT] **Aucun bras Sonnet**, hors périmètre de l'option B. Aucune clé Anthropic
chargée.

[FAIT] **Aucun juge lancé.** Le bundle aveugle gelé est celui de v14
(`d7d3daec…`), à système unique : il permet de noter l'utilité et les défauts de
citation, pas de départager deux systèmes.

[FAIT] **Coût unitaire `N-A`** — source manquante, aucune estimation fabriquée.

[FAIT] Les limites d'oracle non corrigées sont inchangées et listées dans
`manual-oracle-v2.json`, champ `knownLimitsNotCorrected` : les 4 unités de stage
`inconnu` inappariables, et la macro qui ne porte que sur les documents acceptés
sauf à demander la population fixe. S'y ajoute le conflit mesuré en v14 entre le
contrat v9 et les sept ancres d'énumération de Saint-Étienne (`v14/report.md`).

## Gates

| Gate | Résultat |
| --- | --- |
| `make check-v15-replay` | `exactReplay: true` |
| `make test-v14 CAMPAIGN=v15` | **27/27** |
| Requalification hors ligne des 5 reçus | acceptation identique en ligne et hors ligne, 5/5 |
| `grep -rlE 'sk-ant-[A-Za-z0-9]' v15` | **0** |

SHA : gel de prompt `b8e5eed0…` · comparaison `180c6b36…` · oracle gelé `4d50a26c…`
(byte-identique à v9) · oracle v2 `be5e21a6…`.

Campagne de référence : [`../v14/report.md`](../v14/report.md).
Comparaison v1 contre v2 : [`../oracle-v2-comparison.json`](../oracle-v2-comparison.json).
