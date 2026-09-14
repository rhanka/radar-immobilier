v11 LOW : 1/5 acceptés (v9 : 3/5, v10 : 1/5) · refus principaux : `entity_citation_excerpt_too_long` (3), `ungrounded_pdf_excerpt` (1) · seuil B ≥4/5 : non atteint

# Campagne T1 v11 — contrat d'extraction v7

## Résultat

Le contrôle Valcourt puis les cinq PDF ont été envoyés une seule fois à
Gemini 3.8 Flash LOW, avec un plafond de 65 536 tokens. Les six appels ont reçu
HTTP 200 et une fin SSE `STOP`; aucun retry n'a été envoyé. Le contrôle
Valcourt est accepté avec 7 322 tokens de sortie. Le plafond de six requêtes
Gemini est atteint.

La campagne accepte 1/5 PDF, comme v10 et contre 3/5 en v9. Le seuil B d'au
moins 4/5 n'est donc pas atteint sur ce run. Valcourt, seule sortie acceptée,
obtient P=1,000, R=0,833 et F1=0,909; cette valeur est aussi la macro v11 sur
les sorties acceptées et ne porte pas sur le même ensemble que la macro v9.

## Comparaison v9 ↔ v10 ↔ v11 par PDF

Chaque cellule donne : accepté · refus principal · P/R/F1 · tokens sortie.

| PDF | v9 | v10 | v11 |
| --- | --- | --- | --- |
| Lac-des-Seize-Îles | oui · aucun · 1,000/0,250/0,400 · 4 920 | non · `entity_citation_excerpt_too_long` · N-A · 4 131 | non · `entity_citation_excerpt_too_long` · N-A · 4 036 |
| Saint-Étienne-de-Bolton | oui · aucun · 0,800/0,235/0,364 · 9 488 | non · `entity_citation_excerpt_too_long` · N-A · 9 846 | non · `ungrounded_pdf_excerpt` · N-A · 9 918 |
| Valcourt | oui · aucun · 1,000/0,833/0,909 · 9 449 | oui · aucun · 1,000/0,833/0,909 · 6 803 | oui · aucun · 1,000/0,833/0,909 · 6 880 |
| Saint-Barthélemy | non · `missing_evidence_ref` · N-A · 14 000 | non · `entity_citation_excerpt_too_long` · N-A · 12 807 | non · `entity_citation_excerpt_too_long` · N-A · 9 294 |
| Waterloo | non · `ungrounded_pdf_excerpt` · N-A · 12 218 | non · `ungrounded_pdf_excerpt` · N-A · 17 059 | non · `entity_citation_excerpt_too_long` · N-A · 15 960 |

## Effet mesuré du contrat v7

- L'ancrage typographique corrige la cause Waterloo observée en v9/v10 : les
  formes `YvesMalouin` et `Yves-Malouin` s'ancrent sur la même page après
  normalisation, et aucun `ungrounded_pdf_excerpt` ne subsiste pour Waterloo.
  Le cas reste toutefois refusé, déplacé vers la limite de longueur.
- La consigne de coupure et le `maxLength: 200` ne suffisent pas à contraindre
  toutes les générations. Le plus long extrait d'entité mesure 205 points de
  code pour Lac, 207 pour Saint-Étienne, 205 pour Saint-Barthélemy et 203 pour
  Waterloo; seul Valcourt reste sous la borne avec un maximum de 123.
- Saint-Étienne est refusé d'abord par le nouveau plancher d'ancrage :
  `Zone : COM-1`, `Zone : RUR-12`, `Zone : RUR-8` et `Zone : VIL-2` deviennent
  des ancres normalisées de moins de 12 caractères. Sa sortie porte également
  deux extraits de 207 points de code.
- `missing_evidence_ref` et `unknown_status` restent absents des cinq reçus.
  Les quatre refus sont désormais entièrement dans les deux classes
  `entity_citation_excerpt_too_long` et `ungrounded_pdf_excerpt`.

La requalification hors ligne, après injection de l'identité PDF, reproduit
les cinq décisions live : profil valide 5/5, provenance valide 1/5, accepté
1/5. Le JSON brut est entouré d'un fence dans 5/5 cas, puis valide après
normalisation du wrapper dans 5/5 cas.

## Agrégats v11

- Latence campagne : 152 066 ms cumulés, moyenne 30 413,2 ms, maximum observé
  64 120 ms.
- Usage campagne : 68 565 tokens d'entrée, 46 088 de sortie, 114 653 au total.
- Sortie acceptée : TP=5, FP=0, FN=1; P=1,000, R=0,833, F1=0,909; 21/21
  citations ont l'identité, la page et l'extrait attendus.
- Sonnet : `N-A`; la clé Anthropic est absente de l'environnement du processus.
  Aucun fichier `.env*` n'a été lu.

Le scoreur reste inchangé : seules les unités issues des nœuds `Signal` et
`DesignationEvent` comptent. Les nœuds `Bylaw` restent hors du numérateur.

## Gel et empreintes

- Commit produit v7 : `5068dda38bffe8659a85c2e51f566fb9c6ad4584`.
- Module profil : `eabeda45975ce1b546d97e6635271bc76bb6fbbbd36e89032b443135ddd8be05`.
- Module corpus : `47cf6c620e4fd5ef20791443776810dc072d7e2449cc232726f35ed8d9c4680a`.

| PDF | SHA schéma | SHA prompt |
| --- | --- | --- |
| Lac-des-Seize-Îles | `abc3eeba4122884589ba8c23267848e92b41c44eda172ea00a89ac7f361b30e2` | `a2e09d1edcfe1658452edcf54d03646ffc3b8feb1f0564bf9a2671a0a3b08737` |
| Saint-Étienne-de-Bolton | `50d88bbdc1e19e1a6824fc4cde8a85798bf0765edf2c5fd1d3e6c011ec43bd3f` | `a5b3f9f7d0dac566604c13a9ea229917e0bc112e8493076e3d0f647a5aabe2a6` |
| Valcourt | `52ae4b4378fffaedcdde92cfbc8bac046bfddccea1b80d5ae94f98d5245e50ae` | `9c46af54d100313688abfe7f679961bc7885d0f7d2035a1c3c3253cd6478f11a` |
| Saint-Barthélemy | `4d143e58beead1db7db439c52ca1613e3637b948e49f64f4ad88c832b7992b45` | `1f7a579c4c6e13465f6b0529ae8c63fa0ac2be83d48f18893070087e3e23be87` |
| Waterloo | `5374f3fae7c57fc5ea05a2142c8382989f13d921c21050941cb8d75d3f512838` | `cb8e6886ee00693442d0b6c7c23ad0b0f9b4d2743fae300ce32b1485edc5ec46` |

Le manifeste et l'oracle v11 sont identiques à v10 hors libellé de campagne;
seuls le commit profil v7 et les champs dérivés de profil, corpus, prompt,
schéma, empreinte et taille changent. Gates : gel v10↔v11 vérifié, 23/23 tests
hors réseau, cinq reçus requalifiés et score 5/5 cas. Aucun acte de production ni
merge n'a été effectué.
