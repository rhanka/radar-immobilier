# Campagne v16 — contrat v9 après la revue, schéma seul déplacé

`[FAIT]` = mesuré, avec sa source dans ce dossier. `[JUGEMENT]` = appréciation.
`N-A` = non disponible ou non calculable.

## Ce que v16 est

[FAIT] v16 rejoue v15 avec **une seule variable déplacée : le schéma émis**. Les deux
majeurs de la revue v9 (`.remote/REVIEW_PR688_V9.md`) changent ce que le modèle lit —
M1 retire la forme compacte `{page, excerpt}` annoncée sous `evidence`, M2 porte
`evidence_item.excerpt.minLength` de 1 à 12 et aligne sa description sur la garantie
d'ancrage — donc le gel v14/v15 ne couvrait plus exactement ce que le modèle voit.

[FAIT] `make check-v16-freeze` compare le gel v16 au gel v15, champ par champ :

| Constant | Déplacé |
| --- | --- |
| corpus, oracle, plafond 64 000, prompt système | `t1Commit` `d93f5c93` → `93994e45` |
| `graphifyVersion` 0.18.0, `meshVersion` 0.19.1 | `profileModuleSha256` `776c7578…` → `65e06be3…` |
| `chunkId` et pages des 5 documents | `corpusModuleSha256` `47cf6c62…` → `1e884005…` |
| **`promptSha256` des 5 documents, inchangé** | `schemaSha256` des 5 documents |

[FAIT] **Le prompt est identique à l'octet près sur les cinq documents** (`promptBytes`
identiques, `promptSha256` identiques). Le schéma perd de 249 à 302 octets par document.
La seule chose que le modèle voit autrement est donc le bloc `evidence` du schéma et une
clause de la description des citations d'entités.

[FAIT] Modèle `gemini-3.8-flash-tiered`, effort LOW, plafond 64 000, **5 PV, 5 requêtes,
aucune retry de qualité**.

## Résultat

[FAIT] **3 PV sur 5 acceptés**, contre 5/5 en v14 et 5/5 en v15.

| Agrégat | v14 | v15 | **v16** |
| --- | ---: | ---: | ---: |
| Acceptés | 5/5 | 5/5 | **3/5** |
| Classes de refus | aucune | aucune | **`ungrounded_pdf_excerpt`, 2 documents** |
| `evidence[]` compacts (M1) | 0 sur 34 | 0 sur 30 | **0 sur 41** |
| `evidence[]` sous 12 normalisés (M2) | 0 sur 34 | 0 sur 30 | **0 sur 41** |
| Citations d'entités sous 20 bruts | 0 sur 103 | 0 sur 94 | **0 sur 132** |
| Citations d'entités sous 12 normalisés | 0 sur 103 | 0 sur 94 | **0 sur 132** |
| Macro F1 oracle v2, acceptés | 0,576 | 0,582 | **0,566** (sur 3 documents, pas 4) |
| Macro F1 oracle v2, population fixe | 0,576 | 0,582 | **0,425** |
| Macro P / R oracle v2, acceptés | 0,664 / 0,547 | 0,680 / 0,547 | **0,566 / 0,582** |
| Tokens entrée / sortie | 70 080 / 42 920 | 70 080 / 39 225 | **69 630 / 55 882** |
| Latence moyenne · maximale | 27 030 · 52 710 ms | 25 470 · 32 174 ms | **40 773 · 69 539 ms** |
| Extraits tronqués à 200 | 18 | 20 | **27** |
| Coût unitaire | `N-A` | `N-A` | `N-A` |

[FAIT] Les 450 tokens d'entrée en moins sont la contrepartie directe du schéma plus court.

## Par document

| Document | HTTP | fin | latence | tokens in/out | accepté | F1 v2 | tp/gold (v2) |
| --- | ---: | :-: | ---: | ---: | :-: | ---: | :-: |
| Lac-des-Seize-Îles | 200 | `STOP` | 11 426 ms | 7 376 / 3 456 | oui | 0,571 | 2/4 |
| Saint-Étienne-de-Bolton | 200 | `STOP` | 69 539 ms | 19 864 / 18 438 | oui | 0,359 | 7/17 |
| Valcourt | 200 | `STOP` | 20 371 ms | 7 826 / 6 768 | oui | 0,769 | 5/6 |
| Saint-Barthélemy | 200 | `STOP` | 52 099 ms | 15 035 / 13 086 | **non** | 0,000 | 0/8 |
| Waterloo | 200 | `STOP` | 50 429 ms | 19 529 / 14 134 | **non** | `N-A` | 0/1 |

[FAIT] Les cinq appels aboutissent en HTTP 200 avec `finishReason STOP` : **aucune panne
de transport, aucune troncature de sortie**. Les deux refus sont des refus de validation.

## Les deux refus, causes mesurées

[FAIT] Les deux portent le même nom, `ungrounded PDF excerpt`, et **aucun des deux n'est
un plancher** : les extraits refusés font 168 et 115 caractères normalisés, très au-dessus
des 12 du plancher d'ancrage.

**Waterloo, page 11 — attribution de page sur un couple quasi identique.** Le PV porte
deux dérogations mineures presque mot pour mot : « … la marge arrière du **80**, rue
YvesMalouin » en page 11, « … du **82**, rue YvesMalouin » en page 12. v14 et v15 ont
attribué chacune à sa page. v16 a cité **les deux en page 11**. L'extrait « 82 » n'est pas
sur la page 11 ; l'ancrage page-locale l'a refusé. Le préfixe normalisé commun s'arrête
exactement au chiffre : 100 caractères ancrés, puis `2rueyvesmalouin` contre
`0rueyvesmalouinadoptee` sur la page. 5 enregistrements portaient cet extrait
(2 nœuds, 2 arêtes, 1 `evidence[]`).

**Saint-Barthélemy, page 4 — citation à cheval sur deux pages.** Les 104 premiers
caractères normalisés de l'extrait sont sur la page 4, puis **la page 4 s'arrête** : la
suite (`quelepremierprojetdereglement73926…`) est en page 5. La citation déborde la page
qu'elle déclare. 2 enregistrements (1 nœud, 1 arête).

[JUGEMENT] Ce sont deux erreurs du modèle, pas deux artefacts de contrat, et l'ancrage a
fait exactement ce pour quoi il existe : il a arrêté une citation dont le contenu ne se
trouve pas sur la page déclarée. Le second cas aurait fait entrer dans le graphe une
adresse fausse (82 pour 80) présentée comme verbatim.

## Le validateur v16 ne refuse rien que v15 acceptait

[FAIT] Les **dix reçus v14 et v15 requalifiés hors ligne sous le snapshot v16** donnent le
même verdict qu'avant, **fichier par fichier, à l'octet près** : 10/10 toujours acceptés,
mêmes violations, mêmes comptes de troncature (`git diff` vide sur
`docs/reviews/refresh-benchmark/v14` et `/v15` après requalification croisée).

[FAIT] Symétriquement, la requalification hors ligne des cinq reçus v16 reproduit
l'acceptation en ligne (3/5), le requalificateur échouant par construction sur tout écart
entre verdict en ligne et hors ligne.

[JUGEMENT] La baisse de 5/5 à 3/5 ne vient donc pas d'un durcissement du validateur. Elle
vient de deux sorties de modèle différentes.

## Ce qu'on ne peut pas conclure

[FAIT] **Une seule observation sous le schéma corrigé.** v14 et v15 ont fourni deux
observations sous l'ancien schéma ; v16 n'en fournit qu'une sous le nouveau. Le plafond de
cette lane est de 5 requêtes, toutes consommées, et aucune retry de qualité n'était
autorisée : **il est impossible de dire ici si 3/5 est le nouveau régime ou un tirage**.

[FAIT] Le volume de citations varie beaucoup d'un run à l'autre sous gel identique : sur
Waterloo, 32 citations en v14, 20 en v15, 31 en v16 — et v14 en a ancré 32 sur 32. Le
volume seul n'explique donc pas le refus. Sur Saint-Étienne, v16 émet 44 citations et
27 nœuds contre 19 et 12 en v15 : la sortie totale passe de 39 225 à 55 882 tokens.

[JUGEMENT] Le seuil B « ≥ 4/5 sur deux runs » a été atteint par la paire v14 + v15. **Il
n'est pas ré-établi pour le schéma d'après-revue** : il faudrait au moins un second run
v16 pour le dire, ce que le plafond de requêtes interdit ici.

[FAIT] Les unités appariées bougent aussi sur les documents acceptés : Lac 3 → 2,
Saint-Étienne 6 → 7, Valcourt 5 → 5. La paire v14 ↔ v15 les avait trouvées identiques sur
les cinq documents. Une observation ne permet pas d'en faire une tendance.

[FAIT] **Aucun bras Sonnet, aucun juge lancé, coût unitaire `N-A`** — sources absentes,
aucune estimation fabriquée. Les limites d'oracle non corrigées sont inchangées
(`manual-oracle-v2.json`, champ `knownLimitsNotCorrected`).

## Gates

| Gate | Résultat |
| --- | --- |
| `make check-v16-freeze` | `contractOnlyDelta: true`, 5 documents, prompts inchangés |
| `make test-v14 CAMPAIGN=v16` | **27/27** |
| `make test-v14 CAMPAIGN=v15` | **27/27** (non-régression du harnais) |
| `make test-oracle-v2` | **7/7** |
| Requalification hors ligne des 5 reçus v16 | acceptation identique en ligne et hors ligne, 3/5 |
| Requalification croisée des 10 reçus v14/v15 sous le snapshot v16 | 10/10 acceptés, `git diff` vide |
| `grep -rlE 'sk-ant-[A-Za-z0-9]' v16` | **0** |

SHA : `t1Commit` `93994e454a91031dcbbd49b8590fdd45b47a6cd4` · profil `65e06be3…` ·
corpus `1e884005…` · oracle gelé `4d50a26c…` (byte-identique depuis v9) · oracle v2
`be5e21a6…`.

Campagnes de référence : [`../v14/report.md`](../v14/report.md) ·
[`../v15/report.md`](../v15/report.md).
Comparaison v1 contre v2 : [`../oracle-v2-comparison.json`](../oracle-v2-comparison.json).
