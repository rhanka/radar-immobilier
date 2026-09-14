v13 contrat v8, plafond 64 000 · Gemini LOW 4/5 acceptés F1 macro 0,133 · Sonnet Cloud Code 4/5 acceptés F1 macro 0,222 · seuil B « ≥ 4/5 » atteint par les deux bras · l'acceptation monte, la correspondance à l'oracle baisse

# Campagne T1 v13 — contrat v8, Gemini LOW contre Sonnet 4.6

## Résultat en une phrase

Le contrat `immo-pv-extraction-v8` fait passer Sonnet de **0/5 à 4/5** et Gemini
LOW de **3/5 à 4/5** sorties acceptées. Les deux bras atteignent donc le seuil B
« ≥ 4/5 ». Sur la même campagne, le score de correspondance à l'oracle **baisse**
pour Gemini (F1 macro 0,558 → 0,133) : l'acceptation et la qualité mesurée ne
bougent pas dans le même sens, et la suite du rapport mesure pourquoi.

## Gel v13 et delta v12 → v13

Deux choses seulement bougent face à v12, et elles sont toutes deux au gel :

1. **Profil v8.** Produit `19d0d8b2` (`fix/refresh-profile-contract-v6`, PR #688),
   module `refresh-profile.ts`
   `113f477acd69fcc1b5d842a6e542e3231b906062b8dc173d38ed20a36a097304`,
   module `refresh-corpus.ts`
   `47cf6c620e4fd5ef20791443776810dc072d7e2449cc232726f35ed8d9c4680a`.
   v12 tournait sur le profil v5 (`f96356e9`, `b1d3989b…`).
2. **Plafond commun 64 000.** v12 gelait 65 536 et le bras Cloud Code déviait à
   64 000, seule valeur admise (sondes `v12/probes/` : 64 000 → 200, 64 001 → 400,
   65 536 → 400). v13 gèle 64 000 pour **tous** les bras : la déviation de v12
   disparaît, les deux bras partagent un plafond identique.

Inchangé : les cinq PDF, leurs textes et leurs hachages de page; l'oracle manuel,
**byte-identique** à v9 (`4d50a26c869283199c58dcb75cf4055bccb39f988a9c700c026ddd0a1ef87130`);
le manifeste, identique à celui de v9 hors le champ `campaign`; `maxAttempts=2`
avec `retryOnlyAfter=transport_failure`; le scoreur et l'oracle, non touchés.

Le prompt et le schéma sont **reconstruits** à partir du profil v8, ce qui est le
but de la campagne : ils changent donc d'empreinte sur les cinq documents.

| Document | schéma v13 | prompt v13 |
| --- | --- | --- |
| Lac-des-Seize-Îles | `c77d955b…` | `db26d9e3…` |
| Saint-Étienne-de-Bolton | `97d8960a…` | `5a24ebf3…` |
| Valcourt | `4266edd8…` | `5a9562e7…` |
| Saint-Barthélemy | `ced46ec2…` | `3a044a93…` |
| Waterloo | `021c07f4…` | `ea0fefe8…` |

## Contrôle Valcourt

Une requête Gemini LOW avant toute campagne : HTTP 200, `finishReason` `STOP`,
`maxOutputTokens` 64 000 observé sur le corps de requête, **accepté** en
15 781 ms. Le contrat v8 franchit toutes les couches; les deux bras ont été lancés.

## Comparaison par PDF

Accepté, couches et refus sont lus **après requalification hors ligne** des reçus
v2. Le requalifieur v13 rejoue la décision du profil v8 : version de contrat,
injection d'identité PDF, **bornage de l'extrait par troncature** à 200 points de
code, puis validation d'extraction, de profil et d'ancrage. Il ne porte plus le
rejet `entity_citation_excerpt_too_long`, retiré du produit en v8, et ne borne
plus `evidence[]`, que la production n'a jamais borné. Sur les dix reçus, la
décision hors ligne est **identique** à la décision en ligne.

| PDF | Bras | HTTP | Fin | Latence | Tokens in / out | Brut | Norm. | Extr. | Profil | Prov. | Accepté | Refus exact | P / R / F1 |
| --- | --- | ---: | :-: | ---: | ---: | :-: | :-: | :-: | :-: | :-: | :-: | --- | ---: |
| Lac-des-Seize-Îles | Gemini v5 (v9) | 200 | STOP | 13 844 ms | 6 811 / 4 920 | non | oui | oui | oui | oui | **oui** | — | 1,000 / 0,250 / 0,400 |
| Lac-des-Seize-Îles | Sonnet v5 (v12) | 200 | STOP | 51 508 ms | 7 508 / 6 051 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×8 + `entity_citation_excerpt_too_long` ×1 | `N-A` |
| Lac-des-Seize-Îles | **Gemini v8 (v13)** | 200 | STOP | 13 004 ms | 7 161 / 4 098 | non | oui | oui | oui | oui | **oui** | — | 1,000 / 0,250 / 0,400 |
| Lac-des-Seize-Îles | **Sonnet v8 (v13)** | 200 | STOP | 58 138 ms | 7 892 / 6 871 | non | oui | oui | oui | oui | **oui** | — | 1,000 / 0,500 / 0,667 |
| Saint-Étienne-de-Bolton | Gemini v5 (v9) | 200 | STOP | 25 959 ms | 19 346 / 9 488 | non | oui | oui | oui | oui | **oui** | — | 0,800 / 0,235 / 0,364 |
| Saint-Étienne-de-Bolton | Sonnet v5 (v12) | 200 | STOP | 223 620 ms | 21 661 / 25 102 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×29 + `entity_citation_excerpt_too_long` ×4 | `N-A` |
| Saint-Étienne-de-Bolton | **Gemini v8 (v13)** | 200 | STOP | 58 250 ms | 19 696 / 17 557 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×4 (`nodes[11..14].citations[0]`) | `N-A` |
| Saint-Étienne-de-Bolton | **Sonnet v8 (v13)** | 200 | STOP | 209 710 ms | 22 045 / 24 048 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×17 (`nodes[20..23]`, `edges[23..31]`, `evidence[17..20]`) | `N-A` |
| Valcourt | Gemini v5 (v9) | 200 | STOP | 25 533 ms | 7 263 / 9 449 | non | oui | oui | oui | oui | **oui** | — | 1,000 / 0,833 / 0,909 |
| Valcourt | Sonnet v5 (v12) | 200 | STOP | 77 173 ms | 7 846 / 9 200 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×5 | `N-A` |
| Valcourt | **Gemini v8 (v13)** | 200 | STOP | 17 958 ms | 7 613 / 6 917 | non | oui | oui | oui | oui | **oui** | — | 0,000 / 0,000 / 0,000 |
| Valcourt | **Sonnet v8 (v13)** | 200 | STOP | 64 983 ms | 8 230 / 7 641 | non | oui | oui | oui | oui | **oui** | — | 0,000 / 0,000 / 0,000 |
| Saint-Barthélemy | Gemini v5 (v9) | 200 | STOP | 47 135 ms | 14 493 / 14 000 | non | oui | oui | non | `N-A` | non | `missing_evidence_ref` ×3 | `N-A` |
| Saint-Barthélemy | Sonnet v5 (v12) | 200 | STOP | 128 647 ms | 16 532 / 13 968 | non | oui | oui | non | `N-A` | non | `unknown_status` ×2 + `missing_evidence_ref` ×1 | `N-A` |
| Saint-Barthélemy | **Gemini v8 (v13)** | 200 | STOP | 21 346 ms | 14 843 / 7 795 | non | oui | oui | oui | oui | **oui** | — | 0,000 / 0,000 / 0,000 |
| Saint-Barthélemy | **Sonnet v8 (v13)** | 200 | STOP | 130 594 ms | 16 916 / 14 820 | non | oui | oui | oui | oui | **oui** | — | 0,000 / 0,000 / 0,000 |
| Waterloo | Gemini v5 (v9) | 200 | STOP | 41 042 ms | 19 017 / 12 218 | non | oui | oui | oui | non | non | `ungrounded_pdf_excerpt` ×2 | `N-A` |
| Waterloo | Sonnet v5 (v12) | 200 | STOP | 171 483 ms | 21 677 / 18 269 | non | oui | oui | non | `N-A` | non | `unknown_status` ×2 + `incompatible_source_type` ×1 | `N-A` |
| Waterloo | **Gemini v8 (v13)** | 200 | STOP | 42 127 ms | 19 367 / 10 794 | non | oui | oui | oui | oui | **oui** | — | oracle partiel : R = 0,000 |
| Waterloo | **Sonnet v8 (v13)** | 200 | STOP | 145 524 ms | 22 061 / 16 666 | non | oui | oui | oui | oui | **oui** | — | oracle partiel : R = 0,000 |

Waterloo porte un oracle volontairement partiel (une seule unité) : le scoreur y
laisse `precision` et `f1` à `null` depuis v3. Ce document est donc exclu des
agrégats P/R/F1 ci-dessous, dans les quatre bras, et compté séparément.

Aucune tentative 2 n'existe dans cette campagne : les dix appels ont reçu HTTP 200
du premier coup. Aucune relance de qualité n'a été faite.

## Agrégats

| Agrégat | Gemini v5 (v9) | Sonnet v5 (v12) | **Gemini v8 (v13)** | **Sonnet v8 (v13)** |
| --- | ---: | ---: | ---: | ---: |
| Plafond de sortie | 65 536 | 65 536 gelé / 64 000 appliqué | **64 000** | **64 000** |
| Acceptés | 3/5 | 0/5 | **4/5** | **4/5** |
| Seuil B « ≥ 4/5 » | non | non | **atteint** | **atteint** |
| Couches brut · norm · extr · profil · prov · accepté | 0/5 · 5/5 · 5/5 · 4/5 · 3/5 · 3/5 | 0/5 · 5/5 · 5/5 · 3/5 · 0/5 · 0/5 | 0/5 · 5/5 · 5/5 · **5/5** · 4/5 · 4/5 | 0/5 · 5/5 · 5/5 · **5/5** · 4/5 · 4/5 |
| Macro P / R / F1 (acceptés, hors oracle partiel) | 0,933 / 0,440 / **0,558** (n=3) | `N-A` | 0,333 / 0,083 / **0,133** (n=3) | 0,333 / 0,167 / **0,222** (n=3) |
| Micro P / R / F1 | 0,909 / 0,370 / 0,526 (27 unités) | `N-A` | 0,125 / 0,056 / 0,077 (18 unités) | 0,182 / 0,111 / 0,138 (18 unités) |
| Latence moyenne | 30 703 ms | 130 486 ms | **30 537 ms** | 121 790 ms |
| Latence p95 observée | 47 135 ms | 223 620 ms | 58 250 ms | 209 710 ms |
| Tokens entrée / sortie | 66 930 / 50 075 | 75 224 / 72 590 | 68 680 / 47 161 | 77 144 / 70 046 |
| Coût unitaire | `N-A` | `N-A` | `N-A` | `N-A` |

**Les bases macro ne sont pas les mêmes d'une campagne à l'autre.** Le scoreur
n'évalue que les sorties acceptées; quand l'ensemble accepté change, l'ensemble
noté change avec lui. v9 note Lac, Saint-Étienne et Valcourt; v13 note Lac,
Valcourt et Saint-Barthélemy. Comparer 0,558 et 0,133 comme deux mesures du même
objet serait une erreur de lecture : ce sont deux moyennes sur deux populations de
documents différentes. La section suivante donne la comparaison à population fixe.

**Coût `N-A` — source manquante.** Le dépôt ne porte aucun tarif par token, ni
Anthropic ni Google. Les seuls tarifs présents
(`docs/reports/architecture-monthly/token-audit.mjs`, `docs/reports/couts-*.md`)
sont des forfaits au siège sans dénominateur en tokens. Aucune estimation n'a été
fabriquée.

## Ce que le contrat v8 a corrigé, mesuré

Quatre familles de refus que v12 mesurait ont **entièrement disparu** des dix reçus
v13 :

| Famille | v12 Sonnet | v9 Gemini | v13 Gemini | v13 Sonnet |
| --- | ---: | ---: | ---: | ---: |
| `unknown_status` | 4 occurrences | 0 | **0** | **0** |
| `entity_citation_excerpt_too_long` | 5 | 0 | **0** (inatteignable) | **0** (inatteignable) |
| `missing_evidence_ref` | 1 | 3 | **0** | **0** |
| `incompatible_source_type` | 1 | 0 | **0** | **0** |
| `ungrounded_pdf_excerpt` | 42 | 2 | 4 | 17 |

- L'énumération exacte de statut par type de nœud supprime `unknown_status`, qui
  était la famille dominante côté Sonnet. C'était bien un écart de contrat, pas un
  écart de compétence du modèle : v12 le supposait, v13 le mesure.
- Les `evidence_refs` explicites suppriment `missing_evidence_ref`, y compris le
  refus que Gemini subissait sur Saint-Barthélemy depuis v9.
- La troncature côté profil fait un travail réel et non symbolique : **28 extraits
  tronqués côté Gemini, 22 côté Sonnet**, tous restés ancrés après troncature.
  Le profil a bien borné, et le bornage n'a coûté aucun ancrage.

**Il reste une seule classe de refus, la même sur les deux bras.**
`ungrounded_pdf_excerpt` sur Saint-Étienne, et la cause est exactement celle que la
lane contrat avait mesurée : les quatre libellés de zone.

| chemin | page | extrait | points de code | après normalisation |
| --- | --- | --- | ---: | ---: |
| `nodes[…].citations[0]` | 11 | `Zone : COM-1` | 12 | 8 |
| `nodes[…].citations[0]` | 12 | `Zone : RUR-12` | 13 | 9 |
| `nodes[…].citations[0]` | 13 | `Zone : RUR-8` | 12 | 8 |
| `nodes[…].citations[0]` | 14 | `Zone : VIL-2` | 12 | 8 |

Les quatre sont verbatim sur la page citée, et les quatre tombent sous le plancher
d'ancrage `>= 12` caractères normalisés. Le plancher de 20 caractères que le prompt
v8 demande — « quand le texte cité fait moins de 20 caractères, continue la copie
verbatim » — **n'est appliqué par aucun des deux modèles** sur ces quatre libellés.
Le durcissement de consigne n'a donc pas produit l'effet visé, et c'est mesuré sur
deux modèles indépendants. Sonnet propage en outre le même libellé vers ses arêtes
et son `evidence[]`, d'où 17 violations contre 4.

## Pourquoi la correspondance à l'oracle baisse

C'est le point qui demande le plus de prudence, et il a deux causes distinctes.

### Cause 1 — Valcourt : la numérotation de point d'ordre du jour

Le scoreur exige que l'extrait cité **contienne** l'ancre de l'oracle. Les ancres
Valcourt commencent par la numérotation du point : `7.1 1070, RUE BISSONNETTE`.

- Sous v5, le modèle commençait son extrait à la numérotation :
  `7.1 1070, RUE BISSONNETTE - PIIA BOISÉ DU RUISSEAU - LOTISSEMENT`.
- Sous v8, il commence **après** :
  `1070, RUE BISSONNETTE - PIIA BOISÉ DU RUISSEAU - LOTISSEMENT`.

L'extrait reste verbatim, reste ancré, reste sur la bonne page — et le scoreur ne
le reconnaît plus. Ce n'est pas une troncature : ces extraits font 56 à 118 points
de code, très en-dessous de la borne de 200.

Diagnostic, à ancre oracle privée de sa numérotation, sorties inchangées :

| Valcourt | scoreur gelé | ancre sans numérotation |
| --- | ---: | ---: |
| Gemini v5 (v9) | 1,000 / 0,833 / 0,909 | 0,714 / 0,833 / 0,769 |
| **Gemini v8 (v13)** | 0,000 / 0,000 / 0,000 | 0,667 / 0,667 / 0,667 |
| **Sonnet v8 (v13)** | 0,000 / 0,000 / 0,000 | 0,714 / 0,833 / 0,769 |

Le zéro de Valcourt est donc un artefact de convention d'ancre, pas une sortie
vide. Sonnet v8 y retrouve exactement le niveau de Gemini v5.

### Cause 2 — Saint-Étienne et Saint-Barthélemy : perte de contenu réelle

Deux écarts ne s'expliquent pas par la convention d'ancre, et ils sont réels :

- **Saint-Étienne** : v9 appariait 4 unités sur 17, v13 en apparie **0** sur les
  deux bras. Étapes et pages citées sont pourtant identiques à v9 (`piia`,
  `derogation_mineure`, pages 11 à 14). Ce sont les extraits qui changent : sous
  v8 les nœuds citent le libellé de zone `Zone : COM-1` au lieu du texte de
  décision qui portait l'ancre. La même bascule produit le refus d'ancrage et la
  perte d'appariement — une cause, deux effets.
- **Saint-Barthélemy** : nouvellement accepté sur les deux bras, mais 0 unité sur
  8. Les étapes émises sont les bonnes (`adoption`, `avis_motion`,
  `projet_reglement`); les pages citées ne couvrent que 4–5 (Gemini) et 3–5
  (Sonnet) quand l'oracle s'étend sur 4, 5, 6, 7, 8 et 10. C'est un défaut de
  couverture du document, pas un défaut d'appariement.

### Comparaison à population fixe

Mêmes quatre documents pour les trois bras (Waterloo exclu, oracle partiel), toutes
les sorties notées qu'elles soient acceptées ou non, ancre privée de sa
numérotation. C'est un **diagnostic de contenu**, pas la métrique produit : il
ignore la porte d'acceptation.

| Bras | macro F1 | micro P / R / F1 |
| --- | ---: | ---: |
| Gemini v5 (v9) | 0,383 | 0,625 / 0,286 / 0,392 |
| **Gemini v8 (v13)** | 0,267 | 0,333 / 0,143 / 0,200 |
| **Sonnet v8 (v13)** | 0,359 | 0,368 / 0,200 / 0,259 |

À population et convention d'ancre fixes : **Sonnet v8 est au niveau de Gemini v5**
et **Gemini v8 est en retrait de son propre niveau v5**. L'écart Gemini v5 → v8
vient presque entièrement de Saint-Étienne.

## Bras Sonnet direct

`N-A, non nécessaire`. Le bras direct n'était prévu qu'en repli si le transport
Cloud Code échouait. Les cinq appels Cloud Code ont reçu HTTP 200 et se sont
terminés par `STOP`; aucun repli n'était justifié, et aucune clé Anthropic n'a été
chargée dans cette campagne.

## Bundle aveugle

`v13/blind-bundle.json` gelé, SHA-256
`dc3d35c8222464b94fc7af9dc68df56ce1473b8426bc71c822ccd5cd9d0df14f`, avec
`v13/blind-map.json` et `v13/judge-prompt.md`. **Aucun juge lancé.**

Contrairement à v12, ce bundle est comparable : **8 entrées**, **2 alias**
(`system-032f55c8cc8b`, `system-87b5985c3e9f`), et `coverage[].comparable` vaut
`true` sur **4 documents sur 5** — Lac, Valcourt, Saint-Barthélemy, Waterloo. Seul
Saint-Étienne reste à `false`, faute de sortie acceptée sur l'un ou l'autre bras.
Un classement par document y est donc calculable, sur quatre documents.

Le prompt de juge porte l'avertissement sur la numérotation d'ancre documentée
ci-dessus, pour que le juge évalue le soutien sur le fond et ne reproduise pas
l'artefact du scoreur automatique.

## Gates, gel et SHA

| Gate | Résultat |
| --- | --- |
| `make test-v13 ENV=test-t1-model-benchmark` | **27/27** |
| `make test-v9` / `test-v11` / `test-v12` rejoués | 27/27 chacun, aucune régression |
| Requalification hors ligne, 10 reçus | acceptation identique en ligne et hors ligne |
| `score-v13` sur chaque bras | 5/5 cas |
| `git diff --check` | propre |
| `grep -rlE 'sk-ant-[A-Za-z0-9]' docs/reviews/refresh-benchmark/v13` | **0 fichier** |

- Manifeste : `80c2970dacb2d419d97ad0bc456a53c574594b20b2f85ed7d9aac75ea09cc229`.
- Gel de prompt : `1b6bfb5b6f3905de78031ef118bf8be71400233f3008056a2ef7c25ce9f25072`.
- Oracle : `4d50a26c869283199c58dcb75cf4055bccb39f988a9c700c026ddd0a1ef87130`
  (**identique à v9**).
- Comparaison Gemini : `6f495c09cd1ce6d0acb7b1723878c6da828415e6aeabb7abd70579c441ea6d11`.
- Comparaison Sonnet Cloud Code : `bb1909bb58574b6f2b6c92db2bdc03fc2ae64f85000092517b70c7228ab7594f`.
- Bundle aveugle : `dc3d35c8222464b94fc7af9dc68df56ce1473b8426bc71c822ccd5cd9d0df14f`.

Aucun acte de production, aucun merge, aucun force-push, aucun trailer.

## Portée et limites

Mesuré : HTTP, fin de flux, latence, tokens, six couches de validation, refus
exacts, acceptation et P/R/F1 des deux bras v13 sur les cinq PDF gelés; équivalence
de traitement hors ligne; cause exacte de la classe de refus restante; cause exacte
de la baisse de correspondance à l'oracle.

Non couvert :

- **Variance** : une seule observation par document et par bras. Les écarts
  Gemini/Sonnet rapportés ici ne sont pas des intervalles.
- **Coût unitaire par token** : source manquante, non estimé.
- **Le jugement aveugle** : le bundle est gelé mais aucun juge n'a été lancé, donc
  aucune évaluation sémantique indépendante n'existe à ce stade.
- **La qualité de Waterloo** : oracle volontairement partiel, une unité; `precision`
  et `f1` y restent `null` par construction du scoreur.
- **Le comportement de Saint-Étienne après traitement du libellé de zone** : ni le
  plancher d'ancrage `>= 12` ni le scoreur n'ont été touchés dans cette lane.

## Points pour le conducteur

1. **Le seuil B est atteint par les deux bras, et il ne suffit pas à décider.**
   L'acceptation monte et la correspondance à l'oracle baisse au même moment. Un
   arbitrage sur le seul critère « ≥ 4/5 » sélectionnerait un contrat qui laisse
   passer des sorties moins appariées à l'oracle.
2. **Le plancher de 20 caractères demandé par le prompt v8 n'est pas appliqué** par
   Gemini ni par Sonnet sur les libellés de zone. Deux voies existent — abaisser le
   plancher d'ancrage de 12, ou traiter le libellé court côté profil — et les deux
   sont des décisions de garantie produit qui reviennent à l'owner, pas à cette lane.
3. **La convention d'ancre de l'oracle est fragile.** Elle fait dépendre le score de
   la présence d'une numérotation d'ordre du jour en tête d'extrait. Le corpus et
   l'oracle sont gelés depuis v9 et n'ont pas été touchés ici; si les campagnes
   ultérieures doivent comparer des contrats qui changent le début de l'extrait,
   cette convention est à arbitrer avant, pas après.
4. **Sonnet 4.6 n'est plus écarté.** v12 concluait qu'on ne pouvait pas conclure;
   v13 le mesure : 4/5 accepté, et le meilleur des deux bras sur la comparaison à
   population fixe. Il reste deux à quatre fois plus lent que Gemini LOW.
