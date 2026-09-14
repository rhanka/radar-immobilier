v9 LOW rejeu : 3/5 acceptés (v7 : 3/5) · variance F1 observée : Lac 0,000 ; Saint-Étienne +0,364 ; Valcourt 0,000 ; Saint-Barthélemy N-A ; Waterloo N-A

# Campagne T1 v9 — rejeu Gemini LOW

## Résultat

Le rejeu exact de v7 conserve la même décision d'acceptation sur les cinq PDF :
Lac-des-Seize-Îles, Saint-Étienne-de-Bolton et Valcourt sont acceptés;
Saint-Barthélemy et Waterloo sont refusés. Les cinq appels ont reçu HTTP 200 et
une fin SSE `STOP`; aucun contrôle préalable et aucun retry n'ont été envoyés.

Le F1 macro des trois sorties acceptées est 0,558, contre 0,436 en v7. Cet écart
ne mesure pas à lui seul une amélioration sémantique : Saint-Étienne conserve
cinq événements admissibles au score, mais des extraits plus longs font passer
quatre ancres exactes en v9, alors que v7 n'en faisait passer aucune.

## Comparaison v7 ↔ v9 par PDF

| PDF | v7 accepté · F1 | v9 accepté · F1 | Δ F1 | Latence v7 → v9 | Tokens entrée / sortie v7 → v9 |
| --- | --- | --- | ---: | ---: | ---: |
| Lac-des-Seize-Îles | oui · 0,400 | oui · 0,400 | 0,000 | 14 352 → 13 844 ms | 6 811 / 4 731 → 6 811 / 4 920 |
| Saint-Étienne-de-Bolton | oui · 0,000 | oui · 0,364 | +0,364 | 31 902 → 25 959 ms | 19 346 / 10 875 → 19 346 / 9 488 |
| Valcourt | oui · 0,909 | oui · 0,909 | 0,000 | 26 763 → 25 533 ms | 7 263 / 8 423 → 7 263 / 9 449 |
| Saint-Barthélemy | non · N-A | non · N-A | N-A | 26 458 → 47 135 ms | 14 493 / 8 417 → 14 493 / 14 000 |
| Waterloo | non · N-A | non · N-A | N-A | 29 258 → 41 042 ms | 19 017 / 9 594 → 19 017 / 12 218 |

L'acceptation varie sur 0/5 PDF. Le F1 calculable varie sur 1/3 sorties
acceptées. Deux observations par PDF ne permettent pas d'estimer une variance
statistique ni une probabilité d'acceptation; seuls les écarts observés sont
rapportés.

## Refus et couches

Les cinq JSON bruts sont entourés d'un fence; la normalisation rend les cinq
JSON valides. Saint-Barthélemy échoue au profil avec `missing_evidence_ref` sur
`nodes[10]`, `nodes[11]` et `edges[6]`. Waterloo franchit le profil puis échoue
la provenance avec `ungrounded_pdf_excerpt` sur `nodes[3].citations[1]` et
`nodes[4].citations[1]`. La requalification hors ligne des reçus v2 n'a changé
aucune acceptation.

## Réconciliations hors réseau

### Saint-Étienne : F1 v7 nul contre utilité juge 4/5

L'oracle contient 17 unités : neuf adoptions de règlements, trois avis de
non-modification et cinq PIIA/dérogations. La sortie Gemini v7 représente les
neuf adoptions comme nœuds `Bylaw` et les cinq décisions locales comme
`DesignationEvent`; elle omet les trois avis. Les deux juges comptent donc les
mêmes 14 unités soutenues et donnent une utilité 4/5 à Gemini.

Le scoreur automatique n'attend aucun identifiant oracle dans la sortie : il
apparie seulement les nœuds `Signal`/`DesignationEvent` par étape, page et ancre
textuelle exacte. Les neuf `Bylaw` sont hors de son numérateur. Sur les cinq
événements restants, les extraits v7 s'arrêtent avant la fin des ancres B154 à
B157; B158 cite l'occurrence détaillée de page 14 tandis que l'oracle ne porte
que l'occurrence sommaire de page 2. Résultat mesuré : 0/17 au score v7 malgré
14/17 unités reconnues par chacun des deux juges. L'oracle couvre les unités,
mais sa seule occurrence pour B158 est partielle par rapport aux preuves
valides du PDF; le F1 v7 n'est donc pas une mesure de couverture sémantique des
nœuds `Bylaw`.

En v9, les cinq `DesignationEvent` restent présents; quatre extraits contiennent
désormais les ancres B154 à B157 en entier. Le score passe à 4 TP, 1 FP et
13 FN, soit F1 0,364. B158 reste non apparié à cause de la page oracle. Les
identifiants de nœuds différents (`event-2026-08-154`, etc.) ne causent aucun de
ces écarts.

### Valcourt HIGH : F1 0 contre LOW 0,909

HIGH produit cinq groupes admissibles qui correspondent sémantiquement aux
mêmes unités V71 à V75 que LOW, avec les mêmes étapes et la page 1; il ne produit
pas d'autre groupe admissible hors oracle et omet V132 comme LOW. Ses cinq
extraits retirent toutefois les préfixes d'item `7.1` à `7.5`, présents dans les
ancres gelées. L'appariement exact obtient donc 0 TP et 5 FP. LOW conserve ces
préfixes dans les extraits et obtient 5 TP, 0 FP, 1 FN. Le F1 0 de HIGH provient
ici des ancres, pas d'autres unités produites.

### `unknown_status`

Les valeurs ne sont pas absentes du contexte fourni au modèle. Les propriétés
du profil décrivent `Constraint.status` comme `actif/leve/en_appel` et
`Bylaw.status` comme `en_vigueur/abroge/remplace/projet`. Le même profil fournit
une liste de durcissement générique distincte : `candidate`, `attached`,
`needs_review`, `validated`, `rejected`, `superseded`. HIGH place `actif` sur le
statut de nœud `Constraint` et `projet` sur celui d'un `Bylaw`; le validateur les
compare à la liste générique et les refuse. Le schéma transmet les valeurs
métier dans des descriptions textuelles de propriétés, pas comme un `enum`
machine distinct du statut générique : l'espace de noms et l'emplacement de
`status` sont ambigus dans le contrat présenté.

### Waterloo LOW : extraits refusés

Les deux extraits visent les bonnes pages physiques : page 11 pour le 80 rue
Yves-Malouin et page 12 pour le 82. Ils reprennent presque mot pour mot la
décision, mais remplacent la chaîne extraite du PDF `YvesMalouin` par
`Yves-Malouin`. Le validateur ne normalise que les espaces avant une recherche
de sous-chaîne; cette correction typographique suffit donc à refuser les deux
extraits. Ce ne sont ni des paraphrases de fond ni des extraits d'une autre
page. v9 répète le même écart sur les mêmes deux décisions.

## Agrégats v9

- Latence : 153 513 ms cumulés, moyenne 30 702,6 ms, p95 observé 47 135 ms.
- Usage : 66 930 tokens d'entrée, 50 075 de sortie, 117 005 au total;
  `thoughtsTokenCount` absent des cinq reçus LOW.
- Couches : brut 0/5, normalisé 5/5, extraction 5/5, profil 4/5,
  provenance 3/5, accepté 3/5.
- Macro sur les trois acceptés : P=0,933, R=0,440, F1=0,558.
- Micro sur 27 unités oracle : TP=10, FP=1, FN=17, P=0,909, R=0,370,
  F1=0,526.
- Citations acceptées : 83/83 identités, pages et extraits valides.
- Sonnet comparable : `N-A`; la clé Anthropic est absente du processus et
  aucun `.env*` n'a été lu.

## Gel et SHA

Le manifeste, le gel de prompt et l'oracle sont copiés de v7. Seul le champ
`campaign` passe de `v7` à `v9` dans les deux premiers; le test hors réseau
19/19 confirme l'équivalence du reste. Produit et profil restent
`f96356e90a76b14b32ef0e913a82eb5805a9a413` et
`b1d3989bc826e0691fb644b0b2857099f2c957a44f054bf0b3746adc526dab3f`.

- Manifeste : `2da70f07b9307b4e51555061804f5b058bc1e495b3239b5868e3f48de2af66de`.
- Prompt : `219596263359ace8315aae267d1cf2639b6b390b42be4076b6331d284be2c1c6`.
- Oracle : `4d50a26c869283199c58dcb75cf4055bccb39f988a9c700c026ddd0a1ef87130`.
- Comparaison : `c31b367c7d371711cd42abbf9c65671be3940d4099b0edb30850d2914a703f32`.

Gates : v9 19/19, cinq reçus v2 requalifiés hors ligne, score 5/5 cas,
`git diff --check` à exécuter au lot documentaire. Aucun acte produit ni merge
n'a été effectué.
