# Campagne v100 — 100 PV, 100 villes, Gemini 3.8 Flash LOW, contrat v9 (`93994e45`)

`[FAIT]` = mesuré, avec sa source. `[JUGEMENT]` = appréciation, identifiée comme
telle. `N-A` = non disponible ou non calculable.

Une seule variable bouge par rapport à v16 : **le corpus**. Même instantané de
contrat (`93994e45`, `immo-pv-extraction-v9`), même modèle, même effort LOW, même
plafond de 64 000 tokens de sortie, même transport Cloud Code, `maxAttempts = 2`
réservé au transport, aucune retry de qualité.

---

## 1. Le résultat en six lignes

[FAIT] **87 PV acceptés sur 100**, soit 87,0 % (IC 95 % de Wilson : 79,0 % – 92,2 %).
100 requêtes envoyées, 100 réponses HTTP 200, **100 fins de flux `STOP`**, aucune
relance de transport consommée.

[FAIT] **Trois classes de refus, 13 documents.** `ungrounded_pdf_excerpt` (6 PV),
`missing_evidence_ref` (5 PV), `inferred_relation_disallowed` (2 PV).

[FAIT] **Neuf refus sur treize tiennent à un seul enregistrement fautif**, soit 2,7 %
à 5,3 % des citations de leur propre document. Sur toute la campagne, **2 119
enregistrements cités, 32 non ancrés : 98,49 % des citations sont ancrées**.

[FAIT] **Les six refus d'ancrage ont tous la même cause mesurée** : la mise en page
du PDF — colonnes entrelacées, pied de page, numéro intercalé, coupure de page —
insère des caractères au milieu du passage dans la sortie de `pdftotext`, là où le
modèle cite la phrase telle qu'un lecteur la lit. Détail au §4.

[FAIT] **Latence** : moyenne 19,2 s, p50 16,7 s, p95 39,5 s, max 59,4 s.
**Tokens** : 1 646 755 en entrée, 679 330 en sortie sur 100 documents.
**La sortie la plus longue fait 17 424 tokens contre un plafond de 64 000** : la
marge est de 46 576 tokens, aucune troncature sur 100 documents.

[FAIT] **Les cinq documents du gel v13→v16 sont acceptés 5/5** sous v100, contre
3/5 en v16 et 5/5 en v14 et v15, à contrat identique.

---

## 2. Le corpus

[FAIT] **100 PV et ordres du jour municipaux réels, 100 villes distinctes**, tous
datés 2026, tirés du corpus radar local (représentations PDF d'origine, empreintes
sha256 vérifiées fichier par fichier).

[FAIT] Construction de l'univers de tirage, mesurée :

| Étape | Compte |
| --- | ---: |
| Fiches `*.meta.json` lues sous le dépôt | 2 080 |
| Enregistrements `proces-verbaux-*` de type `application/pdf` | 1 828 |
| Documents PDF distincts, sha256 du fichier = son nom | **1 332** |
| dont villes distinctes | 252 |
| Rejetés : PDF sans couche texte | 2 |
| Rejetés : texte trop volumineux pour un chunk T1 unique | 15 |
| **Exploitables** | **1 315** (248 villes) |
| Exploitables datés 2026 | **578** (236 villes) |
| Après plancher de 2 000 octets de texte et retrait des villes des cinq ancres | **536** univers de tirage |

[FAIT] **Date de séance** : lue dans le texte du PDF pour 543 des 578 documents de
2026 (`pdf-text-fr`), 25 depuis la fiche `publishedAt`, 1 au format ISO, 9 depuis
l'URL de publication. Le manifeste porte la date **et sa provenance**, document par
document.

[FAIT] **Stratification** : seaux de taille en terciles de tokens estimés de
l'univers (coupures à 4 432 et 9 873 tokens), quota 32 · 32 · 31, **une ville par
document**, ordre de tirage déterministe par sha256 de l'identifiant. La contrainte
« une ville par document » n'a eu besoin d'être relâchée pour aucun seau.

[FAIT] **Cinq ancres de continuité** : les cinq documents du gel v13→v16, repris
octet pour octet, texte d'exécution identique au manifeste v16 (assertion de gel
dans le générateur). Elles portent l'oracle v13 ; **les 95 autres documents n'ont
pas d'oracle manuel — `manual-oracle: N-A`** : la campagne mesure l'acceptation,
les refus, la latence et les tokens, pas le F1.

[FAIT] Profil du corpus retenu : 1 à 77 pages (médiane 12), 7 250 à 61 769 tokens
d'entrée observés, 842 728 tokens estimés à la sélection contre **1 646 755 mesurés
au fil** — l'estimation à 4 octets par token sous-évalue d'un facteur 1,95.

[FAIT] Gel : `v100/manifest.json` (100 documents, sha256 du PDF, du texte et de
chaque page) et `v100/prompt-freeze.json` (**100 empreintes de prompt et 100
empreintes de schéma, toutes distinctes**, `t1Commit 93994e45`, `profileModuleSha256
65e06be3…`, `corpusModuleSha256 1e884005…`, `maxOutputTokens 64000`,
`graphifyVersion 0.18.0`, `meshVersion 0.19.1`).

---

## 3. Acceptation

[FAIT] **87/100.** Par couche, sur les 100 documents lancés :

| Couche | Résultat |
| --- | --- |
| Transport | **100/100** HTTP 200, 0 relance |
| JSON brut | 2/100 — **98 réponses sur 100 arrivent dans un bloc Markdown**, le normalisateur l'absorbe |
| JSON après normalisation | 100/100 |
| Extraction | 100/100 |
| Profil | **93/100** (7 refus) |
| Provenance page/extrait | **87/93** (6 refus) |
| **Accepté** | **87/100** |

[FAIT] Par seau de taille et par tranche de pages :

| Strate | Acceptés | Taux | IC 95 % Wilson |
| --- | :-: | ---: | --- |
| S (< 4 432 tokens estimés) | 29/32 | 90,6 % | 75,8 – 96,8 % |
| M | 29/32 | 90,6 % | 75,8 – 96,8 % |
| L (≥ 9 873 tokens estimés) | 24/31 | 77,4 % | 60,2 – 88,6 % |
| Ancres v13 | 5/5 | 100 % | 56,6 – 100 % |
| 1–3 pages | 24/26 | 92,3 % | — |
| 4–8 pages | 9/10 | 90,0 % | — |
| 9–15 pages | 24/26 | 92,3 % | — |
| 16–25 pages | 19/22 | 86,4 % | — |
| **26 pages et plus** | **11/16** | **68,8 %** | 44,4 – 85,8 % |

[FAIT] **L'effet de taille n'est pas établi à ce n.** Comparaison « ≤ 25 pages »
(73/84) contre « 26 pages et plus » (11/16) : test exact de Fisher bilatéral,
**p = 0,128**. La pente va dans le sens attendu, elle n'est pas significative.

[FAIT] **Une ville par document** : le taux par ville est donc le taux par document,
et aucune ville ne pèse plus de 1 % de l'agrégat.

[FAIT] **Requalification hors ligne** : les 100 reçus rejoués hors ligne sous le
même instantané de contrat rendent **le même verdict que la décision en ligne, pour
les 100** — le requalificateur échoue par construction sur tout écart.

---

## 4. Les classes de refus, avec leurs exemples réels

### 4.1 `ungrounded_pdf_excerpt` — 6 documents, 32 enregistrements

[FAIT] Documents : Coteau-du-Lac (2026-02-10), Wentworth-Nord (2026-01-21),
Sainte-Angèle-de-Monnoir (2026-01-13), Contrecœur (2026-04-14), Berthier-sur-Mer
(2026-03-24), Potton (2026-01-05).

[FAIT] Extraits refusés à **76 à 271 caractères normalisés** : aucun plancher n'est
en cause, ni les 12 de l'ancrage ni les 20 de la citation d'entité.

[FAIT] Diagnostic hors ligne, préfixe normalisé le plus long qui figure encore sur la
page citée, puis ce que la page porte ensuite :

| Document · chemin · page | Préfixe commun | L'extrait continue par | La page continue par |
| --- | ---: | --- | --- |
| Coteau-du-Lac · `nodes[3].citations[0]` · p. 3 | 18 / 91 | `aapprobationdemandedunppcmoipourle25ruedeschutes…` | `9aapprobationdemandedunppcmoipourle25ruedeschutes…` |
| Contrecœur · `nodes[0].citations[0]` · p. 1 | 41 / 76 | `unicipaltenuelemardi14avril2026a19h` | `ardi14avril2026a19halaquellesontpresentsmunicipaltenuelema…` |
| Potton · `nodes[2].citations[0]` · p. 43 | 34 / 80 | `291brmodifiantlereglementdezonagenumero2001291` | `nagenumero2001291considerantque291brmodifiantlereglementdezo…` |
| Berthier-sur-Mer · `nodes[6].citations[0]` · p. 5 | 61 / 123 | `sontsitueesalinterieurduperimetredurbanisation…` | `berthiersurmeriseanceextraordinairedu24mars2026page57` |
| Sainte-Angèle-de-Monnoir · `evidence[2]` · p. 11 | 122 / 271 | `piiapourle152rueprincipaleetautoriselemission…` | *(fin de la page 11)* |
| Wentworth-Nord · `evidence[7]` · p. 8 | 177 / 232 | `particulierespourdesraisonsdeprotectiondelenvironnement` | `28450` |

[FAIT] Exemple lisible, Coteau-du-Lac. Le modèle cite :

~~~text
8.3. Demande d’un PPCMOI

a)

Approbation. Demande d’un PPCMOI pour le 25, rue des Chutes
(agrandissement résidentiel)
~~~

La page 3 porte, dans l'ordre rendu par `pdftotext`, `8.3. Demande d'un PPCMOI`,
puis **`9.`** — le numéro de la section suivante, « SERVICE DU GÉNIE », qui se place
là par effet de colonne —, puis `a)`, puis `Approbation…`. La normalisation supprime
la ponctuation mais **garde le chiffre `9`**, qui casse la sous-chaîne.

[JUGEMENT] **Les six refus relèvent d'une seule et même cause** : l'extrait est
fidèle au document tel qu'il se lit, et il ne l'est pas à l'ordre des octets que
`pdftotext` produit. Quatre variantes mesurées : colonnes entrelacées (Contrecœur,
Potton ×3, Coteau-du-Lac), pied de page intercalé (Berthier-sur-Mer), numéro parasite
intercalé (Wentworth-Nord), phrase qui déborde sur la page suivante
(Sainte-Angèle-de-Monnoir ×2).

[JUGEMENT] Ce n'est pas la classe de refus de v16. En v16, les deux refus étaient
des **erreurs de page du modèle** : une adresse attribuée à la mauvaise page sur un
couple quasi identique. Ici, sur 100 documents, **aucun refus d'ancrage ne vient d'une
page fausse ou d'un texte inventé** : dans les six cas, le passage cité est bien sur
la page indiquée, à des caractères de mise en page près.

### 4.2 `missing_evidence_ref` — 5 documents, 5 enregistrements

[FAIT] Documents : Richelieu, Frontenac, Sainte-Martine, Sainte-Croix, Sainte-Thècle.
**Un seul nœud fautif par document**, à chaque fois, sur 22 à 37 enregistrements cités.

~~~text
richelieu-2026-02-03   nodes[7] must include at least 1 evidence_refs
frontenac-2026-03-10   nodes[6] must include at least 1 evidence_refs
sainte-martine-2026-03-17  nodes[11] must include at least 1 evidence_refs
~~~

[JUGEMENT] Un nœud sur une vingtaine oublie son renvoi de preuve et emporte le
document entier. La famille était déjà connue : `missing_evidence_ref` ×3 en v9,
puis **0** en v13, v14, v15 et v16 — sur 5 documents. À 100 documents, elle
réapparaît à 5 %.

### 4.3 `inferred_relation_disallowed` — 2 documents, 2 enregistrements

[FAIT] Dollard-des-Ormeaux et Waterville. Le même motif dans les deux cas :

~~~text
edges[3] relation lifecycle_predecessor is INFERRED but inferred relations are disallowed
~~~

[FAIT] Chez Dollard-des-Ormeaux, l'arête fautive relie l'adoption du premier projet
du règlement R-2026-199-1 à son avis de motion — deux actes présents dans le même
ordre du jour. Le contenu est exact ; **c'est le degré de confiance déclaré qui est
refusé**, pas le fait.

[FAIT] Classe **inédite** : absente des campagnes v9, v13, v14, v15 et v16.

### 4.4 Ce que coûtent ces refus

[FAIT] Sur les 13 documents refusés : **39 enregistrements fautifs sur 332 cités,
soit 11,7 %**. Neuf documents sur treize sont refusés pour **un seul enregistrement**.

| Document | Fautifs | Cités | Part |
| --- | ---: | ---: | ---: |
| Potton | 9 | 18 | 50,0 % |
| Sainte-Angèle-de-Monnoir | 6 | 12 | 50,0 % |
| Coteau-du-Lac | 7 | 21 | 33,3 % |
| Berthier-sur-Mer | 8 | 29 | 27,6 % |
| Waterville | 1 | 19 | 5,3 % |
| Richelieu | 1 | 22 | 4,5 % |
| Dollard-des-Ormeaux | 1 | 23 | 4,3 % |
| Frontenac | 1 | 23 | 4,3 % |
| Sainte-Martine | 1 | 27 | 3,7 % |
| Wentworth-Nord | 1 | 33 | 3,0 % |
| Contrecœur | 1 | 34 | 2,9 % |
| Sainte-Croix | 1 | 34 | 2,9 % |
| Sainte-Thècle | 1 | 37 | 2,7 % |

[JUGEMENT] Le contrat est **tout-ou-rien par document** : un enregistrement sur
trente-sept annule trente-six enregistrements ancrés. C'est un choix de garantie
défendable pour un job sans surveillance ; à 100 documents, il se chiffre.

---

## 5. Latence, tokens, fins de flux

[FAIT] Latence de bout en bout par document, 100 observations :

| | moyenne | p50 | p95 | min | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tous | 19 172 ms | 16 703 ms | 39 494 ms | 1 706 ms | 59 371 ms |
| Acceptés | 18 494 ms | 16 347 ms | 39 494 ms | 1 706 ms | 59 371 ms |
| Seau S | 13 206 ms | 13 511 ms | — | — | 28 187 ms |
| Seau M | 19 375 ms | 17 929 ms | — | — | 44 583 ms |
| Seau L | 23 611 ms | 21 357 ms | — | — | 56 600 ms |

[FAIT] Corrélation de Pearson entre la latence et la taille : **0,475 avec le nombre
de pages**, **0,459 avec les tokens d'entrée**. La taille explique donc une part
minoritaire de la latence.

[FAIT] Tokens fournisseur, cumulés sur 100 documents : **1 646 755 en entrée**
(moyenne 16 468, p50 14 572, p95 30 525, max 61 769) et **679 330 en sortie**
(moyenne 6 793, p50 6 392, p95 12 699, min 56, max **17 424**).

[FAIT] **Fins de flux SSE : `STOP` 100 fois sur 100**, `finishReason` fournisseur
`stop` 100 fois sur 100. Aucun `MAX_TOKENS`.

[JUGEMENT] **Le plafond de 64 000 est surdimensionné d'un facteur 3,7** : la sortie
la plus longue de la campagne fait 17 424 tokens. Le plafond a été calé en v13 sur la
seule valeur admise par Cloud Code ; sur 100 documents réels, il n'a jamais mordu.

[FAIT] **Coût monétaire : `N-A`, source manquante.** Le dépôt ne porte aucun tarif
par token, ni Google ni Anthropic ni OpenAI. Les tokens ci-dessus sont mesurés ;
aucun montant n'est fabriqué.

---

## 6. Graphe produit et citations

[FAIT] Sur les 100 sorties : **817 nœuds, 781 arêtes, 1 614 citations d'entités,
505 éléments `evidence[]`**, soit **2 119 enregistrements cités**.

[FAIT] **2 087 enregistrements ancrés sur 2 119, soit 98,49 %.**

[FAIT] **374 extraits de citation d'entité ont été tronqués à 200 points de code par
le code** avant validation. **Un seul des 32 enregistrements non ancrés porte un
extrait tronqué** (Potton, `nodes[0].citations[0]`, 203 points de code bruts), et sa
divergence survient au 147ᵉ caractère normalisé sur 165, **avant** le point de
troncature. La troncature n'explique donc aucun des 32 ; ils sont tous décrits au §4.1.

[FAIT] **Aucune citation d'entité sous les planchers** : 0 sous 20 points de code
bruts, 0 sous 12 points de code normalisés, 0 `evidence[]` sous le plancher
d'ancrage. Les motifs M1 et M2 de la revue v9 restent absents à 100 documents.

---

## 7. Les cinq ancres — continuité avec v14, v15 et v16

[FAIT] Mêmes octets, même texte d'exécution, même contrat que v16 :

| Document | v14 | v15 | v16 | **v100** | v100 : nœuds / arêtes / citations | v100 : tokens in/out |
| --- | :-: | :-: | :-: | :-: | :-: | ---: |
| Lac-des-Seize-Îles | ✓ | ✓ | ✓ | **✓** | 5 / 7 / 12 | 7 376 / 4 612 |
| Saint-Étienne-de-Bolton | ✓ | ✓ | ✓ | **✓** | 22 / 16 / 38 | 19 864 / 15 583 |
| Valcourt | ✓ | ✓ | ✓ | **✓** | 9 / 11 / 20 | 7 826 / 7 733 |
| Saint-Barthélemy | ✓ | ✓ | ✗ | **✓** | 9 / 13 / 22 | 15 035 / 9 248 |
| Waterloo | ✓ | ✓ | ✗ | **✓** | 14 / 15 / 29 | 19 529 / 10 960 |
| **Total** | **5/5** | **5/5** | **3/5** | **5/5** | | |

[FAIT] Quatre observations par document sur ces cinq PV : **18 acceptations sur 20**.
Les deux refus sont ceux de v16, et v100 ne les reproduit pas.

[JUGEMENT] C'est la mesure de variance la plus solide dont dispose la lane : à gel
identique, sur les mêmes cinq documents, le contrat d'après-revue passe 5/5, 3/5,
puis 5/5. **Le 3/5 de v16 était un tirage, pas un durcissement.** Le seuil B
« ≥ 4/5 sur deux runs » est donc atteint trois fois sur quatre runs, et v100 le
réétablit pour le schéma d'après-revue.

[FAIT] Le F1 sous l'oracle v2 n'est **pas** recalculé ici : les 95 autres documents
n'ont pas d'oracle et le scoreur ne note que ce qu'il connaît. `manual-oracle: N-A`
pour 95 documents sur 100.

---

## 8. Juges aveugles sur échantillon

### 8.1 Protocole

[FAIT] Paquet `v100/judge/blind-bundle.json`, SHA-256
`3a5d475bc4201da6fcf22868c5bb5d267c24f53b41cf41d37584fe6380370ca4`, **25 entrées** :
20 sorties acceptées stratifiées (6 · 6 · 6 sur S · M · L, 2 ancres) et **5 sorties
refusées** stratifiées par classe de refus (2 `ungrounded_pdf_excerpt`,
2 `missing_evidence_ref`, 1 `inferred_relation_disallowed`). Alias opaques
`doc-<12 hex>`, entrées triées par alias.

[FAIT] **Le paquet ne contient ni l'identifiant du document, ni le verdict du
validateur, ni le nom du modèle.** Limite mesurée : la charge d'extraction porte
`source_file` et `municipality`, **la ville n'est donc pas masquée**.

[FAIT] Deux juges, deux passes séparées, gabarit adapté de `v7/judge-prompt.md` :
recenser les actes d'urbanisme attestés par le texte, dire lesquels l'extraction
soutient et lesquels elle manque, relever les défauts de citation, noter l'utilité
de 1 à 5.

[FAIT] **Juge A — OpenAI `gpt-5.6-sol`**, API Responses, effort `medium`, JSON strict,
un appel par alias. Le catalogue de la clé ne porte **pas** de modèle `gpt-5.6` nu :
`gpt-5.6-luna`, `gpt-5.6-sol` et `gpt-5.6-terra` seulement ; `sol` est l'identifiant
que le dépôt utilise déjà (`PREFLIGHT_MODEL`). 25 verdicts, 25 JSON valides, 0 erreur.
**409 453 tokens d'entrée, 48 127 de sortie dont 28 337 de raisonnement**, 1 191 s au
total. **Coût monétaire `N-A`** — aucun tarif par token dans le dépôt.

[FAIT] **Juge B — Claude Opus 5 (moi)**, passe séparée, lecture du seul paquet, aucun
verdict OpenAI consulté avant écriture. [FAIT] **Limite déclarée : j'ai conduit la
campagne.** Je suis aveugle à l'alias, pas à l'existence de la campagne ; ma cécité
est plus faible que celle du juge A. Pour les quatre documents les plus longs, j'ai
recensé les unités depuis l'ordre du jour et les titres de résolution plutôt que page
à page : écart de méthode assumé.

### 8.2 Ce que les deux juges disent

[FAIT] Utilité moyenne : **juge A 2,96 ; juge B 3,60** sur 25 documents.

| Note | 1 | 2 | 3 | 4 | 5 |
| --- | :-: | :-: | :-: | :-: | :-: |
| Juge A (OpenAI) | 1 | 4 | **16** | 3 | 1 |
| Juge B (Opus) | 1 | 1 | 9 | **10** | 4 |

[FAIT] Accord :

| Mesure | Valeur |
| --- | ---: |
| Corrélation de Pearson | **0,474** |
| Corrélation de Spearman | **0,281** |
| Accord exact | **7/25** |
| Accord à ±1 point | **21/25** |
| Écart absolu moyen | 0,88 |
| Écart signé moyen (B − A) | **+0,64** |
| κ de Cohen, notes exactes | **−0,018** |
| κ de Cohen, binarisé « utile ≥ 4 » | **−0,183** |

[JUGEMENT] **Les deux juges ne s'accordent pas au-delà du hasard sur la note, et
s'accordent sur l'ordre de grandeur.** Le κ négatif s'explique par la forme des
distributions : le juge A concentre 16 verdicts sur 25 en « 3 », le juge B étale sur
3-4-5. À ±1 point, 21 documents sur 25 sont d'accord. **Un écart d'un point entre
deux jugements ne discrimine rien ici.**

[FAIT] Couverture perçue : le juge A recense **128 unités** et en crédite 81
(70,7 % en moyenne par document) ; le juge B recense **211 unités** et en crédite 93
(50,2 %). [JUGEMENT] Les deux juges ne comptent pas la même chose : le juge B compte
les actes administratifs non urbanistiques (règlements de traitement des élus, de
taxation, d'emprunt), le juge A les écarte. L'écart de moyenne d'utilité suit ce même
axe en sens inverse.

[FAIT] Défauts de citation relevés : **49 par le juge A sur 19 documents**, **13 par
le juge B sur 8 documents**.

[FAIT] **Ni l'un ni l'autre juge ne note les documents refusés plus bas que les
acceptés** :

| | n | Utilité moy. juge A | Utilité moy. juge B |
| --- | :-: | ---: | ---: |
| Acceptés par le validateur | 20 | 2,95 | 3,55 |
| **Refusés par le validateur** | 5 | **3,00** | **3,80** |

[JUGEMENT] **C'est le résultat le plus important de la partie juges.** Sur cet
échantillon, le verdict du validateur ne suit pas l'utilité lue. Un document refusé
pour un `evidence_refs` manquant sur vingt-deux citations reste jugé exploitable par
les deux juges. La porte d'acceptation mesure la **provenance**, pas la **valeur** —
constat déjà posé dans le dossier M1 v2 sur Saint-Barthélemy, ici mesuré sur
25 documents et deux juges.

### 8.3 Ce que les deux juges trouvent

[JUGEMENT] Convergences de fond, exprimées par les deux passes :

1. **Les citations sont littérales et sur la bonne page dans la très grande
   majorité des cas** — 98,49 % d'ancrage mesuré côté validateur le confirme.
2. **Les actes de zonage sont extraits avec leur substance** : codes de zone créés,
   agrandis ou abrogés, arêtes `amends`, `defines`, `applies_to`, `rezones`,
   `merges`, numéros de lot, numéros de dossier, étapes.
3. **Les listes longues de dossiers individuels sont repliées ou omises.** Sur
   Mont-Saint-Hilaire, 16 PIIA approuvés et 3 refusés deviennent **deux événements
   agrégés sans adresse ni lot** ; sur Cowansville, 18 PIIA sur 20 sont absents.
4. **Les transactions immobilières sont le déficit le plus coûteux pour un radar
   foncier.** Sur Saint-Barthélemy, cinq résolutions de transaction et un transfert
   de propriété grevé d'un droit de préemption sont absents ; sur Sainte-Clotilde,
   l'acquisition de deux lots pour 150 000 $ destinés au futur CPE l'est aussi.

[JUGEMENT] Contre-exemples mesurés, dans l'autre sens : Sainte-Croix (plan de
lotissement du lot 3 592 103 avec prolongement de rue, extrait en `Signal` de
développement résidentiel), Saint-Odilon (suivi « zonage multilogements — secteur de
la rue des Cerisiers », capté en page 23 d'un PV de 23 pages), Cowansville (premier
projet autorisant 26 logements sur quatre étages en zone Rc-23) et
Stoneham-et-Tewkesbury (refus d'un PPCMOI de 18 logements) montrent que les signaux
à forte valeur foncière **sont** captés quand ils portent une résolution propre.

---

## 9. Ce que la campagne établit et ce qu'elle n'établit pas

[FAIT] **Établi.**
1. Le taux d'acceptation du contrat v9 d'après-revue sur un corpus réel de 100 PV et
   100 villes : **87 %, IC 95 % [79,0 ; 92,2]**.
2. Les trois classes de refus, leur fréquence et leur cause mesurée au caractère près.
3. Le contrat ne sature jamais le plafond : 100 fins `STOP`, sortie maximale à 27 %
   du plafond.
4. La distribution de latence sur 100 observations, et son indépendance partielle à
   la taille.
5. Le 3/5 de v16 n'était pas un durcissement : les mêmes cinq documents repassent 5/5.

[FAIT] **Non établi.**
1. **La variance à corpus v100 fixe** : une seule observation par document sur les
   95 nouveaux. Le rejeu n'a pas été fait — le plafond de 100 requêtes est consommé.
2. **La couverture** : `manual-oracle: N-A` sur 95 documents. Les juges donnent une
   lecture d'utilité sur 25, pas un rappel mesuré sur 100.
3. **Le coût monétaire** : `N-A`, source manquante.
4. **Le comportement d'un autre modèle** sur ce corpus : aucun bras Sonnet, aucun bras
   HIGH.
5. **La significativité de l'effet de taille** : p = 0,128, non concluant.
6. **L'accord inter-juges au-delà du hasard** : κ négatif sur 25 documents.

---

## 10. Correctifs candidats, mesurés — décision de l'owner, hors périmètre de cette lane

[JUGEMENT] Trois pistes, chacune adossée à une mesure de cette campagne. **Aucune
n'est appliquée ici** : le contrat, le prompt, le schéma et le validateur n'ont pas
été touchés.

| # | Piste | Ce que la campagne mesure | Gain plafond mesuré |
| --- | --- | --- | ---: |
| **C1** | Ancrer en tolérant les insertions de mise en page : accepter l'extrait si ses caractères normalisés apparaissent **dans l'ordre** sur la page, avec un budget borné de caractères insérés ; ou nettoyer pieds de page et numéros avant ancrage. | Les 6 refus d'ancrage viennent tous d'un entrelacement, d'un pied de page, d'un numéro intercalé ou d'un débordement de page — jamais d'une page fausse. | **+6 documents (87 → 93 %)** |
| **C2** | Autoriser l'ancrage sur la page citée **et la suivante** pour un extrait qui déborde. | 2 des 32 enregistrements non ancrés (Sainte-Angèle-de-Monnoir). | inclus dans C1 |
| **C3** | Écarter l'enregistrement fautif au lieu de refuser le document, avec le compte reporté dans le reçu. | 9 refus sur 13 tiennent à un enregistrement représentant 2,7 % à 5,3 % des citations du document. | **+9 documents (87 → 96 %)** |

[JUGEMENT] C1 et C3 ne s'additionnent pas : elles se recouvrent sur deux documents
(Wentworth-Nord et Contrecœur, refusés pour un unique enregistrement d'ancrage), et
leur réunion couvre **les treize refus**, donc 100 %. Ce « 100 % » n'a aucune valeur
prédictive : les deux pistes couvrent par construction les trois classes observées,
et rien ne dit qu'une quatrième classe n'apparaîtrait pas sur un autre corpus.
Surtout, **chacune relâche une garantie** — C1 admet qu'un extrait ne soit plus une
sous-chaîne exacte de la page, C3 admet qu'un document entre au graphe avec un
enregistrement écarté. Elles doivent être arbitrées pour ce qu'elles coûtent, pas pour
ce qu'elles rapportent au compteur.

[JUGEMENT] Quatrième piste, sans relâchement de garantie : **le plafond de sortie**.
Mesuré à 17 424 tokens au maximum sur 100 documents contre 64 000 demandés ; le
descendre à 24 000 laisserait encore 38 % de marge au-dessus de la pire sortie
observée. Effet sur l'acceptation : **`N-A`, non mesuré** — un plafond plus bas n'a
pas été sondé dans cette campagne.

---

## 11. Gates et empreintes

| Gate | Résultat |
| --- | --- |
| `make prepare-prompts-v100` | 100 documents, 100 `promptSha256` distincts, 100 `schemaSha256` distincts |
| `make run-v100-real` | 100 requêtes, 100 × HTTP 200, 100 × SSE `STOP`, 0 relance |
| `make requalify-v100-receipts` | **100/100**, verdict hors ligne identique au verdict en ligne |
| `make aggregate-v100` | `v100/aggregate.json` |
| `make freeze-blind-v100` | 25 entrées, SHA-256 `3a5d475bc420…` |
| `make test-v14 CAMPAIGN=v16` | **27/27** — non-régression du harnais |
| `make test-oracle-v2` | **7/7** |
| `node --check` sur les cinq scripts ajoutés | PASS |
| Balayage de secrets sur `v100/` | **0** |

| Artefact | Emplacement |
| --- | --- |
| Manifeste v100 | `v100/manifest.json` |
| Gel des prompts | `v100/prompt-freeze.json` |
| 100 reçus, bruts et sorties | `v100/campaign-gemini/` |
| Journal de lot | `v100/campaign-gemini/batch-log.jsonl` |
| Agrégat | `v100/aggregate.json` |
| Paquet aveugle et correspondance | `v100/judge/blind-bundle.json`, `v100/judge/blind-map.json` |
| Verdicts OpenAI | `v100/judge/openai/*.verdict.json` |
| Verdicts Opus | `v100/judge/opus/verdicts.json` |
| Accord inter-juges | `v100/judge/agreement.json` |

[FAIT] Corpus mis en scène sous `scratchtmp/refresh-benchmark/v100-cas/workers/<ville>/corpus/`,
hors du gel v13, avec l'empreinte du PDF revérifiée après copie.
