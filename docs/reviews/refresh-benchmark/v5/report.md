# Benchmark T1 v5 — contrôle du contrat corrigé

## Résultat

Le contrôle préalable Valcourt a reçu HTTP 200 de
`gemini-3.8-flash-tiered` en effort fournisseur `LOW`. La réponse commence
par un fence `json`, contient les nouvelles citations au niveau des entités,
mais ne contient ni JSON complet ni fence fermant. Le parseur strict refuse
donc la réponse avant les validateurs d'extraction, de profil et de
provenance.

La campagne est arrêtée après 1 requête Gemini sur le plafond de 8. Aucune
des cinq requêtes de campagne et aucun juge n'ont été lancés. Sonnet est
`N-A` parce que la clé Anthropic est absente de l'environnement du processus.

## Tableau PDF × modèle

`N-A` indique une mesure non disponible. Pour Valcourt, `profil=N-A` indique
que le parseur n'a pas atteint `validateProfileExtraction`; le contrôle est
donc négatif. Les quatre autres requêtes Gemini sont interdites par le garde
du contrôle préalable.

| PDF | Modèle | HTTP | Latence | Tokens entrée/sortie/total | jsonValidRaw | Normalisé | Extraction | Profil | Provenance | Accepté | Score |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| Lac-des-Seize-Îles | Gemini 3.8 Flash LOW | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Lac-des-Seize-Îles | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Saint-Étienne-de-Bolton | Gemini 3.8 Flash LOW | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Saint-Étienne-de-Bolton | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Valcourt (contrôle) | Gemini 3.8 Flash LOW | 200 | 56 170 ms | 7 838 / 14 360 / 22 198 | non | non | N-A | N-A | N-A | non | N-A |
| Valcourt | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Saint-Barthélemy | Gemini 3.8 Flash LOW | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Saint-Barthélemy | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Waterloo | Gemini 3.8 Flash LOW | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| Waterloo | Sonnet comparable | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |

## Diagnostic du contrôle

- Le reçu rapporte `finishReason=stop`, 14 360 tokens de sortie sous le
  plafond de 16 384, un seul essai et aucune erreur de transport ou 429.
- `jsonValidRaw=false`, `wrapperNormalized=false` et
  `jsonValidAfterNormalize=false`.
- L'erreur native est un `SyntaxError` à la position 0 sur le fence ouvrant.
  Après retrait diagnostique de ce fence, `jq` rapporte une chaîne inachevée
  à la ligne 583, colonne 79.
- Le texte brut possède un seul fence ouvrant et se termine au milieu d'un
  extrait. Une cause de saturation fournisseur reste non vérifiée.
- Les validateurs aval n'ont pas été atteints : extraction, profil et
  provenance sont `N-A`; aucune liste de violations profil n'existe pour ce
  contrôle.

## Décision M1 recommandée

Ne pas promouvoir de modèle en M1 sur cette campagne. Le nouveau contrat de
citations apparaît dans la réponse partielle, mais Gemini n'a pas produit une
enveloppe JSON complète sur le contrôle. La qualité sémantique, la conformité
profil complète et les scores des juges restent non vérifiés. Une nouvelle
campagne nécessite d'abord une stratégie explicite pour borner la taille de
sortie sans affaiblir la provenance page par page.

## Gel et preuves

- Module T1 : worktree `tmp/t1-profile-fix`, commit
  `5f227929ee71747cc7f3dc8245167b7d7f42c69d`, SHA-256
  `ae8852d3fbbcab6ac93f9ad484b750ebcfbb7b95893a2b9ad2c63df2dc558f3d`.
- Gel : `manifest.json` SHA-256
  `e3c6976f2b1143a60faa09cb94a6a512d7c0cc071c60273adc841075217398f7` et
  `prompt-freeze.json` SHA-256
  `c0bb9d11835be0cbc5d3819efbf220e0edb304d11016ffcbfa5efc362ea152c8`.
- Reçu :
  `control/valcourt-2026-06-01-agenda--gemini-low.receipt.json`.
- Réponse brute :
  `control/valcourt-2026-06-01-agenda--gemini-low.raw.txt`.
