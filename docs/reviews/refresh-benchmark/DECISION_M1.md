recommandation : B · Gemini v8 4/5 · Sonnet v8 4/5 · juges v13 : égalité · reste : `ungrounded_pdf_excerpt` (libellés de zone courts, Saint-Étienne, sur les deux modèles)

# Dossier de décision M1 (v2) — quel modèle pour le CronJob `radar-refresh-pv`

Public : l'owner. Chaque notion mesurée est introduite par une phrase simple, puis
illustrée par un extrait réel tiré des reçus de campagne. `[FAIT]` = mesuré, avec
sa source. `[JUGEMENT]` = appréciation, identifiée comme telle. `N-A` = non
disponible ou non calculable.

---

## 1. En une page

### La question

[FAIT] La PR [#682](https://github.com/rhanka/radar-immobilier/pull/682)
(`feat/refresh-prod-018`, ouverte, `mergeStateStatus=CLEAN`) installe un CronJob
`radar-refresh-pv` qui tourne **sans surveillance** : il prend des procès-verbaux
et ordres du jour municipaux en PDF, demande à un modèle de langage d'en extraire
des signaux d'urbanisme structurés, et écrit le résultat dans le graphe.
Source : `gh pr view 682`, et §3 de la version 1 de ce dossier.

[JUGEMENT] La question posée à l'owner est : **quel modèle et quel réglage on met
dans ce CronJob**, et **maintenant ou après un tour de correction supplémentaire**.

### La réponse recommandée

[JUGEMENT] **Option B** : corriger d'abord une dernière cause mesurée (le modèle
cite le libellé de zone au lieu de la phrase de décision), réaligner l'oracle de
mesure, puis exiger deux campagnes à au moins 4/5 avant de promouvoir. Gemini
3.8 Flash LOW reste le candidat de tête pour la promotion qui suivra.

### Les trois chiffres qui comptent

| Chiffre | Ce qu'il dit | Source |
| --- | --- | --- |
| **4/5 et 4/5** | Sous le contrat v8, Gemini LOW et Sonnet 4.6 Cloud Code font passer chacun 4 PDF sur 5 à travers toutes les validations. Le seuil qui avait été posé (« au moins 4 sur 5 ») est atteint par les deux. | `v13/report.md`, agrégats |
| **0 unité sur 8** | Saint-Barthélemy est **accepté** par les deux modèles et n'apparie **aucune** des 8 unités attendues par l'oracle : les pages citées (4–5 et 3–5) ne couvrent pas les pages 4 à 8 et 10 de l'oracle. Autrement dit : « accepté » ne veut pas dire « utile ». | `v13/report.md`, cause 2 |
| **Égalité 2–2, confiance faible** | Le juge aveugle B ne départage pas les deux modèles : 2 documents chacun, 13 unités contre 12 sur 19, utilité cumulée 13 contre 13. | `v13/judges/verdict-judge-b.json` |

[FAIT] Quatrième chiffre utile : Gemini LOW répond en **30,5 s** de moyenne,
Sonnet Cloud Code en **121,8 s**, soit 4,0 fois plus, pour la même acceptation
4/5 (`v13/report.md`, agrégats).

---

## 2. Le problème, raconté

### Ce qu'on demande au modèle

[FAIT] On lui donne le texte d'un PV municipal (par exemple les 14 pages du PV de
Saint-Étienne-de-Bolton du 4 août 2026) et on lui demande de rendre un objet JSON
qui contient : des **nœuds** (un règlement, une zone, une décision), des **arêtes**
(quel règlement est visé par quelle décision), et pour chaque nœud et chaque arête
une **citation** qui dit *à quelle page* et *avec quel extrait exact du PDF* cette
affirmation est soutenue. Source : `refresh-profile.ts:70-115` décrit dans
`DIAG_GEMINI_JSON.md`.

[JUGEMENT] La garantie visée n'est pas « le modèle a bien résumé ». Elle est : **on
peut retrouver, dans le PDF, à la page indiquée, le passage qui soutient chaque
affirmation**. C'est cette garantie qui permet de publier un signal à un
utilisateur sans qu'un humain relise le PV.

### Pourquoi « ça répond 200 » ne suffit pas

[FAIT] La toute première campagne réelle (v4) l'illustre : **5 requêtes sur 5 ont
reçu HTTP 200**, et **5 sorties sur 5 ont été refusées** par la validation du
contenu. Le transport était parfait, le produit inexploitable
(`BENCHMARK_T1_RUN.md`, tableau « Campagne PDF × modèle »).

[JUGEMENT] « HTTP 200 » ne mesure que le fait que le fournisseur a répondu. Tout le
travail de ce benchmark consiste à mesurer ce qu'il y a **dans** la réponse.

### Les cinq défauts, dans l'ordre où ils sont apparus

---

#### (a) L'identifiant de modèle n'existait pas chez le fournisseur — 404

[FAIT] **Avant.** La bibliothèque `@sentropic/llm-mesh` 0.19.0 demandait
`gemini-3.8-flash` sur l'hôte `daily-cloudcode-pa.googleapis.com`. Reçu
`v4/gemini-debug-01-mesh-low.json` :

~~~text
"httpStatus": 404,
"model": "gemini-3.8-flash",
"providerEffort": "LOW",
"providerError": { "code": 404, "status": "NOT_FOUND",
                   "message": "Requested entity was not found." }
~~~

[FAIT] Une sonde qui ne changeait **que l'hôte** (retrait du préfixe `daily-`) a
obtenu un 429 `RESOURCE_EXHAUSTED` au lieu du 404 : l'endpoint était bien la
première cause du 404, et l'effort LOW n'y était pour rien
(`v4/gemini-transport-diagnosis.md`).

[FAIT] **Après.** Avec l'identifiant `gemini-3.8-flash-tiered` et une route
épinglée, le ping mesure HTTP 200, message exact `PING_OK`, 929 ms
(`BENCHMARK_T1_RUN.md`, § « Couture modifiée »).

[JUGEMENT] Défaut d'outillage, pas de modèle. Il est fermé, mais il explique
pourquoi rien n'était mesurable avant le 14/09.

---

#### (b) La réponse arrivait emballée dans un bloc Markdown ` ```json `

[FAIT] **Avant.** Le texte brut rendu par Gemini commence par trois accents graves.
Le code appelait `JSON.parse` directement dessus. Rejeu Valcourt,
`v4/diag/valcourt--gemini-low.raw.txt`, 5 premières lignes :

~~~text
```json
{
  "nodes": [
    {
      "id": "source:31df8f116d84d1f50ef34a2aa8f746c6025c56089383b27345b901c8e45c026d",
~~~

[FAIT] Erreur exacte reproduite :
`SyntaxError: Unexpected token '`', "```json\n{\n"... is not valid JSON`, à
l'offset 0. Après retrait strict du bloc, le JSON est syntaxiquement valide
(`DIAG_GEMINI_JSON.md`, § « Reçu Valcourt »).

[FAIT] **Après.** Le parseur accepte soit du JSON direct, soit **un seul bloc
complet** ` ```json … ``` ` couvrant toute la réponse ; tout préambule, suffixe ou
bloc incomplet reste refusé (`LANE_T1_FIX_CAMPAIGN.md`, § « Diff du contrat »).
Depuis, la couche « normalisé » passe 5/5 sur toutes les campagnes.

[FAIT] Point mesuré contre-intuitif : demander au fournisseur
`responseMimeType: "application/json"` **n'a pas suffi**. La sonde a bien mis le
champ sur le fil, et le texte est revenu quand même entouré du bloc
(`DIAG_GEMINI_JSON.md`, § « Sonde `responseMimeType` »).

---

#### (c) Les citations manquaient, puis devenaient trop bavardes

[FAIT] **Avant.** Dans la sortie v4, les nœuds n'ont aucune citation. Extrait réel,
`v4/diag/valcourt--gemini-low.raw.txt` :

~~~json
{
  "id": "bylaw:560",
  "label": "Règlement de zonage 560",
  "node_type": "Bylaw",
  "status": "candidate",
  "numero": "560",
  "municipality": "valcourt"
}
~~~

[FAIT] Rien n'indique *où* dans le PDF ce règlement est mentionné. Le validateur a
produit **exactement 46 violations** sur 8 nœuds et 15 arêtes, deux par entité :
`missing_citation_source_file` et `missing_citation_page`
(`DIAG_GEMINI_JSON.md`, § « Validation après retrait du fence »).

[FAIT] **Correction intermédiaire (contrat v4).** On a exigé une citation sur
chaque nœud et chaque arête, avec 7 champs : `source_file`, `rawRef`, `docSha`,
`sourceUrl`, `modality`, `page`, `excerpt`. Effet mesuré : la sortie a gonflé et
s'est mise à saturer le plafond — c'est le défaut (d) ci-dessous
(`LANE_T1_FIX_CAMPAIGN.md`).

[FAIT] **Après (contrat v5).** Le modèle n'émet plus que `page` et `excerpt` ;
l'identité du PDF (chemin, empreinte, URL, modalité) est **injectée par le code**
avant la validation, puisqu'elle est constante pour un document donné. Extrait
réel, `v7/campaign-real/valcourt-2026-06-01-agenda--gemini-low.raw.txt` :

~~~json
{
  "id": "source_31df8f116d84d1f50ef34a2aa8f746c6025c56089383b27345b901c8e45c026d",
  "node_type": "Source",
  "citations": [
    { "page": 1,
      "excerpt": "SÉANCE ORDINAIRE\nLUNDI 1ER JUIN 2026\nOrdre du jour" }
  ]
}
~~~

[FAIT] Résultat de ce contrat compact sur le contrôle Valcourt : 19 citations sur
19 enrichies et validées, profil et provenance valides
(`LANE_T1_V5_CAMPAIGN.md`, § « Re-gel v6 et contrôle v5 »).

---

#### (d) La sortie était coupée en plein milieu — et affichée comme « terminée »

[FAIT] **Avant.** Saint-Étienne-de-Bolton, plafond 16 384 tokens. Le fichier brut
s'arrête au milieu d'un objet. Fin réelle de
`v6/campaign-real/saint-etienne-de-bolton-2026-08-04--gemini-low.raw.txt` :

~~~text
    {
      "id": "ev-9",
      "source_file": "raw/proces-verbaux-saint-etienne-de-bolton/cas/27799681….pdf",
~~~

[FAIT] Il n'y a ni accolade fermante, ni bloc de clôture : le texte s'interrompt à
la ligne 808, colonne 139. Le dernier événement du flux fournisseur porte
`finishReason=MAX_TOKENS` avec 15 057 tokens visibles — mais le reçu de haut
niveau affichait `finishReason=stop` (`LANE_T1_V5_CAMPAIGN.md`, § « Confirmation
au niveau fournisseur »).

[FAIT] Cause dans le code, lue en lecture seule : le chemin public `generate()` de
`cloud-code-runtime-client.js` (lignes 285-304) agrège le texte puis **ignore** la
raison de fin de l'événement final et construit `finishReason=stop`. Un
`MAX_TOKENS` fournisseur peut donc apparaître comme `stop`
(`LANE_T1_V5_CAMPAIGN.md`, § « Mapping llm-mesh observé »).

[FAIT] **Après.** Plafond porté à 65 536 (campagne v7) : 5 requêtes sur 5 en HTTP
200, **5 fins de flux `STOP` sur 5**, aucune saturation, 3 sorties acceptées
(`LANE_T1_V7_CAMPAIGN.md`). En v13 le plafond commun est descendu à **64 000**,
seule valeur admise côté Cloud Code : les sondes mesurent 64 000 → HTTP 200,
64 001 → HTTP 400, 65 536 → HTTP 400 (`v12/probes/`, cité par `v13/report.md`).

[JUGEMENT] C'est le défaut le plus coûteux de la série : pendant deux campagnes,
le reçu disait « terminé normalement » alors que la réponse était tronquée.

---

#### (e) Extraits trop longs, puis libellés de zone au lieu du texte de décision

**Premier temps — trop longs.**

[FAIT] **Avant.** Le contrat v7 demandait un extrait d'au plus 200 caractères,
coupé net même au milieu d'un mot. Le modèle **applique** la coupe, et dépasse
quand même la borne de 1 à 7 caractères. Cas réel, Waterloo,
`nodes[15].citations[0]`, page 9, 203 caractères, fin de l'extrait :

~~~text
… de 40
mètres, au fonds des lots 4 161 789 ou 6 098 789 du cadastre
du Québec dans le secte
~~~

[FAIT] 15 extraits dépassaient la borne sur la campagne v11
(201, 202, 202, 202, 203, 204, 204, 204, 204, 204, 204, 205, 205, 205, 207).
**14 sur 15 étaient des préfixes exacts du passage de la page citée, et 15 sur 15
étaient déjà ancrés** sur cette page. L'acceptation était tombée à 1/5
(`LANE_T1_V8_CONTRACT.md`, partie 1).

[JUGEMENT] Refuser une sortie parce que l'extrait fait 203 caractères au lieu de
200, alors qu'il est verbatim et retrouvé sur la bonne page, n'achète aucune
garantie.

[FAIT] **Après (contrat v8).** Le code tronque lui-même l'extrait à 200 caractères
**avant** la validation, et le code de refus pour longueur est retiré, devenu
inatteignable. Mesure v13 : **28 extraits tronqués côté Gemini, 22 côté Sonnet,
tous restés ancrés** (`v13/report.md`, § « Ce que le contrat v8 a corrigé »).

**Second temps — le libellé de zone. Non corrigé.**

[FAIT] Sur Saint-Étienne, le modèle crée un nœud par zone, et le cite par son
libellé. Extrait réel,
`v13/campaign-gemini/saint-etienne-de-bolton-2026-08-04--gemini-low.raw.txt` :

~~~json
{
  "id": "zone-COM-1",
  "node_type": "Zone",
  "citations": [ { "page": 11, "excerpt": "Zone : COM-1" } ]
}
~~~

[FAIT] `Zone : COM-1` est bien présent verbatim page 11 ; le contexte réel de la
page est `…Adresse : 12, rue Principale\nLot : 5 191 695\nZone : COM-1`. Mais la
vérification d'ancrage compare les deux textes après avoir supprimé tout
caractère non alphanumérique : il reste `zonecom1`, soit **8 caractères**, sous le
plancher de **12** exigé (`LANE_T1_V8_CONTRACT.md`, partie 1, point 2).

| extrait | page | caractères | après normalisation |
| --- | ---: | ---: | ---: |
| `Zone : COM-1` | 11 | 12 | 8 |
| `Zone : RUR-12` | 12 | 13 | 9 |
| `Zone : RUR-8` | 13 | 12 | 8 |
| `Zone : VIL-2` | 14 | 12 | 8 |

[FAIT] Ces mêmes libellés existaient déjà dans la sortie v9 — où Saint-Étienne
était **accepté** avec F1 0,364 (`v13/report.md`, tableau par PDF, ligne « Gemini
v5 (v9) » ; `v9/campaign-real/saint-etienne-de-bolton-2026-08-04--gemini-low.raw.txt`).
Ce qui a changé n'est pas le modèle : c'est le plancher d'ancrage de 12 caractères
normalisés, introduit avec le contrat v7 (`LANE_T1_V7_CONTRACT.md`, partie 1).

[FAIT] Le contrat v8 a tenté de corriger par la consigne : « quand le texte cité
fait moins de 20 caractères, continue la copie verbatim ». **Ni Gemini ni Sonnet ne
l'appliquent** sur ces quatre libellés. C'est vérifié sur deux modèles
indépendants (`v13/report.md`, § classe de refus restante).

[FAIT] Cette bascule a **deux effets d'une seule cause** : elle provoque le refus
d'ancrage, et elle fait perdre l'appariement à l'oracle — Saint-Étienne passe de
4 unités appariées sur 17 (v9) à **0** sur les deux bras (v13), aux mêmes étapes
et aux mêmes pages (`v13/report.md`, cause 2).

---

## 3. Comment on mesure

### Les six couches de validation

[FAIT] Chaque réponse traverse six portes, dans cet ordre. Une porte fermée arrête
tout : les portes suivantes ne sont pas évaluées et valent `N-A`.

| # | Couche | La question posée | Exemple de refus réel |
| --- | --- | --- | --- |
| 1 | **Transport** | Le fournisseur a-t-il répondu ? | v4 : HTTP 404 `NOT_FOUND` sur `gemini-3.8-flash` |
| 2 | **JSON brut / normalisé** | Le texte est-il un objet JSON, éventuellement après retrait d'un unique bloc ` ```json ` ? | v5 contrôle : bloc ouvrant sans bloc fermant, parse refusé à l'offset 0 |
| 3 | **Extraction** | La forme de base du graphe est-elle correcte (nœuds, arêtes, pas d'arête orpheline) ? | sonde v5 au plafond 65 536 : une arête orpheline |
| 4 | **Profil** | Les types, les statuts et les renvois de preuve appartiennent-ils bien au contrat ? | v12 Sonnet : `unknown_status` sur la valeur `projet` ; v9 Gemini : `missing_evidence_ref` ×3 sur Saint-Barthélemy |
| 5 | **Provenance page / extrait** | L'extrait cité se retrouve-t-il vraiment à la page indiquée du PDF ? | v13 : `ungrounded_pdf_excerpt` sur `Zone : COM-1` ; v9 : le modèle écrit `Yves-Malouin` là où le PDF porte `YvesMalouin` |
| 6 | **Accepté** | Les cinq précédentes sont-elles passées ? | — |

[FAIT] Lecture sur la campagne v13 : `brut 0/5 · normalisé 5/5 · extraction 5/5 ·
profil 5/5 · provenance 4/5 · accepté 4/5`, identique sur les deux modèles
(`v13/report.md`). Le `0/5` en première colonne signifie que **les deux modèles
emballent systématiquement leur réponse dans un bloc Markdown** ; le normalisateur
l'absorbe. Seule exception mesurée : Gemini en effort HIGH produit du JSON brut
5/5 (`LANE_T1_V8_HIGH.md`).

[FAIT] Ces six couches sont rejouées **hors ligne** sur les reçus après chaque
campagne. En v13, sur les dix reçus, la décision hors ligne est identique à la
décision prise en direct (`v13/report.md`, § comparaison par PDF).

### L'oracle manuel, et ce que P, R et F1 veulent dire

[FAIT] Un humain a lu les cinq PDF et écrit à la main la liste de ce qu'il faut
trouver : **36 unités** (Saint-Étienne 17, Saint-Barthélemy 8, Valcourt 6, Lac 4,
Waterloo 1). Chaque unité porte une étape, une page et une **ancre** : le morceau
de phrase qui doit se retrouver dans l'extrait cité. Le fichier est gelé et
**byte-identique de v9 à v13** (`4d50a26c…`, `v13/manual-oracle.json`).

[FAIT] Exemple d'unité, Valcourt V71 : étape `piia`, page 1, ancre
`7.1 1070, RUE BISSONNETTE`.

[FAIT] Les trois mesures, en une phrase chacune :
- **Précision (P)** : parmi ce que le modèle a produit, quelle part est attendue.
- **Rappel (R)** : parmi ce qui est attendu, quelle part le modèle a trouvée.
- **F1** : une moyenne des deux qui pénalise les déséquilibres ; 1 = parfait,
  0 = aucun appariement.

[FAIT] Règle d'appariement, lue dans le code (`tools/refresh-benchmark/score-v3.mjs:16-61`) :
seuls les nœuds de type `Signal` et `DesignationEvent` sont éligibles ; ils sont
regroupés par les arêtes `raises_signal` ; une unité compte comme trouvée si le
groupe déclare **la même étape** et porte une citation **à la même page** dont
l'extrait, en minuscules et espaces normalisés, **contient l'ancre**.

### Les limites mesurées de cet oracle — elles sont importantes

[FAIT] **Limite 1 — la numérotation d'ordre du jour (Valcourt).** L'ancre commence
par le numéro du point. Sous le contrat v5, le modèle commençait son extrait au
numéro ; sous v8, il commence juste après :

~~~text
ancre oracle  : 7.1 1070, RUE BISSONNETTE
extrait v5    : 7.1 1070, RUE BISSONNETTE - PIIA BOISÉ DU RUISSEAU - LOTISSEMENT
extrait v8    :     1070, RUE BISSONNETTE - PIIA BOISÉ DU RUISSEAU - LOTISSEMENT
~~~

[FAIT] L'extrait v8 reste verbatim, reste ancré, reste sur la bonne page — et le
scoreur ne le reconnaît plus. Valcourt passe de F1 0,909 à 0,000. En privant
l'ancre de sa numérotation, sans toucher aux sorties : Gemini v5 → 0,769,
Gemini v8 → 0,667, Sonnet v8 → 0,769 (`v13/report.md`, cause 1). Ces extraits font
56 à 118 caractères : ce n'est pas un effet de la troncature.

[FAIT] **Limite 2 — les `Bylaw` ne comptent pas (Saint-Étienne).** Sur la campagne
v7, Gemini a matérialisé neuf adoptions sous forme de nœuds `Bylaw` et cinq
décisions en `DesignationEvent`. Le scoreur n'admettant que `Signal` et
`DesignationEvent`, les neuf `Bylaw` sont hors du numérateur : **F1 automatique
0,000**, alors que **chacun des deux juges aveugles crédite 14 unités sur 17**
(version 1 de ce dossier, § réconciliation Saint-Étienne ; règle confirmée dans
`score-v3.mjs:17-18`).

[FAIT] **Limite 3 — le F1 ne porte que sur les sorties acceptées, donc pas sur la
même population d'une campagne à l'autre.** v9 note Lac, Saint-Étienne et
Valcourt ; v13 note Lac, Valcourt et Saint-Barthélemy. Lire « 0,558 contre 0,133 »
comme deux mesures du même objet serait une erreur (`v13/report.md`, § agrégats).

[FAIT] **Limite 4 — Waterloo porte un oracle volontairement partiel** (une seule
unité) : précision et F1 y valent `null` par construction, dans tous les bras.

[FAIT] **Écart entre la mesure automatique et la lecture humaine, v13.** F1 macro
automatique : Gemini 0,133, Sonnet 0,222. Sur les mêmes documents, le juge aveugle
crédite **12 unités sur 19 à Gemini et 13 sur 19 à Sonnet**
(`v13/judges/verdict-judge-b.json`).

[JUGEMENT] L'oracle mesure une correspondance de forme, pas l'utilité. Les deux
chiffres sont vrais et ne disent pas la même chose ; c'est pourquoi on lance aussi
des juges.

### Les juges aveugles

[FAIT] Protocole : les sorties acceptées sont figées dans un paquet
(`blind-bundle.json`) avec une empreinte SHA-256, et chaque système reçoit un
**alias opaque**. La correspondance alias → modèle est conservée à part
(`blind-map.json`) et n'est pas transmise au juge. Deux modèles indépendants jugent
le même paquet, sans savoir qui a produit quoi. Ils rendent, par document : les
unités soutenues, les défauts de citation, une note d'utilité sur 5 et un
classement.

[FAIT] **v7** — alias `system-20d310137265` = Gemini LOW, `system-02004a62770a` =
Sonnet 4.6 historique. Les **deux** juges classent Gemini premier globalement,
**premier sur 2 des 3 documents**, confiance `medium`. Sonnet l'emporte sur
Saint-Étienne. Motif cité par le juge B : « qualité de traçabilité, structuration
des relations et absence de conclusions non étayées »
(`v7/judges/verdict-judge-a.json`, `verdict-judge-b.json`, `v7/blind-map.json`).

[FAIT] **v13** — alias `system-87b5985c3e9f` = Gemini LOW v8,
`system-032f55c8cc8b` = Sonnet Cloud Code v8 (`v13/blind-map.json`). Juge B :

| document | premier | unités soutenues | utilité |
| --- | --- | ---: | ---: |
| Lac-des-Seize-Îles | Sonnet | 4 contre 3, sur 4 | 4 contre 3 |
| Valcourt | Gemini | 5 contre 5, sur 6 | 4 contre 3 |
| Saint-Barthélemy | Sonnet | 3 contre 3, sur 8 | 3 contre 2 |
| Waterloo | Gemini | 1 contre 1, sur 1 | 4 contre 3 |

[FAIT] Bilan du juge B : `winner: "tie"`, `confidence: "low"`, partage 2–2,
**13 unités contre 12 sur 19**, **utilités cumulées égales, 13 contre 13**. Ses
propres limites déclarées : une seule observation par cellule, Saint-Étienne non
jugé faute de sortie acceptée, et l'écart d'une unité « n'est pas discriminant ».
Profils de défaut opposés et de gravité comparable : Sonnet sur-relie et retouche
ses extraits ; Gemini cite littéralement partout (111 citations vérifiées sans
écart) mais fusionne ou omet des étapes.

**Juge A (Gemini) : en attente.** [FAIT] Le second juge v13 n'a pas été lancé, la
configuration Gemini n'étant pas disponible au moment de la rédaction (source :
brief du conducteur i-cond). Cette section est à compléter à sa réception ; aucun
verdict n'est anticipé ici.

### La variance : ce qu'on sait et ce qu'on ne sait pas

[FAIT] La campagne v9 est un **rejeu à gel identique** de la campagne v7 : même
contrat, même modèle, même effort, même plafond. Résultat : **acceptation
identique, 3/5, sur exactement les mêmes PDF**. Le F1 bouge sur 1 des 3 sorties
acceptées — Lac 0,000 d'écart, Valcourt 0,000 d'écart, Saint-Étienne +0,364
(version 1 de ce dossier, § contexte mesuré).

[FAIT] Deux observations par PDF ne permettent d'estimer ni une variance
statistique, ni une probabilité d'acceptation. La campagne v13 ne porte **qu'une
seule observation par document et par bras** (`v13/report.md`, § limites).

[JUGEMENT] Conséquence pratique : un écart d'une unité entre deux modèles, ou un
écart de F1 inférieur à celui déjà observé entre deux rejeux du même réglage, ne
doit pas servir à trancher.

---

## 4. Les résultats

### Toutes les campagnes, v4 → v13

[FAIT] « Contrat » = version du contrat d'extraction, c'est-à-dire ce qu'on demande
au modèle. « Plafond » = `maxOutputTokens`. Tokens = entrée / sortie visible,
cumulés sur la campagne.

| Campagne | Contrat | Modèle | Effort | Plafond | Acceptés | F1 macro | Latence moy. | Tokens |
| --- | --- | --- | --- | ---: | :-: | ---: | ---: | ---: |
| v4 | v3 | Gemini 3.8 Flash | LOW | 16 384 | **0/5** | `N-A` | 31 394 ms | 67 397 / 46 553 |
| v5 (contrôle seul) | v4 | Gemini 3.8 Flash | LOW | 16 384 | **0/1** | `N-A` | 56 170 ms | 7 838 / 14 360 |
| v6 (2 PDF lancés) | v5 | Gemini 3.8 Flash | LOW | 16 384 | **1/5** | 0,400 (n=1) | 20 945 et 54 670 ms | 26 157 / 22 624 |
| v7 | v5 | Gemini 3.8 Flash | LOW | 65 536 | **3/5** | 0,436 (n=3) | 25 747 ms | 66 930 / 42 040 |
| v8 | v5 | Gemini 3.8 Flash | **HIGH** | 65 536 | **3/5** | 0,200 (n=2) | 81 753 ms | 66 930 / 63 438 (+76 833 pensée) |
| v9 (rejeu de v7) | v5 | Gemini 3.8 Flash | LOW | 65 536 | **3/5** | 0,558 (n=3) | 30 703 ms | 66 930 / 50 075 |
| v10 | v6 | Gemini 3.8 Flash | LOW | 65 536 | **1/5** | 0,909 (n=1) | 34 127 ms | 68 125 / 50 646 |
| v11 | v7 | Gemini 3.8 Flash | LOW | 65 536 | **1/5** | 0,909 (n=1) | 30 413 ms | 68 565 / 46 088 |
| v12 | v5 | Sonnet 4.6 direct | `N-A` | 65 536 | **0/5** | `N-A` | 137 252 ms | 75 224 / 70 669 |
| v12 | v5 | Sonnet 4.6 Cloud Code | `N-A` | 64 000 appliqué | **0/5** | `N-A` | 130 486 ms | 75 224 / 72 590 |
| **v13** | **v8** | **Gemini 3.8 Flash** | **LOW** | **64 000** | **4/5** | **0,133** (n=3) | **30 537 ms** | **68 680 / 47 161** |
| **v13** | **v8** | **Sonnet 4.6 Cloud Code** | `N-A` | **64 000** | **4/5** | **0,222** (n=3) | **121 790 ms** | **77 144 / 70 046** |

[FAIT] **La colonne F1 n'est pas comparable ligne à ligne** : le scoreur ne note
que les sorties acceptées, donc chaque ligne porte sur une population de documents
différente (limite 3 du §3). C'est explicite dans les rapports v10, v11 et v13.

[FAIT] Pour comparer à population fixe, le rapport v13 rejoue les mêmes quatre
documents (Waterloo exclu, oracle partiel), en notant **toutes** les sorties
qu'elles soient acceptées ou non, avec l'ancre privée de sa numérotation. C'est un
diagnostic de contenu, pas la métrique produit :

| Bras | F1 macro à population fixe | micro P / R / F1 |
| --- | ---: | ---: |
| Gemini v5 (v9) | **0,383** | 0,625 / 0,286 / 0,392 |
| Sonnet v8 (v13) | **0,359** | 0,368 / 0,200 / 0,259 |
| Gemini v8 (v13) | **0,267** | 0,333 / 0,143 / 0,200 |

[FAIT] À population fixe, Sonnet v8 est au niveau de Gemini v5, et **Gemini v8 est
en retrait de son propre niveau v5** — l'écart venant presque entièrement de
Saint-Étienne (`v13/report.md`).

### Ce que le contrat v8 a réellement corrigé

[FAIT] Quatre familles de refus ont entièrement disparu des dix reçus v13 :

| Famille de refus | v12 Sonnet | v9 Gemini | v13 Gemini | v13 Sonnet |
| --- | ---: | ---: | ---: | ---: |
| `unknown_status` | 4 | 0 | **0** | **0** |
| `entity_citation_excerpt_too_long` | 5 | 0 | **0** (inatteignable) | **0** (inatteignable) |
| `missing_evidence_ref` | 1 | 3 | **0** | **0** |
| `incompatible_source_type` | 1 | 0 | **0** | **0** |
| `ungrounded_pdf_excerpt` | 42 | 2 | **4** | **17** |

### Les juges

[FAIT] **v7** : Gemini LOW l'emporte sur Sonnet 4.6 historique auprès des deux
juges, premier sur 2 des 3 documents, confiance `medium`.

[FAIT] **v13** : égalité. 2 documents chacun, 13 unités contre 12 sur 19, utilité
cumulée 13 contre 13, confiance `low`. Juge A en attente.

### Sonnet 4.6

[FAIT] Sous le contrat v5 (campagne v12), Sonnet obtient **0/5 en direct Anthropic
et 0/5 en Cloud Code**, avec 10 requêtes sur 10 en HTTP 200. Deux des trois
familles de refus pointaient vers le contrat, pas vers le modèle : `unknown_status`
venait d'une ambiguïté où le profil décrivait des valeurs métier (`actif`,
`projet`) que le validateur comparait à une liste générique
(`LANE_T1_SONNET_C.md`).

[FAIT] Sous le contrat v8 (campagne v13), Sonnet Cloud Code passe à **4/5**, avec
le meilleur F1 macro des deux bras v13 (0,222) et le meilleur score à population
fixe après Gemini v5 (0,359). Il est **4,0 fois plus lent** : 121 790 ms contre
30 537 ms de moyenne, et 209 710 ms contre 58 250 ms en p95.

[JUGEMENT] v12 concluait qu'on ne pouvait pas conclure sur Sonnet. v13 le mesure :
il n'est plus écartable sur la qualité, il l'est sur la latence si le débit compte.

### L'effort HIGH est écarté

[FAIT] Campagne v8 : même identifiant de modèle, seul `thinkingLevel` passe de LOW
à HIGH. Résultat : **acceptation inchangée à 3/5** (en échangeant un cas contre un
autre), latence moyenne **×3,18** (81,8 s contre 25,7 s), tokens fournisseur
totaux **×1,90**, F1 macro calculable en baisse de 0,436 à 0,200, et Valcourt qui
tombe de 0,909 à 0,000 (`LANE_T1_V8_HIGH.md`).

[JUGEMENT] HIGH coûte trois fois plus cher en temps sans acheter une acceptation
supplémentaire. Il n'est retenu dans aucune option.

---

## 5. Ce qui reste ouvert

[FAIT] **Une seule classe de refus subsiste** : `ungrounded_pdf_excerpt` sur
Saint-Étienne, ×4 côté Gemini et ×17 côté Sonnet, causée par les libellés de zone
courts (`Zone : COM-1`) qui tombent sous le plancher d'ancrage de 12 caractères
normalisés. Elle touche **les deux modèles**, ce qui exclut une explication par la
compétence d'un modèle particulier. Le plancher de 20 caractères demandé par le
prompt v8 n'est appliqué par aucun des deux.

[FAIT] **Deux voies existent pour la traiter**, et les deux sont des arbitrages de
garantie produit qui reviennent à l'owner : abaisser le plancher d'ancrage de 12,
ou traiter le libellé court côté code (`v13/report.md`, point 2 pour le
conducteur).

[FAIT] **L'oracle est à réaligner** sur trois points mesurés : la convention de
numérotation d'ordre du jour (Valcourt), l'exclusion des nœuds `Bylaw` du
numérateur (Saint-Étienne), et le fait que la macro ne porte que sur les sorties
acceptées. Le corpus et l'oracle sont gelés depuis v9 et n'ont pas été touchés.

[FAIT] **Le coût unitaire est `N-A` — source manquante.** Le dépôt ne porte aucun
tarif par token, ni Anthropic ni Google. Les seuls tarifs présents
(`docs/reports/architecture-monthly/token-audit.mjs`, `docs/reports/couts-*.md`)
sont des forfaits au siège, sans dénominateur en tokens. Aucune estimation n'a été
fabriquée.

[FAIT] **La variance n'est pas mesurée** sur v13 : une seule observation par
document et par bras.

[FAIT] **Le juge A v13 est en attente** (configuration Gemini). Aucun jugement
aveugle complet n'existe donc sur la campagne v13.

[FAIT] **Les correctifs sont prêts mais non fusionnés.** PR
[#687](https://github.com/rhanka/radar-immobilier/pull/687) (JSON strict et
citations) et PR [#688](https://github.com/rhanka/radar-immobilier/pull/688)
(contrat v8) sont ouvertes vers `main`, `mergeStateStatus=CLEAN`, checks `Enforce
repo policy` et `Quality gates` en `SUCCESS`. #688 dépend de #687. Aucune des deux
n'est fusionnée (`gh pr view`).

[FAIT] **Codex est hors quota jusqu'au 20/09** (source : brief du conducteur
i-cond ; non attesté par un artefact du dépôt).

[FAIT] **La revue externe multi-agent prévue par le harness est `N-A`** sur
plusieurs lanes : la politique d'exécution n'autorise pas le partage du dépôt
privé. Les validations disponibles sont les tests locaux et les checks CI
(`LANE_T1_V6_CONTRACT.md`, § limite de revue).

---

## 6. Les options

| id | choix | pour | contre | coût | réversibilité | ce qui le ferait gagner |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | [JUGEMENT] Promouvoir **Gemini LOW, contrat v8, plafond 64 000, maintenant** : fusionner #687 puis #688, les reporter dans #682, et journaliser l'échec par PV via `recordOutcome`. | [FAIT] 4/5 acceptés, seuil atteint. [FAIT] Les deux juges v7 préféraient déjà Gemini au Sonnet historique. [FAIT] 30,5 s par PV, le plus rapide des candidats. [JUGEMENT] La couverture démarre tout de suite sur 4 PV sur 5. | [FAIT] Saint-Barthélemy est accepté avec **0 unité appariée sur 8** : la porte d'acceptation ne mesure pas la couverture. [FAIT] À population fixe, Gemini v8 (0,267) est **en retrait de Gemini v5** (0,383). [FAIT] Saint-Étienne reste muet à chaque run. [FAIT] Juge A absent, variance non mesurée. | [FAIT] Un appel modèle par PV et par run ; montant `N-A`, source manquante. | [JUGEMENT] Forte : retour au réglage antérieur, le CronJob n'étant pas destructif. | [JUGEMENT] Si l'owner accepte explicitement qu'un PV sur cinq reste sans signal **et** qu'un PV accepté puisse n'apporter aucune unité attendue, contre une mise en service immédiate. |
| **B** | [JUGEMENT] **Contrat v9 d'abord** : faire citer la phrase de décision plutôt que le libellé de zone, réaligner l'oracle (numérotation d'ordre du jour, nœuds `Bylaw`), puis exiger **deux runs à ≥ 4/5** avec un critère de couverture en plus de l'acceptation. | [FAIT] Vise la **seule** classe de refus restante, dont la cause est mesurée au caractère près sur deux modèles. [FAIT] Corrige les trois limites d'oracle mesurées, sans lesquelles les campagnes suivantes resteront illisibles. [JUGEMENT] Pose un seuil reproductible avant un job sans surveillance. | [FAIT] Le durcissement par consigne a **déjà échoué une fois** : le plancher de 20 caractères du prompt v8 n'est appliqué par aucun des deux modèles. [JUGEMENT] Retarde la valeur, sans garantie qu'un tour de plus suffise. | [FAIT] Travail de contrat hors de cette lane, puis au moins 10 appels de qualification ; montant `N-A`. | [JUGEMENT] Forte : le seuil et le contrat restent remplaçables par une décision suivante. | [JUGEMENT] Si la priorité est qu'un signal publié sans relecture humaine soit fiable, et que la mesure qui l'atteste soit lisible. |
| **C** | [JUGEMENT] Promouvoir **Sonnet 4.6 Cloud Code, contrat v8**, à la place de Gemini. | [FAIT] Même acceptation 4/5. [FAIT] Meilleur F1 macro v13 (0,222 contre 0,133) et meilleur score à population fixe des deux bras v13 (0,359 contre 0,267). [FAIT] Le juge B lui crédite 13 unités contre 12. | [FAIT] **4,0× plus lent** : 121,8 s contre 30,5 s en moyenne, 209,7 s contre 58,3 s en p95. [FAIT] Consomme 70 046 tokens de sortie contre 47 161. [FAIT] Le juge B ne le déclare pas vainqueur : `tie`, confiance `low`. [FAIT] Retouche ses extraits : citations non littérales sur les 4 documents. | [FAIT] Un appel par PV, quatre fois plus long ; montant `N-A`. | [JUGEMENT] Forte : le bras est isolé et interchangeable. | [JUGEMENT] Si la latence du CronJob est sans importance et que l'écart de correspondance à l'oracle est jugé décisif malgré l'égalité prononcée par le juge. |
| **D** | [JUGEMENT] Ne rien promouvoir et **rejouer v13 à l'identique deux fois**, pour mesurer la variance avant tout autre changement. | [FAIT] v13 n'a qu'une observation par cellule ; le rejeu v7→v9 avait déjà montré un F1 bougeant de +0,364 sur un document à gel identique. [JUGEMENT] Sépare le bruit d'échantillonnage des effets de contrat. | [FAIT] Ne corrige aucune cause connue : Saint-Étienne resterait refusé. [JUGEMENT] Deux observations de plus ne suffisent toujours pas à estimer une probabilité. | [FAIT] 20 appels supplémentaires ; montant et quota causal `N-A`. | [JUGEMENT] Totale : collecte seule, aucun acte produit. | [JUGEMENT] Si l'owner estime que l'écart Gemini/Sonnet doit être départagé avant de retoucher le contrat. |

### Recommandation : B

[JUGEMENT] **La raison décisive.** Le critère qui avait été posé — « au moins 4 PV
sur 5 acceptés » — ne mesure pas ce que l'owner veut. Saint-Barthélemy le montre :
[FAIT] il est accepté par les deux modèles et n'apparie **aucune** des 8 unités
attendues, parce que les pages citées (4–5 et 3–5) ne couvrent pas les pages 4 à 8
et 10 de l'oracle. [JUGEMENT] La porte d'acceptation vérifie la **provenance**
(« ce passage est bien à cette page »), jamais la **couverture** (« tu as bien tout
trouvé »). Promouvoir sur ce seul critère, pour un job sans surveillance,
reviendrait à retenir un réglage dont la mesure ne sait pas distinguer une bonne
extraction d'une extraction maigre.

[JUGEMENT] Deuxième raison, plus faible mais convergente : à population fixe,
Gemini v8 (0,267) est en retrait de Gemini v5 (0,383), et la cause est identifiée
au caractère près — c'est le même libellé de zone qui provoque le refus de
Saint-Étienne. Une cause, deux effets, une correction.

[JUGEMENT] **Le cas le plus fort contre B.** Les deux bras atteignent le seuil, les
deux PR sont vertes et fusionnables, le juge aveugle crédite des utilités de 3 et 4
sur 5 sur les quatre documents comparables, et une partie de la baisse de F1 est un
**artefact mesuré** du scoreur, pas une perte de contenu : Valcourt remonte de
0,000 à 0,667 dès qu'on prive l'ancre de sa numérotation. Surtout : [FAIT] le
durcissement par consigne a déjà échoué une fois — le plancher de 20 caractères du
prompt v8 n'a été appliqué par aucun des deux modèles. [JUGEMENT] B peut donc
consommer un tour de plus pour revenir au même point, pendant que 4 PV sur 5
auraient pu produire de la valeur.

[JUGEMENT] **Ce qui renverserait la recommandation.** A devient le bon choix si
l'owner accepte explicitement la double perte mesurée — un PV muet par run, et des
PV acceptés à faible couverture — contre une mise en service immédiate, la
réversibilité étant forte. C devient le bon choix si la latence du CronJob est sans
importance et que le verdict du juge A, à sa réception, tranche pour Sonnet.
D devient le bon choix si l'owner considère qu'aucun écart ne peut être lu tant que
la variance n'est pas mesurée. B bascule vers une promotion dès que le contrat
corrigé atteint 4/5 sur deux runs **sans** nouvelle classe de refus et **avec** une
couverture non nulle sur chaque PV accepté.

[JUGEMENT] **Pré-mortem.** Supposons B choisi et M1 encore bloqué dans trois
semaines. Le scénario le plus vraisemblable au vu des mesures : la consigne de citer
la phrase de décision n'est pas mieux suivie que le plancher de 20 caractères, les
refus se déplacent vers une nouvelle classe — c'est exactement ce qui s'est produit
de v9 à v10 puis v11, où chaque correction a déplacé le refus sans réduire le total
— et le seuil « deux runs à 4/5 » retarde le CronJob sans borne de temps. Les
premiers signaux d'alerte : une classe de refus inédite en v14, un désaccord qui
persiste entre F1 et juges, ou deux runs consécutifs à 3/5. La parade : traiter le
libellé court **côté code** plutôt que par la consigne — la troncature côté code a
fonctionné là où la consigne « coupe à 200 » avait échoué —, fixer d'emblée une
borne de temps à B, et revenir à l'owner plutôt qu'élargir le périmètre.

[JUGEMENT] **Mon intérêt de présentateur.** Recommander B réduit mon risque d'avoir
conseillé un comportement dont je n'ai pas la preuve, et me fait sous-pondérer la
valeur d'une mise en service partielle rapide. Je note aussi que c'était déjà la
recommandation de la version 1 de ce dossier, sur des données différentes : à lire
comme un biais de constance.

[JUGEMENT] **L'intérêt de l'owner**, tel que je le comprends : obtenir des signaux
municipaux exploitables et traçables, avec assez de continuité pour être utiles, un
coût maîtrisable, et la possibilité de revenir en arrière. Les deux termes qui
s'opposent ici sont la vitesse de mise en service et la fiabilité d'un signal publié
sans relecture humaine.

---

## 7. Ce qu'on demande à l'owner

[JUGEMENT] Répondre par **A**, **B**, **C** ou **D**.

Cette réponse n'autorise, par elle-même, ni acte de production, ni fusion de #682,
#687 ou #688, ni modification de contrat dans la présente lane.

---

## Annexe — glossaire

- **Fence** : le bloc ` ```json … ``` ` dont le modèle entoure sa réponse ; il doit être retiré avant de lire le JSON.
- **Ancrage** : vérification qu'un extrait cité se retrouve vraiment à la page indiquée du PDF, après normalisation typographique.
- **Plancher d'ancrage** : longueur minimale (12 caractères normalisés) qu'un extrait doit avoir pour être vérifiable ; en dessous, l'appariement serait accidentel.
- **Oracle** : la liste écrite à la main de ce qu'il faut trouver dans les cinq PDF ; 36 unités, gelée depuis v9.
- **Unité** : un fait réglementaire ou foncier attendu, avec son étape, sa page et son ancre.
- **P (précision)** : parmi ce que le modèle produit, la part attendue. **R (rappel)** : parmi ce qui est attendu, la part trouvée. **F1** : moyenne des deux pénalisant le déséquilibre ; 1 = parfait.
- **Macro / micro** : macro = moyenne des F1 par document ; micro = un seul F1 calculé sur toutes les unités mises ensemble.
- **thinkingLevel (LOW / HIGH)** : budget de réflexion interne accordé au modèle avant qu'il écrive sa réponse.
- **Plafond de tokens (`maxOutputTokens`)** : longueur maximale de la réponse ; s'il est atteint, la sortie est coupée en plein milieu.
- **Juge aveugle** : un modèle tiers qui note deux sorties désignées par des alias opaques, sans savoir qui les a produites.
