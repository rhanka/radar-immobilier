# Campagne v14 — contrat `immo-pv-extraction-v9`, Gemini LOW, plafond 64 000

`[FAIT]` = mesuré, avec sa source dans ce dossier. `[JUGEMENT]` = appréciation.
`N-A` = non disponible ou non calculable.

## Résultat

[FAIT] **5 PV sur 5 acceptés.** Les six couches de validation passent sur les cinq
documents, y compris Saint-Étienne-de-Bolton, refusé par **les deux** modèles sous
le contrat v8. **Aucune violation** n'est enregistrée : ni profil, ni extraction,
ni provenance.

| Agrégat | Gemini v5 (v9) | Gemini v8 (v13) | **Gemini v9 (v14)** |
| --- | ---: | ---: | ---: |
| Plafond | 65 536 | 64 000 | **64 000** |
| Acceptés | 3/5 | 4/5 | **5/5** |
| Couches brut · norm · extr · profil · prov · accepté | 0·5·5·4·3·3 /5 | 0·5·5·5·4·4 /5 | **0·5·5·5·5·5 /5** |
| Classes de refus restantes | 2 | 1 (`ungrounded_pdf_excerpt`) | **aucune** |
| Macro F1, oracle v1 | 0,558 (n=3) | 0,133 (n=3) | **0,282 (n=4)** |
| Macro F1, oracle v2 | 0,610 (n=3) | 0,389 (n=3) | **0,576 (n=4)** |
| Macro P / R, oracle v2 | 0,696 / 0,582 | 0,389 / 0,389 | **0,664 / 0,547** |
| Latence moyenne | 30 703 ms | 30 537 ms | **27 030 ms** |
| Tokens entrée / sortie | 66 930 / 50 075 | 68 680 / 47 161 | **70 080 / 42 920** |
| Coût unitaire | `N-A` | `N-A` | `N-A` |

[FAIT] **Les macros ne portent plus sur la même population d'une campagne à
l'autre** : le scoreur ne note que les acceptés, donc v9 note 3 documents, v13 en
note 3 et v14 en note 4 (Waterloo exclu, oracle volontairement partiel). v14 est
la première campagne où population acceptée et population complète coïncident.

[FAIT] **Coût `N-A` — source manquante.** Aucun tarif par token dans le dépôt, ni
Anthropic ni Google. Aucune estimation n'a été fabriquée.

## Par document

| Document | HTTP | fin de flux | latence | tokens in/out | accepté | F1 v1 | F1 v2 | tp/gold (v2) | P / R (v2) |
| --- | ---: | :-: | ---: | ---: | :-: | ---: | ---: | :-: | ---: |
| Lac-des-Seize-Îles | 200 | `STOP` | 11 693 ms | 7 441 / 3 816 | oui | 0,400 | **0,750** | 3/4 | 0,750 / 0,750 |
| Saint-Étienne-de-Bolton | 200 | `STOP` | 25 903 ms | 19 976 / 9 802 | **oui** | 0,364 | **0,500** | 6/17 | 0,857 / 0,353 |
| Valcourt | 200 | `STOP` | 16 148 ms | 7 893 / 5 586 | oui | 0,000 | **0,769** | 5/6 | 0,714 / 0,833 |
| Saint-Barthélemy | 200 | `STOP` | 28 697 ms | 15 123 / 8 561 | oui | 0,364 | 0,286 | 2/8 | 0,333 / 0,250 |
| Waterloo | 200 | `STOP` | 52 710 ms | 19 647 / 15 155 | oui | `N-A` | `N-A` | 1/1 | `N-A` / 1,000 |

[FAIT] Waterloo porte un oracle volontairement partiel (une unité) : précision et
F1 y valent `null` par construction, dans toutes les campagnes.

## Gel v14 et delta v13 → v14

[FAIT] **Un seul changement** : le contrat de profil. Tout le reste est repris de
v13 sans modification.

| Élément | v13 | v14 |
| --- | --- | --- |
| Contrat | `immo-pv-extraction-v8` | **`immo-pv-extraction-v9`** |
| Commit T1 | `19d0d8b2` | **`d93f5c93`** (PR #688) |
| Module `refresh-profile.ts` | `113f477a…` | **`776c7578…`** |
| Module `refresh-corpus.ts` | `47cf6c62…` | `47cf6c62…` (identique) |
| Plafond | 64 000 | 64 000 |
| Corpus, hachages de page, manifeste | v9 | identiques, hors champ `campaign` |
| Oracle gelé `manual-oracle.json` | `4d50a26c…` | `4d50a26c…` (byte-identique) |
| `maxAttempts` / `retryOnlyAfter` | 2 / `transport_failure` | identiques |

[FAIT] SHA de cette campagne : manifeste `54af3724…` · gel de prompt `2923598a…` ·
comparaison `a3a897e9…` · bundle aveugle `d7d3daec…` · oracle v2 `be5e21a6…`.

## Contrôle Valcourt — le contrôle a servi

[FAIT] Le premier gel v14 portait le commit `ac99728f`, première rédaction du
prompt v9. Le contrôle Valcourt, lancé avant la campagne, a mesuré ceci :

| Contrôle Valcourt | contrat v8 (`19d0d8b2`) | v9 première rédaction (`ac99728f`) | v9 corrigé (`d93f5c93`) |
| --- | ---: | ---: | ---: |
| HTTP / fin de flux | 200 / `STOP` | 200 / `STOP` | 200 / `STOP` |
| Plafond demandé | 64 000 | 64 000 | 64 000 |
| Tokens entrée / sortie | 7 613 / **6 173** | 7 830 / **56** | 7 893 / **6 843** |
| Nœuds / arêtes | 7 / 7 | **0 / 0** | 8 / 8 |
| Accepté | oui | **oui** | oui |

[FAIT] Sous la première rédaction, la sortie est **acceptée et vide**. Une seule
variable change entre les deux premières colonnes : le module de profil. Reçu
conservé : `v14/control-v9-first-wording/`, gel conservé :
`v14/prompt-freeze-v9-first-wording.json`.

[JUGEMENT] Cause : Valcourt est un **ordre du jour**. Il énonce des points prévus
et aucune décision prise. La consigne « l'extrait est la phrase de décision ; une
adresse est une propriété » ne laissait au modèle rien qu'il estime citable, et le
contrat autorise par ailleurs une extraction vide. L'acceptation ne l'a pas vu :
elle vérifie la provenance, jamais la couverture.

[FAIT] Correction (`d93f5c93`) : la règle nomme désormais ce qu'elle vise — une
ligne qui n'est qu'un libellé et un code — et ajoute que **sur un ordre du jour, le
point listé est l'acte** ; rendre une extraction vide au seul motif qu'aucune
phrase de décision n'existe est interdit. Le cas réellement sans fait attesté reste
autorisé, inchangé. Le numéro de contrat reste `v9` : il n'avait jamais tourné de
campagne.

[JUGEMENT] C'est exactement le rôle d'un contrôle à une requête : la classe de
refus n'a pas été déplacée en silence, elle a été mesurée avant de dépenser cinq
requêtes.

## Ce que v9 corrige, mesuré

[FAIT] La seule classe de refus laissée par v8 disparaît.

| Famille de refus | v9 Gemini | v13 Gemini | v13 Sonnet | **v14 Gemini** |
| --- | ---: | ---: | ---: | ---: |
| `unknown_status` | 0 | 0 | 0 | **0** |
| `entity_citation_excerpt_too_long` | 0 | 0 (inatteignable) | 0 (inatteignable) | **0** (inatteignable) |
| `missing_evidence_ref` | 3 | 0 | 0 | **0** |
| `incompatible_source_type` | 0 | 0 | 0 | **0** |
| `ungrounded_pdf_excerpt` | 2 | 4 | 17 | **0** |
| `entity_citation_excerpt_too_short` | `N-A` (règle absente) | `N-A` | `N-A` | **0** |

[FAIT] **Le plancher de 20 points de code est respecté** : sur les **103 citations
d'entités** de la campagne, **0** porte un extrait de moins de 20 points de code.
Sous v13, 17 des 331 citations en portaient un, toutes sur Saint-Étienne, toutes
refusées. La consigne v8 « continue jusqu'à 20 caractères » n'était suivie par
aucun modèle ; la règle v9, nommée et appliquée par le validateur, l'est.

[FAIT] 18 extraits ont été tronqués à 200 points de code côté profil, **tous restés
ancrés**.

## Saint-Étienne, le cas qui bloquait

[FAIT] Sous v13, Saint-Étienne était refusé sur les deux bras, par des libellés de
zone cités à la place du texte de décision. Sous v14 il est **accepté**, avec
**6 unités appariées sur 17** par l'oracle v2 et une **précision de 0,857** : ce
que le modèle produit est presque toujours attendu, c'est la couverture qui reste
partielle.

[FAIT] Unités appariées : `B14`, `B154`, `B155`, `B156`, `B157`, `B158`. Les 11
unités manquantes se répartissent en deux causes mesurées :

- **3 unités de stage `inconnu`** (`BC2010-11`, `BC2014-11`, `BC2023-02`) qu'aucun
  modèle ne peut apparier : aucune sortie ne porte cette valeur de stage. C'est une
  limite de l'oracle, laissée telle quelle et non corrigée par la version v2.
- **8 adoptions de règlements** (`B04` à `B11`). Le modèle **regroupe** les sept
  règlements `2026-04` à `2026-10` en **un seul** nœud `Bylaw` (`Règlement 2026-05`)
  et le cite page 10 par la phrase de résolution : « QUE le conseil municipal adopte
  les Règlements ci-dessus mentionnés ». C'est exactement ce que le contrat v9
  demande. Les ancres de l'oracle, elles, attendent la **ligne d'énumération**
  (« 2026-04 modifiant le »), qui n'est pas la phrase de décision. `B11` n'est pas
  produit du tout.

  [JUGEMENT] Sur ces sept unités, **le contrat v9 et l'oracle demandent deux choses
  opposées** : la phrase de décision d'un côté, l'élément de liste qu'elle vise de
  l'autre. C'est une limite d'oracle restante, distincte de la couverture du modèle,
  et que la version v2 ne corrige pas — elle a ajouté la page 10 comme site
  alternatif, pas une ancre de résolution. À arbitrer avant toute campagne qui
  voudrait lire ces sept unités comme un déficit de couverture.

## Limites

[FAIT] **Une seule observation par document** pour cette campagne. La variance est
mesurée par la campagne v15, rejeu exact de v14.

[FAIT] **Bras Sonnet : `N-A`, hors périmètre.** L'option B porte sur Gemini LOW ;
aucune clé Anthropic n'a été chargée.

[FAIT] **Bundle aveugle gelé, aucun juge lancé.** `v14/blind-bundle.json`
(`d7d3daec…`), 5 entrées, 1 alias, `comparable: false` sur les cinq documents — un
seul système est en lice, un classement par document n'est donc pas calculable. Le
paquet reste utilisable par un juge pour noter l'utilité et les défauts de
citation, pas pour départager deux systèmes.

[FAIT] **Coût unitaire `N-A`** — source manquante, aucune estimation fabriquée.

## Gates

| Gate | Résultat |
| --- | --- |
| `make test-v14` (v14 et v15) | **27/27** chacun |
| `make test-v13` rejoué | **27/27**, aucune régression |
| `make test-oracle-v2` | **7/7** |
| Requalification hors ligne des 5 reçus | acceptation identique en ligne et hors ligne, 5/5 |
| `make check-v15-replay` | `exactReplay: true` |
| Trailers interdits sur les commits | **0** |
| `grep -rlE 'sk-ant-[A-Za-z0-9]' v14 v15` | **0** |

Comparaison v1 contre v2 par PV et par bras : [`../oracle-v2-comparison.json`](../oracle-v2-comparison.json).
Rejeu exact : [`../v15/report.md`](../v15/report.md).
